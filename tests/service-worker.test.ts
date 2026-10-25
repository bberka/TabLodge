import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {transformWithOxc} from 'vite-plus';
import {test} from 'vite-plus/test';
import type {
	ActionSuccess,
	Bookmark,
	BookmarkColumn,
	Folder,
	SavedTab,
	Session,
	Settings,
	TabLodgeMessage,
	TabLodgeMessageType,
} from '../src/app/types';

// The service worker is a classic script with no exports, so each harness runs the
// type-stripped source in a fresh VM context against a mocked chrome.* API.
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
	splitViewId?: number;
};
type MockCreateProperties = Partial<MockTab> & {splitWithTabId?: number};
type MockWindow = {
	id: number;
	type: string;
	focused: boolean;
	title: string;
	tabs: MockTab[];
};
type SidePanelCall = {
	method: 'setOptions' | 'setPanelBehavior';
	value: {enabled?: boolean; path?: string; openPanelOnActionClick?: boolean};
};
/**
 `splitApi`: "native" (default) provides createSplit/unsplit and create({ splitWithTabId }) with Chromium's
 constraints, "missing" mirrors a browser before Chrome 155, and "throws" has createSplit always reject.
 `misplacedCreateUrls` opens those tabs at the start of the window, as if the browser placed them elsewhere.
 */
type HarnessOptions = {
	failedCreateUrls?: string[];
	bookmarkTree?: unknown[];
	withoutContextMenuShown?: boolean;
	splitApi?: 'native' | 'missing' | 'throws';
	misplacedCreateUrls?: string[];
};
type MenuItem = {
	id?: string;
	title?: string;
	enabled?: boolean;
};
type MessageListener = (
	message: unknown,
	sender: unknown,
	sendResponse: (response: never) => void,
) => unknown;
type EventListener = (...args: never[]) => unknown;

// The stored `tablodge.state` as tests seed it (partial or legacy-shaped) and read it back after
// the worker has written its normalized store.
type StoredSession = {tabs: Array<Partial<SavedTab>>} & Partial<
	Omit<Session, 'tabs'>
>;
type StoredState = {
	schemaVersion: number;
	groups: StoredSession[];
	folders: Array<Partial<Folder>>;
	bookmarkColumns: Array<Partial<BookmarkColumn>>;
	bookmarks: Array<Partial<Bookmark>>;
	settings: Partial<Settings> & Record<string, unknown>;
	updatedAt: number;
};

// Responses as the tests read them: success fields are typed from the protocol, while `ok` and
// `error` are checked at runtime by each test's assertions.
type TestResponse<K extends TabLodgeMessageType> = Omit<
	ActionSuccess<K>,
	'ok'
> & {ok: boolean; error?: string};

function createWorkerHarness(
	initialState: Partial<StoredState>,
	initialTabs: MockTab[] = [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://current.example/',
			title: 'Current',
		},
	],
	options: HarnessOptions = {},
) {
	let messageListener: MessageListener | undefined;
	const listeners: Record<string, EventListener> = {};
	// Seeded with the fixture; the worker's storage writes replace it with the normalized store.
	const state = structuredClone(initialState) as StoredState;
	const openedTabs: MockTab[] = [];
	const removedTabIds: number[] = [];
	const sidePanelCalls: SidePanelCall[] = [];
	const createdWindows: Array<Omit<MockWindow, 'tabs'> & {tabs: undefined}> =
		[];
	const discardedTabs: number[] = [];
	const menuItems: MenuItem[] = [];
	let storageFailure: Error | null = null;
	let nextTabId = 200;
	let nextWindowId = 20;
	let nextGroupId = 500;
	let nextSplitId = 900;
	let lastFocusedWindowId = 10;
	const tabs = structuredClone(initialTabs);
	const windows: MockWindow[] = [
		{id: 10, type: 'normal', focused: true, title: 'Test window', tabs},
	];
	// Tab-strip order: `index` is kept contiguous per window, like Chromium's tab strip.
	const tabsForWindow = (windowId: number) =>
		tabs
			.filter((tab) => tab.windowId === windowId)
			.toSorted((a, b) => a.index - b.index);
	const reindex = (order: MockTab[]) => {
		for (const [index, tab] of order.entries()) {
			tab.index = index;
		}
	};

	const placeAt = (tab: MockTab, position: number) => {
		const order = tabsForWindow(tab.windowId).filter((entry) => entry !== tab);
		order.splice(Math.max(0, Math.min(position, order.length)), 0, tab);
		reindex(order);
	};

	const findTab = (id: number) => {
		const tab = tabs.find((entry) => entry.id === id);
		if (!tab) {
			throw new Error(`No tab with id: ${id}.`);
		}

		return tab;
	};

	const isSplit = (tab: MockTab) => (tab.splitViewId ?? -1) >= 0;
	/**
	Calls to tabs.group, tabs.createSplit, tabs.move, and tabGroups.update, in order.
	*/
	const apiLog: string[] = [];
	const splitApi = {
		async createSplit(tabIds: [number, number]) {
			apiLog.push(`split:${tabIds.join(',')}`);
			if (options.splitApi === 'throws') {
				throw new Error('Mock browser cannot split these tabs.');
			}

			const [first, second] = tabIds.map((id) => findTab(id));
			if (
				first.windowId !== second.windowId ||
				Boolean(first.pinned) !== Boolean(second.pinned) ||
				(first.groupId ?? -1) !== (second.groupId ?? -1)
			) {
				throw new Error(
					'Tabs in a split view must share windowId, pinned, and groupId.',
				);
			}

			if (Math.abs(first.index - second.index) !== 1) {
				throw new Error('Tabs in a split view must be adjacent.');
			}

			if (isSplit(first) || isSplit(second)) {
				throw new Error('A tab is already in a split view.');
			}

			const splitViewId = nextSplitId++;
			first.splitViewId = splitViewId;
			second.splitViewId = splitViewId;
			return splitViewId;
		},
		async unsplit(splitViewId: number) {
			for (const tab of tabs) {
				if (tab.splitViewId === splitViewId) {
					tab.splitViewId = -1;
				}
			}
		},
	};

	const event = (name: string) => ({
		addListener(callback: EventListener) {
			listeners[name] = callback;
		},
	});
	const chrome = {
		runtime: {
			getURL: (file: string) => `chrome-extension://tablodge/${file}`,
			getManifest: () => ({...manifest}),
			onMessage: {
				addListener(callback: MessageListener) {
					messageListener = callback;
				},
			},
			onInstalled: event('onInstalled'),
			onStartup: event('onStartup'),
		},
		storage: {
			local: {
				async get(keys: string[]) {
					const out: Record<string, unknown> = {};
					for (const key of keys) {
						if (key === storageKey && state) {
							out[key] = structuredClone(state);
						}
					}

					return out;
				},
				async set(values: Record<string, unknown>) {
					if (storageFailure) {
						throw storageFailure;
					}

					if (Object.hasOwn(values, storageKey)) {
						Object.assign(state, structuredClone(values[storageKey]));
					}
				},
			},
		},
		windows: {
			async get(id: number, query: {populate?: boolean} = {}) {
				const win = windows.find((entry) => entry.id === id);
				if (!win) {
					throw new Error(`Unknown window ${id}`);
				}

				return {
					id: win.id,
					type: win.type,
					title: win.title,
					...(query.populate && {
						tabs: tabsForWindow(win.id).map((tab) => ({...tab})),
					}),
				};
			},
			async getLastFocused() {
				return {id: lastFocusedWindowId, type: 'normal'};
			},
			async getAll(query: {populate?: boolean} = {}) {
				return windows.map((win) => ({
					id: win.id,
					type: win.type,
					title: win.title,
					...(query.populate && {
						tabs: tabsForWindow(win.id).map((tab) => ({...tab})),
					}),
				}));
			},
			async update(id: number) {
				lastFocusedWindowId = id;
				return {};
			},
			async create(
				properties: {
					type?: string;
					focused?: boolean;
					url?: string | string[];
				} = {},
			) {
				const id = nextWindowId++;
				const win: MockWindow = {
					id,
					type: properties.type || 'normal',
					focused: properties.focused !== false,
					title: 'Restored window',
					tabs: [],
				};
				windows.push(win);
				createdWindows.push({...win, tabs: undefined});
				lastFocusedWindowId = id;
				const url = Array.isArray(properties.url)
					? properties.url[0]
					: properties.url || 'chrome://newtab/';
				const tab = {
					id: nextTabId++,
					windowId: id,
					index: 0,
					active: true,
					pinned: false,
					url,
					title: 'New Tab',
				};
				tabs.push(tab);
				return {id, type: win.type};
			},
		},
		tabs: {
			async query(query: {windowId?: number} = {}) {
				return tabs
					.filter(
						(tab) =>
							query.windowId === undefined || tab.windowId === query.windowId,
					)
					.map((tab) => ({...tab}));
			},
			async get(id: number) {
				return {...findTab(id)};
			},
			async create(properties: MockCreateProperties) {
				if ((options.failedCreateUrls || []).includes(properties.url ?? '')) {
					throw new Error('Mock browser refused the tab.');
				}

				const {splitWithTabId, index, ...fields} = properties;
				const partner =
					splitWithTabId !== undefined && options.splitApi !== 'missing'
						? findTab(splitWithTabId)
						: null;
				if (partner && isSplit(partner)) {
					throw new Error('The split-with tab is already in a split view.');
				}

				const windowId =
					fields.windowId ?? partner?.windowId ?? lastFocusedWindowId;
				if (fields.active) {
					for (const entry of tabsForWindow(windowId)) {
						entry.active = false;
					}
				}

				const created: MockTab = {
					id: nextTabId++,
					windowId,
					index: 0,
					active: Boolean(fields.active),
					pinned: false,
					groupId: -1,
					...fields,
				};
				let position = index ?? tabsForWindow(windowId).length;
				// New pinned tabs join the end of the pinned area; a split-with tab opens to the right unless index says left.
				if (created.pinned) {
					position = tabsForWindow(windowId).filter((tab) => tab.pinned).length;
				}

				if (partner) {
					position =
						index === partner.index ? partner.index : partner.index + 1;
					created.pinned = Boolean(partner.pinned);
					created.groupId = partner.groupId ?? -1;
				}

				if ((options.misplacedCreateUrls || []).includes(created.url ?? '')) {
					position = 0;
				}

				tabs.push(created);
				placeAt(created, position);
				if (partner) {
					created.splitViewId = nextSplitId;
					partner.splitViewId = nextSplitId;
					nextSplitId += 1;
				}

				openedTabs.push({...created});
				return {...created};
			},
			async move(id: number, properties: {index: number}) {
				apiLog.push(`move:${id}:${properties.index}`);
				const tab = findTab(id);
				placeAt(
					tab,
					properties.index < 0 ? Number.MAX_SAFE_INTEGER : properties.index,
				);
				return {...tab};
			},
			async update(id: number, properties: Partial<MockTab>) {
				const tab = tabs.find((entry) => entry.id === id);
				if (!tab) {
					throw new Error(`Unknown tab ${id}`);
				}

				if (properties.active) {
					for (const entry of tabsForWindow(tab.windowId)) {
						entry.active = false;
					}
				}

				Object.assign(tab, properties);
				return {...tab};
			},
			async remove(ids: number | number[]) {
				const idList = Array.isArray(ids) ? ids : [ids];
				removedTabIds.push(...idList);
				for (const id of idList) {
					const index = tabs.findIndex((tab) => tab.id === id);
					if (index === -1) {
						continue;
					}

					const [removed] = tabs.splice(index, 1);
					// Closing one half of a split view unsplits the other.
					if (isSplit(removed)) {
						for (const tab of tabs) {
							if (tab.splitViewId === removed.splitViewId) {
								tab.splitViewId = -1;
							}
						}
					}

					reindex(tabsForWindow(removed.windowId));
				}
			},
			async discard(id: number) {
				discardedTabs.push(id);
				return tabs.find((entry) => entry.id === id);
			},
			// Like Chromium, grouping moves the tabs together (in the given order) at the first tab's position.
			async group({tabIds}: {tabIds: number[]}) {
				apiLog.push(`group:${tabIds.join(',')}`);
				const members = tabIds.map((id) => findTab(id));
				const groupId = nextGroupId++;
				const order = tabsForWindow(members[0].windowId);
				const rest = order.filter((tab) => !members.includes(tab));
				rest.splice(
					order
						.slice(0, members[0].index)
						.filter((tab) => !members.includes(tab)).length,
					0,
					...members,
				);
				reindex(rest);
				for (const tab of members) {
					tab.groupId = groupId;
				}

				return groupId;
			},
			...(options.splitApi !== 'missing' && splitApi),
		},
		tabGroups: {
			async query() {
				return [];
			},
			async update(groupId: number, properties: {collapsed?: boolean}) {
				apiLog.push(
					`groupUpdate:${groupId}:${properties.collapsed ? 'collapsed' : 'expanded'}`,
				);
				return {};
			},
		},
		bookmarks: {
			async getTree() {
				return structuredClone(options.bookmarkTree || []);
			},
		},
		action: {async setPopup() {}, onClicked: event('actionClicked')},
		sidePanel: {
			async setOptions(value: SidePanelCall['value']) {
				sidePanelCalls.push({
					method: 'setOptions',
					value: structuredClone(value),
				});
			},
			async setPanelBehavior(value: SidePanelCall['value']) {
				sidePanelCalls.push({
					method: 'setPanelBehavior',
					value: structuredClone(value),
				});
			},
		},
		commands: {onCommand: event('onCommand')},
		contextMenus: {
			async removeAll() {
				menuItems.length = 0;
			},
			create(item: MenuItem) {
				menuItems.push(structuredClone(item));
			},
			onClicked: event('contextMenuClicked'),
			// Chrome has no onShown; tests can drop it to mirror that browser.
			...(!options.withoutContextMenuShown && {
				onShown: event('contextMenuShown'),
			}),
			async update() {},
			async refresh() {},
		},
	};

	const context = vm.createContext({
		chrome,
		URL,
		console,
		crypto: webcrypto,
		globalThis: null,
		setTimeout,
		clearTimeout,
	});
	context.globalThis = context;
	vm.runInContext(workerSource, context, {filename: workerPath});

	return {
		openedTabs,
		removedTabIds,
		sidePanelCalls,
		createdWindows,
		discardedTabs,
		menuItems,
		listeners,
		tabs,
		apiLog,
		tabsForWindow,
		setStorageFailure(error: Error) {
			storageFailure = error;
		},
		state,
		async sendMessage<M extends TabLodgeMessage>(
			message: M,
			sender: {tab?: Partial<MockTab>} = {tab: {id: 1, windowId: 10}},
		) {
			assert.equal(
				typeof messageListener,
				'function',
				'service worker should register its runtime message listener',
			);
			return new Promise<TestResponse<M['type']>>((resolve, reject) => {
				let returnedAsync: unknown;
				try {
					returnedAsync = messageListener!(message, sender, resolve);
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}

				assert.equal(
					returnedAsync,
					true,
					'runtime message listener should keep the response channel open',
				);
			});
		},
	};
}

