import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {transformWithOxc} from 'vite-plus';
import {afterEach, beforeEach, test, vi} from 'vite-plus/test';
import type {
	Bookmark,
	BookmarkColumn,
	SavedTab,
	Session,
	Settings,
	TabLodgeMessage,
} from '../src/app/types';

// Right-click menus. Like tests/service-worker.test.ts, this runs the type-stripped service worker in a
// fresh VM context per harness. Its chrome mock is smaller but stricter about context menus: it uses the
// callback-style API of Chrome 116-122 (no promises), reports duplicate or orphaned ids through
// runtime.lastError like Chrome does, and fires storage.onChanged.
const workerPath = join(
	import.meta.dirname,
	'..',
	'extension',
	'service-worker.ts',
);
const {code: workerSource} = await transformWithOxc(
	readFileSync(workerPath, 'utf8'),
	workerPath,
	{lang: 'ts'},
);
const storageKey = 'tablodge.state';
const manifest = JSON.parse(
	readFileSync(
		join(import.meta.dirname, '..', 'extension', 'manifest.json'),
		'utf8',
	),
) as chrome.runtime.Manifest;
const appName = manifest.short_name ?? manifest.name;
const dashboardUrl = 'chrome-extension://tablodge/newtab.html';
/**
Longer than the worker's rebuild debounce (150 ms).
*/
const REBUILD_WAIT = 200;

// The mocks and the worker's debounces run on fake timers, so waiting means advancing the clock.
beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

type MockTab = {
	id: number;
	windowId: number;
	index: number;
	active: boolean;
	url?: string;
	title?: string;
	pinned?: boolean;
	highlighted?: boolean;
	groupId?: number;
};
type MenuItem = {
	id: string;
	title?: string;
	type?: string;
	parentId?: string;
	contexts?: string[];
	checked?: boolean;
	enabled?: boolean;
	targetUrlPatterns?: string[];
	documentUrlPatterns?: string[];
};
type StoredState = {
	schemaVersion: number;
	groups: Array<
		Partial<Omit<Session, 'tabs'>> & {tabs: Array<Partial<SavedTab>>}
	>;
	folders: unknown[];
	bookmarkColumns: Array<Partial<BookmarkColumn>>;
	bookmarks: Array<Partial<Bookmark>>;
	settings: Partial<Settings> & Record<string, unknown>;
	updatedAt: number;
};
type Listener = (...args: never[]) => unknown;
type ClickInfo = {
	menuItemId: string;
	linkUrl?: string;
	linkText?: string;
	selectionText?: string;
	pageUrl?: string;
	checked?: boolean;
};
type Response = {ok: boolean; error?: string; settings?: Settings} & Record<
	string,
	unknown
>;

const columns = [
	{id: 'bookmark-default', name: 'Bookmarks', createdAt: 0, isDefault: true},
	{id: 'column-reading', name: 'Reading', createdAt: 1, isDefault: false},
];

function baseState(
	settings: Record<string, unknown> = {},
	extra: Partial<StoredState> = {},
): StoredState {
	return {
		schemaVersion: 7,
		groups: [],
		folders: [{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true}],
		bookmarkColumns: structuredClone(columns),
		bookmarks: [],
		settings: {...settings},
		updatedAt: 1,
		...extra,
	};
}

