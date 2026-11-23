import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {afterEach, beforeEach, test, vi} from 'vite-plus/test';
import type {
	Bookmark,
	BookmarkColumn,
	SavedTab,
	Session,
	Settings,
	TabLodgeMessage,
} from '../src/shared/types';
import {BOOKMARK_UNFILED_ID} from '../src/shared/bookmark-rules';
import {logicalState, sortKeysDeep, storeLibrary} from './library-fixtures';
import {buildWorkerSource} from './worker-source';

// Right-click menus. Like tests/service-worker.test.ts, this runs the type-stripped service worker in a
// fresh VM context per harness. Its chrome mock is smaller but stricter about context menus: it uses the
// callback-style API of Chrome 116-122 (no promises), reports duplicate or orphaned ids through
// runtime.lastError like Chrome does, and fires storage.onChanged.
const workerPath = join(
	import.meta.dirname,
	'..',
	'shell',
	'service-worker.ts',
);
const workerSource = await buildWorkerSource();
const manifest = JSON.parse(
	readFileSync(
		join(import.meta.dirname, '..', 'shell', 'manifest.json'),
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
	srcUrl?: string;
	mediaType?: string;
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
	{
		firefox = false,
		userAgent = '',
		listsTabContext = true,
		scriptingFails = false,
	}: {
		firefox?: boolean;
		userAgent?: string;
		listsTabContext?: boolean;
		/**
		Chrome.scripting.executeScript rejects, as on pages an extension cannot script.
		*/
		scriptingFails?: boolean;
	} = {},
) {
	const listeners: Record<string, Listener[]> = {};
	const on = (name: string) => ({
		addListener(callback: Listener) {
			(listeners[name] ||= []).push(callback);
		},
		removeListener(callback: Listener) {
			const callbacks = listeners[name];
			const index = callbacks?.indexOf(callback) ?? -1;
			if (index >= 0) {
				callbacks.splice(index, 1);
			}
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
	// Storage holds every key the worker writes; `state` mirrors the library the way the app sees it.
	const stored: Record<string, unknown> = {};
	storeLibrary(stored, structuredClone(initialState));
	const state = (logicalState(stored) ?? {}) as typeof initialState;
	const pullState = () => {
		for (const key of Object.keys(state)) {
			Reflect.deleteProperty(state, key);
		}

		Object.assign(state, logicalState(stored));
	};

	const sessionStorage: Record<string, unknown> = {};
	const tabs = structuredClone(initialTabs);
	const openedTabs: MockTab[] = [];
	const updatedTabs: Array<{id: number; url?: string}> = [];
	const badges: Array<{text: string; tabId?: number}> = [];
	const warnings: string[] = [];
	const toasts: Array<{
		tabId: number;
		message: string;
		failed: boolean;
		undo?: {id: string};
		theme: string;
	}> = [];
	const menus = new Map<string, MenuItem>();
	/**
	Errors Chrome would report through runtime.lastError (duplicate ids, missing parents).
	*/
	const menuErrors: string[] = [];
	let lastError: {message: string} | undefined;
	let nextTabId = 200;
	let lastFocusedWindowId = 10;
	let refreshes = 0;
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
			getURL: (file: string) =>
				`${firefox ? 'moz' : 'chrome'}-extension://tablodge/${file}`,
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
			session: {
				async get(keys: string | string[]) {
					return Object.fromEntries(
						[keys]
							.flat()
							.filter((key) => Object.hasOwn(sessionStorage, key))
							.map((key) => [key, structuredClone(sessionStorage[key])]),
					);
				},
				async set(values: Record<string, unknown>) {
					Object.assign(sessionStorage, structuredClone(values));
				},
				async remove(keys: string | string[]) {
					for (const key of [keys].flat()) {
						Reflect.deleteProperty(sessionStorage, key);
					}
				},
			},
			local: {
				async get(keys: string[]) {
					return Object.fromEntries(
						keys
							.filter((key) => Object.hasOwn(stored, key))
							.map((key) => [key, sortKeysDeep(structuredClone(stored[key]))]),
					);
				},
				async set(values: Record<string, unknown>) {
					const changes = Object.fromEntries(
						Object.entries(values).map(([key, value]) => [
							key,
							{
								oldValue: structuredClone(stored[key]),
								newValue: structuredClone(value),
							},
						]),
					);
					for (const [key, value] of Object.entries(values)) {
						stored[key] = structuredClone(value);
					}

					pullState();
					// Chrome delivers onChanged after the write, asynchronously.
					setTimeout(() => {
						fire('storageChanged', changes, 'local');
					}, 0);
				},
				async remove(keys: string | string[]) {
					for (const key of [keys].flat()) {
						Reflect.deleteProperty(stored, key);
					}

					pullState();
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
		scripting: {
			async executeScript(injection: {
				target: {tabId: number};
				args: [Omit<(typeof toasts)[number], 'tabId'>];
			}) {
				if (scriptingFails) {
					throw new Error('Cannot access contents of the page.');
				}

				toasts.push({tabId: injection.target.tabId, ...injection.args[0]});
				return [{result: true}];
			},
		},
		sidePanel: {
			async open() {},
			async setOptions() {},
			async setPanelBehavior() {},
		},
		commands: {onCommand: on('onCommand')},
		contextMenus: {
			ACTION_MENU_TOP_LEVEL_LIMIT: 6,
			// Firefox and Chromium 149 or newer list the tab strip's context.
			ContextType: listsTabContext
				? {PAGE: 'page', TAB: 'tab'}
				: {PAGE: 'page'},
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
			...(firefox && {
				onShown: on('menuShown'),
				refresh() {
					refreshes++;
				},
			}),
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
		navigator: {userAgent},
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
		toasts,
		menuErrors,
		refreshes: () => refreshes,
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
					messageListener!(
						message,
						{
							tab: {id: 1, windowId: 10},
							url: `${firefox ? 'moz' : 'chrome'}-extension://tablodge/newtab.html`,
						},
						resolve,
					);
				}),
			);
		},
		/**
		A message from code injected into the web page in tab `tabId`, as the Save quote toast sends it.
		*/
		sendFromPage(message: TabLodgeMessage, tabId = 1) {
			return untilSettled(
				new Promise<Response>((resolve) => {
					messageListener!(
						message,
						{
							tab: {id: tabId, windowId: 10},
							url: 'https://current.example/page',
						},
						resolve,
					);
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
	assert.ok(
		harness.items().every((item) => !item.contexts?.includes('tab')),
		'a Chromium of unknown version gets no tab strip items, although it lists the context',
	);
	assert.deepEqual(titles(harness.childrenOf('tablodge-page-root')), [
		'Bookmark this page to',
		'Send this tab to session',
		'Keep a copy',
		'---',
		'Save selected tabs',
		'Save this window',
		'Save tabs from all windows',
	]);
	assert.deepEqual(titles(harness.childrenOf('tablodge-page-bookmark')), [
		'Bookmarks',
		'Reading',
		'---',
		'New column',
	]);
	assert.deepEqual(
		titles(harness.childrenOf('tablodge-page-send')),
		['New session'],
		'with no saved sessions the picker only offers a new one',
	);

	assert.deepEqual(
		harness.topLevel('selection').map((item) => item.id),
		['tablodge-selection-root'],
	);
	assert.deepEqual(titles(harness.childrenOf('tablodge-selection-root')), [
		'Search saved tabs & bookmarks for “%s”',
		'Save quote',
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
		['✓', '✓', '='],
		'a skipped duplicate flashes its own mark, never the success tick',
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

test('image and video menus list the columns under one root each', async () => {
	const harness = createHarness(baseState());
	await harness.install();
	for (const [root, bookmark, title, contexts] of [
		[
			'tablodge-image-root',
			'tablodge-image-bookmark',
			'Bookmark image to',
			['image'],
		],
		[
			'tablodge-media-root',
			'tablodge-media-bookmark',
			'Bookmark video to',
			['video', 'audio'],
		],
	] as const) {
		assert.equal(harness.item(root)?.title, appName);
		assert.equal(harness.item(root)?.parentId, undefined);
		assert.deepEqual(harness.item(root)?.contexts, contexts);
		assert.deepEqual(titles(harness.childrenOf(root)), [title]);
		assert.deepEqual(titles(harness.childrenOf(bookmark)), [
			'Bookmarks',
			'Reading',
			'---',
			'New column',
		]);
	}

	// Only web images have an address to save; a stream needs a web page to fall back to.
	assert.deepEqual(harness.item('tablodge-image-root')?.targetUrlPatterns, [
		'http://*/*',
		'https://*/*',
	]);
	assert.equal(
		harness.item('tablodge-media-root')?.targetUrlPatterns,
		undefined,
	);
	assert.deepEqual(harness.item('tablodge-media-root')?.documentUrlPatterns, [
		'http://*/*',
		'https://*/*',
	]);
	assert.deepEqual(
		['image', 'video', 'audio'].map(
			(context) => harness.topLevel(context).length,
		),
		[1, 1, 1],
		'one root per context',
	);
});

test('Bookmark image to saves the image address, and skips one saved in any column (when duplicates are rejected) or in the trash', async () => {
	const harness = createHarness(
		baseState(
			{saveDuplicateHandling: 'reject'},
			{
				bookmarks: [
					{
						id: 'b0',
						title: 'Old image',
						url: 'https://cdn.example/old.png',
						columnId: 'bookmark-default',
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
		),
	);
	await harness.install();
	const save = async (srcUrl: string) =>
		harness.click({
			menuItemId: 'tablodge-image-bookmark:column-reading',
			mediaType: 'image',
			srcUrl,
			pageUrl: 'https://www.photos.example/album/2',
		});
	await save('https://cdn.example/full/cat.JPG?w=800');
	await save('https://cdn.example/full/cat.JPG?w=800');
	// Bookmarked in another column, it still counts as saved.
	await save('https://cdn.example/old.png');
	assert.deepEqual(
		harness.state.bookmarks.map(({title, url, columnId}) => ({
			title,
			url,
			columnId,
		})),
		[
			{
				title: 'Old image',
				url: 'https://cdn.example/old.png',
				columnId: 'bookmark-default',
			},
			{
				title: 'Image from photos.example',
				url: 'https://cdn.example/full/cat.JPG?w=800',
				columnId: 'column-reading',
			},
		],
	);

	const saved = harness.state.bookmarks[1];
	assert.equal(
		(await harness.send({type: 'DELETE_BOOKMARK', bookmarkId: saved.id!})).ok,
		true,
	);
	await save('https://cdn.example/full/cat.JPG?w=800');
	assert.equal(
		harness.state.bookmarks.length,
		1,
		'nothing comes back from the trash',
	);
	assert.deepEqual(harness.warnings, [
		'This address is in the trash bin. Restore it from there to keep it.',
	]);
	assert.deepEqual(
		harness.badges.filter((badge) => badge.text).map((badge) => badge.text),
		['✓', '=', '=', '!'],
	);
});

test('Bookmark image to follows the duplicate setting: allowed in another column, never twice in one', async () => {
	const harness = createHarness(
		baseState(
			{saveDuplicateHandling: 'allow'},
			{
				bookmarks: [
					{
						id: 'b0',
						title: 'Old image',
						url: 'https://cdn.example/old.png',
						columnId: 'bookmark-default',
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
		),
	);
	await harness.install();
	const save = async (srcUrl: string) =>
		harness.click({
			menuItemId: 'tablodge-image-bookmark:column-reading',
			mediaType: 'image',
			srcUrl,
			pageUrl: 'https://www.photos.example/album/2',
		});
	await save('https://cdn.example/old.png');
	await save('https://cdn.example/old.png');
	assert.deepEqual(
		harness.state.bookmarks.map(({url, columnId}) => ({url, columnId})),
		[
			{url: 'https://cdn.example/old.png', columnId: 'bookmark-default'},
			{url: 'https://cdn.example/old.png', columnId: 'column-reading'},
		],
	);
	assert.deepEqual(
		harness.badges.filter((badge) => badge.text).map((badge) => badge.text),
		['✓', '='],
	);
	assert.deepEqual(harness.warnings, []);
});

test('Bookmark video to saves a video file by its address and a stream by its page', async () => {
	const harness = createHarness(baseState(), [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://www.youtube.com/watch?v=abc',
			title: '(3) A talk - YouTube',
		},
	]);
	await harness.install();
	const tab = {
		id: 1,
		windowId: 10,
		url: 'https://www.youtube.com/watch?v=abc',
		title: '(3) A talk - YouTube',
	};
	await harness.click(
		{
			menuItemId: 'tablodge-media-bookmark:bookmark-default',
			mediaType: 'video',
			srcUrl: 'blob:https://www.youtube.com/5f1e',
			pageUrl: tab.url,
		},
		tab,
	);
	await harness.click(
		{
			menuItemId: 'tablodge-media-bookmark:bookmark-default',
			mediaType: 'video',
			srcUrl: 'blob:https://www.youtube.com/other',
			pageUrl: tab.url,
		},
		tab,
	);
	await harness.click(
		{
			menuItemId: 'tablodge-media-bookmark:column-reading',
			mediaType: 'video',
			srcUrl: 'https://media.example/clip.webm',
			pageUrl: 'https://news.example/story',
		},
		{id: 1, windowId: 10, url: 'https://news.example/story', title: 'Story'},
	);
	assert.deepEqual(
		harness.state.bookmarks.map(({title, url, columnId}) => ({
			title,
			url,
			columnId,
		})),
		[
			{
				title: 'A talk - YouTube',
				url: 'https://www.youtube.com/watch?v=abc',
				columnId: 'bookmark-default',
			},
			{
				title: 'Video from news.example',
				url: 'https://media.example/clip.webm',
				columnId: 'column-reading',
			},
		],
		'the second click on the same stream is a duplicate',
	);

	await harness.click(
		{
			menuItemId: 'tablodge-media-bookmark-new',
			mediaType: 'audio',
			srcUrl: 'https://radio.example/show.mp3',
			pageUrl: 'https://radio.example/',
		},
		{id: 1, windowId: 10, url: 'https://radio.example/', title: 'Radio'},
	);
	const opened = new URL(harness.openedTabs[0].url!);
	assert.equal(
		opened.searchParams.get('bookmarkUrl'),
		'https://radio.example/show.mp3',
	);
	assert.equal(
		opened.searchParams.get('bookmarkTitle'),
		'Audio from radio.example',
	);
	assert.equal(opened.searchParams.get('bookmarkColumn'), 'new');
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

function sessionEntry(
	id: string,
	name: string,
	updatedAt: number,
	extra: Record<string, unknown> = {},
) {
	return {
		id,
		name,
		folderId: 'unfiled',
		createdAt: 1,
		updatedAt,
		tabs: [{id: `${id}-tab`, title: 'Old', url: `https://${id}.example/`}],
		...extra,
	};
}

test('the send-to-session picker lists the ten most recent sessions, skips Archived, and ends with a new session', async () => {
	const many = Array.from({length: 12}, (_, index) =>
		sessionEntry(`s${index}`, `Session ${index}`, 100 + index),
	);
	const harness = createHarness(
		baseState(
			{},
			{
				folders: [
					{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true},
					{id: 'archive', name: 'Archived', createdAt: 0},
				],
				groups: [
					...many,
					sessionEntry('old', 'Archived one', 999, {folderId: 'archive'}),
					sessionEntry('blank', '', 50),
				],
			},
		),
	);
	await harness.install();
	assert.deepEqual(harness.menuErrors, []);
	const children = harness.childrenOf('tablodge-page-send');
	assert.deepEqual(titles(children), [
		...Array.from({length: 10}, (_, index) => `Session ${11 - index}`),
		'---',
		'New session',
	]);
	assert.equal(children[0].id, 'tablodge-page-send:s11');
	assert.deepEqual(children[0].contexts, ['page', 'frame']);
	assert.equal(harness.item('tablodge-page-send:old'), undefined);
});

test('the send-to-session picker follows session renames, additions and deletions', async () => {
	const harness = createHarness(
		baseState({}, {groups: [sessionEntry('a', 'Alpha', 10)]}),
	);
	await harness.install();
	const sessionTitles = () => titles(harness.childrenOf('tablodge-page-send'));
	assert.deepEqual(sessionTitles(), ['Alpha', '---', 'New session']);

	await harness.send({
		type: 'UPDATE_GROUP',
		groupId: 'a',
		fields: {name: 'Alpha renamed'},
	});
	await wait(REBUILD_WAIT);
	assert.deepEqual(sessionTitles(), ['Alpha renamed', '---', 'New session']);

	await harness.click({
		menuItemId: 'tablodge-page-send-new',
		pageUrl: 'https://current.example/page',
	});
	await wait(REBUILD_WAIT);
	assert.equal(sessionTitles().length, 4, 'the new session joins the picker');

	await harness.send({type: 'DELETE_GROUP', groupId: 'a'});
	await wait(REBUILD_WAIT);
	assert.equal(harness.item('tablodge-page-send:a'), undefined);
	assert.deepEqual(harness.menuErrors, []);
});

test('sending this tab to a session appends it, leaves the page open when closing is off, and allows repeats', async () => {
	const harness = createHarness(
		baseState(
			{closeOnSave: false},
			{
				groups: [sessionEntry('a', 'Alpha', 10), sessionEntry('b', 'Beta', 20)],
			},
		),
	);
	await harness.install();
	await harness.click({menuItemId: 'tablodge-page-send:a'});
	const alpha = harness.state.groups.find((group) => group.id === 'a')!;
	assert.deepEqual(
		alpha.tabs.map((tab) => [tab.title, tab.url]),
		[
			['Old', 'https://a.example/'],
			['Current page', 'https://current.example/page'],
		],
	);
	assert.equal(
		harness.state.groups.find((group) => group.id === 'b')!.tabs.length,
		1,
		'other sessions are untouched',
	);
	assert.ok((alpha.updatedAt ?? 0) > 10);
	assert.equal(harness.badges.at(0)?.text, '✓');
	assert.equal(harness.tabs.length, 1, 'the tab stays open');

	// Allowed duplicates may repeat an address in another session, matching the toolbar behavior.
	await harness.click({menuItemId: 'tablodge-page-send:b'});
	assert.equal(
		harness.state.groups.find((group) => group.id === 'b')!.tabs.length,
		2,
	);
});

test('sending this tab honors rejected duplicates, excluded sites, close on save, and a vanished session', async () => {
	const rejecting = createHarness(
		baseState(
			{saveDuplicateHandling: 'reject', closeOnSave: false},
			{
				groups: [
					sessionEntry('a', 'Alpha', 10, {
						tabs: [
							{id: 't', title: 'Seen', url: 'https://current.example/page'},
						],
					}),
					sessionEntry('b', 'Beta', 20),
				],
			},
		),
	);
	await rejecting.install();
	await rejecting.click({menuItemId: 'tablodge-page-send:b'});
	assert.equal(
		rejecting.state.groups.find((group) => group.id === 'b')!.tabs.length,
		1,
		'an address saved anywhere is not added again',
	);

	const excluded = createHarness(
		baseState(
			{excludedOrigins: ['current.example']},
			{groups: [sessionEntry('a', 'Alpha', 10)]},
		),
	);
	await excluded.install();
	await excluded.click({menuItemId: 'tablodge-page-send:a'});
	assert.equal(excluded.state.groups[0].tabs.length, 1);
	assert.match(excluded.warnings.join('\n'), /no eligible web tab/);
	assert.equal(excluded.badges.at(0)?.text, '!');

	const closing = createHarness(
		baseState(
			{closeOnSave: true, openDashboardAfterSave: false},
			{groups: [sessionEntry('a', 'Alpha', 10)]},
		),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://current.example/page',
				title: 'Current page',
			},
			{
				id: 2,
				windowId: 10,
				index: 1,
				active: false,
				url: 'https://other.example/',
				title: 'Other',
			},
		],
	);
	await closing.install();
	await closing.click({menuItemId: 'tablodge-page-send:a'});
	assert.equal(closing.state.groups[0].tabs.length, 2);
	assert.deepEqual(
		closing.tabs.map((tab) => tab.id),
		[2],
		'the sent tab closes like any other save',
	);

	const missing = createHarness(
		baseState({}, {groups: [sessionEntry('a', 'Alpha', 10)]}),
	);
	await missing.install();
	await missing.click({menuItemId: 'tablodge-page-send:gone'});
	assert.match(missing.warnings.join('\n'), /no longer exists/);
	assert.equal(missing.state.groups[0].tabs.length, 1);
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

test('the selection search quotes text that would read as search operators', async () => {
	const harness = createHarness(baseState());
	await harness.install();
	await harness.click({
		menuItemId: 'tablodge-selection-search',
		selectionText: 'install -g site:npmjs.com',
	});
	const q = new URL(harness.openedTabs[0].url ?? '').searchParams.get('q');
	assert.equal(q, '"install -g site:npmjs.com"');
});

const quoted = (url: string, quote: string) => ({
	menuItemId: 'tablodge-selection-quote',
	selectionText: quote,
	pageUrl: url,
});

test('Save quote bookmarks the page with the quote and a link to it, then appends the next quote', async () => {
	const harness = createHarness(
		baseState(
			{},
			{
				bookmarks: [
					{
						id: 'older',
						url: 'https://elsewhere.example/',
						title: 'Elsewhere',
						columnId: 'column-reading',
						createdAt: 5,
						updatedAt: 5,
					},
				],
			},
		),
	);
	await harness.install();
	await harness.click(quoted('https://current.example/page', 'First quote'));
	const page = 'https://current.example/page';
	const saved = harness.state.bookmarks.find((entry) => entry.url === page);
	assert.ok(saved, 'the page is bookmarked');
	assert.equal(saved.title, 'Current page');
	assert.equal(
		saved.columnId,
		'column-reading',
		"the column the Add bookmark dialog starts on: the newest bookmark's",
	);
	assert.equal(saved.notes, `> First quote\n${page}#:~:text=First%20quote`);
	assert.equal(harness.toasts.length, 1);
	assert.equal(harness.toasts[0].message, 'Quote saved to Reading.');
	assert.equal(harness.toasts[0].failed, false);
	assert.ok(harness.toasts[0].undo);
	assert.deepEqual(harness.badges, [], 'the toast replaces the badge');

	// The page opened from the saved link reports the address with the fragment; it is still the same bookmark.
	await harness.click(
		quoted(
			`${page}#:~:text=First%20quote`,
			'Second, longer quote that runs on past eight words',
		),
	);
	const bookmarks = harness.state.bookmarks.filter(
		(entry) => entry.url === page,
	);
	assert.equal(bookmarks.length, 1);
	assert.equal(
		bookmarks[0].notes,
		`> First quote\n${page}#:~:text=First%20quote\n\n> Second, longer quote that runs on past eight words\n${page}#:~:text=Second%2C%20longer%20quote%20that,on%20past%20eight%20words`,
	);
});

test('Save quote never lands in a source column, even when it is the only column', async () => {
	const harness = createHarness(
		baseState(
			{},
			{
				bookmarkColumns: [
					{id: 'source-reddit', name: 'Reddit', createdAt: 0, isDefault: false},
				],
				bookmarks: [
					{
						id: 'post',
						url: 'https://www.reddit.com/r/a/comments/1/',
						title: 'Post',
						columnId: 'source-reddit',
						createdAt: 5,
						updatedAt: 5,
					},
				],
			},
		),
	);
	await harness.install();
	await harness.click(quoted('https://current.example/page', 'A quote'));
	const saved = harness.state.bookmarks.find(
		(entry) => entry.url === 'https://current.example/page',
	);
	assert.equal(saved?.columnId, BOOKMARK_UNFILED_ID);
});

test('Save quote goes into a saved tab of the page, and every saved copy of it', async () => {
	const page = 'https://current.example/page';
	const harness = createHarness(
		baseState(
			{},
			{
				groups: [
					{
						id: 'g1',
						name: 'Research',
						folderId: 'unfiled',
						createdAt: 1,
						updatedAt: 1,
						tabs: [{id: 't1', url: page, title: 'Page', notes: 'Mine'}],
					},
					{
						id: 'g2',
						name: 'Other',
						folderId: 'unfiled',
						createdAt: 1,
						updatedAt: 1,
						tabs: [{id: 't2', url: page, title: 'Page', notes: 'Mine'}],
					},
				],
			},
		),
	);
	await harness.install();
	await harness.click(quoted(page, 'Hi'));
	assert.equal(harness.state.bookmarks.length, 0, 'no bookmark is made');
	for (const group of harness.state.groups) {
		assert.equal(group.tabs[0].notes, `Mine\n\n> Hi\n${page}#:~:text=Hi`);
	}

	assert.equal(harness.toasts[0].message, 'Quote saved to Research.');
});

test('Save quote refuses a quote that does not fit the note and leaves it as it was', async () => {
	const page = 'https://current.example/page';
	const full = 'x'.repeat(9990);
	const harness = createHarness(
		baseState(
			{},
			{
				bookmarks: [
					{
						id: 'b1',
						url: page,
						title: 'Page',
						columnId: 'bookmark-default',
						notes: full,
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
		),
	);
	await harness.install();
	await harness.click(quoted(page, 'One more quote'));
	assert.equal(harness.state.bookmarks[0].notes, full);
	assert.equal(harness.toasts.length, 1);
	assert.equal(harness.toasts[0].failed, true);
	assert.match(harness.toasts[0].message, /note for this page is full/);
	assert.equal(harness.toasts[0].undo, undefined);
});

test('Undo from the quote toast removes the quote and the bookmark it made', async () => {
	const harness = createHarness(baseState());
	await harness.install();
	await harness.click(quoted('https://current.example/page', 'Hello'));
	assert.equal(harness.state.bookmarks.length, 1);
	const {id} = harness.toasts[0].undo!;

	// A page may not run Undo itself, and another tab may not take back this toast's quote.
	assert.equal((await harness.sendFromPage({type: 'UNDO', id})).ok, false);
	assert.equal(
		(await harness.sendFromPage({type: 'QUOTE_UNDO', id}, 2)).ok,
		false,
	);
	assert.equal(harness.state.bookmarks.length, 1);

	const response = await harness.sendFromPage({type: 'QUOTE_UNDO', id});
	assert.equal(response.ok, true);
	assert.equal(harness.state.bookmarks.length, 0);
	assert.equal(
		(await harness.sendFromPage({type: 'QUOTE_UNDO', id})).ok,
		false,
		'an undo id works once',
	);
});

test('Save quote flashes the badge where the page cannot show a toast', async () => {
	const harness = createHarness(baseState(), undefined, {scriptingFails: true});
	await harness.install();
	await harness.click(quoted('https://current.example/page', 'Hello'));
	assert.equal(harness.state.bookmarks.length, 1, 'the quote is still saved');
	assert.deepEqual(
		harness.badges.map((badge) => badge.text),
		['✓'],
	);
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
	const harness = createHarness(baseState());
	await harness.install();
	await harness.click({
		menuItemId: 'tablodge-link-bookmark:bookmark-default',
		linkUrl: 'javascript:alert(1)',
	});
	assert.deepEqual(harness.warnings, [
		'Only http and https links can be saved.',
	]);
	assert.equal(harness.state.groups.length, 0);
});

const chromeUserAgent = (major: number) =>
	`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;

const stripTabs: MockTab[] = [
	{
		id: 1,
		windowId: 10,
		index: 0,
		active: true,
		highlighted: true,
		url: 'https://current.example/page',
		title: 'Current page',
	},
	{
		id: 2,
		windowId: 10,
		index: 1,
		active: false,
		highlighted: true,
		url: 'https://second.example/',
		title: 'Second',
	},
	{
		id: 3,
		windowId: 10,
		index: 2,
		active: false,
		highlighted: false,
		url: 'https://third.example/',
		title: 'Third',
	},
];

test('Firefox puts the page items on the tab strip and retitles the bookmark item there', async () => {
	const harness = createHarness(baseState(), stripTabs, {firefox: true});
	await harness.install();
	assert.deepEqual(harness.menuErrors, []);
	assert.deepEqual(
		harness.topLevel('tab').map((item) => item.id),
		['tablodge-page-root'],
	);
	assert.ok(
		harness
			.items()
			.filter((item) => item.contexts?.includes('tab'))
			.every((item) => item.contexts?.includes('page')),
		'only page items join the tab strip',
	);

	harness.fire('menuShown', {contexts: ['tab']}, stripTabs[2]);
	await wait(10);
	assert.equal(
		harness.item('tablodge-page-bookmark')?.title,
		'Bookmark this tab to',
	);
	assert.equal(harness.refreshes(), 1);

	harness.fire('menuShown', {contexts: ['page', 'all']}, stripTabs[0]);
	await wait(10);
	assert.equal(
		harness.item('tablodge-page-bookmark')?.title,
		'Bookmark this page to',
	);
});

test('Chromium 150 puts the page items on the tab strip, with & as written and the page title kept', async () => {
	const state = baseState();
	state.bookmarkColumns.push({
		id: 'column-rd',
		name: 'R&D',
		createdAt: 3,
		isDefault: false,
	});
	const harness = createHarness(state, stripTabs, {
		userAgent: chromeUserAgent(150),
	});
	await harness.install();
	assert.deepEqual(harness.menuErrors, []);
	const idsWith = (context: string) =>
		harness
			.items()
			.filter((item) => item.contexts?.includes(context))
			.map((item) => item.id);
	assert.deepEqual(
		harness.topLevel('tab').map((item) => item.id),
		['tablodge-page-root'],
	);
	assert.deepEqual(
		idsWith('tab'),
		idsWith('page'),
		'exactly the page items join the tab strip',
	);
	assert.equal(harness.item('tablodge-page-bookmark:column-rd')?.title, 'R&D');
	assert.equal(
		harness.item('tablodge-page-bookmark')?.title,
		'Bookmark this page to',
	);
});

test('in Chromium the tab strip items refuse a tab that is not a web page', async () => {
	// Chromium ignores documentUrlPatterns in the tab strip, so the items also show on the dashboard's own tab.
	const dashboard: MockTab = {
		id: 4,
		windowId: 10,
		index: 3,
		active: false,
		highlighted: false,
		url: 'chrome-extension://tablodge/newtab.html',
		title: 'New tab',
	};
	const harness = createHarness(
		baseState({}, {groups: [sessionEntry('a', 'Alpha', 10)]}),
		[...stripTabs, dashboard],
		{userAgent: chromeUserAgent(150)},
	);
	await harness.install();
	for (const menuItemId of [
		'tablodge-page-bookmark:column-reading',
		'tablodge-page-send:a',
		'tablodge-page-send-new',
		'tablodge-page-save-selected',
	]) {
		await harness.click({menuItemId}, dashboard);
	}

	assert.deepEqual(harness.state.bookmarks, []);
	assert.deepEqual(
		harness.state.groups.map((group) => group.tabs.length),
		[1],
	);
	assert.equal(harness.warnings.length, 4);
	assert.deepEqual(
		harness.badges.filter((badge) => badge.text),
		Array.from({length: 4}, () => ({tabId: 4, text: '!'})),
	);
});

for (const [browser, options] of [
	['Firefox', {firefox: true}],
	['Chromium 150', {userAgent: chromeUserAgent(150)}],
] as const) {
	test(`${browser}: tab strip items act on the clicked tab, even when it is not the active one`, async () => {
		const harness = createHarness(
			baseState(
				{closeOnSave: false},
				{groups: [sessionEntry('a', 'Alpha', 10)]},
			),
			stripTabs,
			options,
		);
		await harness.install();
		const third = stripTabs[2];
		await harness.click(
			{menuItemId: 'tablodge-page-bookmark:column-reading'},
			third,
		);
		assert.deepEqual(
			harness.state.bookmarks.map(({url, columnId}) => [url, columnId]),
			[['https://third.example/', 'column-reading']],
		);

		await harness.click({menuItemId: 'tablodge-page-send:a'}, third);
		assert.deepEqual(
			harness.state.groups
				.find((group) => group.id === 'a')!
				.tabs.map((tab) => tab.url),
			['https://a.example/', 'https://third.example/'],
		);

		const newSessionUrls = async (menuItemId: string, tab: MockTab) => {
			const before = new Set(harness.state.groups.map((group) => group.id));
			await harness.click({menuItemId}, tab);
			return harness.state.groups
				.find((group) => !before.has(group.id))
				?.tabs.map((saved) => saved.url);
		};

		assert.deepEqual(await newSessionUrls('tablodge-page-send-new', third), [
			'https://third.example/',
		]);
		assert.deepEqual(
			await newSessionUrls('tablodge-page-save-selected', third),
			['https://third.example/'],
			'a tab outside the selection saves only itself',
		);
		assert.deepEqual(
			await newSessionUrls('tablodge-page-save-selected', stripTabs[1]),
			['https://current.example/page', 'https://second.example/'],
			'a tab inside the selection saves the selection',
		);
		assert.deepEqual(harness.warnings, []);
	});
}

const SAVED_CURRENT = sessionEntry('seen', 'Seen', 5, {
	tabs: [{id: 'seen-tab', title: 'Old', url: 'https://current.example/page'}],
});
const markOf = (harness: ReturnType<typeof createHarness>) =>
	harness.badges.filter((badge) => badge.text).map((badge) => badge.text);

test('the save-window shortcut reports a save, a skipped duplicate, and a failure on the badge', async () => {
	const harness = createHarness(
		baseState(
			{saveDuplicateHandling: 'reject', closeOnSave: false},
			{groups: []},
		),
	);
	await harness.install();
	harness.fire('onCommand', 'save-window', harness.tabs[0]);
	await wait(100);
	harness.fire('onCommand', 'save-window', harness.tabs[0]);
	await wait(100);
	assert.deepEqual(markOf(harness), ['✓', '=']);
	assert.equal(harness.state.groups.length, 1, 'the duplicate is not stored');
	assert.deepEqual(harness.warnings, [], 'a skipped duplicate is not an error');

	const empty = createHarness(baseState({closeOnSave: false}), []);
	await empty.install();
	empty.fire('onCommand', 'save-window', {id: 1, windowId: 10});
	await wait(100);
	assert.deepEqual(markOf(empty), ['!']);
	assert.equal(empty.warnings.length, 1);
});

test('the toolbar button reports the same three results, and a skipped duplicate leaves its tab open', async () => {
	const harness = createHarness(
		baseState(
			{
				saveDuplicateHandling: 'reject',
				closeOnSave: true,
				actionMode: 'current-tab-to-group',
			},
			{groups: [SAVED_CURRENT]},
		),
	);
	await harness.install();
	harness.fire('actionClicked', harness.tabs[0]);
	await wait(100);
	assert.deepEqual(markOf(harness), ['=']);
	assert.equal(harness.tabs.length, 1, 'the duplicate tab is not closed');
	assert.equal(harness.state.groups[0].tabs.length, 1);

	const allowing = createHarness(
		baseState(
			{
				saveDuplicateHandling: 'allow',
				closeOnSave: false,
				actionMode: 'current-tab-to-group',
			},
			{groups: [sessionEntry('other', 'Other', 5)]},
		),
	);
	await allowing.install();
	allowing.fire('actionClicked', allowing.tabs[0]);
	await wait(100);
	assert.deepEqual(markOf(allowing), ['✓']);
});

test('sending the current tab without a chosen session skips Archived sessions', async () => {
	const harness = createHarness(
		baseState(
			{closeOnSave: false, actionMode: 'current-tab-to-group'},
			{
				folders: [
					{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true},
					{id: 'archive', name: 'Archived', createdAt: 0},
				],
				groups: [
					sessionEntry('archived', 'Archived one', 900, {folderId: 'archive'}),
					sessionEntry('live', 'Live', 10),
				],
			},
		),
	);
	await harness.install();
	harness.fire('actionClicked', harness.tabs[0]);
	await wait(100);
	assert.equal(
		harness.state.groups.find((group) => group.id === 'live')!.tabs.length,
		2,
	);
	assert.equal(
		harness.state.groups.find((group) => group.id === 'archived')!.tabs.length,
		1,
	);
});

test('adding links to a session follows the duplicate setting and reports a skipped duplicate as one', async () => {
	const groups = [
		sessionEntry('a', 'Alpha', 10),
		sessionEntry('b', 'Beta', 20),
	];
	for (const handling of ['allow', 'reject'] as const) {
		const harness = createHarness(
			baseState({saveDuplicateHandling: handling}, {groups}),
		);
		await harness.install();
		const same = await harness.send({
			type: 'ADD_LINKS_TO_SESSION',
			groupId: 'a',
			links: [{url: 'https://a.example/', title: 'Again'}],
		});
		assert.equal(same.ok, false, 'its own session never holds a link twice');
		assert.equal(same.duplicate, true);
		const other = await harness.send({
			type: 'ADD_LINKS_TO_SESSION',
			groupId: 'a',
			links: [{url: 'https://b.example/', title: 'Beta'}],
		});
		assert.equal(other.ok, handling === 'allow');
		assert.equal(other.duplicate, handling === 'reject' ? true : undefined);
	}
});

test('adding bookmarks follows the duplicate setting on every path', async () => {
	const bookmark = {
		id: 'b0',
		title: 'Seen',
		url: 'https://seen.example/',
		columnId: 'bookmark-default',
		createdAt: 1,
		updatedAt: 1,
	};
	for (const handling of ['allow', 'reject'] as const) {
		const harness = createHarness(
			baseState({saveDuplicateHandling: handling}, {bookmarks: [bookmark]}),
		);
		await harness.install();
		const sameColumn = await harness.send({
			type: 'ADD_BOOKMARK',
			bookmark: {
				url: 'https://seen.example/',
				title: 'Again',
				columnId: 'bookmark-default',
			},
		});
		assert.equal(sameColumn.ok, false);
		assert.equal(sameColumn.duplicate, true);
		const otherColumn = await harness.send({
			type: 'ADD_BOOKMARK',
			bookmark: {
				url: 'https://seen.example/',
				title: 'Again',
				columnId: 'column-reading',
			},
		});
		assert.equal(otherColumn.ok, handling === 'allow');
		const many = await harness.send({
			type: 'ADD_BOOKMARKS',
			bookmarks: [{url: 'https://seen.example/', title: 'Again'}],
			columnId: 'column-reading',
		});
		assert.equal(many.ok, false);
		assert.equal(many.duplicate, true);
		// A link menu save of the same address into a third place reports the duplicate on the badge, never a tick.
		await harness.click({
			menuItemId: 'tablodge-link-bookmark:bookmark-default',
			linkUrl: 'https://seen.example/',
		});
		assert.equal(markOf(harness).at(-1), '=');
		assert.deepEqual(harness.warnings, []);
	}
});