function stateWithSession(settings: Record<string, unknown> = {}): StoredState {
	const timestamp = 1_700_000_000_000;
	return {
		schemaVersion: 3,
		groups: [
			{
				id: 'session-1',
				name: 'Research',
				folderId: 'unfiled',
				createdAt: timestamp,
				updatedAt: timestamp,
				tabs: [
					{
						id: 'saved-tab-1',
						title: 'Saved page',
						url: 'https://saved.example/article',
						pinned: false,
						originalIndex: 0,
					},
				],
			},
		],
		folders: [{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true}],
		bookmarkColumns: [
			{
				id: 'bookmark-default',
				name: 'Bookmarks',
				createdAt: 0,
				isDefault: true,
			},
		],
		bookmarks: [],
		settings: {
			closeOnSave: true,
			duplicateHandling: 'skip',
			restoreTarget: 'current-window',
			...settings,
		},
		updatedAt: timestamp,
	};
}

test('RESTORE_GROUP opens a valid saved URL and reports successful session restoration', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});

	assert.equal(response.ok, true, response.error);
	assert.equal(response.count, 1);
	assert.equal(response.skipped, 0);
	assert.equal(harness.openedTabs.length, 1);
	assert.equal(harness.openedTabs[0].url, 'https://saved.example/article');
	assert.equal(
		harness.state.groups.some((group) => group.id === 'session-1'),
		true,
	);
});

test('default session preferences use newest-first, keep-on-restore, quick-popup action, and opt-out pinned tabs', async () => {
	const harness = createWorkerHarness({...stateWithSession(), settings: {}});
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(response.settings.actionMode, 'popup');
	assert.equal(response.settings.includePinnedTabs, false);
	assert.equal(response.settings.sessionSort, 'newest');
	assert.equal(response.settings.restoreMode, 'keep');
	assert.equal(response.settings.restoreTarget, 'new-window-unless-only-tab');
});

test('RESTORE_GROUP opens a new window when the current window has other tabs', async () => {
	const harness = createWorkerHarness(
		stateWithSession({restoreTarget: 'new-window-unless-only-tab'}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://current.example/',
				title: 'Current',
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
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(harness.createdWindows.length, 1);
	assert.equal(harness.openedTabs[0].windowId, harness.createdWindows[0].id);
	assert.equal(
		harness.removedTabIds.includes(200),
		true,
		'the temporary bootstrap tab is removed after a successful restore',
	);
});

test('locked sessions always keep saved tabs when restore mode requests removal', async () => {
	const state = stateWithSession({restoreMode: 'remove'});
	state.groups[0].locked = true;
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
		forceRemove: true,
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.removed, false);
	assert.equal(harness.state.groups[0].tabs.length, 1);
});

test('restoring with archive policy marks the session without removing saved tabs', async () => {
	const harness = createWorkerHarness(
		stateWithSession({restoreMode: 'archive'}),
	);
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.archived, true);
	assert.equal(harness.state.groups[0].archived, true);
	assert.equal(harness.state.groups[0].tabs.length, 1);
});

test('single-tab restore can remain in the background or switch based on its setting', async () => {
	const background = createWorkerHarness(
		stateWithSession({singleTabBehavior: 'stay'}),
	);
	const backgroundResult = await background.sendMessage({
		type: 'RESTORE_TAB',
		groupId: 'session-1',
		tabId: 'saved-tab-1',
	});
	assert.equal(backgroundResult.ok, true, backgroundResult.error);
	assert.equal(
		background.tabs.find((tab) => tab.id === background.openedTabs[0].id)!
			.active,
		false,
	);

	const foreground = createWorkerHarness(
		stateWithSession({singleTabBehavior: 'switch'}),
	);
	const foregroundResult = await foreground.sendMessage({
		type: 'RESTORE_TAB',
		groupId: 'session-1',
		tabId: 'saved-tab-1',
	});
	assert.equal(foregroundResult.ok, true, foregroundResult.error);
	assert.equal(
		foreground.tabs.find((tab) => tab.id === foreground.openedTabs[0].id)!
			.active,
		true,
	);
});

test('background restore unloading leaves active and pinned tabs alone', async () => {
	const state = stateWithSession({unloadRestoredTabs: true});
	state.groups[0].tabs.push(
		{
			id: 'saved-tab-2',
			title: 'Background',
			url: 'https://background.example/',
			pinned: false,
		},
		{
			id: 'saved-tab-pinned',
			title: 'Pinned',
			url: 'https://pinned.example/',
			pinned: true,
		},
	);
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.deepEqual(harness.discardedTabs, [201]);
});

test('restore duplicate policy is separate from import decisions', async () => {
	const tabs = [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://saved.example/article',
			title: 'Already open',
		},
	];
	const skipped = createWorkerHarness(
		stateWithSession({restoreDuplicateHandling: 'skip'}),
		tabs,
	);
	const skipResult = await skipped.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(skipResult.ok, false);
	assert.equal(skipped.openedTabs.length, 0);

	const opened = createWorkerHarness(
		stateWithSession({restoreDuplicateHandling: 'open'}),
		tabs,
	);
	const openResult = await opened.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(openResult.ok, true, openResult.error);
	assert.equal(opened.openedTabs.length, 1);
});

test('RESTORE_TAB opens a valid saved URL and reports success', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const response = await harness.sendMessage({
		type: 'RESTORE_TAB',
		groupId: 'session-1',
		tabId: 'saved-tab-1',
	});

	assert.equal(response.ok, true, response.error);
	assert.equal(response.count, 1);
	assert.equal(harness.openedTabs.length, 1);
	assert.equal(harness.openedTabs[0].url, 'https://saved.example/article');
});

test('single-tab toolbar mode appends into the first non-archived unlocked session', async () => {
	const state = stateWithSession({closeOnSave: false});
	state.groups[0].locked = true;
	state.groups[1] = {
		...structuredClone(state.groups[0]),
		id: 'archived-session',
		locked: false,
		archived: true,
	};
	state.groups[2] = {
		...structuredClone(state.groups[0]),
		id: 'eligible-session',
		locked: false,
		archived: false,
	};
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({
		type: 'SAVE_CURRENT_TAB_TO_GROUP',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.groupId, 'eligible-session');
	assert.equal(harness.state.groups[0].tabs.length, 1);
	assert.equal(harness.state.groups[2].tabs.length, 2);
	assert.equal(harness.state.groups[2].tabs[1].url, 'https://current.example/');
});

test('popup selection saves only explicitly selected tabs and uses the supplied session title', async () => {
	const harness = createWorkerHarness(stateWithSession({closeOnSave: false}), [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			highlighted: true,
			url: 'https://current.example/',
			title: 'Current',
		},
		{
			id: 2,
			windowId: 10,
			index: 1,
			active: false,
			highlighted: true,
			url: 'https://selected.example/',
			title: 'Selected',
		},
		{
			id: 3,
			windowId: 10,
			index: 2,
			active: false,
			highlighted: false,
			url: 'https://not-selected.example/',
			title: 'Not selected',
		},
	]);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'selected',
		tabIds: [2],
		groupName: 'Quick chooser title',
	});
	assert.equal(response.ok, true, response.error);
	const saved = harness.state.groups[0];
	assert.equal(saved.name, 'Quick chooser title');
	assert.equal(saved.tabs.length, 1);
	assert.equal(saved.tabs[0].url, 'https://selected.example/');
});

test('import duplicate decisions are scoped to each import request and latest title keeps existing notes', async () => {
	const state = stateWithSession();
	state.groups[0].tabs[0].notes = 'Keep this note';
	const harness = createWorkerHarness(state);
	const data = {
		groups: [
			{
				name: 'Incoming',
				folderId: 'unfiled',
				tabs: [
					{
						title: 'Imported title',
						url: 'https://saved.example/article',
						notes: 'Incoming note',
					},
				],
			},
		],
	};
	const skipped = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data,
		importOptions: {duplicateMode: 'skip', titlePolicy: 'latest'},
	});
	assert.equal(skipped.ok, true, skipped.error);
	assert.equal(harness.state.groups.length, 1);
	assert.equal(harness.state.groups[0].tabs[0].title, 'Imported title');
	assert.equal(harness.state.groups[0].tabs[0].notes, 'Keep this note');

	const allowed = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data,
		importOptions: {duplicateMode: 'allow'},
	});
	assert.equal(allowed.ok, true, allowed.error);
	assert.equal(harness.state.groups.length, 2);
	assert.equal(
		harness.state.groups[0].tabs[0].url,
		'https://saved.example/article',
	);
	assert.equal(harness.state.groups[0].tabs[0].notes, 'Incoming note');
});

test('ADD_EXCLUDED_ORIGIN validates and adds a website from Settings', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const invalid = await harness.sendMessage({
		type: 'ADD_EXCLUDED_ORIGIN',
		origin: 'chrome://settings',
	});
	assert.equal(invalid.ok, false);
	const added = await harness.sendMessage({
		type: 'ADD_EXCLUDED_ORIGIN',
		origin: 'https://example.test/path',
	});
	assert.equal(added.ok, true, added.error);
	assert.equal(
		JSON.stringify(added.settings.excludedOrigins),
		JSON.stringify(['https://example.test']),
	);
});

test('RESTORE_GROUP reports individual tab-create failures when some tabs open', async () => {
	const state = stateWithSession();
	state.groups[0].tabs.push({
		id: 'saved-tab-2',
		title: 'Refused page',
		url: 'https://refused.example/',
		pinned: false,
	});
	const harness = createWorkerHarness(state, undefined, {
		failedCreateUrls: ['https://refused.example/'],
	});
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});

	assert.equal(response.ok, true);
	assert.equal(response.count, 1);
	assert.equal(response.failed, 1);
	assert.equal(response.failures[0].title, 'Refused page');
	assert.match(response.failures[0].error, /refused/i);
	assert.deepEqual(
		harness.openedTabs.map((tab) => tab.url),
		['https://saved.example/article'],
	);
});