function createHarness(
	initialState: StoredState,
	initialTabs: MockTab[] = [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://current.example/page',
			title: 'Current page',
		},
	],
) {
	const listeners: Record<string, Listener[]> = {};
	const on = (name: string) => ({
		addListener(callback: Listener) {
			(listeners[name] ||= []).push(callback);
		},
	});
	const fire = (name: string, ...args: unknown[]) => {
		for (const callback of listeners[name] || []) {
			(callback as (...values: unknown[]) => unknown)(...args);
		}
	};

	let messageListener:
		| ((
				message: unknown,
				sender: unknown,
				sendResponse: (response: Response) => void,
		  ) => unknown)
		| undefined;
	const state = structuredClone(initialState);
	const tabs = structuredClone(initialTabs);
	const openedTabs: MockTab[] = [];
	const updatedTabs: Array<{id: number; url?: string}> = [];
	const badges: Array<{text: string; tabId?: number}> = [];
	const warnings: string[] = [];
	const menus = new Map<string, MenuItem>();
	/**
	Errors Chrome would report through runtime.lastError (duplicate ids, missing parents).
	*/
	const menuErrors: string[] = [];
	let lastError: {message: string} | undefined;
	let nextTabId = 200;
	let lastFocusedWindowId = 10;
	const withError = (message: string, callback?: () => void) => {
		lastError = {message};
		try {
			callback?.();
		} finally {
			lastError = undefined;
		}
	};

	const chrome = {
		runtime: {
			get lastError() {
				return lastError;
			},
			getURL: (file: string) => `chrome-extension://tablodge/${file}`,
			getManifest: () => ({...manifest}),
			onMessage: {
				addListener(callback: typeof messageListener) {
					messageListener = callback;
				},
			},
			onInstalled: on('onInstalled'),
			onStartup: on('onStartup'),
		},
		storage: {
			local: {
				async get(keys: string[]) {
					return keys.includes(storageKey)
						? {[storageKey]: structuredClone(state)}
						: {};
				},
				async set(values: Record<string, unknown>) {
					if (!Object.hasOwn(values, storageKey)) {
						return;
					}

					const oldValue = structuredClone(state);
					Object.assign(state, structuredClone(values[storageKey]));
					const newValue = structuredClone(state);
					// Chrome delivers onChanged after the write, asynchronously.
					setTimeout(
						() =>
							fire(
								'storageChanged',
								{[storageKey]: {oldValue, newValue}},
								'local',
							),
						0,
					);
				},
			},
			onChanged: on('storageChanged'),
		},
		windows: {
			WINDOW_ID_NONE: -1,
			async get(id: number, options: {populate?: boolean} = {}) {
				if (id !== 10) {
					throw new Error(`Unknown window ${id}`);
				}

				return {
					id,
					type: 'normal',
					title: 'Window',
					...(options.populate && {
						tabs: tabs
							.filter((tab) => tab.windowId === id)
							.map((tab) => ({...tab})),
					}),
				};
			},
			async getLastFocused() {
				return {id: lastFocusedWindowId, type: 'normal'};
			},
			async getAll(options: {populate?: boolean} = {}) {
				return [
					{
						id: 10,
						type: 'normal',
						title: 'Window',
						...(options.populate && {tabs: tabs.map((tab) => ({...tab}))}),
					},
				];
			},
			async update(id: number) {
				lastFocusedWindowId = id;
				return {};
			},
			onFocusChanged: on('windowFocusChanged'),
		},
		tabs: {
			async query(
				query: {
					active?: boolean;
					windowId?: number;
					lastFocusedWindow?: boolean;
				} = {},
			) {
				return tabs
					.filter(
						(tab) =>
							(query.active === undefined || tab.active === query.active) &&
							(query.windowId === undefined ||
								tab.windowId === query.windowId) &&
							(!query.lastFocusedWindow ||
								tab.windowId === lastFocusedWindowId),
					)
					.map((tab) => ({...tab}));
			},
			async create(properties: Partial<MockTab>) {
				const created: MockTab = {
					id: nextTabId++,
					windowId: properties.windowId ?? lastFocusedWindowId,
					index: tabs.length,
					active: Boolean(properties.active),
					...properties,
				};
				tabs.push(created);
				openedTabs.push({...created});
				return {...created};
			},
			async update(id: number, properties: Partial<MockTab>) {
				const tab = tabs.find((entry) => entry.id === id);
				if (!tab) {
					throw new Error(`Unknown tab ${id}`);
				}

				Object.assign(tab, properties);
				updatedTabs.push({id, url: properties.url});
				return {...tab};
			},
			async move(id: number) {
				return {...tabs.find((entry) => entry.id === id)!};
			},
			async remove(ids: number | number[]) {
				for (const id of Array.isArray(ids) ? ids : [ids]) {
					const index = tabs.findIndex((tab) => tab.id === id);
					if (index !== -1) {
						tabs.splice(index, 1);
					}
				}
			},
			onActivated: on('tabActivated'),
			onUpdated: on('tabUpdated'),
		},
		tabGroups: {
			async query() {
				return [];
			},
		},
		bookmarks: {
			async getTree() {
				return [];
			},
		},
		action: {
			async setPopup() {},
			async setBadgeText(details: {text: string; tabId?: number}) {
				badges.push({...details});
			},
			async setBadgeBackgroundColor() {},
			onClicked: on('actionClicked'),
		},
		sidePanel: {
			async open() {},
			async setOptions() {},
			async setPanelBehavior() {},
		},
		commands: {onCommand: on('onCommand')},
		contextMenus: {
			ACTION_MENU_TOP_LEVEL_LIMIT: 6,
			// Callback-style, as on Chrome 116-122: nothing is returned.
			removeAll(callback?: () => void) {
				menus.clear();
				setTimeout(() => callback?.(), 0);
			},
			create(item: MenuItem, callback?: () => void) {
				if (menus.has(item.id)) {
					menuErrors.push(`duplicate:${item.id}`);
					withError(
						`Cannot create item with duplicate id ${item.id}`,
						callback,
					);
					return;
				}

				if (item.parentId !== undefined && !menus.has(item.parentId)) {
					menuErrors.push(`orphan:${item.id}`);
					withError(`Cannot find menu item with id ${item.parentId}`, callback);
					return;
				}

				menus.set(item.id, structuredClone(item));
				if (callback) {
					setTimeout(callback, 0);
				}
			},
			update(id: string, properties: Partial<MenuItem>, callback?: () => void) {
				const item = menus.get(id);
				if (!item) {
					withError(`Cannot find menu item with id ${id}`, callback);
					return;
				}

				Object.assign(item, properties);
				if (callback) {
					setTimeout(callback, 0);
				}
			},
			onClicked: on('menuClicked'),
		},
	};

	const capturedConsole = {
		...console,
		warn(...args: unknown[]) {
			warnings.push(String(args[0]));
		},
		info: () => undefined,
	};
	const context = vm.createContext({
		chrome,
		URL,
		URLSearchParams,
		console: capturedConsole,
		crypto: webcrypto,
		globalThis: null,
		setTimeout,
		clearTimeout,
	});
	context.globalThis = context;
	vm.runInContext(workerSource, context, {filename: workerPath});

	const items = () => [...menus.values()];
	return {
		state,
		tabs,
		openedTabs,
		updatedTabs,
		badges,
		warnings,
		menuErrors,
		items,
		ids: () => items().map((item) => item.id),
		item: (id: string) => menus.get(id),
		childrenOf: (parentId: string) =>
			items().filter((item) => item.parentId === parentId),
		topLevel: (contextName: string) =>
			items().filter(
				(item) =>
					item.parentId === undefined && item.contexts?.includes(contextName),
			),
		async install() {
			fire('onInstalled', {reason: 'update'});
			await wait(REBUILD_WAIT);
		},
		async click(
			info: ClickInfo,
			tab: Partial<MockTab> | undefined = {
				id: 1,
				windowId: 10,
				url: 'https://current.example/page',
				title: 'Current page',
			},
		) {
			fire('menuClicked', info, tab);
			await wait(50);
		},
		fire,
		send(message: TabLodgeMessage) {
			return untilSettled(
				new Promise<Response>((resolve) => {
					messageListener!(message, {tab: {id: 1, windowId: 10}}, resolve);
				}),
			);
		},
	};
}