test('unified new-tab destination is enabled by default while pinned tabs remain opt-out', async () => {
	const state = stateWithSession();
	state.schemaVersion = 6;
	delete state.settings.newTabEnabled;
	delete state.settings.includePinnedTabs;
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(response.settings.newTabEnabled, true);
	assert.equal(response.settings.includePinnedTabs, false);
	assert.equal(response.bookmarkColumns.length, 1);
});

test('settings updates never disable Sessions and Bookmarks together', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const first = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {sessionsEnabled: false},
	});
	assert.equal(first.ok, true);
	const rejected = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {bookmarksEnabled: false},
	});
	assert.equal(rejected.ok, false);
	assert.match(rejected.error!, /keep sessions or bookmarks enabled/i);
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(response.settings.sessionsEnabled, false);
	assert.equal(response.settings.bookmarksEnabled, true);
	const reset = await harness.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.sessionsEnabled, true);
	assert.equal(reset.settings.bookmarksEnabled, true);
	assert.equal(reset.settings.newTabEnabled, true);
	assert.equal(reset.settings.includePinnedTabs, false);
});

test('disabled systems keep their data and reject mutations', async () => {
	const harness = createWorkerHarness(stateWithSession());
	harness.state.bookmarks = [
		{
			id: 'bookmark-1',
			title: 'Saved link',
			url: 'https://link.example/',
			columnId: 'bookmark-default',
		},
	];
	assert.equal(
		(
			await harness.sendMessage({
				type: 'UPDATE_SETTINGS',
				settings: {sessionsEnabled: false},
			})
		).ok,
		true,
	);
	assert.equal(
		(await harness.sendMessage({type: 'DELETE_GROUP', groupId: 'session-1'}))
			.ok,
		false,
	);
	assert.equal(
		(
			await harness.sendMessage({
				type: 'IMPORT_GROUPS',
				data: [{title: 'New', url: 'https://new.example/'}],
			})
		).ok,
		false,
	);
	assert.equal(harness.state.groups.length, 1);

	assert.equal(
		(
			await harness.sendMessage({
				type: 'UPDATE_SETTINGS',
				settings: {sessionsEnabled: true, bookmarksEnabled: false},
			})
		).ok,
		true,
	);
	assert.equal(
		(
			await harness.sendMessage({
				type: 'DELETE_BOOKMARK',
				bookmarkId: 'bookmark-1',
			})
		).ok,
		false,
	);
	assert.equal(
		(await harness.sendMessage({type: 'IMPORT_BROWSER_BOOKMARKS'})).ok,
		false,
	);
	assert.equal(harness.state.bookmarks.length, 1);
});

test('browser bookmark import maps folders to ordered columns and skips duplicate URLs', async () => {
	const state = stateWithSession();
	state.bookmarks = [
		{
			id: 'existing',
			title: 'Existing',
			url: 'https://already.example/',
			columnId: 'bookmark-default',
		},
	];
	const tree = [
		{
			id: '0',
			title: '',
			children: [
				{
					id: '1',
					title: 'Bookmarks bar',
					children: [
						{id: '10', title: 'Start', url: 'https://already.example/'},
						{
							id: '11',
							title: 'Docs',
							children: [
								{id: '12', title: 'Guide', url: 'https://docs.example/guide'},
								{
									id: '13',
									title: 'Nested',
									children: [
										{
											id: '14',
											title: 'Reference',
											url: 'https://docs.example/ref',
										},
									],
								},
							],
						},
						{id: '15', title: 'News', url: 'https://news.example/'},
					],
				},
			],
		},
	];
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		bookmarkTree: tree,
	});
	harness.state.bookmarks = state.bookmarks;
	const response = await harness.sendMessage({
		type: 'IMPORT_BROWSER_BOOKMARKS',
	});

	assert.equal(response.ok, true, response.error);
	assert.equal(response.columnsAdded, 3);
	assert.equal(response.bookmarksAdded, 3);
	assert.equal(response.bookmarksSkipped, 1);
	const imported = harness.state.bookmarks.filter(
		(bookmark) => bookmark.id !== 'existing',
	);
	assert.deepEqual(
		imported.map((bookmark) => bookmark.url),
		[
			'https://docs.example/guide',
			'https://docs.example/ref',
			'https://news.example/',
		],
	);
	assert.deepEqual(
		harness.state.bookmarkColumns.slice(1).map((column) => column.name),
		['Bookmarks bar', 'Bookmarks bar / Docs', 'Bookmarks bar / Docs / Nested'],
	);
	assert.equal(imported[0].columnId, harness.state.bookmarkColumns[2].id);
	assert.equal(imported[1].columnId, harness.state.bookmarkColumns[3].id);
	assert.equal(imported[2].columnId, harness.state.bookmarkColumns[1].id);
});

test('selected-tab saving never stores or removes pinned tabs', async () => {
	const harness = createWorkerHarness(
		stateWithSession({closeOnSave: true, openDashboardAfterSave: false}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				highlighted: true,
				url: 'https://selected.example/',
				title: 'Selected',
			},
			{
				id: 2,
				windowId: 10,
				index: 1,
				active: false,
				highlighted: true,
				pinned: true,
				url: 'https://pinned.example/',
				title: 'Pinned',
			},
			{
				id: 3,
				windowId: 10,
				index: 2,
				active: false,
				highlighted: false,
				url: 'https://not-selected.example/',
				title: 'Not selected',
			},
		],
	);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'selected',
	});

	assert.equal(response.ok, true, response.error);
	const savedGroup = harness.state.groups.find(
		(group) => group.id === response.groupId,
	)!;
	assert.deepEqual(
		savedGroup.tabs.map((tab) => tab.url),
		['https://selected.example/'],
	);
	assert.deepEqual(harness.removedTabIds, [1]);
	assert.equal(harness.removedTabIds.includes(2), false);
});

test('saving with a legacy includePinnedTabs preference never stores or removes pinned tabs', async () => {
	const harness = createWorkerHarness(
		stateWithSession({
			includePinnedTabs: true,
			closeOnSave: true,
			openDashboardAfterSave: false,
		}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://current.example/',
				title: 'Current',
				pinned: false,
			},
			{
				id: 2,
				windowId: 10,
				index: 1,
				active: false,
				url: 'https://pinned.example/',
				title: 'Pinned',
				pinned: true,
			},
			{
				id: 3,
				windowId: 10,
				index: 2,
				active: false,
				url: 'https://other.example/',
				title: 'Other',
				pinned: false,
			},
		],
	);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});

	assert.equal(response.ok, true, response.error);
	const savedGroup = harness.state.groups.find(
		(group) => group.id === response.groupId,
	)!;
	assert.deepEqual(
		savedGroup.tabs.map((tab) => tab.url),
		['https://current.example/', 'https://other.example/'],
	);
	assert.equal(
		savedGroup.tabs.some((tab) => tab.pinned),
		false,
	);
	assert.deepEqual(
		harness.removedTabIds.toSorted((a, b) => a - b),
		[1, 3],
	);
	assert.equal(harness.removedTabIds.includes(2), false);
});

test('explicit pinned-tab opt-in stores and retains pinned state, and close requires successful storage', async () => {
	const state = stateWithSession({
		includePinnedTabs: true,
		closeOnSave: false,
		openDashboardAfterSave: false,
		duplicateHandling: 'open',
	});
	state.schemaVersion = 6;
	const harness = createWorkerHarness(state, [
		{
			id: 11,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://pinned-opt-in.example/',
			title: 'Pinned opt-in',
			pinned: true,
		},
	]);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(response.ok, true, response.error);
	const saved = harness.state.groups.find(
		(group) => group.id === response.groupId,
	)!.tabs[0];
	assert.equal(saved.pinned, true);
	assert.deepEqual(
		harness.removedTabIds,
		[],
		'close setting is required even after successful storage',
	);

	const restore = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: response.groupId!,
	});
	assert.equal(restore.ok, true, restore.error);
	assert.equal(harness.openedTabs[0].pinned, true);
});

test('failed storage never closes an opted-in pinned tab', async () => {
	const state = stateWithSession({
		includePinnedTabs: true,
		closeOnSave: true,
		openDashboardAfterSave: false,
	});
	state.schemaVersion = 6;
	const harness = createWorkerHarness(state, [
		{
			id: 12,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://pinned-storage-failure.example/',
			title: 'Pinned',
			pinned: true,
		},
	]);
	await harness.sendMessage({type: 'GET_STATE'});
	harness.setStorageFailure(new Error('disk is full'));
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(response.ok, false);
	assert.deepEqual(harness.removedTabIds, []);
});

test('pinned opt-in is false for pre-v5 and missing legacy settings', async () => {
	const state = stateWithSession({includePinnedTabs: true});
	state.schemaVersion = 4;
	const harness = createWorkerHarness(state, [
		{
			id: 13,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://legacy-pinned.example/',
			title: 'Pinned',
			pinned: true,
		},
	]);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(response.ok, false);
	assert.equal(harness.state.settings.includePinnedTabs, false);
	assert.deepEqual(harness.removedTabIds, []);
});

test('Side Panel setting enables the local bookmark page on the toolbar action', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const result = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {sidePanelEnabled: true},
	});
	assert.equal(result.ok, true);
	assert.equal(
		harness.sidePanelCalls.some(
			(call) =>
				call.method === 'setOptions' &&
				call.value.enabled &&
				call.value.path === 'sidepanel.html',
		),
		true,
	);
	assert.equal(
		harness.sidePanelCalls.some(
			(call) =>
				call.method === 'setPanelBehavior' && call.value.openPanelOnActionClick,
		),
		true,
	);
});

test('column delete preserves bookmarks, including when the built-in or last column is removed', async () => {
	const state = stateWithSession();
	state.schemaVersion = 6;
	state.bookmarkColumns.push({id: 'column-work', name: 'Work', createdAt: 2});
	state.bookmarks = [
		{
			id: 'default-link',
			title: 'Default link',
			url: 'https://default.example/',
			columnId: 'bookmark-default',
		},
		{
			id: 'work-link',
			title: 'Work link',
			url: 'https://work.example/',
			columnId: 'column-work',
		},
	];
	const harness = createWorkerHarness(state);
	const rejected = await harness.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'bookmark-default',
	});
	assert.equal(
		rejected.ok,
		false,
		'deletion with bookmarks requires an explicit target',
	);
	assert.equal(harness.state.bookmarks[0].columnId, 'bookmark-default');

	const moved = await harness.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'bookmark-default',
		targetColumnId: 'column-work',
	});
	assert.equal(moved.ok, true, moved.error);
	assert.equal(
		harness.state.bookmarks.find((bookmark) => bookmark.id === 'default-link')!
			.columnId,
		'column-work',
	);

	const last = await harness.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'column-work',
	});
	assert.equal(last.ok, true, last.error);
	assert.deepEqual(harness.state.bookmarkColumns, []);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => bookmark.columnId),
		['bookmark-unfiled', 'bookmark-unfiled'],
	);
});

test('bookmark columns reorder deterministically from first to last and last to first', async () => {
	const state = stateWithSession();
	state.schemaVersion = 6;
	state.bookmarkColumns.push(
		{id: 'column-two', name: 'Two'},
		{id: 'column-three', name: 'Three'},
	);
	const harness = createWorkerHarness(state);
	const firstToLast = await harness.sendMessage({
		type: 'REORDER_BOOKMARK_COLUMN',
		columnId: 'bookmark-default',
		targetColumnId: 'column-three',
		position: 'after',
	});
	assert.equal(firstToLast.ok, true, firstToLast.error);
	assert.deepEqual(
		harness.state.bookmarkColumns.map((column) => column.id),
		['column-two', 'column-three', 'bookmark-default'],
	);
	const lastToFirst = await harness.sendMessage({
		type: 'REORDER_BOOKMARK_COLUMN',
		columnId: 'bookmark-default',
		targetColumnId: 'column-two',
		position: 'before',
	});
	assert.equal(lastToFirst.ok, true, lastToFirst.error);
	assert.deepEqual(
		harness.state.bookmarkColumns.map((column) => column.id),
		['bookmark-default', 'column-two', 'column-three'],
	);
});

test('bookmark reordering moves a link across columns at the requested insertion point', async () => {
	const state = stateWithSession();
	state.schemaVersion = 6;
	state.bookmarkColumns.push({id: 'column-two', name: 'Two'});
	state.bookmarks = [
		{
			id: 'bookmark-one',
			title: 'One',
			url: 'https://one.example/',
			columnId: 'bookmark-default',
			createdAt: 1,
			updatedAt: 1,
		},
		{
			id: 'bookmark-two',
			title: 'Two',
			url: 'https://two.example/',
			columnId: 'column-two',
			createdAt: 2,
			updatedAt: 2,
		},
	];
	const harness = createWorkerHarness(state);
	const result = await harness.sendMessage({
		type: 'REORDER_BOOKMARK',
		bookmarkId: 'bookmark-one',
		targetColumnId: 'column-two',
		targetBookmarkId: 'bookmark-two',
		position: 'before',
	});
	assert.equal(result.ok, true, result.error);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => [bookmark.id, bookmark.columnId]),
		[
			['bookmark-one', 'column-two'],
			['bookmark-two', 'column-two'],
		],
	);
});

test('session and bookmark import paths mutate only their own data types', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const input = {
		groups: [
			{
				name: 'Imported session',
				tabs: [
					{title: 'Imported tab', url: 'https://imported-session.example/'},
				],
			},
		],
		bookmarkColumns: [{id: 'imports', name: 'Imported links'}],
		bookmarks: [
			{
				title: 'Imported link',
				url: 'https://imported-bookmark.example/',
				columnId: 'imports',
			},
		],
	};
	const sessions = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: input,
	});
	assert.equal(sessions.ok, true, sessions.error);
	assert.equal(
		harness.state.groups.some((group) => group.name === 'Imported session'),
		true,
	);
	assert.equal(harness.state.bookmarks.length, 0);

	const bookmarks = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: input,
	});
	assert.equal(bookmarks.ok, true, bookmarks.error);
	assert.equal(
		harness.state.bookmarks.some(
			(entry) => entry.url === 'https://imported-bookmark.example/',
		),
		true,
	);
	assert.equal(
		harness.state.groups.filter((group) => group.name === 'Imported session')
			.length,
		1,
	);
});

test('bookmark title falls back to matching open-tab metadata instead of a bare URL', async () => {
	const harness = createWorkerHarness(stateWithSession(), [
		{
			id: 21,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://title-match.example/article',
			title: 'An open page title',
		},
	]);
	const result = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {
			title: 'https://title-match.example/article',
			url: 'https://title-match.example/article',
		},
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(harness.state.bookmarks[0].title, 'An open page title');
});

test('drag kinds are told apart by type, and the document guard only blocks stray link drags', async () => {
	const {dragPayloadKind, shouldBlockDocumentDrop, SESSION_DRAG_TYPE} =
		await import('../src/app/interaction-actions');
	assert.equal(dragPayloadKind(['application/x-tablodge-column']), 'column');
	assert.equal(
		dragPayloadKind(['text/uri-list', 'application/x-tablodge-bookmark']),
		'bookmark',
	);
	assert.equal(
		dragPayloadKind(['text/plain', 'text/uri-list', SESSION_DRAG_TYPE]),
		'session',
	);
	assert.equal(dragPayloadKind(['text/uri-list', 'text/html']), 'link');
	assert.equal(dragPayloadKind(['Files']), null);
	assert.equal(dragPayloadKind(undefined), null);
	const target = (editable = false) => ({
		closest: (selector: string) =>
			editable && selector.includes('textarea') ? {} : null,
	});
	const event = (
		types: string[],
		fields: {
			defaultPrevented?: boolean;
			target?: ReturnType<typeof target>;
		} = {},
	) => ({
		defaultPrevented: false,
		dataTransfer: {types},
		target: target(),
		...fields,
	});
	// Over a column, the column has already called preventDefault: leave it alone.
	assert.equal(
		shouldBlockDocumentDrop(
			event([SESSION_DRAG_TYPE, 'text/uri-list'], {defaultPrevented: true}),
		),
		false,
	);
	// Anywhere else, session, tab, and external link drags are blocked (no copy cursor, nothing saved).
	assert.equal(
		shouldBlockDocumentDrop(event([SESSION_DRAG_TYPE, 'text/uri-list'])),
		true,
	);
	assert.equal(shouldBlockDocumentDrop(event(['text/uri-list'])), true);
	// Text fields keep native drops, and unrelated drags are not touched.
	assert.equal(
		shouldBlockDocumentDrop(event(['text/plain'], {target: target(true)})),
		false,
	);
	assert.equal(shouldBlockDocumentDrop(event(['Files'])), false);
	assert.equal(shouldBlockDocumentDrop(null), false);
});

test('session drags carry every link for TabLodge columns while keeping plain link payloads', async () => {
	const {
		applyLinkDrag,
		parseSessionDragData,
		sessionDropPrompt,
		SESSION_DRAG_TYPE,
	} = await import('../src/app/interaction-actions');
	const written: Record<string, string> = {};
	const dataTransfer: {
		setData(type: string, value: string): void;
		effectAllowed?: DataTransfer['effectAllowed'];
	} = {
		setData(type, value) {
			written[type] = value;
		},
	};
	const tabs = [
		{title: 'A', url: 'https://a.example/'},
		{title: '', url: 'https://b.example/'},
		{title: 'Local', url: 'file:///etc/passwd'},
	];
	assert.equal(applyLinkDrag(dataTransfer, tabs, 'Reading', 'session-1'), true);
	assert.equal(dataTransfer.effectAllowed, 'copyLink');
	assert.ok(written['text/uri-list']);
	assert.ok(written['text/plain']);
	assert.ok(written['text/html']);
	const session = parseSessionDragData(written[SESSION_DRAG_TYPE])!;
	assert.equal(session.id, 'session-1');
	assert.equal(session.name, 'Reading');
	assert.deepEqual(session.links, [
		{title: 'A', url: 'https://a.example/'},
		{title: '', url: 'https://b.example/'},
	]);
	const prompt = sessionDropPrompt(session, 'Work');
	assert.equal(prompt.title, 'Add 2 links from “Reading” to “Work”?');
	assert.equal(prompt.confirmLabel, 'Add 2 links');
	assert.equal(
		sessionDropPrompt(
			{name: 'One', links: [{url: 'https://a.example/'}]},
			'Work',
		).title,
		'Add 1 link from “One” to “Work”?',
	);

	const single: Record<string, string> = {};
	applyLinkDrag(
		{
			setData(type, value) {
				single[type] = value;
			},
		},
		[tabs[0]],
	);
	assert.equal(
		single[SESSION_DRAG_TYPE],
		undefined,
		'a single saved tab drags as a plain link',
	);
	assert.equal(parseSessionDragData('not json'), null);
	assert.equal(
		parseSessionDragData(
			JSON.stringify({name: 'Empty', links: [{url: 'javascript:alert(1)'}]}),
		),
		null,
	);
});

test('ADD_BOOKMARKS adds every dropped link to one column in order at the drop position', async () => {
	const state = stateWithSession();
	state.schemaVersion = 6;
	state.bookmarkColumns.push({id: 'column-two', name: 'Two'});
	state.bookmarks = [
		{
			id: 'bookmark-one',
			title: 'One',
			url: 'https://one.example/',
			columnId: 'column-two',
			createdAt: 1,
			updatedAt: 1,
		},
		{
			id: 'bookmark-two',
			title: 'Two',
			url: 'https://two.example/',
			columnId: 'column-two',
			createdAt: 2,
			updatedAt: 2,
		},
	];
	const harness = createWorkerHarness(state);
	const links = [
		{title: 'A', url: 'https://a.example/'},
		{title: 'Bad', url: 'ftp://bad.example/'},
		{title: 'B', url: 'https://b.example/'},
	];
	const result = await harness.sendMessage({
		type: 'ADD_BOOKMARKS',
		bookmarks: links,
		columnId: 'column-two',
		targetBookmarkId: 'bookmark-one',
		position: 'after',
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.count, 2);
	assert.deepEqual(
		harness.state.bookmarks
			.filter((bookmark) => bookmark.columnId === 'column-two')
			.map((bookmark) => bookmark.title),
		['One', 'A', 'B', 'Two'],
	);
	const atEnd = await harness.sendMessage({
		type: 'ADD_BOOKMARKS',
		bookmarks: [{title: 'C', url: 'https://c.example/'}],
		columnId: 'bookmark-unfiled',
	});
	assert.equal(atEnd.ok, true, atEnd.error);
	assert.equal(harness.state.bookmarks.at(-1)!.columnId, 'bookmark-unfiled');
	const none = await harness.sendMessage({
		type: 'ADD_BOOKMARKS',
		bookmarks: [{url: 'javascript:void 0'}],
		columnId: 'column-two',
	});
	assert.equal(none.ok, false);
});

test('session title activation respects the configured edit or restore action', async () => {
	const {activateSessionTitle} = await import('../src/app/interaction-actions');
	const calls: string[] = [];
	const handlers = {
		edit() {
			calls.push('edit');
		},
		restore() {
			calls.push('restore');
		},
	};
	activateSessionTitle('restore', handlers);
	activateSessionTitle('edit', handlers);
	activateSessionTitle('unexpected', handlers);
	assert.deepEqual(calls, ['restore', 'edit', 'edit']);
});

test('save duplicates can be allowed or silently rejected, with existing or latest title', async () => {
	const tabs = [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://saved.example/article',
			title: 'Fresh title',
		},
	];
	const allowed = createWorkerHarness(
		stateWithSession({closeOnSave: false, saveDuplicateHandling: 'allow'}),
		tabs,
	);
	const allowResult = await allowed.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(allowResult.ok, true, allowResult.error);
	assert.equal(allowed.state.groups.length, 2);

	const kept = createWorkerHarness(
		stateWithSession({closeOnSave: false, saveDuplicateHandling: 'reject'}),
		tabs,
	);
	const keepResult = await kept.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(keepResult.ok, true, keepResult.error);
	assert.equal(keepResult.count, 0);
	assert.equal(keepResult.skipped, 1);
	assert.equal(kept.state.groups.length, 1);
	assert.equal(kept.state.groups[0].tabs[0].title, 'Saved page');

	const latest = createWorkerHarness(
		stateWithSession({
			closeOnSave: true,
			saveDuplicateHandling: 'reject',
			saveDuplicateTitle: 'latest',
		}),
		[
			...tabs,
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
	const latestResult = await latest.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(latestResult.ok, true, latestResult.error);
	assert.equal(latestResult.skipped, 1);
	assert.equal(latest.state.groups[1].tabs[0].title, 'Fresh title');
	assert.equal(latest.state.groups[0].tabs.length, 1);
	assert.deepEqual(
		latest.removedTabIds.toSorted((a, b) => a - b),
		[1, 2],
	);
});

test('session clipboard formats cover URL/title orderings, URL-only, Markdown, and rich text', async () => {
	const {formatSessionLinks, writeClipboard} =
		await import('../src/app/interaction-actions');
	const group = {
		name: 'Reading <list>',
		tabs: [
			{title: 'A [one]', url: 'https://a.example/?x=1&y=2'},
			{title: '', url: 'https://b.example/'},
		],
	};
	assert.equal(
		formatSessionLinks(group, 'url').text,
		'https://a.example/?x=1&y=2\nhttps://b.example/',
	);
	assert.equal(
		formatSessionLinks(group, 'title-url').text,
		'A [one]\nhttps://a.example/?x=1&y=2\n\nhttps://b.example/\nhttps://b.example/',
	);
	assert.equal(
		formatSessionLinks(group, 'url-title').text.split('\n\n', 1)[0],
		'https://a.example/?x=1&y=2\nA [one]',
	);
	assert.match(
		formatSessionLinks(group, 'markdown').text,
		/- \[A \\\[one\\\]\]\(https:\/\/a\.example/,
	);
	const rich = formatSessionLinks(group, 'rich');
	assert.match(rich.html!, /<h3>Reading &lt;list&gt;<\/h3>/);
	assert.match(rich.html!, /href="https:\/\/a\.example\/\?x=1&amp;y=2"/);

	const writes: FakeItem[][] = [];
	class FakeItem {
		data: Record<string, unknown>;
		constructor(data: Record<string, unknown>) {
			this.data = data;
		}
	}
	assert.equal(
		await writeClipboard(
			rich,
			{
				async write(items: FakeItem[]) {
					writes.push(items);
				},
				writeText: async () => assert.fail('rich text should use write'),
			},
			FakeItem,
		),
		'rich',
	);
	assert.deepEqual(Object.keys(writes[0][0].data).toSorted(), [
		'text/html',
		'text/plain',
	]);
	const texts: string[] = [];
	assert.equal(
		await writeClipboard(
			rich,
			{
				async writeText(text: string) {
					texts.push(text);
				},
			},
			undefined,
		),
		'plain',
	);
	assert.equal(texts.length, 1);
});

test('popup pinned override saves pinned tabs once without changing the preference, and they survive reload', async () => {
	const harness = createWorkerHarness(
		stateWithSession({closeOnSave: false, includePinnedTabs: false}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://plain.example/',
				title: 'Plain',
				pinned: false,
			},
			{
				id: 2,
				windowId: 10,
				index: 1,
				active: false,
				url: 'https://pinned-once.example/',
				title: 'Pinned',
				pinned: true,
			},
		],
	);
	await harness.sendMessage({type: 'GET_STATE'});
	const refused = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.deepEqual(
		harness.state.groups
			.find((group) => group.id === refused.groupId)!
			.tabs.map((tab) => tab.url),
		['https://plain.example/'],
	);
	const allowed = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
		includePinned: true,
	});
	assert.equal(allowed.ok, true, allowed.error);
	const reloaded = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(reloaded.settings.includePinnedTabs, false);
	assert.equal(
		reloaded.groups
			.find((group) => group.id === allowed.groupId)!
			.tabs.some((tab) => tab.pinned),
		true,
	);
});