const wait = async (ms: number) => vi.advanceTimersByTimeAsync(ms);
/**
Advances the fake clock until the promise settles, for responses that wait on mock callbacks scheduled with setTimeout.
*/
async function untilSettled<T>(promise: Promise<T>) {
	const state = {settled: false};
	const result = promise.finally(() => {
		state.settled = true;
	});
	while (!state.settled) {
		await vi.advanceTimersByTimeAsync(1);
	}

	return result;
}

const titles = (items: MenuItem[]) =>
	items.map((item) => (item.type === 'separator' ? '---' : item.title));

test('default settings build one parent per context, plus the toolbar menu', async () => {
	const harness = createHarness(baseState());
	await harness.install();
	assert.deepEqual(harness.menuErrors, []);

	const linkRoots = harness.topLevel('link');
	assert.deepEqual(
		linkRoots.map((item) => item.id),
		['tablodge-link-root'],
	);
	assert.equal(
		linkRoots[0].title,
		appName,
		'menu titles use the manifest short_name',
	);
	assert.deepEqual(linkRoots[0].targetUrlPatterns, [
		'http://*/*',
		'https://*/*',
	]);
	assert.deepEqual(titles(harness.childrenOf('tablodge-link-root')), [
		'Bookmark link to',
		'Save link for later',
	]);
	assert.deepEqual(titles(harness.childrenOf('tablodge-link-bookmark')), [
		'Bookmarks',
		'Reading',
		'---',
		'New column',
	]);
	assert.deepEqual(
		harness
			.childrenOf('tablodge-link-bookmark')
			.map((item) => item.id)
			.slice(0, 3),
		[
			'tablodge-link-bookmark:bookmark-default',
			'tablodge-link-bookmark:column-reading',
			'tablodge-link-bookmark-separator',
		],
	);

	const pageRoots = harness.topLevel('page');
	assert.deepEqual(
		pageRoots.map((item) => item.id),
		['tablodge-page-root'],
	);
	assert.deepEqual(pageRoots[0].contexts, ['page', 'frame']);
	assert.deepEqual(titles(harness.childrenOf('tablodge-page-root')), [
		'Bookmark this page to',
		'---',
		'Save this tab',
		'Save this window',
		'Save selected tabs',
		'Save tabs to the left',
		'Save tabs to the right',
		'Save all tabs except this one',
		'Save this tab group',
		'Save tabs from all windows',
	]);
	assert.deepEqual(titles(harness.childrenOf('tablodge-page-bookmark')), [
		'Bookmarks',
		'Reading',
		'---',
		'New column',
	]);

	assert.deepEqual(
		harness.topLevel('selection').map((item) => item.id),
		['tablodge-selection-root'],
	);
	assert.deepEqual(titles(harness.childrenOf('tablodge-selection-root')), [
		'Search saved tabs & bookmarks for “%s”',
	]);

	const action = harness.topLevel('action');
	assert.deepEqual(titles(action), [
		'Open dashboard',
		'Open side panel',
		'Save this window',
		'Exclude this site from saves',
		'Help',
		'Settings',
	]);
	assert.equal(harness.item('tablodge-action-exclude')?.type, 'checkbox');
	assert.equal(harness.item('tablodge-action-exclude')?.checked, false);
});