test('explicit quick-popup tab picks are saved even when those tabs are not highlighted', async () => {
	const harness = createWorkerHarness(stateWithSession({closeOnSave: false}), [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			highlighted: true,
			url: 'https://a.example/',
			title: 'A',
		},
		{
			id: 2,
			windowId: 10,
			index: 1,
			active: false,
			highlighted: false,
			url: 'https://b.example/',
			title: 'B',
		},
		{
			id: 3,
			windowId: 10,
			index: 2,
			active: false,
			highlighted: false,
			url: 'https://c.example/',
			title: 'C',
		},
	]);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'selected',
		tabIds: [2, 3],
		groupName: 'Picked',
	});
	assert.equal(response.ok, true, response.error);
	const group = harness.state.groups.find(
		(entry) => entry.id === response.groupId,
	)!;
	assert.equal(group.name, 'Picked');
	assert.deepEqual(
		group.tabs.map((tab) => tab.url),
		['https://b.example/', 'https://c.example/'],
	);
});

test('allowed duplicates inherit notes and title, and UPDATE_TAB shares edits across copies', async () => {
	const state = stateWithSession({
		closeOnSave: false,
		saveDuplicateHandling: 'allow',
		saveDuplicateTitle: 'existing',
	});
	state.groups[0].tabs[0].notes = 'Read before Friday';
	const harness = createWorkerHarness(state, [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://saved.example/article',
			title: 'Fresh title',
		},
	]);
	const saved = await harness.sendMessage({type: 'SAVE_TABS', scope: 'window'});
	const copy = harness.state.groups.find((group) => group.id === saved.groupId)!
		.tabs[0];
	assert.equal(copy.notes, 'Read before Friday');
	assert.equal(copy.title, 'Saved page');

	const edit = await harness.sendMessage({
		type: 'UPDATE_TAB',
		groupId: saved.groupId!,
		tabId: copy.id!,
		fields: {title: 'Renamed', notes: 'New note'},
	});
	assert.equal(edit.ok, true, edit.error);
	assert.equal(edit.shared, 1);
	for (const group of harness.state.groups) {
		assert.equal(group.tabs[0].title, 'Renamed');
		assert.equal(group.tabs[0].notes, 'New note');
	}

	const latestState = stateWithSession({
		closeOnSave: false,
		saveDuplicateHandling: 'allow',
		saveDuplicateTitle: 'latest',
	});
	const latest = createWorkerHarness(latestState, [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://saved.example/article',
			title: 'Fresh title',
		},
	]);
	await latest.sendMessage({type: 'SAVE_TABS', scope: 'window'});
	assert.deepEqual(
		latest.state.groups.map((group) => group.tabs[0].title),
		['Fresh title', 'Fresh title'],
	);
});

test('restoring a single tab in archive mode dims only that tab, and UPDATE_TAB can unarchive it', async () => {
	const state = stateWithSession({restoreMode: 'archive'});
	state.groups[0].tabs.push({
		id: 'saved-tab-2',
		title: 'Other',
		url: 'https://other-saved.example/',
		pinned: false,
	});
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({
		type: 'RESTORE_TAB',
		groupId: 'session-1',
		tabId: 'saved-tab-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(harness.state.groups[0].archived, false);
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => tab.archived),
		[true, false],
	);
	await harness.sendMessage({
		type: 'UPDATE_TAB',
		groupId: 'session-1',
		tabId: 'saved-tab-1',
		fields: {archived: false},
	});
	assert.equal(harness.state.groups[0].tabs[0].archived, false);
});

test('link drag data carries uri-list, plain text, and html for tabs and sessions', async () => {
	const {buildLinkDragData} = await import('../src/app/interaction-actions');
	const single = buildLinkDragData([
		{title: 'A & B', url: 'https://a.example/?x=1&y=2'},
	])!;
	assert.equal(single['text/uri-list'], 'https://a.example/?x=1&y=2');
	assert.equal(
		single['text/html'],
		'<a href="https://a.example/?x=1&amp;y=2">A &amp; B</a>',
	);
	const session = buildLinkDragData(
		[
			{title: 'A', url: 'https://a.example/'},
			{title: '', url: 'https://b.example/'},
		],
		'Reading <1>',
	)!;
	assert.equal(
		session['text/uri-list'],
		'https://a.example/\r\nhttps://b.example/',
	);
	assert.match(
		session['text/plain'],
		/^Reading <1>\nA\nhttps:\/\/a\.example\/\n\nhttps:\/\/b\.example\/\nhttps:\/\/b\.example\/$/,
	);
	assert.match(session['text/html'], /<h3>Reading &lt;1&gt;<\/h3><ul><li>/);
	assert.equal(buildLinkDragData([]), null);
});

test("DELETE_BOOKMARK_COLUMN with discardBookmarks deletes the column's bookmarks instead of moving them", async () => {
	const state = stateWithSession();
	state.schemaVersion = 6;
	state.bookmarkColumns.push({id: 'column-work', name: 'Work', createdAt: 2});
	state.bookmarks = [
		{
			id: 'default-link',
			title: 'Default link',
			url: 'https://default.example/',
			columnId: 'bookmark-default',
		},
		{
			id: 'work-one',
			title: 'Work one',
			url: 'https://work-one.example/',
			columnId: 'column-work',
		},
		{
			id: 'work-two',
			title: 'Work two',
			url: 'https://work-two.example/',
			columnId: 'column-work',
		},
	];
	const harness = createWorkerHarness(state);
	const result = await harness.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'column-work',
		discardBookmarks: true,
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.deleted, 2);
	assert.equal(result.moved, 0);
	assert.deepEqual(
		harness.state.bookmarkColumns.map((column) => column.id),
		['bookmark-default'],
	);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => bookmark.id),
		['default-link'],
	);

	// Discarding also works for the last column, where bookmarks would otherwise become unfiled.
	const last = await harness.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'bookmark-default',
		discardBookmarks: true,
	});
	assert.equal(last.ok, true, last.error);
	assert.equal(last.deleted, 1);
	assert.deepEqual(harness.state.bookmarkColumns, []);
	assert.deepEqual(harness.state.bookmarks, []);
});

function stateWithEverything(): StoredState {
	const state = stateWithSession({
		excludedOrigins: ['https://private.example'],
		copyFormat: 'url',
	});
	state.schemaVersion = 6;
	state.groups.push({
		id: 'session-2',
		name: 'Work',
		folderId: 'folder-work',
		createdAt: 2,
		tabs: [{id: 't2', title: 'Work', url: 'https://work.example/'}],
	});
	state.folders.push({id: 'folder-work', name: 'Work', createdAt: 2});
	state.bookmarkColumns = [{id: 'column-news', name: 'News', createdAt: 3}];
	state.bookmarks = [
		{
			id: 'b1',
			title: 'One',
			url: 'https://one.example/',
			columnId: 'column-news',
		},
		{
			id: 'b2',
			title: 'Two',
			url: 'https://two.example/',
			columnId: 'column-news',
		},
		{
			id: 'b3',
			title: 'Three',
			url: 'https://three.example/',
			columnId: 'bookmark-unfiled',
		},
	];
	return state;
}

const freshFolders = [
	{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true},
];
const freshColumns = [
	{id: 'bookmark-default', name: 'Bookmarks', createdAt: 0, isDefault: true},
];

test('ERASE_DATA sessions removes sessions and folders but keeps bookmarks and settings', async () => {
	const harness = createWorkerHarness(stateWithEverything());
	const result = await harness.sendMessage({
		type: 'ERASE_DATA',
		scope: 'sessions',
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.sessions, 2);
	assert.equal(result.bookmarks, 0);
	assert.deepEqual(harness.state.groups, []);
	assert.deepEqual(harness.state.folders, freshFolders);
	assert.equal(harness.state.bookmarks.length, 3);
	assert.deepEqual(
		harness.state.bookmarkColumns.map((column) => column.id),
		['column-news'],
	);
	assert.deepEqual(harness.state.settings.excludedOrigins, [
		'https://private.example',
	]);
	assert.equal(harness.state.settings.copyFormat, 'url');
});

test('ERASE_DATA bookmarks removes bookmarks and columns and recreates the default column', async () => {
	const harness = createWorkerHarness(stateWithEverything());
	const result = await harness.sendMessage({
		type: 'ERASE_DATA',
		scope: 'bookmarks',
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.sessions, 0);
	assert.equal(result.bookmarks, 3);
	assert.deepEqual(harness.state.bookmarks, []);
	assert.deepEqual(harness.state.bookmarkColumns, freshColumns);
	assert.deepEqual(
		harness.state.groups.map((group) => group.id),
		['session-1', 'session-2'],
	);
	assert.deepEqual(
		harness.state.folders.map((folder) => folder.id),
		['unfiled', 'folder-work'],
	);
	assert.deepEqual(harness.state.settings.excludedOrigins, [
		'https://private.example',
	]);
});

test('ERASE_DATA all restores fresh-install data while keeping settings and excluded sites', async () => {
	const harness = createWorkerHarness(stateWithEverything());
	const result = await harness.sendMessage({type: 'ERASE_DATA', scope: 'all'});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.sessions, 2);
	assert.equal(result.bookmarks, 3);
	assert.deepEqual(harness.state.groups, []);
	assert.deepEqual(harness.state.folders, freshFolders);
	assert.deepEqual(harness.state.bookmarks, []);
	assert.deepEqual(harness.state.bookmarkColumns, freshColumns);
	assert.deepEqual(harness.state.settings.excludedOrigins, [
		'https://private.example',
	]);
	assert.equal(harness.state.settings.copyFormat, 'url');

	const invalid = await harness.sendMessage({
		type: 'ERASE_DATA',
		scope: 'everything' as 'all',
	});
	assert.equal(invalid.ok, false);
});

test('importing sessions with Bookmarks disabled reports a numeric updatedTitles', async () => {
	const harness = createWorkerHarness(
		stateWithSession({bookmarksEnabled: false}),
	);
	const result = await harness.sendMessage({
		type: 'IMPORT_GROUPS',
		data: {
			groups: [
				{name: 'Imported', tabs: [{title: 'New', url: 'https://new.example/'}]},
			],
		},
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.updatedTitles, 0);
	assert.equal(result.count, 1);
});

test('null stored settings are treated as defaults', async () => {
	const harness = createWorkerHarness({
		...stateWithSession(),
		settings: null,
	} as unknown as StoredState);
	const result = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.settings.sessionsEnabled, true);
	assert.equal(result.settings.restoreTarget, 'new-window-unless-only-tab');
	assert.equal(result.groups.length, 1);
});

test('without contextMenus.onShown the tab-group item stays enabled and a click outside a group fails gracefully', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		withoutContextMenuShown: true,
	});
	assert.equal(harness.listeners.contextMenuShown, undefined);
	await harness.listeners.onInstalled();
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
	const item = harness.menuItems.find(
		(entry) => entry.id === 'tablodge-page-save-group',
	);
	assert.ok(item, 'the tab-group menu item is created');
	assert.notEqual(
		item.enabled,
		false,
		'the tab-group item must not be permanently disabled',
	);

	const warnings: unknown[] = [];
	const originalWarn = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args[0]);
	};

	try {
		const click = harness.listeners.contextMenuClicked as (
			info: {menuItemId: string},
			tab: Partial<MockTab> & {groupId: number},
		) => void;
		click(
			{menuItemId: 'tablodge-page-save-group'},
			{id: 1, windowId: 10, groupId: -1},
		);
		await new Promise((resolve) => {
			setTimeout(resolve, 10);
		});
	} finally {
		console.warn = originalWarn;
	}

	assert.deepEqual(warnings, ['The active tab is not in a tab group.']);
	assert.equal(harness.state.groups.length, 1, 'no session is saved');
});