test('the master switch and each group switch control their menus', async () => {
	const off = createHarness(baseState({contextMenusEnabled: false}));
	await off.install();
	assert.deepEqual(off.ids(), []);

	const cases: Array<[keyof Settings, string, string]> = [
		['contextMenuLinksEnabled', 'link', 'tablodge-link-root'],
		['contextMenuPageEnabled', 'page', 'tablodge-page-root'],
		['contextMenuSelectionEnabled', 'selection', 'tablodge-selection-root'],
		['contextMenuActionEnabled', 'action', 'tablodge-action-open'],
	];
	for (const [setting, context, id] of cases) {
		const harness = createHarness(baseState({[setting]: false}));
		await harness.install();
		assert.equal(harness.item(id), undefined, `${setting} off removes ${id}`);
		assert.deepEqual(
			harness.topLevel(context),
			[],
			`${setting} off leaves no ${context} items`,
		);
		const otherCases = cases.filter(([other]) => other !== setting);
		for (const [, otherContext] of otherCases) {
			assert.ok(
				harness.topLevel(otherContext).length,
				`${setting} off keeps ${otherContext}`,
			);
		}
	}
});

test('disabled systems drop their items', async () => {
	const noSessions = createHarness(baseState({sessionsEnabled: false}));
	await noSessions.install();
	assert.deepEqual(titles(noSessions.childrenOf('tablodge-link-root')), [
		'Bookmark link to',
	]);
	assert.deepEqual(titles(noSessions.childrenOf('tablodge-page-root')), [
		'Bookmark this page to',
	]);
	assert.deepEqual(titles(noSessions.topLevel('action')), [
		'Open dashboard',
		'Open side panel',
		'Help',
		'Settings',
	]);

	const noBookmarks = createHarness(baseState({bookmarksEnabled: false}));
	await noBookmarks.install();
	assert.deepEqual(titles(noBookmarks.childrenOf('tablodge-link-root')), [
		'Save link for later',
	]);
	assert.equal(
		noBookmarks.childrenOf('tablodge-page-root')[0].title,
		'Save this tab',
		'no leading separator without the bookmark submenu',
	);
	assert.equal(
		noBookmarks.ids().some((id) => id.includes('bookmark')),
		false,
	);
});