// ---- Split View (Chrome 155+): two tabs shown side by side in one tab-strip slot ----

// Window 10: a split pair (1|2), a plain tab (3), and a second split pair (4|5).
function splitWindowTabs(highlighted: number[] = [1]): MockTab[] {
	return [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://left.example/',
			title: 'Left',
			splitViewId: 7,
		},
		{
			id: 2,
			windowId: 10,
			index: 1,
			active: false,
			url: 'https://right.example/',
			title: 'Right',
			splitViewId: 7,
		},
		{
			id: 3,
			windowId: 10,
			index: 2,
			active: false,
			url: 'https://plain.example/',
			title: 'Plain',
			splitViewId: -1,
		},
		{
			id: 4,
			windowId: 10,
			index: 3,
			active: false,
			url: 'https://docs.example/',
			title: 'Docs',
			splitViewId: 9,
		},
		{
			id: 5,
			windowId: 10,
			index: 4,
			active: false,
			url: 'https://notes.example/',
			title: 'Notes',
			splitViewId: 9,
		},
	].map((tab) => ({...tab, highlighted: highlighted.includes(tab.id)}));
}

const savedUrlsAndSplits = (group: StoredSession | undefined) =>
	group!.tabs.map((tab) => [
		new URL(tab.url!).hostname.split('.', 1)[0],
		tab.split?.position ?? null,
	]);

// A session holding a split pair (left|right) followed by a plain tab.
function stateWithSplitSession(
	settings: Record<string, unknown> = {},
	tabs?: Array<Partial<SavedTab>>,
): StoredState {
	const state = stateWithSession({
		restoreTarget: 'current-window',
		...settings,
	});
	state.schemaVersion = 7;
	state.groups[0].tabs = tabs || [
		{
			id: 'split-left',
			title: 'Left',
			url: 'https://left.example/',
			split: {id: 'pair-1', position: 0},
		},
		{
			id: 'split-right',
			title: 'Right',
			url: 'https://right.example/',
			split: {id: 'pair-1', position: 1},
		},
		{id: 'plain', title: 'Plain', url: 'https://plain.example/'},
	];
	return state;
}

test('window saves record each split pair with a fresh per-session key and left/right positions', async () => {
	const harness = createWorkerHarness(
		stateWithSession({closeOnSave: false}),
		splitWindowTabs(),
	);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(response.ok, true, response.error);
	const saved = harness.state.groups.find(
		(group) => group.id === response.groupId,
	)!;
	assert.deepEqual(savedUrlsAndSplits(saved), [
		['left', 0],
		['right', 1],
		['plain', null],
		['docs', 0],
		['notes', 1],
	]);
	const [left, right, , docs, notes] = saved.tabs;
	assert.equal(left.split!.id, right.split!.id);
	assert.equal(docs.split!.id, notes.split!.id);
	assert.notEqual(left.split!.id, docs.split!.id);
	assert.notEqual(
		left.split!.id,
		'7',
		"the browser's volatile splitViewId is not stored",
	);
});

test('saving only one half of a split stores it as a plain tab, and an active split alone is not a selection', async () => {
	const harness = createWorkerHarness(
		stateWithSession({closeOnSave: false}),
		splitWindowTabs([2, 3]),
	);
	const selected = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'selected',
	});
	assert.equal(selected.ok, true, selected.error);
	assert.deepEqual(
		savedUrlsAndSplits(
			harness.state.groups.find((group) => group.id === selected.groupId),
		),
		[
			['right', null],
			['plain', null],
		],
	);

	// Both halves of the active split highlighted is one tab-strip slot, so "selected or window" saves the window.
	const slot = createWorkerHarness(
		stateWithSession({closeOnSave: false}),
		splitWindowTabs([1, 2]),
	);
	const windowSave = await slot.sendMessage({
		type: 'SAVE_TABS',
		scope: 'selected-or-window',
	});
	assert.equal(windowSave.ok, true, windowSave.error);
	assert.equal(
		slot.state.groups.find((group) => group.id === windowSave.groupId)!.tabs
			.length,
		5,
	);

	const explicit = createWorkerHarness(
		stateWithSession({closeOnSave: false}),
		splitWindowTabs(),
	);
	const picked = await explicit.sendMessage({
		type: 'SAVE_TABS',
		scope: 'selected',
		tabIds: [1],
	});
	assert.deepEqual(
		savedUrlsAndSplits(
			explicit.state.groups.find((group) => group.id === picked.groupId),
		),
		[['left', null]],
	);
});

test("saveSplitTabs 'focused' keeps only the active half of the active split in selection saves", async () => {
	const highlighted = [1, 2, 4, 5];
	const both = createWorkerHarness(
		stateWithSession({closeOnSave: false}),
		splitWindowTabs(highlighted),
	);
	const bothResult = await both.sendMessage({
		type: 'SAVE_TABS',
		scope: 'selected',
	});
	assert.deepEqual(
		savedUrlsAndSplits(
			both.state.groups.find((group) => group.id === bothResult.groupId),
		),
		[
			['left', 0],
			['right', 1],
			['docs', 0],
			['notes', 1],
		],
	);

	const focused = createWorkerHarness(
		stateWithSession({closeOnSave: true, saveSplitTabs: 'focused'}),
		splitWindowTabs(highlighted),
	);
	const focusedResult = await focused.sendMessage({
		type: 'SAVE_TABS',
		scope: 'selected',
	});
	assert.equal(focusedResult.ok, true, focusedResult.error);
	// Other split views in the selection are still saved in full.
	assert.deepEqual(
		savedUrlsAndSplits(
			focused.state.groups.find((group) => group.id === focusedResult.groupId),
		),
		[
			['left', null],
			['docs', 0],
			['notes', 1],
		],
	);
	assert.deepEqual(
		focused.removedTabIds.toSorted((a, b) => a - b),
		[1, 4, 5],
		'the unsaved half stays open',
	);

	const toolbar = createWorkerHarness(
		stateWithSession({closeOnSave: false, saveSplitTabs: 'focused'}),
		splitWindowTabs(highlighted),
	);
	const toolbarResult = await toolbar.sendMessage({
		type: 'SAVE_TABS',
		scope: 'selected-or-window',
	});
	assert.equal(
		toolbar.state.groups.find((group) => group.id === toolbarResult.groupId)!
			.tabs.length,
		3,
	);

	// Whole-window saves always keep both halves.
	const windowSave = createWorkerHarness(
		stateWithSession({closeOnSave: false, saveSplitTabs: 'focused'}),
		splitWindowTabs(highlighted),
	);
	const windowResult = await windowSave.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(
		windowSave.state.groups.find((group) => group.id === windowResult.groupId)!
			.tabs.length,
		5,
	);
});

test('excluded sites and rejected duplicates drop a partner, leaving the other half unsplit', async () => {
	const excluded = createWorkerHarness(
		stateWithSession({
			closeOnSave: false,
			excludedOrigins: ['https://right.example'],
		}),
		splitWindowTabs(),
	);
	const excludedResult = await excluded.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.deepEqual(
		savedUrlsAndSplits(
			excluded.state.groups.find(
				(group) => group.id === excludedResult.groupId,
			),
		),
		[
			['left', null],
			['plain', null],
			['docs', 0],
			['notes', 1],
		],
	);

	const state = stateWithSession({
		closeOnSave: false,
		saveDuplicateHandling: 'reject',
	});
	state.groups[0].tabs = [
		{id: 'known', title: 'Docs', url: 'https://docs.example/'},
	];
	const duplicate = createWorkerHarness(state, splitWindowTabs());
	const duplicateResult = await duplicate.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(duplicateResult.skipped, 1);
	assert.deepEqual(
		savedUrlsAndSplits(
			duplicate.state.groups.find(
				(group) => group.id === duplicateResult.groupId,
			),
		),
		[
			['left', 0],
			['right', 1],
			['plain', null],
			['notes', null],
		],
	);
});

test('restoring a session recreates its split view from adjacent tabs', async () => {
	const harness = createWorkerHarness(stateWithSplitSession());
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.count, 3);
	assert.equal(response.splits, 1);
	assert.equal(response.splitsSeparated, 0);
	const [, left, right, plain] = harness.tabsForWindow(10);
	assert.deepEqual(
		[left.url, right.url, plain.url],
		[
			'https://left.example/',
			'https://right.example/',
			'https://plain.example/',
		],
	);
	assert.ok(left.splitViewId! >= 0);
	assert.equal(left.splitViewId, right.splitViewId);
	assert.equal(plain.splitViewId ?? -1, -1);
	assert.deepEqual(harness.apiLog, [`split:${left.id},${right.id}`]);
});

test("restoreSplitTabs 'separate' opens the pair as neighboring normal tabs", async () => {
	const harness = createWorkerHarness(
		stateWithSplitSession({restoreSplitTabs: 'separate'}),
	);
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.splits, 0);
	assert.equal(response.splitsSeparated, 0);
	assert.deepEqual(harness.apiLog, []);
	assert.deepEqual(
		harness
			.tabsForWindow(10)
			.map((tab) => tab.url)
			.slice(1),
		[
			'https://left.example/',
			'https://right.example/',
			'https://plain.example/',
		],
	);
});

test('restore falls back to normal tabs when createSplit is missing or throws, without failing tabs', async () => {
	const missing = createWorkerHarness(stateWithSplitSession(), undefined, {
		splitApi: 'missing',
	});
	const missingResult = await missing.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(missingResult.ok, true, missingResult.error);
	assert.equal(missingResult.count, 3);
	assert.equal(missingResult.failed, 0);
	assert.equal(
		missingResult.splitsSeparated,
		0,
		'an unsupported browser falls back silently',
	);

	const throws = createWorkerHarness(
		stateWithSplitSession({restoreMode: 'remove'}),
		undefined,
		{splitApi: 'throws'},
	);
	const throwsResult = await throws.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(throwsResult.ok, true, throwsResult.error);
	assert.equal(throwsResult.count, 3);
	assert.equal(throwsResult.failed, 0);
	assert.equal(throwsResult.splits, 0);
	assert.equal(
		throwsResult.splitsSeparated,
		1,
		'a refused split is a soft note',
	);
	assert.equal(
		throwsResult.removed,
		true,
		'split failures never block restore-and-remove',
	);
	assert.deepEqual(
		throws
			.tabsForWindow(10)
			.map((tab) => tab.url)
			.slice(1),
		[
			'https://left.example/',
			'https://right.example/',
			'https://plain.example/',
		],
	);
});

test('a pair the browser placed apart is moved together once and split', async () => {
	const harness = createWorkerHarness(stateWithSplitSession(), undefined, {
		misplacedCreateUrls: ['https://right.example/'],
	});
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.splits, 1);
	const order = harness.tabsForWindow(10);
	const left = order.find((tab) => tab.url === 'https://left.example/')!;
	const right = order.find((tab) => tab.url === 'https://right.example/')!;
	assert.equal(right.index, left.index + 1);
	assert.equal(left.splitViewId, right.splitViewId);
	assert.match(harness.apiLog.join(' '), /^split:\S+ move:\S+ split:\S+$/);
});

test('pinned and grouped split pairs keep their state, with grouping before splitting and collapsing after', async () => {
	const work = {
		key: 'g1',
		title: 'Work',
		color: 'blue' as const,
		collapsed: true,
	};
	const state = stateWithSplitSession({includePinnedTabs: true}, [
		{
			id: 'pin-left',
			title: 'Mail',
			url: 'https://mail.example/',
			pinned: true,
			split: {id: 'pinned-pair', position: 0},
		},
		{
			id: 'pin-right',
			title: 'Chat',
			url: 'https://chat.example/',
			pinned: true,
			split: {id: 'pinned-pair', position: 1},
		},
		{
			id: 'work-solo',
			title: 'Board',
			url: 'https://board.example/',
			nativeGroup: work,
		},
		{
			id: 'work-left',
			title: 'Spec',
			url: 'https://spec.example/',
			nativeGroup: work,
			split: {id: 'group-pair', position: 0},
		},
		{
			id: 'work-right',
			title: 'Code',
			url: 'https://code.example/',
			nativeGroup: work,
			split: {id: 'group-pair', position: 1},
		},
	]);
	const harness = createWorkerHarness(state, [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://current.example/',
			title: 'Current',
			groupId: -1,
		},
	]);
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.splits, 2);
	const byUrl = (host: string) =>
		harness.tabs.find((tab) => tab.url === `https://${host}.example/`)!;
	const [mail, chat, board, spec, code] = [
		'mail',
		'chat',
		'board',
		'spec',
		'code',
	].map((host) => byUrl(host));
	assert.equal(mail.pinned && chat.pinned, true);
	assert.equal(mail.splitViewId, chat.splitViewId);
	assert.ok(spec.groupId! >= 0);
	assert.equal(spec.groupId, code.groupId);
	assert.equal(board.groupId, spec.groupId);
	assert.equal(spec.splitViewId, code.splitViewId);
	assert.notEqual(spec.splitViewId, mail.splitViewId);
	assert.deepEqual(
		harness.apiLog.map((entry) => entry.split(':', 1)[0]),
		['group', 'split', 'split', 'groupUpdate'],
	);
	assert.match(harness.apiLog.at(-1)!, /:collapsed$/);
});

test('restore duplicate skipping and single-tab restore open a lone half without splitting', async () => {
	const open = [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://left.example/',
			title: 'Already open',
		},
	];
	const skipped = createWorkerHarness(
		stateWithSplitSession({restoreDuplicateHandling: 'skip'}),
		open,
	);
	const skipResult = await skipped.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(skipResult.ok, true, skipResult.error);
	assert.equal(skipResult.skipped, 1);
	assert.equal(skipResult.splits, 0);
	assert.deepEqual(skipped.apiLog, []);
	assert.deepEqual(
		skipped.openedTabs.map((tab) => tab.url),
		['https://right.example/', 'https://plain.example/'],
	);

	const single = createWorkerHarness(stateWithSplitSession());
	const singleResult = await single.sendMessage({
		type: 'RESTORE_TAB',
		groupId: 'session-1',
		tabId: 'split-right',
	});
	assert.equal(singleResult.ok, true, singleResult.error);
	assert.deepEqual(
		single.openedTabs.map((tab) => tab.url),
		['https://right.example/'],
	);
	assert.deepEqual(single.apiLog, []);
});

test('unloading restored tabs leaves split tabs loaded', async () => {
	const harness = createWorkerHarness(
		stateWithSplitSession({unloadRestoredTabs: true}),
	);
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	const plain = harness.tabs.find(
		(tab) => tab.url === 'https://plain.example/',
	)!;
	assert.deepEqual(harness.discardedTabs, [plain.id]);

	// When the browser refused the split, the pair are ordinary background tabs again and may be unloaded.
	const refused = createWorkerHarness(
		stateWithSplitSession({unloadRestoredTabs: true}),
		undefined,
		{splitApi: 'throws'},
	);
	await refused.sendMessage({type: 'RESTORE_GROUP', groupId: 'session-1'});
	const right = refused.tabs.find(
		(tab) => tab.url === 'https://right.example/',
	)!;
	const plainId = refused.tabs.find(
		(tab) => tab.url === 'https://plain.example/',
	)!.id;
	assert.deepEqual(
		refused.discardedTabs.toSorted((a, b) => a - b),
		[right.id, plainId].toSorted((a, b) => a - b),
	);
});

test('import keeps valid split pairs and drops invalid, orphaned, or mismatched split info', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const split = (id: unknown, position: unknown) => ({id, position});
	const data = {
		format: 'example-sessions',
		version: 1,
		groups: [
			{
				name: 'Split import',
				tabs: [
					// Stored right-then-left: reordered so the left tab comes first.
					{title: 'B', url: 'https://b.example/', split: split('p1', 1)},
					{title: 'A', url: 'https://a.example/', split: split('p1', 0)},
					{
						title: 'Orphan',
						url: 'https://orphan.example/',
						split: split('p2', 0),
					},
					{
						title: 'Bad position',
						url: 'https://bad-position.example/',
						split: split('p3', 2),
					},
					{
						title: 'Bad id',
						url: 'https://bad-id.example/',
						split: split(42, 1),
					},
					{
						title: 'Pinned mismatch',
						url: 'https://pinned-a.example/',
						split: split('p4', 0),
					},
					{
						title: 'Pinned mismatch',
						url: 'https://pinned-b.example/',
						pinned: true,
						split: split('p4', 1),
					},
					{
						title: 'Same position',
						url: 'https://same-a.example/',
						split: split('p5', 0),
					},
					{
						title: 'Same position',
						url: 'https://same-b.example/',
						split: split('p5', 0),
					},
					{
						title: 'Reused key',
						url: 'https://reused-a.example/',
						split: split('p1', 0),
					},
					{
						title: 'Reused key',
						url: 'https://reused-b.example/',
						split: split('p1', 1),
					},
					{title: 'Old export', url: 'https://old.example/'},
				],
			},
		],
	};
	const result = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data,
		importOptions: {duplicateMode: 'allow'},
	});
	assert.equal(result.ok, true, result.error);
	const imported = harness.state.groups.find(
		(group) => group.name === 'Split import',
	)!;
	assert.deepEqual(
		imported.tabs.map((tab) => [
			new URL(tab.url!).hostname.split('.', 1)[0],
			tab.split ? `${tab.split.id}:${tab.split.position}` : null,
		]),
		[
			['a', 'p1:0'],
			['b', 'p1:1'],
			['orphan', null],
			['bad-position', null],
			['bad-id', null],
			['pinned-a', null],
			['same-a', null],
			['same-b', null],
			['reused-a', null],
			['reused-b', null],
			['old', null],
		],
	);
	assert.equal(
		imported.tabs.some((tab) => 'split' in tab && tab.split === undefined),
		false,
		'no empty split keys are stored',
	);
});

test("import duplicate skipping and deleting one half orphan the remaining tab's split info", async () => {
	const state = stateWithSession();
	state.groups[0].tabs = [
		{id: 'known', title: 'Known', url: 'https://b.example/'},
	];
	const harness = createWorkerHarness(state);
	const data = {
		groups: [
			{
				name: 'Pair',
				tabs: [
					{
						title: 'A',
						url: 'https://a.example/',
						split: {id: 'p1', position: 0},
					},
					{
						title: 'B',
						url: 'https://b.example/',
						split: {id: 'p1', position: 1},
					},
					{
						title: 'C',
						url: 'https://c.example/',
						split: {id: 'p2', position: 0},
					},
					{
						title: 'D',
						url: 'https://d.example/',
						split: {id: 'p2', position: 1},
					},
				],
			},
		],
	};
	const result = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data,
		importOptions: {duplicateMode: 'skip'},
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.skipped, 1);
	const pair = harness.state.groups.find((group) => group.name === 'Pair')!;
	assert.deepEqual(
		pair.tabs.map((tab) => tab.split?.id ?? null),
		[null, 'p2', 'p2'],
	);

	const deleted = await harness.sendMessage({
		type: 'DELETE_TAB',
		groupId: pair.id!,
		tabId: pair.tabs[2].id!,
	});
	assert.equal(deleted.ok, true, deleted.error);
	const reloaded = await harness.sendMessage({type: 'GET_STATE'});
	assert.deepEqual(
		reloaded.groups
			.find((group) => group.name === 'Pair')!
			.tabs.map((tab) => tab.split ?? null),
		[null, null],
	);
});

test('exported sessions carry split info that imports back as the same pair', async () => {
	const source = createWorkerHarness(
		stateWithSession({closeOnSave: false}),
		splitWindowTabs(),
	);
	await source.sendMessage({type: 'SAVE_TABS', scope: 'window'});
	const exported = await source.sendMessage({type: 'GET_STATE'});
	const file = JSON.stringify({
		format: 'tablodge-sessions',
		version: 1,
		folders: exported.folders,
		groups: exported.groups,
	});
	const payload: unknown = JSON.parse(file);
	const target = createWorkerHarness({...stateWithSession(), groups: []});
	const imported = await target.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: payload,
	});
	assert.equal(imported.ok, true, imported.error);
	const session = target.state.groups.find((group) => group.tabs.length === 5)!;
	assert.deepEqual(savedUrlsAndSplits(session), [
		['left', 0],
		['right', 1],
		['plain', null],
		['docs', 0],
		['notes', 1],
	]);
});

test('split settings default to side-by-side restore and saving both tabs, and normalize unknown values', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	const initial = await defaults.sendMessage({type: 'GET_STATE'});
	assert.equal(initial.settings.restoreSplitTabs, 'split');
	assert.equal(initial.settings.saveSplitTabs, 'both');

	const invalid = createWorkerHarness(
		stateWithSession({restoreSplitTabs: 'sideways', saveSplitTabs: 1}),
	);
	const normalized = await invalid.sendMessage({type: 'GET_STATE'});
	assert.equal(normalized.settings.restoreSplitTabs, 'split');
	assert.equal(normalized.settings.saveSplitTabs, 'both');

	const updated = await invalid.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {restoreSplitTabs: 'separate', saveSplitTabs: 'focused'},
	});
	assert.equal(updated.ok, true, updated.error);
	assert.equal(invalid.state.settings.restoreSplitTabs, 'separate');
	assert.equal(invalid.state.settings.saveSplitTabs, 'focused');
	const reset = await invalid.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.restoreSplitTabs, 'split');
	assert.equal(reset.settings.saveSplitTabs, 'both');
});

test('expandSessionsByDefault is on by default, only an explicit false turns it off, and resets to on', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	assert.equal(
		(await defaults.sendMessage({type: 'GET_STATE'})).settings
			.expandSessionsByDefault,
		false,
	);

	const truthy = createWorkerHarness(
		stateWithSession({expandSessionsByDefault: false}),
	);
	assert.equal(
		(await truthy.sendMessage({type: 'GET_STATE'})).settings
			.expandSessionsByDefault,
		false,
		'only a real true enables it',
	);

	const updated = await truthy.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {expandSessionsByDefault: true},
	});
	assert.equal(updated.ok, true, updated.error);
	assert.equal(truthy.state.settings.expandSessionsByDefault, true);
	const reset = await truthy.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.expandSessionsByDefault, true);
});

test('link, quick-action, ordering and pin settings normalize with defaults', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	const s = (await defaults.sendMessage({type: 'GET_STATE'})).settings;
	assert.equal(s.bookmarkClickAction, 'current');
	assert.equal(s.sessionLinkClickAction, 'new');
	assert.equal(s.showBookmarkQuickActions, false);
	assert.equal(s.sessionsOnTop, false);
	assert.equal(s.keepLodgePinned, false);
	assert.equal(s.urlDisplayMode, 'full');

	const junk = createWorkerHarness(
		stateWithSession({
			bookmarkClickAction: 'bogus',
			sessionLinkClickAction: 'none',
			showBookmarkQuickActions: 'yes',
			sessionsOnTop: 1,
			keepLodgePinned: true,
			urlDisplayMode: 'domain',
		}),
	);
	const j = (await junk.sendMessage({type: 'GET_STATE'})).settings;
	assert.equal(j.bookmarkClickAction, 'current');
	assert.equal(j.sessionLinkClickAction, 'none');
	assert.equal(j.showBookmarkQuickActions, false);
	assert.equal(j.sessionsOnTop, false);
	assert.equal(j.keepLodgePinned, true);
	assert.equal(j.urlDisplayMode, 'domain');
	const reset = await junk.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.keepLodgePinned, false);
	assert.equal(reset.settings.urlDisplayMode, 'full');
});