test('settings default to on, normalize, and rebuild the menus immediately', async () => {
	const harness = createHarness(
		baseState({
			contextMenuLinksEnabled: 'no',
			contextMenuPageEnabled: 0,
			contextMenuSelectionEnabled: null,
		}),
	);
	const initial = await harness.send({type: 'GET_STATE'});
	const settings = initial.settings!;
	// Only an explicit false switches a group off; other stored values fall back to the default (on).
	assert.equal(settings.contextMenusEnabled, true);
	assert.equal(settings.contextMenuLinksEnabled, true);
	assert.equal(settings.contextMenuPageEnabled, true);
	assert.equal(settings.contextMenuSelectionEnabled, true);
	assert.equal(settings.contextMenuActionEnabled, true);
	await harness.install();

	const result = await harness.send({
		type: 'UPDATE_SETTINGS',
		settings: {contextMenuLinksEnabled: false},
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.settings!.contextMenuLinksEnabled, false);
	assert.equal(
		harness.item('tablodge-link-root'),
		undefined,
		'the rebuild finishes before UPDATE_SETTINGS responds',
	);
	assert.ok(harness.item('tablodge-page-root'));

	await harness.send({
		type: 'UPDATE_SETTINGS',
		settings: {contextMenusEnabled: false},
	});
	assert.deepEqual(harness.ids(), []);
	const reset = await harness.send({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings!.contextMenuLinksEnabled, true);
	assert.ok(
		harness.item('tablodge-link-root'),
		'restoring defaults brings the menus back',
	);
	await wait(REBUILD_WAIT);
	assert.deepEqual(harness.menuErrors, []);
});

test('menus follow column additions, renames, reorders and deletions without duplicate ids', async () => {
	const harness = createHarness(baseState());
	await harness.install();
	const columnTitles = () =>
		titles(harness.childrenOf('tablodge-link-bookmark'));

	const created = await harness.send({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'Recipes',
	});
	assert.equal(created.ok, true, created.error);
	const recipesId = (created.column as BookmarkColumn).id;
	await wait(REBUILD_WAIT);
	assert.deepEqual(columnTitles(), [
		'Bookmarks',
		'Reading',
		'Recipes',
		'---',
		'New column',
	]);
	assert.ok(
		harness.item(`tablodge-page-bookmark:${recipesId}`),
		'the page submenu follows too',
	);

	await harness.send({
		type: 'UPDATE_BOOKMARK_COLUMN',
		columnId: 'column-reading',
		name: 'Read later',
	});
	await wait(REBUILD_WAIT);
	assert.deepEqual(columnTitles(), [
		'Bookmarks',
		'Read later',
		'Recipes',
		'---',
		'New column',
	]);

	await harness.send({
		type: 'REORDER_BOOKMARK_COLUMN',
		columnId: recipesId,
		targetColumnId: 'bookmark-default',
		position: 'before',
	});
	await wait(REBUILD_WAIT);
	assert.deepEqual(columnTitles(), [
		'Recipes',
		'Bookmarks',
		'Read later',
		'---',
		'New column',
	]);

	await harness.send({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'column-reading',
	});
	await wait(REBUILD_WAIT);
	assert.deepEqual(columnTitles(), [
		'Recipes',
		'Bookmarks',
		'---',
		'New column',
	]);

	// A burst of changes, settings updates and lifecycle events at once still never creates an id twice.
	await Promise.all([
		harness.send({type: 'CREATE_BOOKMARK_COLUMN', name: 'One'}),
		harness.send({type: 'CREATE_BOOKMARK_COLUMN', name: 'Two'}),
		harness.send({
			type: 'UPDATE_SETTINGS',
			settings: {contextMenuSelectionEnabled: false},
		}),
		harness.send({
			type: 'UPDATE_SETTINGS',
			settings: {contextMenuSelectionEnabled: true},
		}),
	]);
	harness.fire('onStartup');
	harness.fire('onInstalled', {reason: 'update'});
	await wait(REBUILD_WAIT * 2);
	assert.deepEqual(columnTitles(), [
		'Recipes',
		'Bookmarks',
		'One',
		'Two',
		'---',
		'New column',
	]);
	assert.ok(harness.item('tablodge-selection-search'));
	assert.deepEqual(harness.menuErrors, [], 'no duplicate or orphaned ids');
	assert.deepEqual(harness.warnings, []);
});

test('unrelated storage writes do not rebuild the menus', async () => {
	const harness = createHarness(baseState());
	await harness.install();
	const before = harness.item('tablodge-link-root');
	await harness.send({
		type: 'ADD_BOOKMARK',
		bookmark: {url: 'https://unrelated.example/', title: 'Unrelated'},
	});
	await wait(REBUILD_WAIT);
	assert.equal(
		harness.item('tablodge-link-root'),
		before,
		'the same menu objects remain',
	);
});

test('bookmarking a link into a column uses the link text, falls back to the host, and skips copies', async () => {
	const harness = createHarness(baseState());
	await harness.install();
	await harness.click({
		menuItemId: 'tablodge-link-bookmark:column-reading',
		linkUrl: 'https://news.example/story?id=4',
		linkText: '  A good story ',
	});
	await harness.click({
		menuItemId: 'tablodge-link-bookmark:bookmark-default',
		linkUrl: 'https://www.docs.example/guide/intro',
	});
	await harness.click({
		menuItemId: 'tablodge-link-bookmark:column-reading',
		linkUrl: 'https://news.example/story?id=4',
		linkText: 'Again',
	});
	assert.deepEqual(
		harness.state.bookmarks.map(({title, url, columnId}) => ({
			title,
			url,
			columnId,
		})),
		[
			{
				title: 'A good story',
				url: 'https://news.example/story?id=4',
				columnId: 'column-reading',
			},
			{
				title: 'docs.example',
				url: 'https://www.docs.example/guide/intro',
				columnId: 'bookmark-default',
			},
		],
	);
	assert.deepEqual(
		harness.badges.filter((badge) => badge.text).map((badge) => badge.text),
		['✓', '✓', '✓'],
	);
	assert.equal(
		harness.badges[0].tabId,
		1,
		'the badge is set on the clicked tab only',
	);
	assert.deepEqual(harness.openedTabs, [], 'bookmarking never opens the link');

	await harness.click({
		menuItemId: 'tablodge-link-bookmark:column-gone',
		linkUrl: 'https://news.example/other',
	});
	assert.deepEqual(harness.warnings, [
		'That bookmark column no longer exists.',
	]);
	assert.equal(harness.badges.at(-1)?.text, '!');
	assert.equal(harness.state.bookmarks.length, 2);
});

test('bookmarking this page uses the tab title and the chosen column', async () => {
	const harness = createHarness(baseState());
	await harness.install();
	await harness.click({
		menuItemId: 'tablodge-page-bookmark:bookmark-default',
		pageUrl: 'https://current.example/page',
	});
	assert.deepEqual(
		harness.state.bookmarks.map(({title, url, columnId}) => ({
			title,
			url,
			columnId,
		})),
		[
			{
				title: 'Current page',
				url: 'https://current.example/page',
				columnId: 'bookmark-default',
			},
		],
	);
});

test('New column opens the dashboard with a prefilled add-bookmark dialog', async () => {
	const harness = createHarness(baseState());
	await harness.install();
	await harness.click({
		menuItemId: 'tablodge-link-bookmark-new',
		linkUrl: 'https://news.example/a',
		linkText: 'Story A',
	});
	const opened = new URL(harness.openedTabs[0].url!);
	assert.equal(harness.openedTabs[0].url!.split('?', 1)[0], dashboardUrl);
	assert.equal(
		opened.searchParams.get('bookmarkUrl'),
		'https://news.example/a',
	);
	assert.equal(opened.searchParams.get('bookmarkTitle'), 'Story A');
	assert.equal(opened.searchParams.get('bookmarkColumn'), 'new');
	assert.equal(
		harness.state.bookmarks.length,
		0,
		'nothing is saved until the dialog is submitted',
	);

	// A second request reuses the open dashboard tab.
	await harness.click({
		menuItemId: 'tablodge-page-bookmark-new',
		pageUrl: 'https://current.example/page',
	});
	assert.equal(harness.openedTabs.length, 1);
	assert.equal(
		new URL(harness.updatedTabs.at(-1)!.url!).searchParams.get('bookmarkTitle'),
		'Current page',
	);
});

test('Save link for later creates the Saved links session, appends to it, and skips duplicates', async () => {
	const harness = createHarness(
		baseState(
			{},
			{
				groups: [
					{
						id: 'other',
						name: 'Research',
						folderId: 'unfiled',
						createdAt: 1,
						updatedAt: 1,
						tabs: [
							{
								id: 't1',
								title: 'Kept title',
								url: 'https://shared.example/',
								notes: 'shared note',
							},
						],
					},
				],
			},
		),
	);
	await harness.install();
	await harness.click({
		menuItemId: 'tablodge-link-save',
		linkUrl: 'https://one.example/a',
		linkText: 'First link',
	});
	const savedLinks = () =>
		harness.state.groups.find((group) => group.name === 'Saved links');
	assert.ok(savedLinks(), 'the session is created');
	assert.equal(
		harness.state.groups[0].name,
		'Saved links',
		'a new session is listed first',
	);
	assert.deepEqual(
		savedLinks()!.tabs.map((tab) => tab.title),
		['First link'],
	);

	await harness.click({
		menuItemId: 'tablodge-link-save',
		linkUrl: 'https://two.example/',
	});
	await harness.click({
		menuItemId: 'tablodge-link-save',
		linkUrl: 'https://one.example/a',
		linkText: 'Duplicate',
	});
	// A URL saved elsewhere is allowed by default, sharing that copy's title and notes.
	await harness.click({
		menuItemId: 'tablodge-link-save',
		linkUrl: 'https://shared.example/',
		linkText: 'New title',
	});
	assert.equal(
		harness.state.groups.filter((group) => group.name === 'Saved links').length,
		1,
		'one Saved links session',
	);
	assert.deepEqual(
		savedLinks()!.tabs.map(({title, url, notes}) => ({title, url, notes})),
		[
			{title: 'First link', url: 'https://one.example/a', notes: ''},
			{title: 'two.example', url: 'https://two.example/', notes: ''},
			{
				title: 'Kept title',
				url: 'https://shared.example/',
				notes: 'shared note',
			},
		],
	);
	assert.deepEqual(harness.openedTabs, [], 'the link is never opened');
	assert.deepEqual(
		harness.tabs.map((tab) => tab.id),
		[1],
		'no tab is closed',
	);
	assert.deepEqual(harness.warnings, []);
});

test('Save link for later respects rejected duplicates and appends to an existing Saved links session', async () => {
	const harness = createHarness(
		baseState(
			{saveDuplicateHandling: 'reject'},
			{
				groups: [
					{
						id: 'saved-links',
						name: 'Saved links',
						folderId: 'unfiled',
						createdAt: 1,
						updatedAt: 1,
						tabs: [{id: 't1', title: 'Old', url: 'https://old.example/'}],
					},
				],
			},
		),
	);
	await harness.install();
	await harness.click({
		menuItemId: 'tablodge-link-save',
		linkUrl: 'https://old.example/',
	});
	assert.equal(
		harness.state.groups.length,
		1,
		'a URL saved anywhere is rejected',
	);
	await harness.click({
		menuItemId: 'tablodge-link-save',
		linkUrl: 'https://new.example/',
		linkText: 'New',
	});
	assert.equal(
		harness.state.groups.length,
		1,
		'the existing Saved links session is reused',
	);
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => tab.url),
		['https://old.example/', 'https://new.example/'],
	);
});