test('stretchBookmarkColumns is on by default, only an explicit false turns it off, and resets to on', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	assert.equal(
		(await defaults.sendMessage({type: 'GET_STATE'})).settings
			.stretchBookmarkColumns,
		true,
	);

	const junk = createWorkerHarness(
		stateWithSession({stretchBookmarkColumns: 'no'}),
	);
	assert.equal(
		(await junk.sendMessage({type: 'GET_STATE'})).settings
			.stretchBookmarkColumns,
		true,
		'only a real false disables it',
	);

	const off = createWorkerHarness(
		stateWithSession({stretchBookmarkColumns: false}),
	);
	assert.equal(
		(await off.sendMessage({type: 'GET_STATE'})).settings
			.stretchBookmarkColumns,
		false,
	);

	const updated = await junk.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {stretchBookmarkColumns: false},
	});
	assert.equal(updated.ok, true, updated.error);
	assert.equal(junk.state.settings.stretchBookmarkColumns, false);
	const reset = await junk.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.stretchBookmarkColumns, true);
});

test("bookmark imports with a target column ignore the file's columns and fill only that column", async () => {
	const harness = createWorkerHarness(stateWithSession());
	harness.state.bookmarkColumns = [
		{id: 'bookmark-default', name: 'Bookmarks', isDefault: true},
		{id: 'reading', name: 'Reading'},
	];
	const input = {
		bookmarkColumns: [{id: 'imports', name: 'Imported links'}],
		bookmarks: [
			{title: 'One', url: 'https://one.example/', columnId: 'imports'},
			{title: 'Two', url: 'https://two.example/'},
		],
	};
	const result = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: input,
		importOptions: {targetColumnId: 'reading'},
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.columns, 0);
	assert.deepEqual(
		harness.state.bookmarkColumns.map((column) => column.name),
		['Bookmarks', 'Reading'],
	);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => [
			bookmark.url,
			bookmark.columnId,
		]),
		[
			['https://one.example/', 'reading'],
			['https://two.example/', 'reading'],
		],
	);
	// Unfiled works as a target; an unknown column id falls back to the file's columns.
	const unfiled = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: {bookmarks: [{url: 'https://three.example/'}]},
		importOptions: {targetColumnId: 'bookmark-unfiled'},
	});
	assert.equal(unfiled.ok, true, unfiled.error);
	assert.equal(harness.state.bookmarks.at(-1)?.columnId, 'bookmark-unfiled');
	const unknown = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: {
			bookmarkColumns: [{id: 'x', name: 'From file'}],
			bookmarks: [{url: 'https://four.example/', columnId: 'x'}],
		},
		importOptions: {targetColumnId: 'missing'},
	});
	assert.equal(unknown.ok, true, unknown.error);
	assert.equal(
		harness.state.bookmarkColumns.some((column) => column.name === 'From file'),
		true,
	);
});

test('browser bookmark import into one column creates no folder columns', async () => {
	const tree = [
		{
			id: '0',
			title: '',
			children: [
				{
					id: '1',
					title: 'Bookmarks bar',
					children: [
						{
							id: '2',
							title: 'Docs',
							children: [
								{id: '3', title: 'Guide', url: 'https://docs.example/guide'},
							],
						},
						{id: '4', title: 'News', url: 'https://news.example/'},
					],
				},
			],
		},
	];
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		bookmarkTree: tree,
	});
	const response = await harness.sendMessage({
		type: 'IMPORT_BROWSER_BOOKMARKS',
		targetColumnId: 'bookmark-default',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.columnsAdded, 0);
	assert.equal(response.bookmarksAdded, 2);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => bookmark.columnId),
		['bookmark-default', 'bookmark-default'],
	);
});

test("files from other tools import through the parsers' payloads", async () => {
	const {parseImportFile, sessionImportPayload, bookmarkImportPayload} =
		await import('../src/app/import-formats');
	const harness = createWorkerHarness(stateWithSession());
	const onetab = parseImportFile(
		'https://a.example/ | A\nhttps://b.example/ | B\n\nhttps://c.example/ | C\n',
		'onetab.txt',
	);
	const sessions = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: sessionImportPayload(onetab),
		importOptions: {duplicateMode: 'skip'},
	});
	assert.equal(sessions.ok, true, sessions.error);
	assert.equal(sessions.groups, 2);
	assert.equal(sessions.count, 3);
	assert.deepEqual(
		harness.state.groups.slice(0, 2).map((group) => group.name),
		['OneTab group 1', 'OneTab group 2'],
	);
	const csv = parseImportFile(
		'title,url,session,folder,notes,created\nT,https://t.example/,Work,Projects,Remember,2025-01-01T00:00:00.000Z\n',
		'x.csv',
	);
	const withFolder = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: sessionImportPayload(csv),
	});
	assert.equal(withFolder.ok, true, withFolder.error);
	const work = harness.state.groups.find((group) => group.name === 'Work');
	assert.equal(
		harness.state.folders.find((folder) => folder.id === work?.folderId)?.name,
		'Projects',
	);
	assert.equal(work?.tabs[0].notes, 'Remember');
	assert.equal(work?.createdAt, Date.parse('2025-01-01T00:00:00.000Z'));
	const html = parseImportFile(
		'<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Dev</H3><DL><p><DT><A HREF="https://dev.example/">Dev</A></DL><p><DT><A HREF="https://loose.example/">Loose</A></DL>',
		'b.html',
	);
	const bookmarks = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: bookmarkImportPayload(html),
	});
	assert.equal(bookmarks.ok, true, bookmarks.error);
	assert.equal(bookmarks.columns, 1);
	const dev = harness.state.bookmarkColumns.find(
		(column) => column.name === 'Dev',
	);
	assert.equal(
		harness.state.bookmarks.find(
			(bookmark) => bookmark.url === 'https://dev.example/',
		)?.columnId,
		dev?.id,
	);
	assert.equal(
		harness.state.bookmarks.find(
			(bookmark) => bookmark.url === 'https://loose.example/',
		)?.columnId,
		'bookmark-default',
	);
});

test('dashboard query parameters: search prefill, new-column request, and URL cleanup', async () => {
	const {initialSearchQuery, newColumnRequested, stripSearchParams} =
		await import('../src/app/page-params');
	assert.equal(initialSearchQuery('?q=%20split%0Aview%20'), 'split view');
	assert.equal(initialSearchQuery('?bookmarkUrl=x'), '');
	assert.equal(initialSearchQuery(`?q=${'a'.repeat(300)}`).length, 200);
	assert.equal(newColumnRequested('new'), true);
	assert.equal(newColumnRequested('bookmark-default'), false);
	assert.equal(newColumnRequested(null), false);
	assert.equal(
		stripSearchParams(
			{pathname: '/newtab.html', search: '?q=x&group=g1', hash: '#sessions'},
			['q'],
		),
		'/newtab.html?group=g1#sessions',
	);
	assert.equal(
		stripSearchParams(
			{
				pathname: '/newtab.html',
				search: '?bookmarkUrl=u&bookmarkTitle=t&bookmarkColumn=new',
				hash: '',
			},
			['bookmarkUrl', 'bookmarkTitle', 'bookmarkColumn'],
		),
		'/newtab.html',
	);
});

// ---- Session link moves, session ordering, and the pinned TabLodge tab ----
function reorderState(settings: Record<string, unknown> = {}): StoredState {
	const state = stateWithSession(settings);
	const tab = (
		id: string,
		extra: Partial<SavedTab> = {},
	): Partial<SavedTab> => ({
		id,
		title: id,
		url: `https://${id}.example/`,
		pinned: false,
		originalIndex: 0,
		...extra,
	});
	state.groups = [
		{
			...state.groups[0],
			id: 'A',
			name: 'A',
			tabs: [
				tab('a1', {split: {id: 'pair', position: 0}}),
				tab('a2', {split: {id: 'pair', position: 1}}),
				tab('a3'),
			],
		},
		{...state.groups[0], id: 'B', name: 'B', tabs: [tab('b1'), tab('b2')]},
		{...state.groups[0], id: 'C', name: 'C', tabs: [tab('c1')]},
	];
	return state;
}

const tabIdsOf = (state: StoredState, groupId: string) =>
	state.groups.find((group) => group.id === groupId)?.tabs.map((t) => t.id);

test('MOVE_TAB moves a link to another session, drops split info for both halves, and removes an emptied source', async () => {
	const harness = createWorkerHarness(reorderState());
	const moved = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'A',
		tabId: 'a1',
		toGroupId: 'B',
		targetTabId: 'b1',
		position: 'after',
	});
	assert.equal(moved.ok, true, moved.error);
	assert.deepEqual(tabIdsOf(harness.state, 'A'), ['a2', 'a3']);
	assert.deepEqual(tabIdsOf(harness.state, 'B'), ['b1', 'a1', 'b2']);
	const all = harness.state.groups.flatMap((group) => group.tabs);
	assert.equal(
		all.every((t) => !t.split),
		true,
		'neither half of the old pair keeps split info',
	);

	const emptied = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'C',
		tabId: 'c1',
		toGroupId: 'A',
		targetTabId: 'a2',
		position: 'before',
	});
	assert.equal(emptied.ok, true, emptied.error);
	assert.deepEqual(tabIdsOf(harness.state, 'A'), ['c1', 'a2', 'a3']);
	assert.equal(
		harness.state.groups.some((group) => group.id === 'C'),
		false,
	);
});

test('MOVE_TAB with copy keeps the source and its split pair, and appends without a target', async () => {
	const harness = createWorkerHarness(reorderState());
	const copied = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'A',
		tabId: 'a1',
		toGroupId: 'B',
		copy: true,
	});
	assert.equal(copied.ok, true, copied.error);
	assert.deepEqual(tabIdsOf(harness.state, 'A'), ['a1', 'a2', 'a3']);
	assert.equal(harness.state.groups[0].tabs[0].split?.id, 'pair');
	const b = harness.state.groups.find((group) => group.id === 'B')!;
	assert.equal(b.tabs.length, 3);
	const copy = b.tabs.at(-1)!;
	assert.notEqual(copy.id, 'a1');
	assert.equal(copy.url, 'https://a1.example/');
	assert.equal(copy.split, undefined);
});

test('MOVE_TAB reorders inside one session and rejects unknown links or sessions', async () => {
	const harness = createWorkerHarness(reorderState());
	const reordered = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'A',
		tabId: 'a3',
		toGroupId: 'A',
		targetTabId: 'a1',
		position: 'before',
	});
	assert.equal(reordered.ok, true, reordered.error);
	assert.deepEqual(tabIdsOf(harness.state, 'A'), ['a3', 'a1', 'a2']);
	const missingTab = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'A',
		tabId: 'nope',
		toGroupId: 'B',
	});
	assert.equal(missingTab.ok, false);
	const missingGroup = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'A',
		tabId: 'a3',
		toGroupId: 'nope',
	});
	assert.equal(missingGroup.ok, false);
	assert.deepEqual(tabIdsOf(harness.state, 'A'), ['a3', 'a1', 'a2']);
});

test('SET_GROUP_ORDER persists a custom session order and switches the sort to custom', async () => {
	const harness = createWorkerHarness(reorderState({sessionSort: 'newest'}));
	const result = await harness.sendMessage({
		type: 'SET_GROUP_ORDER',
		order: ['C', 'A', 'B'],
	});
	assert.equal(result.ok, true, result.error);
	assert.deepEqual(
		harness.state.groups.map((group) => group.id),
		['C', 'A', 'B'],
	);
	assert.equal(harness.state.settings.sessionSort, 'custom');

	// A filtered view lists only some sessions: they trade places among their own slots.
	const subset = await harness.sendMessage({
		type: 'SET_GROUP_ORDER',
		order: ['B', 'C', 'ghost'],
	});
	assert.equal(subset.ok, true, subset.error);
	assert.deepEqual(
		harness.state.groups.map((group) => group.id),
		['B', 'A', 'C'],
	);
});

const settleLodge = async () =>
	new Promise((resolve) => {
		setTimeout(resolve, 500);
	});
const lodgeUrl = 'chrome-extension://tablodge/newtab.html';
const pinnedLodges = (
	harness: ReturnType<typeof createWorkerHarness>,
	windowId: number,
) =>
	harness.tabs.filter(
		(tab) => tab.windowId === windowId && tab.url === lodgeUrl && tab.pinned,
	);