test('the selection search opens the dashboard with ?q=', async () => {
	const harness = createHarness(baseState());
	await harness.install();
	await harness.click({
		menuItemId: 'tablodge-selection-search',
		selectionText: '  split\n view   tabs ',
	});
	assert.equal(harness.openedTabs.length, 1);
	assert.equal(harness.openedTabs[0].url, `${dashboardUrl}?q=split+view+tabs`);
	assert.deepEqual(harness.badges, [], 'opening a page needs no badge');
});

test('the toolbar exclude toggle adds and removes the active site and tracks the active tab', async () => {
	const harness = createHarness(
		baseState({excludedOrigins: ['https://other.example']}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://current.example/page',
				title: 'Current',
			},
			{
				id: 2,
				windowId: 10,
				index: 1,
				active: false,
				url: 'https://other.example/x',
				title: 'Other',
			},
			{
				id: 3,
				windowId: 10,
				index: 2,
				active: false,
				url: 'chrome://settings/',
				title: 'Settings',
			},
		],
	);
	await harness.install();
	const tab = {id: 1, windowId: 10, url: 'https://current.example/page'};
	await harness.click(
		{menuItemId: 'tablodge-action-exclude', checked: true},
		tab,
	);
	assert.deepEqual(harness.state.settings.excludedOrigins, [
		'other.example',
		'current.example',
	]);
	assert.equal(harness.item('tablodge-action-exclude')?.checked, true);

	await harness.click(
		{menuItemId: 'tablodge-action-exclude', checked: false},
		tab,
	);
	assert.deepEqual(harness.state.settings.excludedOrigins, ['other.example']);
	assert.equal(harness.item('tablodge-action-exclude')?.checked, false);
	assert.deepEqual(
		harness.badges.filter((badge) => badge.text).map((badge) => badge.text),
		['✓', '✓'],
	);

	// Switching tabs updates the checkbox: an excluded site is checked, a non-web page disables it.
	for (const entry of harness.tabs) {
		entry.active = entry.id === 2;
	}

	harness.fire('tabActivated', {tabId: 2, windowId: 10});
	await wait(50);
	assert.equal(harness.item('tablodge-action-exclude')?.checked, true);
	for (const entry of harness.tabs) {
		entry.active = entry.id === 3;
	}

	harness.fire('tabActivated', {tabId: 3, windowId: 10});
	await wait(50);
	assert.deepEqual(
		[
			harness.item('tablodge-action-exclude')?.checked,
			harness.item('tablodge-action-exclude')?.enabled,
		],
		[false, false],
	);

	await harness.click(
		{menuItemId: 'tablodge-action-exclude'},
		{id: 3, windowId: 10, url: 'chrome://settings/'},
	);
	assert.deepEqual(harness.warnings, [
		'Open a regular web page to exclude its site.',
	]);
	assert.deepEqual(harness.state.settings.excludedOrigins, ['other.example']);

	// Exclusions changed in Settings also update the checkbox.
	for (const entry of harness.tabs) {
		entry.active = entry.id === 1;
	}

	await harness.send({
		type: 'ADD_EXCLUDED_ORIGIN',
		origin: 'https://current.example',
	});
	await wait(50);
	assert.equal(harness.item('tablodge-action-exclude')?.checked, true);
});

test('the toolbar exclude item matches hosts with a trailing dot and is off for single-label hosts', async () => {
	const harness = createHarness(
		baseState({excludedOrigins: ['https://other.example']}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://other.example./x',
				title: 'Dotted',
			},
			{
				id: 2,
				windowId: 10,
				index: 1,
				active: false,
				url: 'http://wiki/page',
				title: 'Wiki',
			},
		],
	);
	await harness.install();
	harness.fire('tabActivated', {tabId: 1, windowId: 10});
	await wait(50);
	assert.equal(harness.item('tablodge-action-exclude')?.checked, true);
	for (const entry of harness.tabs) {
		entry.active = entry.id === 2;
	}

	harness.fire('tabActivated', {tabId: 2, windowId: 10});
	await wait(50);
	assert.deepEqual(
		[
			harness.item('tablodge-action-exclude')?.checked,
			harness.item('tablodge-action-exclude')?.enabled,
		],
		[false, false],
	);
});

test('toolbar items open the dashboard, Help and Settings, and save the window', async () => {
	const harness = createHarness(baseState({closeOnSave: false}), [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://current.example/page',
			title: 'Current',
		},
		{
			id: 2,
			windowId: 10,
			index: 1,
			active: false,
			url: 'https://second.example/',
			title: 'Second',
		},
	]);
	await harness.install();
	await harness.click({menuItemId: 'tablodge-action-open'});
	await harness.click({menuItemId: 'tablodge-action-help'});
	await harness.click({menuItemId: 'tablodge-action-settings'});
	assert.deepEqual(
		harness.openedTabs.map((tab) => tab.url),
		[
			dashboardUrl,
			'chrome-extension://tablodge/help.html',
			'chrome-extension://tablodge/options.html',
		],
	);
	await harness.click({menuItemId: 'tablodge-action-save-window'});
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => tab.url),
		['https://current.example/page', 'https://second.example/'],
	);
	assert.equal(harness.badges.find((badge) => badge.text)?.text, '✓');
});

test('menu actions never throw when an action fails', async () => {
	const harness = createHarness(baseState({sessionsEnabled: false}));
	await harness.install();
	await harness.click({
		menuItemId: 'tablodge-link-save',
		linkUrl: 'https://one.example/',
	});
	await harness.click({
		menuItemId: 'tablodge-link-bookmark:bookmark-default',
		linkUrl: 'javascript:alert(1)',
	});
	await harness.click({menuItemId: 'tablodge-page-save-tab'}, undefined);
	assert.deepEqual(harness.warnings, [
		'Sessions are disabled in Settings.',
		'Only http and https links can be saved.',
		'Sessions are disabled in Settings.',
	]);
	assert.equal(harness.state.groups.length, 0);
});
