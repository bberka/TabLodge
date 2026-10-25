import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {transformWithOxc} from 'vite-plus';
import {test} from 'vite-plus/test';
import {ICON_IDS} from '../src/app/icon-ids';
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
	pendingUrl?: string;
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
	state?: string;
	incognito?: boolean;
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
	/**
	Fire tabs.onRemoved when the worker removes a tab (off by default so other tests stay quiet).
	*/
	tabEvents?: boolean;
	/**
	Other chrome.* storage keys present at start (snapshots, backups, trash ...).
	*/
	storage?: Record<string, unknown>;
	/**
	Timers do not run on their own: tests run them with `runTimers()` (used for the snapshot debounce).
	*/
	manualTimers?: boolean;
	/**
	Extra normal windows (ids) that exist at start; their tabs come from `initialTabs`.
	*/
	extraWindows?: number[];
	/**
	Mark window ids as incognito.
	*/
	incognitoWindows?: number[];
	tabGroups?: Array<{
		id: number;
		title: string;
		color: string;
		collapsed: boolean;
	}>;
	/**
	Provide chrome.downloads and grant the optional "downloads" permission.
	*/
	downloads?: boolean;
	/**
	New tabs start with only a pendingUrl, as before their first navigation commits.
	*/
	pendingNavigation?: boolean;
	/**
	Chrome.alarms is missing in this browser build.
	*/
	noAlarms?: boolean;
	/**
	Freeze the worker's clock at this time and set navigator.language (default 'en-US').
	*/
	now?: number;
	locale?: string;
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
// Tests call listeners with whatever arguments the real event would carry.

type EventListener = (...args: any[]) => unknown;

// The stored `tablodge.state` as tests seed it (partial) and read it back after
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
	const sidePanelOpened: Array<{windowId: number}> = [];
	const popupCalls: string[] = [];
	const createdWindows: Array<Omit<MockWindow, 'tabs'> & {tabs: undefined}> =
		[];
	const discardedTabs: number[] = [];
	const menuItems: MenuItem[] = [];
	let storageFailure: Error | null = null;
	const extraStorage: Record<string, unknown> = structuredClone(
		options.storage ?? {},
	);
	const alarms = new Map<
		string,
		{name: string; periodInMinutes?: number; delayInMinutes?: number}
	>();
	const alarmCalls: string[] = [];
	const downloads: Array<{url: string; filename: string}> = [];
	const windowUpdates: Array<{id: number; properties: unknown}> = [];
	const timers = new Map<number, {callback: () => void; delay: number}>();
	let nextTimerId = 1;
	let nextTabId = 200;
	let nextWindowId = 20;
	let nextGroupId = 500;
	let nextSplitId = 900;
	let lastFocusedWindowId = 10;
	const tabs = structuredClone(initialTabs);
	const windows: MockWindow[] = [
		{id: 10, type: 'normal', focused: true, title: 'Test window', tabs},
		...(options.extraWindows ?? []).map((id) => ({
			id,
			type: 'normal',
			focused: false,
			title: `Window ${id}`,
			tabs: [] as MockTab[],
			incognito: (options.incognitoWindows ?? []).includes(id),
		})),
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

	const sessionStore: Record<string, unknown> = {};
	// Every storage.local.get / set / remove, so tests can assert what a code path reads and writes.
	const storageGets: string[][] = [];
	const storageSets: string[][] = [];
	const changeListeners: Array<
		(changes: Record<string, unknown>, area: string) => void
	> = [];
	const notifyChanged = (changes: Record<string, unknown>) => {
		for (const listener of changeListeners) {
			listener(changes, 'local');
		}
	};

	const eventCallbacks = new Map<
		string,
		Set<(...args: unknown[]) => unknown>
	>();
	const event = (name: string) => ({
		// Several worker modules can listen to one event: all of them run, the last result is returned.
		addListener(callback: EventListener) {
			let callbacks = eventCallbacks.get(name);
			if (!callbacks) {
				const set = new Set<(...args: unknown[]) => unknown>();
				eventCallbacks.set(name, set);
				callbacks = set;
				listeners[name] = (...args: unknown[]) => {
					let result: unknown;
					for (const run of set) {
						result = run(...args);
					}

					return result;
				};
			}

			callbacks.add(callback as (...args: unknown[]) => unknown);
		},
		removeListener(callback: EventListener) {
			eventCallbacks
				.get(name)
				?.delete(callback as (...args: unknown[]) => unknown);
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
					storageGets.push([...keys]);
					const out: Record<string, unknown> = {};
					for (const key of keys) {
						if (key === storageKey && state) {
							out[key] = structuredClone(state);
						} else if (Object.hasOwn(extraStorage, key)) {
							out[key] = structuredClone(extraStorage[key]);
						}
					}

					return out;
				},
				async set(values: Record<string, unknown>) {
					if (storageFailure) {
						throw storageFailure;
					}

					storageSets.push(Object.keys(values));
					const changes: Record<string, unknown> = {};
					for (const [key, value] of Object.entries(values)) {
						if (key === storageKey) {
							const oldValue = structuredClone(state);
							Object.assign(state, structuredClone(value));
							changes[key] = {oldValue, newValue: structuredClone(state)};
						} else {
							const oldValue = structuredClone(extraStorage[key]);
							extraStorage[key] = structuredClone(value);
							changes[key] = {oldValue, newValue: structuredClone(value)};
						}
					}

					notifyChanged(changes);
				},
				async remove(keys: string | string[]) {
					const changes: Record<string, unknown> = {};
					for (const key of [keys].flat()) {
						changes[key] = {oldValue: structuredClone(extraStorage[key])};
						Reflect.deleteProperty(extraStorage, key);
					}

					notifyChanged(changes);
				},
				async getBytesInUse(keys: string[]) {
					let total = 0;
					for (const key of keys) {
						const value = key === storageKey ? state : extraStorage[key];
						total += value === undefined ? 0 : JSON.stringify(value).length;
					}

					return total;
				},
			},
			onChanged: {
				addListener(
					callback: (changes: Record<string, unknown>, area: string) => void,
				) {
					changeListeners.push(callback);
				},
			},
			session: {
				async get(key: string) {
					return Object.hasOwn(sessionStore, key)
						? {[key]: sessionStore[key]}
						: {};
				},
				async set(values: Record<string, unknown>) {
					Object.assign(sessionStore, structuredClone(values));
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
					focused: win.focused,
					state: win.state ?? 'normal',
					incognito: Boolean(win.incognito),
					...(query.populate && {
						tabs: tabsForWindow(win.id).map((tab) => ({...tab})),
					}),
				}));
			},
			async update(id: number, properties: unknown = {}) {
				windowUpdates.push({id, properties});
				if ((properties as {focused?: boolean}).focused !== false) {
					lastFocusedWindowId = id;
				}

				return {};
			},
			async remove(id: number) {
				const at = windows.findIndex((win) => win.id === id);
				if (at !== -1) {
					windows.splice(at, 1);
				}

				for (let index = tabs.length - 1; index >= 0; index -= 1) {
					if (tabs[index].windowId === id) {
						tabs.splice(index, 1);
					}
				}
			},
			onCreated: event('windowCreated'),
			onFocusChanged: event('windowFocusChanged'),
			onRemoved: event('windowRemoved'),
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

				if (options.pendingNavigation && created.url) {
					created.pendingUrl = created.url;
					created.url = '';
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
					if (options.tabEvents) {
						(listeners.tabRemoved as unknown as (...args: unknown[]) => void)?.(
							id,
							{windowId: removed.windowId, isWindowClosing: false},
						);
					}
				}
			},
			onRemoved: event('tabRemoved'),
			onMoved: event('tabMoved'),
			onActivated: event('tabActivated'),
			onCreated: event('tabCreated'),
			onUpdated: event('tabUpdated'),
			onAttached: event('tabAttached'),
			onDetached: event('tabDetached'),
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
				return structuredClone(options.tabGroups ?? []);
			},
			onCreated: event('tabGroupCreated'),
			onUpdated: event('tabGroupUpdated'),
			onRemoved: event('tabGroupRemoved'),
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
		action: {
			async setPopup(value: {popup: string}) {
				popupCalls.push(value.popup);
			},
			onClicked: event('actionClicked'),
		},
		sidePanel: {
			async open(value: {windowId: number}) {
				sidePanelOpened.push(value);
			},
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
		...(!options.noAlarms && {
			alarms: {
				async create(
					name: string,
					info: {periodInMinutes?: number; delayInMinutes?: number},
				) {
					alarmCalls.push(`create:${name}:${info.periodInMinutes}`);
					alarms.set(name, {name, ...info});
				},
				async get(name: string) {
					return alarms.get(name);
				},
				async clear(name: string) {
					alarmCalls.push(`clear:${name}`);
					return alarms.delete(name);
				},
				onAlarm: event('alarm'),
			},
		}),
		permissions: {
			async contains() {
				return Boolean(options.downloads);
			},
		},
		...(options.downloads && {
			downloads: {
				async download(info: {url: string; filename: string}) {
					downloads.push({url: info.url, filename: info.filename});
					return downloads.length;
				},
			},
		}),
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

	const manualSetTimeout = (callback: () => void, delay = 0) => {
		const id = nextTimerId++;
		timers.set(id, {callback, delay});
		return id;
	};

	const frozenNow = options.now;
	const FrozenDate =
		frozenNow === undefined
			? Date
			: class extends Date {
					static now() {
						return frozenNow;
					}

					constructor(...args: [] | [number | string | Date]) {
						if (args.length === 0) {
							super(frozenNow!);
						} else {
							super(...(args as [number]));
						}
					}
				};
	const context = vm.createContext({
		chrome,
		Date: FrozenDate,
		navigator: {language: options.locale ?? 'en-US'},
		URL,
		console,
		crypto: webcrypto,
		structuredClone,
		TextEncoder,
		// eslint-disable-next-line no-restricted-globals -- the worker uses btoa, so the mock context provides it
		btoa,
		globalThis: null,
		setTimeout: options.manualTimers ? manualSetTimeout : setTimeout,
		clearTimeout: options.manualTimers
			? (id: number) => {
					timers.delete(id);
				}
			: clearTimeout,
	});
	context.globalThis = context;
	vm.runInContext(workerSource, context, {filename: workerPath});

	return {
		openedTabs,
		removedTabIds,
		sidePanelCalls,
		sidePanelOpened,
		popupCalls,
		createdWindows,
		discardedTabs,
		menuItems,
		listeners,
		tabs,
		windows,
		extraStorage,
		alarms,
		alarmCalls,
		downloads,
		windowUpdates,
		timers,
		/**
		Runs every pending manual timer (and any they schedule), then lets the queued async work settle.
		*/
		async runTimers() {
			for (let round = 0; round < 10 && timers.size > 0; round += 1) {
				const due = [...timers];
				timers.clear();
				for (const [, timer] of due) {
					timer.callback();
				}
			}

			await settle();
		},
		/**
		Fires an event listener the worker registered, then lets its async work settle.
		*/
		async fire(name: string, ...args: unknown[]) {
			listeners[name]?.(...args);
			await settle();
		},
		/**
		Closes a window the way the browser does: its tabs go, then windows.onRemoved fires.
		*/
		async closeWindow(id: number) {
			const at = windows.findIndex((win) => win.id === id);
			if (at !== -1) {
				windows.splice(at, 1);
			}

			for (let index = tabs.length - 1; index >= 0; index -= 1) {
				if (tabs[index].windowId === id) {
					tabs.splice(index, 1);
				}
			}

			listeners.windowRemoved?.(id);
			await settle();
		},
		apiLog,
		tabsForWindow,
		setStorageFailure(error: Error) {
			storageFailure = error;
		},
		state,
		storageGets,
		storageSets,
		/**
		Another extension context (a page) writing the state: the worker only learns of it through storage.onChanged.
		*/
		externalSetState(next: Partial<StoredState>) {
			const oldValue = structuredClone(state);
			Object.assign(state, structuredClone(next));
			notifyChanged({
				[storageKey]: {oldValue, newValue: structuredClone(state)},
			});
		},
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

/**
Lets queued promise work and storage mocks finish.
*/
async function settle() {
	for (let index = 0; index < 40; index += 1) {
		await new Promise<void>((resolve) => {
			setImmediate(resolve);
		});
	}
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
	const state = stateWithSession({
		unloadRestoredTabs: true,
		unloadRestoredTabsThreshold: 1,
	});
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

test('single-tab toolbar mode appends into the first session', async () => {
	const state = stateWithSession({closeOnSave: false});
	state.groups[1] = {...structuredClone(state.groups[0]), id: 'second-session'};
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({
		type: 'SAVE_CURRENT_TAB_TO_GROUP',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.groupId, 'session-1');
	assert.equal(harness.state.groups[0].tabs.length, 2);
	assert.equal(harness.state.groups[1].tabs.length, 1);
	assert.equal(harness.state.groups[0].tabs[1].url, 'https://current.example/');
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
		JSON.stringify(['example.test']),
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
	delete state.settings.newTabEnabled;
	delete state.settings.includePinnedTabs;
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(response.settings.newTabEnabled, true);
	assert.equal(response.settings.includePinnedTabs, false);
	assert.equal(response.bookmarkColumns.length, 1);
});

test('new tab hand-off only happens for browser-opened new tabs while TabLodge new tab is off', async () => {
	const off = createWorkerHarness(stateWithSession({newTabEnabled: false}), [
		{id: 7, windowId: 10, index: 0, active: true, url: ''},
	]);
	const tab = off.tabs.find((entry) => entry.id === 7)!;
	// Not claimed yet (an intentionally opened dashboard): nothing to hand off.
	assert.equal(
		(await off.sendMessage({type: 'HANDOFF_NEW_TAB'}, {tab})).handedOff,
		false,
	);
	await off.listeners.tabCreated({id: 7, pendingUrl: 'chrome://newtab/'});
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 20);
	});
	assert.equal(tab.url, 'chrome://new-tab-page/');
	// The browser sent the tab back: try once more, then fall back to a blank page, then stop.
	assert.equal(
		(await off.sendMessage({type: 'HANDOFF_NEW_TAB'}, {tab})).handedOff,
		true,
	);
	assert.equal(tab.url, 'chrome://new-tab-page/');
	assert.equal(
		(await off.sendMessage({type: 'HANDOFF_NEW_TAB'}, {tab})).handedOff,
		true,
	);
	assert.equal(tab.url, 'about:blank');
	assert.equal(
		(await off.sendMessage({type: 'HANDOFF_NEW_TAB'}, {tab})).handedOff,
		false,
	);

	const on = createWorkerHarness(stateWithSession(), [
		{id: 8, windowId: 10, index: 0, active: true, url: ''},
	]);
	await on.listeners.tabCreated({id: 8, pendingUrl: 'chrome://newtab/'});
	assert.equal(on.tabs[0].url, '');
});

test('new tab fallback settings normalize and choose the target', async () => {
	const read = async (settings: Record<string, unknown>) =>
		(
			await createWorkerHarness(stateWithSession(settings)).sendMessage({
				type: 'GET_STATE',
			})
		).settings;
	assert.equal((await read({})).newTabFallback, 'browser');
	assert.equal(
		(await read({newTabFallback: 'nope'})).newTabFallback,
		'browser',
	);
	assert.equal((await read({newTabFallback: 'blank'})).newTabFallback, 'blank');
	assert.equal(
		(await read({newTabFallbackUrl: 'javascript:alert(1)'})).newTabFallbackUrl,
		'',
	);
	assert.equal(
		(await read({newTabFallbackUrl: ' https://example.com/x '}))
			.newTabFallbackUrl,
		'https://example.com/x',
	);

	for (const [settings, url] of [
		[{newTabFallback: 'blank'}, 'about:blank'],
		[
			{newTabFallback: 'custom', newTabFallbackUrl: 'https://example.com/'},
			'https://example.com/',
		],
		[{newTabFallback: 'custom'}, 'chrome://new-tab-page/'],
	] as const) {
		const harness = createWorkerHarness(
			stateWithSession({newTabEnabled: false, ...settings}),
			[{id: 7, windowId: 10, index: 0, active: true, url: ''}],
		);
		await harness.listeners.tabCreated({id: 7, pendingUrl: 'chrome://newtab/'});
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 20);
		});
		assert.equal(harness.tabs[0].url, url);
	}
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

test('saving with includePinnedTabs off never stores or removes pinned tabs', async () => {
	const harness = createWorkerHarness(
		stateWithSession({
			includePinnedTabs: false,
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

test('toolbarOpens switches the toolbar icon between popup and side panel', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const result = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {toolbarOpens: 'sidepanel'},
	});
	assert.equal(result.ok, true);
	assert.equal(harness.state.settings.toolbarOpens, 'sidepanel');
	assert.equal(
		harness.sidePanelCalls.some(
			(call) =>
				call.method === 'setOptions' &&
				call.value.enabled &&
				call.value.path === 'sidepanel.html',
		),
		true,
	);
	const last = (method: string) =>
		harness.sidePanelCalls.findLast((call) => call.method === method);
	assert.equal(last('setPanelBehavior')?.value.openPanelOnActionClick, true);
	assert.equal(harness.popupCalls.at(-1), '');

	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {toolbarOpens: 'popup'},
	});
	assert.equal(last('setPanelBehavior')?.value.openPanelOnActionClick, false);
	assert.equal(harness.popupCalls.at(-1), 'popup.html');
});

test('toolbarOpens normalizes bad values and migrates the old boolean', async () => {
	const bad = createWorkerHarness({
		...stateWithSession(),
		settings: {toolbarOpens: 'dock'},
	} as never);
	assert.equal(
		(await bad.sendMessage({type: 'GET_STATE'})).settings.toolbarOpens,
		'popup',
	);
	const legacy = createWorkerHarness({
		...stateWithSession(),
		settings: {sidePanelEnabled: true},
	});
	assert.equal(
		(await legacy.sendMessage({type: 'GET_STATE'})).settings.toolbarOpens,
		'sidepanel',
	);
});

test('the toggle-side-panel command opens the side panel for the window', async () => {
	const harness = createWorkerHarness(stateWithSession());
	(harness.listeners.onCommand as (c: string, t: unknown) => void)(
		'toggle-side-panel',
		{id: 1, windowId: 7},
	);
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
	assert.deepEqual(structuredClone(harness.sidePanelOpened), [{windowId: 7}]);
});

test('column delete preserves bookmarks, including when the built-in or last column is removed', async () => {
	const state = stateWithSession();
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

	const toUnfiled = await harness.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'bookmark-default',
		targetColumnId: 'bookmark-unfiled',
	});
	assert.equal(toUnfiled.ok, true, toUnfiled.error);
	assert.equal(toUnfiled.unfiled, 1);
	assert.equal(
		harness.state.bookmarks.find((bookmark) => bookmark.id === 'default-link')!
			.columnId,
		'bookmark-unfiled',
	);
	assert.equal(
		(await harness.sendMessage({type: 'RESTORE_TRASH', id: toUnfiled.trashId!}))
			.ok,
		true,
	);
	assert.equal(
		harness.state.bookmarks.find((bookmark) => bookmark.id === 'default-link')!
			.columnId,
		'bookmark-default',
	);

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
	const {applyLinkDrag, parseSessionDragData, SESSION_DRAG_TYPE} =
		await import('../src/app/interaction-actions');
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

test('groupTitleAction defaults to toggle and keeps stored edit or restore', async () => {
	const read = async (value?: unknown) =>
		(
			await createWorkerHarness({
				...stateWithSession(),
				settings: value === undefined ? {} : {groupTitleAction: value as never},
			}).sendMessage({type: 'GET_STATE'})
		).settings.groupTitleAction;
	assert.equal(await read(), 'toggle');
	assert.equal(await read('bogus'), 'toggle');
	assert.equal(await read('edit'), 'edit');
	assert.equal(await read('restore'), 'restore');
});

test('session title activation respects the configured toggle, edit or restore action', async () => {
	const {activateSessionTitle} = await import('../src/app/interaction-actions');
	const calls: string[] = [];
	const handlers = {
		edit() {
			calls.push('edit');
		},
		restore() {
			calls.push('restore');
		},
		toggle() {
			calls.push('toggle');
		},
	};
	activateSessionTitle('restore', handlers);
	activateSessionTitle('edit', handlers);
	activateSessionTitle('unexpected', handlers);
	activateSessionTitle('toggle', handlers);
	assert.deepEqual(calls, ['restore', 'edit', 'toggle', 'toggle']);
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
	assert.deepEqual(harness.state.settings.excludedOrigins, ['private.example']);
	assert.equal(harness.state.settings.copyFormat, 'url');
});

const UNDO_KEY = 'tablodge.undo';
const undoRecordsOf = (harness: {extraStorage: Record<string, unknown>}) =>
	(
		harness.extraStorage[UNDO_KEY] as
			{records: Array<{id: string; createdAt: number}>} | undefined
	)?.records ?? [];

test('UNDO brings back erased data and drops the record', async () => {
	const harness = createWorkerHarness(stateWithEverything());
	const erased = await harness.sendMessage({type: 'ERASE_DATA', scope: 'all'});
	assert.equal(erased.ok, true, erased.error);
	assert.ok(erased.undoId);
	assert.deepEqual(harness.state.groups, []);
	const undone = await harness.sendMessage({type: 'UNDO', id: erased.undoId});
	assert.equal(undone.ok, true, undone.error);
	assert.equal(harness.state.groups.length, 2);
	assert.equal(harness.state.bookmarks.length, 3);
	assert.equal(undoRecordsOf(harness).length, 0);
	const again = await harness.sendMessage({type: 'UNDO', id: erased.undoId});
	assert.equal(again.ok, false);
});

test('UNDO is refused once something else changed the same data', async () => {
	const harness = createWorkerHarness(stateWithEverything());
	const erased = await harness.sendMessage({
		type: 'ERASE_DATA',
		scope: 'sessions',
	});
	await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'New', url: 'https://new.example/'},
	});
	const undone = await harness.sendMessage({type: 'UNDO', id: erased.undoId!});
	assert.equal(undone.ok, false);
	assert.match(undone.error!, /changed since/);
	assert.deepEqual(harness.state.groups, []);
});

test('UNDO restores a trash that was emptied or cleared item by item', async () => {
	const harness = recoveryHarness();
	await harness.sendMessage({type: 'DELETE_GROUP', groupId: 'session-1'});
	await harness.sendMessage({type: 'BACKUP_NOW'});
	assert.equal(trashOf(harness).length, 1);
	const emptied = await harness.sendMessage({type: 'EMPTY_TRASH'});
	assert.ok(emptied.undoId);
	assert.equal(trashOf(harness).length, 0);
	assert.equal(
		(await harness.sendMessage({type: 'UNDO', id: emptied.undoId})).ok,
		true,
	);
	assert.equal(trashOf(harness).length, 1);
	const entry = trashOf(harness)[0];
	const removed = await harness.sendMessage({
		type: 'DELETE_TRASH',
		id: entry.id,
	});
	assert.ok(removed.undoId);
	assert.equal(trashOf(harness).length, 0);
	await harness.sendMessage({type: 'UNDO', id: removed.undoId});
	assert.equal(trashOf(harness).length, 1);
});

test('UNDO brings back cleared snapshots and refuses after a new capture', async () => {
	const harness = recoveryHarness();
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	const before = historyOf(harness).length;
	assert.equal(before > 0, true);
	const cleared = await harness.sendMessage({type: 'CLEAR_SNAPSHOTS'});
	assert.ok(cleared.undoId);
	assert.equal(historyOf(harness).length, 0);
	assert.equal(
		(await harness.sendMessage({type: 'UNDO', id: cleared.undoId})).ok,
		true,
	);
	assert.equal(historyOf(harness).length, before);

	const deleted = await harness.sendMessage({
		type: 'DELETE_SNAPSHOT',
		id: historyOf(harness)[0].id,
	});
	assert.ok(deleted.undoId);
	harness.tabs.push(webTab(60, 10, 9));
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	const refused = await harness.sendMessage({
		type: 'UNDO',
		id: deleted.undoId,
	});
	assert.equal(refused.ok, false);
});

test('UNDO restores a backup restore and reset settings, and resyncs settings', async () => {
	const harness = createWorkerHarness({
		...bookmarksState(),
		settings: {copyFormat: 'url'},
	});
	const backup = await harness.sendMessage({type: 'BACKUP_NOW'});
	await harness.sendMessage({type: 'DELETE_BOOKMARK', bookmarkId: 'bm-0'});
	const restored = await harness.sendMessage({
		type: 'RESTORE_BACKUP',
		id: backupsOf(harness).auto[0].id,
	});
	assert.equal(restored.ok, true, restored.error);
	assert.equal(harness.state.bookmarks.length, 3);
	assert.equal(backup.ok, true);
	await harness.sendMessage({type: 'UNDO', id: restored.undoId!});
	assert.equal(harness.state.bookmarks.length, 2);

	const reset = await harness.sendMessage({type: 'RESET_SETTINGS'});
	assert.ok(reset.undoId);
	assert.notEqual(harness.state.settings.copyFormat, 'url');
	await harness.sendMessage({type: 'UNDO', id: reset.undoId});
	assert.equal(harness.state.settings.copyFormat, 'url');
});

test('ADD_BOOKMARKS offers undo only when asked, and undo removes just those bookmarks', async () => {
	const harness = createWorkerHarness(bookmarksState());
	const plain = await harness.sendMessage({
		type: 'ADD_BOOKMARKS',
		bookmarks: [{url: 'https://plain.example/'}],
	});
	assert.equal(plain.undoId, undefined);
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARKS',
		bookmarks: [{url: 'https://a.example/'}, {url: 'https://b.example/'}],
		undoable: true,
	});
	assert.equal(added.bookmarks.length, 2);
	assert.equal(harness.state.bookmarks.length, 6);
	const undone = await harness.sendMessage({type: 'UNDO', id: added.undoId!});
	assert.equal(undone.ok, true, undone.error);
	assert.equal(harness.state.bookmarks.length, 4);
});

test('undo records expire, are purged by the alarm, and only the latest few are kept', async () => {
	const harness = createWorkerHarness(stateWithEverything(), undefined, {
		storage: {
			[UNDO_KEY]: {
				version: 1,
				records: [
					{
						id: 'old',
						label: 'Old',
						createdAt: Date.now() - 10 * 60_000,
						keys: ['tablodge.trash'],
						before: {},
						after: {'tablodge.trash': 'none'},
					},
				],
			},
		},
	});
	const stale = await harness.sendMessage({type: 'UNDO', id: 'old'});
	assert.equal(stale.ok, false);
	assert.match(stale.error!, /too long ago/);
	await harness.fire('alarm', {name: 'tablodge-undo'});
	assert.equal(undoRecordsOf(harness).length, 0);

	for (let round = 0; round < 5; round += 1) {
		await harness.sendMessage({type: 'ERASE_DATA', scope: 'sessions'});
		await harness.sendMessage({type: 'RESTORE_BACKUP', id: 'none'});
		await harness.sendMessage({type: 'EMPTY_TRASH'});
	}

	assert.equal(undoRecordsOf(harness).length <= 3, true);
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
	assert.deepEqual(harness.state.settings.excludedOrigins, ['private.example']);
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
	assert.deepEqual(harness.state.settings.excludedOrigins, ['private.example']);
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

test('restored tabs are unloaded only when the restore opened more than the threshold', async () => {
	const restore = async (threshold: number) => {
		const state = stateWithSession({
			unloadRestoredTabs: true,
			unloadRestoredTabsThreshold: threshold,
		});
		state.groups[0].tabs.push(
			{id: 'extra-1', title: 'B', url: 'https://b.example/'},
			{id: 'extra-2', title: 'C', url: 'https://c.example/'},
		);
		const harness = createWorkerHarness(state);
		const response = await harness.sendMessage({
			type: 'RESTORE_GROUP',
			groupId: 'session-1',
		});
		assert.equal(response.ok, true, response.error);
		assert.equal(harness.openedTabs.length, 3);
		return harness.discardedTabs.length;
	};

	assert.equal(await restore(4), 0, 'below the threshold');
	assert.equal(await restore(3), 0, 'equal to the threshold');
	assert.equal(
		await restore(2),
		2,
		'above the threshold; the active tab stays',
	);
});

test('the unload threshold is clamped to a whole number from 1 to 500', async () => {
	const read = async (value: unknown) =>
		(
			await createWorkerHarness(
				stateWithSession({unloadRestoredTabsThreshold: value}),
			).sendMessage({type: 'GET_STATE'})
		).settings.unloadRestoredTabsThreshold;
	assert.equal(await read(undefined), 5);
	assert.equal(await read('abc'), 5);
	assert.equal(await read(0), 1);
	assert.equal(await read(9999), 500);
	assert.equal(await read(7.9), 7);
	assert.equal(await read('12'), 12);
});

test('unloading restored tabs leaves split tabs loaded', async () => {
	const harness = createWorkerHarness(
		stateWithSplitSession({
			unloadRestoredTabs: true,
			unloadRestoredTabsThreshold: 1,
		}),
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
		stateWithSplitSession({
			unloadRestoredTabs: true,
			unloadRestoredTabsThreshold: 1,
		}),
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
			['pinned-b', null],
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

test('expandSessionsByDefault is off by default, only an explicit true turns it on, and resets to off', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	assert.equal(
		(await defaults.sendMessage({type: 'GET_STATE'})).settings
			.expandSessionsByDefault,
		false,
	);

	const truthy = createWorkerHarness(
		stateWithSession({expandSessionsByDefault: true}),
	);
	assert.equal(
		(await truthy.sendMessage({type: 'GET_STATE'})).settings
			.expandSessionsByDefault,
		true,
		'an explicit true is kept',
	);

	const updated = await truthy.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {expandSessionsByDefault: false},
	});
	assert.equal(updated.ok, true, updated.error);
	assert.equal(truthy.state.settings.expandSessionsByDefault, false);
	const reset = await truthy.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.expandSessionsByDefault, false);
});

test('link, quick-action, ordering and pin settings normalize with defaults', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	const s = (await defaults.sendMessage({type: 'GET_STATE'})).settings;
	assert.equal(s.bookmarkClickAction, 'current');
	assert.equal(s.sessionLinkClickAction, 'new');
	assert.equal(s.showBookmarkQuickActions, false);
	assert.equal(s.bookmarkQuickAction, 'open-new');
	assert.equal(s.sessionsOnTop, false);
	assert.equal(s.keepLodgePinned, false);
	assert.equal(s.autoFocusSearchOnNewTab, false);
	assert.equal(s.urlDisplayMode, 'full');
	assert.equal(s.simplifyUrls, true);
	assert.equal(s.markInsecureLinks, true);
	assert.equal(s.markLocalLinks, false);

	const junk = createWorkerHarness(
		stateWithSession({
			bookmarkClickAction: 'bogus',
			sessionLinkClickAction: 'none',
			showBookmarkQuickActions: 'yes',
			bookmarkQuickAction: 'explode',
			sessionsOnTop: 1,
			keepLodgePinned: true,
			autoFocusSearchOnNewTab: true,
			urlDisplayMode: 'domain',
			simplifyUrls: false,
			markInsecureLinks: false,
			markLocalLinks: 'yes',
		}),
	);
	const j = (await junk.sendMessage({type: 'GET_STATE'})).settings;
	assert.equal(j.bookmarkClickAction, 'current');
	assert.equal(j.sessionLinkClickAction, 'none');
	assert.equal(j.showBookmarkQuickActions, false);
	assert.equal(j.bookmarkQuickAction, 'open-new');
	assert.equal(j.sessionsOnTop, false);
	assert.equal(j.keepLodgePinned, true);
	assert.equal(j.autoFocusSearchOnNewTab, true);
	assert.equal(j.urlDisplayMode, 'domain');
	assert.equal(j.simplifyUrls, false);
	assert.equal(j.markInsecureLinks, false);
	assert.equal(j.markLocalLinks, false, 'only a real true enables it');
	const reset = await junk.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.keepLodgePinned, false);
	assert.equal(reset.settings.autoFocusSearchOnNewTab, false);
	assert.equal(reset.settings.urlDisplayMode, 'full');
	assert.equal(reset.settings.simplifyUrls, true);
	assert.equal(reset.settings.markInsecureLinks, true);
	assert.equal(reset.settings.markLocalLinks, false);
});

test('url-only display mode and the bookmark menu click action are accepted', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const result = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {urlDisplayMode: 'url-only', bookmarkClickAction: 'menu'},
	});
	assert.equal(result.settings.urlDisplayMode, 'url-only');
	assert.equal(result.settings.bookmarkClickAction, 'menu');
	const bad = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {
			sessionLinkClickAction: 'menu',
		} as unknown as Partial<Settings>,
	});
	assert.equal(
		bad.settings.sessionLinkClickAction,
		'new',
		'sessions have no menu click action',
	);
});

test('pasteLinkToBookmark is on by default and only an explicit false turns it off', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	assert.equal(
		(await defaults.sendMessage({type: 'GET_STATE'})).settings
			.pasteLinkToBookmark,
		true,
	);
	const off = createWorkerHarness(
		stateWithSession({pasteLinkToBookmark: false}),
	);
	assert.equal(
		(await off.sendMessage({type: 'GET_STATE'})).settings.pasteLinkToBookmark,
		false,
	);
	const reset = await off.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.pasteLinkToBookmark, true);
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

test('keepLodgePinned creates one pinned TabLodge tab per window, re-pins, and never duplicates', async () => {
	const harness = createWorkerHarness(
		stateWithSession({
			keepLodgePinned: true,
			restoreTarget: 'always-new-window',
		}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://current.example/',
				title: 'Current',
			},
		],
		{tabEvents: true},
	);
	await harness.listeners.onStartup();
	await settleLodge();
	assert.equal(pinnedLodges(harness, 10).length, 1);
	assert.equal(pinnedLodges(harness, 10)[0].active, false);

	// A second check finds it and adds nothing.
	harness.listeners.windowFocusChanged(10);
	await settleLodge();
	assert.equal(pinnedLodges(harness, 10).length, 1);

	// A restore into a new window gets its own pinned tab; the restored session never contains one.
	const restored = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(restored.ok, true, restored.error);
	harness.listeners.windowCreated({id: 20, type: 'normal'});
	await settleLodge();
	assert.equal(pinnedLodges(harness, 20).length, 1);
	assert.equal(pinnedLodges(harness, 10).length, 1);
	assert.equal(
		harness.state.groups
			.flatMap((g) => g.tabs)
			.some((t) => t.url?.startsWith('chrome-extension:')),
		false,
	);
});

test('keepLodgePinned re-pins an unpinned TabLodge tab and removes extra pinned copies', async () => {
	const harness = createWorkerHarness(
		stateWithSession({keepLodgePinned: true}),
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
				url: lodgeUrl,
				pinned: false,
			},
		],
		{tabEvents: true},
	);
	await harness.listeners.onStartup();
	await settleLodge();
	assert.equal(harness.tabs.find((tab) => tab.id === 2)!.pinned, true);
	assert.equal(
		harness.openedTabs.length,
		0,
		'the existing tab is re-pinned, not replaced',
	);

	harness.tabs.push({
		id: 3,
		windowId: 10,
		index: 2,
		active: false,
		url: lodgeUrl,
		pinned: true,
	});
	harness.listeners.tabAttached(3, {newWindowId: 10});
	await settleLodge();
	assert.equal(pinnedLodges(harness, 10).length, 1);
});

test('keepLodgePinned recreates a closed tab once, then waits for window focus when the user closes it again quickly', async () => {
	const harness = createWorkerHarness(
		stateWithSession({keepLodgePinned: true}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://current.example/',
				title: 'Current',
			},
		],
		{tabEvents: true},
	);
	await harness.listeners.onStartup();
	await settleLodge();
	const close = async () => {
		const lodge = pinnedLodges(harness, 10)[0];
		const index = harness.tabs.indexOf(lodge);
		harness.tabs.splice(index, 1);
		harness.listeners.tabRemoved(lodge.id, {
			windowId: 10,
			isWindowClosing: false,
		});
		await settleLodge();
	};

	await close();
	assert.equal(
		pinnedLodges(harness, 10).length,
		1,
		'recreated after the first close',
	);
	await close();
	assert.equal(
		pinnedLodges(harness, 10).length,
		0,
		'a quick second close is respected',
	);
	harness.listeners.windowFocusChanged(10);
	await settleLodge();
	assert.equal(
		pinnedLodges(harness, 10).length,
		1,
		'focusing the window restores it',
	);
});

test('keepLodgePinned off leaves windows alone, and enabling it adds the pinned tab', async () => {
	const harness = createWorkerHarness(
		stateWithSession({keepLodgePinned: false}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://current.example/',
				title: 'Current',
			},
		],
		{tabEvents: true},
	);
	await harness.listeners.onStartup();
	harness.listeners.windowCreated({id: 10, type: 'normal'});
	await settleLodge();
	assert.equal(harness.openedTabs.length, 0);

	const enabled = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {keepLodgePinned: true},
	});
	assert.equal(enabled.ok, true, enabled.error);
	await settleLodge();
	assert.equal(pinnedLodges(harness, 10).length, 1);
});

test('saving all windows, or tabs around the TabLodge tab, never saves or closes the pinned TabLodge tab', async () => {
	const tabs: MockTab[] = [
		{id: 1, windowId: 10, index: 0, active: false, url: lodgeUrl, pinned: true},
		{
			id: 2,
			windowId: 10,
			index: 1,
			active: true,
			url: 'https://one.example/',
			title: 'One',
		},
		{
			id: 3,
			windowId: 10,
			index: 2,
			active: false,
			url: 'https://two.example/',
			title: 'Two',
		},
	];
	for (const scope of [
		'all-windows',
		'window',
		'left-of-tab',
		'right-of-tab',
		'except-this-tab',
	] as const) {
		const harness = createWorkerHarness(
			stateWithSession({
				keepLodgePinned: true,
				closeOnSave: true,
				includePinnedTabs: true,
			}),
			tabs,
		);
		const response = await harness.sendMessage(
			{type: 'SAVE_TABS', scope},
			{tab: {id: scope === 'left-of-tab' ? 3 : 2, windowId: 10}},
		);
		assert.equal(response.ok, true, `${scope}: ${response.error}`);
		const saved = harness.state.groups.find((g) => g.id === response.groupId)!;
		assert.equal(
			saved.tabs.some((t) => t.url === lodgeUrl),
			false,
			scope,
		);
		assert.equal(harness.removedTabIds.includes(1), false, scope);
		assert.equal(
			harness.tabs.some((t) => t.id === 1),
			true,
			scope,
		);
	}
});

test('restoring into the current window leaves the pinned TabLodge tab in place', async () => {
	const harness = createWorkerHarness(
		stateWithSession({keepLodgePinned: true, restoreTarget: 'current-window'}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: false,
				url: lodgeUrl,
				pinned: true,
			},
			{
				id: 2,
				windowId: 10,
				index: 1,
				active: true,
				url: 'https://current.example/',
				title: 'Current',
			},
		],
	);
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(harness.removedTabIds.length, 0);
	assert.equal(pinnedLodges(harness, 10).length, 1);
});

test('the worker inlines exactly the icon ids of the icon registry', () => {
	const inlined = /const ICON_IDS = new Set<unknown>\(\[([^\]]*)\]\)/.exec(
		readFileSync(workerPath, 'utf8'),
	);
	assert.ok(inlined, 'the worker declares ICON_IDS');
	const workerIds = [...inlined[1].matchAll(/'([-a-z]+)'/g)].map(
		(match) => match[1],
	);
	assert.deepEqual(workerIds, [...ICON_IDS]);
});

test('bookmark columns store a registry icon and drop unknown ones', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const created = await harness.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'Reading',
		icon: 'book-open',
	});
	assert.equal(created.ok, true, created.error);
	assert.equal(created.column.icon, 'book-open');
	const plain = await harness.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'Plain',
		icon: 'not-a-real-icon',
	});
	assert.equal(plain.ok, true, plain.error);
	assert.equal('icon' in plain.column, false);

	// Renaming without an icon keeps it; an empty string resets it; a valid id replaces it.
	const renamed = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK_COLUMN',
		columnId: created.column.id,
		name: 'Reads',
	});
	assert.equal(renamed.column.icon, 'book-open');
	const swapped = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK_COLUMN',
		columnId: created.column.id,
		name: 'Reads',
		icon: 'star',
	});
	assert.equal(swapped.column.icon, 'star');
	const reset = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK_COLUMN',
		columnId: created.column.id,
		name: 'Reads',
		icon: '',
	});
	assert.equal(reset.ok, true, reset.error);
	assert.equal('icon' in reset.column, false);
});

test('stored column icons are validated on load and kept by imports', async () => {
	const state = stateWithSession();
	state.bookmarkColumns = [
		{id: 'bookmark-default', name: 'Bookmarks', icon: 'bogus'},
		{id: 'column-a', name: 'Alpha', icon: 'rocket'},
	];
	const harness = createWorkerHarness(state);
	const loaded = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(loaded.bookmarkColumns[0].icon, undefined);
	assert.equal(loaded.bookmarkColumns[1].icon, 'rocket');
	const imported = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: {
			bookmarkColumns: [
				{id: 'x', name: 'Imported', icon: 'globe'},
				{id: 'y', name: 'Other', icon: 'nope'},
			],
			bookmarks: [{url: 'https://a.example/', columnId: 'x'}],
		},
	});
	assert.equal(imported.ok, true, imported.error);
	const columns = harness.state.bookmarkColumns;
	assert.equal(
		columns.find((column) => column.name === 'Imported')?.icon,
		'globe',
	);
	assert.equal(
		columns.find((column) => column.name === 'Other')?.icon,
		undefined,
	);
});

test('session folders store a registry icon, keep it on rename and reset it', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const created = await harness.sendMessage({
		type: 'CREATE_FOLDER',
		name: 'Research',
		icon: 'flask',
	});
	assert.equal(created.ok, true, created.error);
	assert.equal(created.folder.icon, 'flask');
	const plain = await harness.sendMessage({
		type: 'CREATE_FOLDER',
		name: 'Plain',
		icon: 'unknown-icon',
	});
	assert.equal(plain.ok, true, plain.error);
	assert.equal('icon' in plain.folder, false);

	const renamed = await harness.sendMessage({
		type: 'UPDATE_FOLDER',
		folderId: created.folder.id,
		name: 'Science',
	});
	assert.equal(renamed.folder.icon, 'flask');
	const swapped = await harness.sendMessage({
		type: 'UPDATE_FOLDER',
		folderId: created.folder.id,
		name: 'Science',
		icon: 'brain',
	});
	assert.equal(swapped.folder.icon, 'brain');
	const reset = await harness.sendMessage({
		type: 'UPDATE_FOLDER',
		folderId: created.folder.id,
		name: 'Science',
		icon: '',
	});
	assert.equal(reset.ok, true, reset.error);
	assert.equal('icon' in reset.folder, false);
});

test('folder icons survive a session import and are validated on load', async () => {
	const state = stateWithSession();
	state.folders.push({id: 'f-bad', name: 'Bad', icon: 'nope'});
	const harness = createWorkerHarness(state);
	const loaded = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(
		loaded.folders.find((folder) => folder.id === 'f-bad')?.icon,
		undefined,
	);
	const imported = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: {
			folders: [{id: 'in-1', name: 'Imported folder', icon: 'rocket'}],
			groups: [
				{
					name: 'Imported',
					folderId: 'in-1',
					tabs: [{url: 'https://imported.example/', title: 'Imported'}],
				},
			],
		},
	});
	assert.equal(imported.ok, true, imported.error);
	assert.equal(
		harness.state.folders.find((folder) => folder.name === 'Imported folder')
			?.icon,
		'rocket',
	);
});

test('a legacy per-session restoreTarget is stripped and sessions follow the Settings restore target', async () => {
	const state = stateWithSession({restoreTarget: 'always-new-window'});
	(state.groups[0] as Record<string, unknown>).restoreTarget = 'current-window';
	const harness = createWorkerHarness(state);
	const loaded = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal('restoreTarget' in loaded.groups[0], false);

	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(harness.createdWindows.length, 1);
});

test('UPDATE_GROUP and imports ignore a restoreTarget field on sessions', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const updated = await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-1',
		fields: {name: 'Renamed', restoreTarget: 'always-new-window'} as never,
	});
	assert.equal(updated.ok, true, updated.error);
	assert.equal('restoreTarget' in updated.group, false);
	const imported = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: {
			groups: [
				{
					name: 'Imported',
					restoreTarget: 'always-new-window',
					tabs: [{url: 'https://imported.example/', title: 'Imported'}],
				},
			],
		},
	});
	assert.equal(imported.ok, true, imported.error);
	for (const group of harness.state.groups) {
		assert.equal('restoreTarget' in group, false);
	}
});

test('RESTORE_GROUP honors a restoreTarget override over the Settings default', async () => {
	const twoTabs: MockTab[] = [
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
	];
	const inNewWindow = createWorkerHarness(
		stateWithSession({restoreTarget: 'current-window'}),
		twoTabs,
	);
	const opened = await inNewWindow.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
		restoreTarget: 'always-new-window',
	});
	assert.equal(opened.ok, true, opened.error);
	assert.equal(inNewWindow.createdWindows.length, 1);

	const inThisWindow = createWorkerHarness(
		stateWithSession({restoreTarget: 'always-new-window'}),
		twoTabs,
	);
	const here = await inThisWindow.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
		restoreTarget: 'current-window',
	});
	assert.equal(here.ok, true, here.error);
	assert.equal(inThisWindow.createdWindows.length, 0);
	assert.equal(inThisWindow.openedTabs[0].windowId, 10);
});

test('excluded sites are hostnames covering subdomains; old origin entries migrate', async () => {
	const harness = createWorkerHarness(
		stateWithSession({
			closeOnSave: false,
			excludedOrigins: [
				'https://google.com',
				'https://Mail.Google.com:8443',
				'https://google.com',
				'garbage',
			],
		}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://gemini.google.com/app',
				title: 'Gemini',
			},
			{
				id: 2,
				windowId: 10,
				index: 1,
				active: false,
				url: 'https://notgoogle.com/',
				title: 'Not',
			},
			{
				id: 3,
				windowId: 10,
				index: 2,
				active: false,
				url: 'https://google.com/',
				title: 'Root',
			},
			{
				id: 4,
				windowId: 10,
				index: 3,
				active: false,
				url: 'https://other.example/',
				title: 'Other',
			},
		],
	);
	const state = await harness.sendMessage({type: 'GET_STATE'});
	assert.deepEqual(
		[...state.settings.excludedOrigins],
		['google.com', 'mail.google.com'],
	);
	const saved = await harness.sendMessage({type: 'SAVE_TABS', scope: 'window'});
	assert.equal(saved.ok, true, saved.error);
	const group = harness.state.groups.find(
		(entry) => entry.id === saved.groupId,
	)!;
	assert.deepEqual(
		group.tabs.map((tab) => tab.url),
		['https://notgoogle.com/', 'https://other.example/'],
	);
});

test('ADD_EXCLUDED_ORIGINS adds many websites at once and ignores repeats', async () => {
	const harness = createWorkerHarness(
		stateWithSession({excludedOrigins: ['known.test']}),
	);
	const result = await harness.sendMessage({
		type: 'ADD_EXCLUDED_ORIGINS',
		origins: [
			'known.test',
			'https://a.example/x',
			'*.b.example',
			'a.example',
			'nonsense',
		],
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.added, 2);
	assert.deepEqual(
		[...result.settings.excludedOrigins],
		['known.test', 'a.example', 'b.example'],
	);
	const none = await harness.sendMessage({
		type: 'ADD_EXCLUDED_ORIGINS',
		origins: ['nonsense'],
	});
	assert.equal(none.ok, false);
});

// ---- Recovery: snapshots, backups, trash ----

const LIVE_KEY = 'tablodge.snapshots.live';
const HISTORY_KEY = 'tablodge.snapshots';
const META_KEY = 'tablodge.snapshots.meta';
const BACKUPS_KEY = 'tablodge.backups';
const TRASH_KEY = 'tablodge.trash';

type StoredSnapshot = {
	id: string;
	reason: string;
	sig: string;
	windows: Array<{
		focused: boolean;
		state: string;
		groups: Array<{title: string; color: string; collapsed: boolean}>;
		tabs: Array<{
			url: string;
			title: string;
			pinned?: boolean;
			active?: boolean;
			group?: number;
			split?: {id: string; position: number};
		}>;
	}>;
};
type StoredMeta = {
	sessionOpen: boolean;
	liveAt: number;
	liveSig?: string;
	closing: {at: number; remaining: number} | null;
	recovery: {snapshotId: string} | null;
};

const webTab = (
	id: number,
	windowId: number,
	index: number,
	extra: Partial<MockTab> = {},
): MockTab => ({
	id,
	windowId,
	index,
	active: false,
	url: `https://site${id}.example/`,
	title: `Site ${id}`,
	...extra,
});
const liveOf = (harness: {extraStorage: Record<string, unknown>}) =>
	harness.extraStorage[LIVE_KEY] as StoredSnapshot | undefined;
const historyOf = (harness: {extraStorage: Record<string, unknown>}) =>
	(harness.extraStorage[HISTORY_KEY] as {history: StoredSnapshot[]} | undefined)
		?.history ?? [];
const metaOf = (harness: {extraStorage: Record<string, unknown>}) =>
	harness.extraStorage[META_KEY] as StoredMeta | undefined;
const recoveryHarness = (
	settings: Record<string, unknown> = {},
	tabs: MockTab[] = [
		webTab(1, 10, 0, {active: true}),
		webTab(2, 10, 1),
		webTab(3, 20, 0, {active: true}),
	],
	options: HarnessOptions = {},
) =>
	createWorkerHarness(stateWithSession(settings), tabs, {
		extraWindows: [20],
		manualTimers: true,
		...options,
	});

test('recovery settings default on and invalid values fall back', async () => {
	const harness = createWorkerHarness({...stateWithSession(), settings: {}});
	const defaults = (await harness.sendMessage({type: 'GET_STATE'})).settings;
	assert.equal(defaults.snapshotsEnabled, true);
	assert.equal(defaults.snapshotIntervalMinutes, 15);
	assert.equal(defaults.snapshotKeep, 25);
	assert.equal(defaults.autoBackup, 'off');
	assert.equal(defaults.autoBackupKeep, 7);
	assert.equal(defaults.autoBackupToDownloads, false);
	assert.equal(defaults.trashRetentionDays, 30);
	const patched = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {
			snapshotIntervalMinutes: '30',
			snapshotKeep: 99,
			autoBackup: 'hourly',
			autoBackupKeep: 12,
			autoBackupToDownloads: 'yes',
			trashRetentionDays: 'x',
			snapshotsEnabled: false,
		} as unknown as Partial<Settings>,
	});
	assert.equal(patched.ok, true, patched.error);
	assert.equal(patched.settings.snapshotIntervalMinutes, 30);
	assert.equal(patched.settings.snapshotKeep, 25);
	assert.equal(patched.settings.autoBackup, 'off');
	assert.equal(patched.settings.autoBackupKeep, 7);
	assert.equal(patched.settings.autoBackupToDownloads, false);
	assert.equal(patched.settings.trashRetentionDays, 30);
	assert.equal(patched.settings.snapshotsEnabled, false);
	const valid = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {
			snapshotIntervalMinutes: 5,
			snapshotKeep: 50,
			autoBackup: 'weekly',
			autoBackupKeep: 30,
			trashRetentionDays: 90,
		},
	});
	assert.equal(valid.settings.snapshotIntervalMinutes, 5);
	assert.equal(valid.settings.snapshotKeep, 50);
	assert.equal(valid.settings.autoBackup, 'weekly');
	assert.equal(valid.settings.autoBackupKeep, 30);
	assert.equal(valid.settings.trashRetentionDays, 90);
});

test('snapshots capture windows with pinned tabs, groups, split pairs, active tab and focus, and skip non-web pages', async () => {
	const harness = recoveryHarness(
		{excludedOrigins: ['private.example']},
		[
			webTab(1, 10, 0, {pinned: true}),
			webTab(2, 10, 1, {active: true, groupId: 7}),
			webTab(3, 10, 2, {groupId: 7}),
			webTab(4, 10, 3, {splitViewId: 5}),
			webTab(5, 10, 4, {splitViewId: 5}),
			webTab(6, 10, 5, {url: 'chrome://settings/'}),
			webTab(7, 10, 6, {url: 'chrome-extension://tablodge/newtab.html'}),
			webTab(8, 10, 7, {url: 'https://private.example/secret'}),
			webTab(9, 20, 0, {active: true}),
			webTab(10, 30, 0),
		],
		{
			extraWindows: [20, 30],
			incognitoWindows: [30],
			tabGroups: [{id: 7, title: 'Research', color: 'blue', collapsed: true}],
		},
	);
	await harness.fire('tabCreated', {});
	assert.equal(
		liveOf(harness),
		undefined,
		'nothing is written before the debounce',
	);
	await harness.runTimers();
	const live = liveOf(harness)!;
	assert.equal(live.windows.length, 2, 'incognito window is skipped');
	const first = live.windows[0];
	assert.deepEqual(
		first.tabs.map((tab) => tab.url),
		[
			'https://site1.example/',
			'https://site2.example/',
			'https://site3.example/',
			'https://site4.example/',
			'https://site5.example/',
		],
	);
	assert.equal(first.tabs[0].pinned, true);
	assert.equal(first.tabs[1].active, true);
	assert.deepEqual(first.groups, [
		{title: 'Research', color: 'blue', collapsed: true},
	]);
	assert.equal(first.tabs[1].group, 0);
	assert.equal(first.tabs[2].group, 0);
	assert.equal(first.tabs[3].split?.position, 0);
	assert.equal(first.tabs[4].split?.position, 1);
	assert.equal(first.tabs[3].split?.id, first.tabs[4].split?.id);
	assert.equal(first.focused, true);
	assert.equal(live.windows[1].focused, false);
	assert.equal(metaOf(harness)?.sessionOpen, true);
});

test('snapshot writes are debounced and identical captures are not rewritten or rotated twice', async () => {
	const harness = recoveryHarness();
	for (let index = 0; index < 5; index += 1) {
		await harness.fire('tabUpdated', 1, {url: 'https://x.example/'}, {});
	}

	assert.equal(
		harness.timers.size,
		1,
		'events coalesce into one pending timer',
	);
	assert.equal([...harness.timers.values()][0].delay <= 5000, true);
	await harness.runTimers();
	const firstLive = liveOf(harness)!;
	assert.ok(firstLive);
	assert.equal(historyOf(harness).length, 0, 'event captures do not rotate');
	// Title-only updates do not schedule anything.
	await harness.fire('tabUpdated', 1, {title: 'Renamed'}, {});
	assert.equal(harness.timers.size, 0);
	// An alarm rotates the live state into history.
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	assert.equal(historyOf(harness).length, 1);
	const rewritten = liveOf(harness)!;
	assert.equal(rewritten.sig, firstLive.sig);
	assert.equal(
		rewritten.id,
		firstLive.id,
		'identical live snapshot is left alone',
	);
	// The same state again adds nothing.
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	assert.equal(historyOf(harness).length, 1);
	// A change adds a second entry, newest first.
	harness.tabs.push(webTab(40, 10, 2));
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	const history = historyOf(harness);
	assert.equal(history.length, 2);
	assert.equal(history[0].windows[0].tabs.length, 3);
});

test('snapshot history is capped by the keep setting', async () => {
	const harness = recoveryHarness({snapshotKeep: 10});
	for (let index = 0; index < 14; index += 1) {
		harness.tabs.push(webTab(100 + index, 10, 5 + index));
		await harness.fire('alarm', {name: 'tablodge-snapshot'});
	}

	const history = historyOf(harness);
	assert.equal(history.length, 10);
	assert.equal(history[0].windows[0].tabs.length, 2 + 14);
	assert.equal(history.at(-1)!.windows[0].tabs.length, 2 + 5);
});

test('snapshots stay off when disabled and alarms follow the settings', async () => {
	const harness = recoveryHarness({snapshotsEnabled: false});
	await harness.fire('tabCreated', {});
	await harness.runTimers();
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	assert.equal(liveOf(harness), undefined);
	assert.equal(harness.alarms.has('tablodge-snapshot'), false);

	const on = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {snapshotsEnabled: true, snapshotIntervalMinutes: 5},
	});
	assert.equal(on.ok, true);
	assert.equal(harness.alarms.get('tablodge-snapshot')?.periodInMinutes, 5);
	assert.equal(harness.timers.size, 1, 'turning snapshots on captures soon');
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {snapshotIntervalMinutes: 30},
	});
	assert.equal(harness.alarms.get('tablodge-snapshot')?.periodInMinutes, 30);
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {snapshotsEnabled: false},
	});
	assert.equal(harness.alarms.has('tablodge-snapshot'), false);
});

test('snapshot capture still works without chrome.alarms', async () => {
	const harness = recoveryHarness({}, undefined, {noAlarms: true});
	await harness.fire('tabCreated', {});
	await harness.runTimers();
	assert.ok(liveOf(harness));
});

const seededSnapshot = (tabCount = 3, id = 'prev-live'): StoredSnapshot => ({
	id,
	reason: 'interval',
	sig: `sig-${id}`,
	windows: [
		{
			focused: true,
			state: 'normal',
			groups: [{title: 'Work', color: 'green', collapsed: false}],
			tabs: Array.from({length: tabCount}, (_, index) => ({
				url: `https://old${index}.example/`,
				title: `Old ${index}`,
				...(index === 0 ? {pinned: true} : {group: 0}),
				...(index === 1 && {active: true}),
			})),
		},
		{
			focused: false,
			state: 'maximized',
			groups: [],
			tabs: [{url: 'https://other.example/', title: 'Other'}],
		},
	],
});
const seededSnapshotStorage = (
	meta: Partial<StoredMeta>,
	live: StoredSnapshot | null = seededSnapshot(),
) => ({
	[LIVE_KEY]: live ? {...live, at: 1_700_000_000_000, size: 100} : undefined,
	[META_KEY]: {
		sessionOpen: false,
		liveAt: 1_700_000_000_000,
		closing: null,
		recovery: null,
		...meta,
	},
});
const cleanStorage = (storage: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(storage).filter(([, value]) => value !== undefined),
	);

test('crash detection: a run that never closed cleanly leaves a pending recovery', async () => {
	const harness = recoveryHarness({}, undefined, {
		storage: cleanStorage(seededSnapshotStorage({sessionOpen: true})),
	});
	await harness.fire('onStartup');
	const response = await harness.sendMessage({type: 'GET_SNAPSHOTS'});
	assert.equal(response.ok, true);
	assert.equal(response.recovery?.windows, 2);
	assert.equal(response.recovery?.tabs, 4);
	assert.equal(response.snapshots.length, 1);
	assert.equal(response.snapshots[0].reason, 'crash');
	assert.equal(response.recovery?.snapshotId, response.snapshots[0].id);
	assert.equal(metaOf(harness)?.sessionOpen, true, 'the new run is open');
});

test('crash detection: clean exits, shutdowns in progress, tiny sessions and browser-restored sessions need no recovery', async () => {
	// Clean exit: sessionOpen was cleared by the last window closing.
	const clean = recoveryHarness({}, undefined, {
		storage: cleanStorage(seededSnapshotStorage({sessionOpen: false})),
	});
	await clean.fire('onStartup');
	const cleanResponse = await clean.sendMessage({type: 'GET_SNAPSHOTS'});
	assert.equal(cleanResponse.recovery, null);
	assert.equal(
		cleanResponse.snapshots[0].reason,
		'exit',
		'still kept in history',
	);

	// Windows were being closed down to one and nothing was captured afterwards: a shutdown, not a crash.
	const closing = recoveryHarness({}, undefined, {
		storage: cleanStorage(
			seededSnapshotStorage({
				sessionOpen: true,
				closing: {at: 1_700_000_005_000, remaining: 1},
			}),
		),
	});
	await closing.fire('onStartup');
	assert.equal(
		(await closing.sendMessage({type: 'GET_SNAPSHOTS'})).recovery,
		null,
	);

	// A capture after the close means the session went on, so it counts as a crash.
	const continued = recoveryHarness({}, undefined, {
		storage: cleanStorage(
			seededSnapshotStorage({
				sessionOpen: true,
				liveAt: 1_700_000_009_000,
				closing: {at: 1_700_000_005_000, remaining: 1},
			}),
		),
	});
	await continued.fire('onStartup');
	assert.ok((await continued.sendMessage({type: 'GET_SNAPSHOTS'})).recovery);

	// Too small to be worth a banner.
	const tiny = recoveryHarness({}, undefined, {
		storage: cleanStorage(
			seededSnapshotStorage(
				{sessionOpen: true},
				{
					...seededSnapshot(1),
					windows: [seededSnapshot(1).windows[0]],
				},
			),
		),
	});
	await tiny.fire('onStartup');
	assert.equal(
		(await tiny.sendMessage({type: 'GET_SNAPSHOTS'})).recovery,
		null,
	);

	// The browser reopened the same tabs itself.
	const restored = recoveryHarness(
		{},
		[
			webTab(1, 10, 0, {url: 'https://old0.example/'}),
			webTab(2, 10, 1, {url: 'https://old1.example/'}),
			webTab(3, 10, 2, {url: 'https://old2.example/'}),
			webTab(4, 10, 3, {url: 'https://other.example/'}),
		],
		{storage: cleanStorage(seededSnapshotStorage({sessionOpen: true}))},
	);
	await restored.fire('onStartup');
	assert.equal(
		(await restored.sendMessage({type: 'GET_SNAPSHOTS'})).recovery,
		null,
	);

	// Disabled snapshots never judge a run.
	const disabled = recoveryHarness({snapshotsEnabled: false}, undefined, {
		storage: cleanStorage(seededSnapshotStorage({sessionOpen: true})),
	});
	await disabled.fire('onStartup');
	assert.equal(
		(await disabled.sendMessage({type: 'GET_SNAPSHOTS'})).recovery,
		null,
	);
});

test('closing the last window is the clean-exit signal and files the final state under exit', async () => {
	const harness = recoveryHarness();
	await harness.fire('tabCreated', {});
	await harness.runTimers();
	assert.equal(metaOf(harness)?.sessionOpen, true);
	await harness.closeWindow(20);
	assert.equal(metaOf(harness)?.sessionOpen, true, 'one window is still open');
	assert.equal(metaOf(harness)?.closing?.remaining, 1);
	await harness.closeWindow(10);
	assert.equal(metaOf(harness)?.sessionOpen, false);
	assert.equal(historyOf(harness)[0].reason, 'exit');
	assert.equal(
		historyOf(harness)[0].windows.length,
		2,
		'the state before closing',
	);
	// Empty captures never replace the saved state.
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	assert.equal(liveOf(harness)!.windows.length, 2);
});

test('dismissing the recovery keeps the snapshot', async () => {
	const harness = recoveryHarness({}, undefined, {
		storage: cleanStorage(seededSnapshotStorage({sessionOpen: true})),
	});
	await harness.fire('onStartup');
	assert.ok((await harness.sendMessage({type: 'GET_SNAPSHOTS'})).recovery);
	assert.equal(
		(await harness.sendMessage({type: 'DISMISS_RECOVERY'})).ok,
		true,
	);
	const after = await harness.sendMessage({type: 'GET_SNAPSHOTS'});
	assert.equal(after.recovery, null);
	assert.equal(after.snapshots.length, 1);
});

test('RESTORE_SNAPSHOT reopens every window with pinned tabs, groups and the active tab', async () => {
	const harness = recoveryHarness({}, undefined, {
		storage: cleanStorage(seededSnapshotStorage({sessionOpen: true})),
	});
	await harness.fire('onStartup');
	const {snapshots, recovery} = await harness.sendMessage({
		type: 'GET_SNAPSHOTS',
	});
	const response = await harness.sendMessage({
		type: 'RESTORE_SNAPSHOT',
		id: snapshots[0].id,
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.windows, 2);
	assert.equal(response.count, 4);
	assert.equal(response.tabIds.length, 4, 'the opened tab ids are returned');
	assert.equal(harness.createdWindows.length, 2);
	const firstWindow = harness.createdWindows[0].id;
	const opened = harness.openedTabs.filter(
		(tab) => tab.windowId === firstWindow,
	);
	assert.deepEqual(
		opened.map((tab) => [tab.url, tab.pinned]),
		[
			['https://old0.example/', true],
			['https://old1.example/', false],
			['https://old2.example/', false],
		],
	);
	assert.ok(
		harness.apiLog.some((entry) => entry.startsWith('group:')),
		'the saved tab group is recreated',
	);
	const active = harness.tabs.find(
		(tab) => tab.windowId === firstWindow && tab.active,
	);
	assert.equal(active?.url, 'https://old1.example/');
	assert.equal(
		harness.windowUpdates.some(
			(entry) =>
				entry.id === harness.createdWindows[1].id &&
				(entry.properties as {state?: string}).state === 'maximized',
		),
		true,
	);
	assert.equal(
		(await harness.sendMessage({type: 'GET_SNAPSHOTS'})).recovery,
		null,
		'restoring the pending snapshot clears the banner',
	);
	assert.ok(recovery);
});

test('RESTORE_SNAPSHOT with a window index restores only that window; duplicates inside a window stay', async () => {
	const live = seededSnapshot();
	live.windows[1].tabs.push({
		url: 'https://other.example/',
		title: 'Other again',
	});
	const harness = recoveryHarness(
		{restoreDuplicateHandling: 'skip'},
		undefined,
		{
			storage: cleanStorage(seededSnapshotStorage({sessionOpen: true}, live)),
		},
	);
	await harness.fire('onStartup');
	const {snapshots} = await harness.sendMessage({type: 'GET_SNAPSHOTS'});
	const response = await harness.sendMessage({
		type: 'RESTORE_SNAPSHOT',
		id: snapshots[0].id,
		windowIndex: 1,
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.windows, 1);
	assert.equal(response.count, 2, 'a repeated URL in one window still opens');
	assert.equal(harness.createdWindows.length, 1);
	const missing = await harness.sendMessage({
		type: 'RESTORE_SNAPSHOT',
		id: snapshots[0].id,
		windowIndex: 9,
	});
	assert.equal(missing.ok, false);
	const unknown = await harness.sendMessage({
		type: 'RESTORE_SNAPSHOT',
		id: 'nope',
	});
	assert.equal(unknown.ok, false);
});

test('snapshots can be saved as sessions, deleted and cleared', async () => {
	const harness = recoveryHarness({}, undefined, {
		storage: cleanStorage(seededSnapshotStorage({sessionOpen: true})),
	});
	await harness.fire('onStartup');
	const {snapshots} = await harness.sendMessage({type: 'GET_SNAPSHOTS'});
	const saved = await harness.sendMessage({
		type: 'SAVE_SNAPSHOT_AS_SESSION',
		id: snapshots[0].id,
	});
	assert.equal(saved.ok, true, saved.error);
	assert.equal(saved.groups, 2);
	assert.equal(saved.count, 4);
	assert.equal(harness.state.groups.length, 3);
	const first = harness.state.groups[0];
	assert.match(first.name ?? '', /^Snapshot .* · window 1$/);
	assert.equal(first.tabs[0].pinned, true, 'pinned tabs are kept');
	assert.equal(first.tabs[1].nativeGroup?.title, 'Work');
	const one = await harness.sendMessage({
		type: 'SAVE_SNAPSHOT_AS_SESSION',
		id: snapshots[0].id,
		windowIndex: 1,
	});
	assert.equal(one.groups, 1);
	assert.match(harness.state.groups[0].name ?? '', /window 2$/);

	assert.equal(
		(await harness.sendMessage({type: 'DELETE_SNAPSHOT', id: snapshots[0].id}))
			.ok,
		true,
	);
	assert.equal(
		(await harness.sendMessage({type: 'DELETE_SNAPSHOT', id: snapshots[0].id}))
			.ok,
		false,
	);
	harness.tabs.push(webTab(60, 10, 9));
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	const cleared = await harness.sendMessage({type: 'CLEAR_SNAPSHOTS'});
	assert.equal(cleared.count, 1);
	assert.equal(liveOf(harness), undefined);
	assert.equal(historyOf(harness).length, 0);
});

test('a 5,000-tab snapshot stays small and fast', async () => {
	const tabs: MockTab[] = Array.from({length: 5000}, (_, index) =>
		webTab(1000 + index, 10 + (index % 5), Math.floor(index / 5), {
			active: index < 5,
			url: `https://example${index % 400}.com/path/to/page/${index}?ref=tab`,
			title: `A reasonably long page title number ${index} - Example Site`,
		}),
	);
	const harness = recoveryHarness({}, tabs, {
		extraWindows: [11, 12, 13, 14],
	});
	const started = performance.now();
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	const elapsed = performance.now() - started;
	const live = liveOf(harness)!;
	const size = JSON.stringify(live).length;
	assert.equal(
		live.windows.reduce((sum, win) => sum + win.tabs.length, 0),
		5000,
	);
	assert.ok(size < 1_200_000, `snapshot is ${size} characters`);
	assert.ok(elapsed < 5000, `capture took ${Math.round(elapsed)} ms`);
	// Identical state is skipped, not rotated twice.
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	assert.equal(historyOf(harness).length, 1);
});

type StoredBackups = {
	auto: Array<{id: string; kind: string; reason: string; json: string}>;
	safety: Array<{id: string; kind: string; reason: string; json: string}>;
	downloadError: string;
};
const backupsOf = (harness: {extraStorage: Record<string, unknown>}) =>
	(harness.extraStorage[BACKUPS_KEY] as StoredBackups | undefined) ?? {
		auto: [],
		safety: [],
		downloadError: '',
	};
type StoredTrash = {
	items: Array<{id: string; kind: string; deletedAt: number; label: string}>;
};
const trashOf = (harness: {extraStorage: Record<string, unknown>}) =>
	(harness.extraStorage[TRASH_KEY] as StoredTrash | undefined)?.items ?? [];

function bookmarksState(count = 3): StoredState {
	const state = stateWithSession();
	state.bookmarkColumns = [
		{id: 'bookmark-default', name: 'Bookmarks', createdAt: 0, isDefault: true},
		{id: 'col-news', name: 'News', createdAt: 1, isDefault: false},
	];
	state.bookmarks = Array.from({length: count}, (_, index) => ({
		id: `bm-${index}`,
		title: `Bookmark ${index}`,
		url: `https://bm${index}.example/`,
		columnId: index < 2 ? 'bookmark-default' : 'col-news',
		createdAt: index,
		updatedAt: index,
	}));
	return state;
}

test('BACKUP_NOW stores a full export that the importer reads, and keeps settings in it', async () => {
	const harness = createWorkerHarness(bookmarksState());
	const response = await harness.sendMessage({type: 'BACKUP_NOW'});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.backup.sessions, 1);
	assert.equal(response.backup.tabs, 1);
	assert.equal(response.backup.bookmarks, 3);
	const stored = backupsOf(harness).auto[0];
	const file = JSON.parse(stored.json) as Record<string, unknown>;
	assert.equal(file.format, 'tablodge-backup');
	assert.equal(Array.isArray(file.groups), true);
	assert.equal(Array.isArray(file.bookmarks), true);
	assert.equal(Array.isArray(file.bookmarkColumns), true);
	assert.equal(typeof file.settings, 'object');
	const data = await harness.sendMessage({
		type: 'GET_BACKUP_DATA',
		id: stored.id,
	});
	assert.equal(data.ok, true);
	assert.match(data.filename, /^tablodge-backup-\d{4}-\d{2}-\d{2}\.json$/);
	assert.equal(data.json, stored.json);
	// The file imports into a fresh install.
	const fresh = createWorkerHarness({
		...stateWithSession(),
		groups: [],
		bookmarks: [],
	});
	const imported = await fresh.sendMessage({
		type: 'IMPORT_GROUPS',
		data: file,
	});
	assert.equal(imported.ok, true, imported.error);
	assert.equal(imported.groups, 1);
	assert.equal(imported.bookmarks, 3);
	const listed = await harness.sendMessage({type: 'GET_BACKUPS'});
	assert.equal(listed.auto.length, 1);
	assert.equal('json' in listed.auto[0], false, 'listing never ships the data');
});

test('automatic backups follow the schedule, skip unchanged data, and rotate', async () => {
	const harness = createWorkerHarness(bookmarksState(), undefined, {});
	assert.equal(harness.alarms.has('tablodge-backup'), false);
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoBackup: 'daily'},
	});
	assert.equal(harness.alarms.get('tablodge-backup')?.periodInMinutes, 1440);
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoBackup: 'weekly'},
	});
	assert.equal(harness.alarms.get('tablodge-backup')?.periodInMinutes, 10_080);
	await harness.fire('alarm', {name: 'tablodge-backup'});
	assert.equal(backupsOf(harness).auto.length, 1);
	assert.equal(backupsOf(harness).auto[0].kind, 'auto');
	await harness.fire('alarm', {name: 'tablodge-backup'});
	assert.equal(
		backupsOf(harness).auto.length,
		1,
		'unchanged data is not backed up again',
	);
	for (let index = 0; index < 10; index += 1) {
		await harness.sendMessage({
			type: 'ADD_BOOKMARK',
			bookmark: {
				url: `https://extra${index}.example/`,
				title: `Extra ${index}`,
			},
		});
		await harness.fire('alarm', {name: 'tablodge-backup'});
	}

	assert.equal(backupsOf(harness).auto.length, 7, 'keeps the last 7');
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoBackup: 'off'},
	});
	assert.equal(harness.alarms.has('tablodge-backup'), false);
	const before = backupsOf(harness).auto.length;
	await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {url: 'https://late.example/', title: 'Late'},
	});
	await harness.fire('alarm', {name: 'tablodge-backup'});
	assert.equal(
		backupsOf(harness).auto.length,
		before,
		'off means no scheduled backups',
	);
});

test('a missed backup is caught up at browser start', async () => {
	const harness = createWorkerHarness(bookmarksState(), undefined, {});
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoBackup: 'daily', autoBackupKeep: 30},
	});
	assert.equal(backupsOf(harness).auto.length, 0);
	await harness.fire('onStartup');
	assert.equal(backupsOf(harness).auto.length, 1);
	await harness.fire('onStartup');
	assert.equal(backupsOf(harness).auto.length, 1, 'not due again yet');
});

test('Downloads copies are written as dated JSON under TabLodge only when enabled and permitted', async () => {
	const permitted = createWorkerHarness(bookmarksState(), undefined, {
		downloads: true,
	});
	await permitted.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoBackup: 'daily', autoBackupToDownloads: true},
	});
	await permitted.fire('alarm', {name: 'tablodge-backup'});
	assert.equal(permitted.downloads.length, 1);
	assert.match(
		permitted.downloads[0].filename,
		/^TabLodge\/tablodge-backup-\d{4}-\d{2}-\d{2}\.json$/,
	);
	assert.match(permitted.downloads[0].url, /^data:application\/json;base64,/);
	const body = Buffer.from(
		permitted.downloads[0].url.split(',', 2)[1],
		'base64',
	).toString('utf8');
	assert.equal(body, backupsOf(permitted).auto[0].json);
	assert.equal(backupsOf(permitted).downloadError, '');

	const off = createWorkerHarness(bookmarksState(), undefined, {
		downloads: true,
	});
	await off.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoBackup: 'daily'},
	});
	await off.fire('alarm', {name: 'tablodge-backup'});
	assert.equal(off.downloads.length, 0, 'not enabled');

	const denied = createWorkerHarness(bookmarksState());
	await denied.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoBackup: 'daily', autoBackupToDownloads: true},
	});
	await denied.fire('alarm', {name: 'tablodge-backup'});
	assert.equal(
		backupsOf(denied).auto.length,
		1,
		'the internal backup still happens',
	);
	assert.match(backupsOf(denied).downloadError, /permission/i);
});

test('oversized backups report that no Downloads copy was written', async () => {
	const state = bookmarksState();
	state.bookmarks = Array.from({length: 12_000}, (_, index) => ({
		id: `big-${index}`,
		title: `A fairly long bookmark title to inflate the backup ${index}`,
		url: `https://big${index}.example/some/long/path/segment/${index}`,
		columnId: 'bookmark-default',
		createdAt: index,
		updatedAt: index,
	}));
	const harness = createWorkerHarness(state, undefined, {downloads: true});
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoBackup: 'daily', autoBackupToDownloads: true},
	});
	await harness.fire('alarm', {name: 'tablodge-backup'});
	assert.equal(harness.downloads.length, 0);
	assert.match(backupsOf(harness).downloadError, /too large/i);
}, 30_000); // Builds a deliberately oversized backup; slow machines need more than the 5 s default.

test('safety backups are taken before erase, large imports and bulk deletes, in a ring of five', async () => {
	const harness = createWorkerHarness(bookmarksState());
	const erased = await harness.sendMessage({
		type: 'ERASE_DATA',
		scope: 'bookmarks',
	});
	assert.equal(erased.ok, true, erased.error);
	assert.equal(backupsOf(harness).safety.length, 1);
	assert.equal(backupsOf(harness).safety[0].reason, 'Before erasing data');
	assert.equal(
		(JSON.parse(backupsOf(harness).safety[0].json) as {bookmarks: unknown[]})
			.bookmarks.length,
		3,
		'the backup holds the data as it was',
	);

	const small = await harness.sendMessage({
		type: 'IMPORT_GROUPS',
		data: {groups: [{name: 'Few', tabs: [{url: 'https://few.example/'}]}]},
	});
	assert.equal(small.ok, true, small.error);
	assert.equal(backupsOf(harness).safety.length, 1, 'small imports take none');
	const bigImport = {
		groups: [
			{
				name: 'Many',
				tabs: Array.from({length: 60}, (_, index) => ({
					url: `https://many${index}.example/`,
				})),
			},
		],
	};
	const large = await harness.sendMessage({
		type: 'IMPORT_GROUPS',
		data: bigImport,
	});
	assert.equal(large.ok, true, large.error);
	assert.equal(backupsOf(harness).safety.length, 2);
	assert.equal(backupsOf(harness).safety[0].reason, 'Before a large import');

	const columnState = bookmarksState(0);
	columnState.bookmarks = Array.from({length: 12}, (_, index) => ({
		id: `c-${index}`,
		title: `Col ${index}`,
		url: `https://col${index}.example/`,
		columnId: 'col-news',
		createdAt: index,
		updatedAt: index,
	}));
	const columns = createWorkerHarness(columnState);
	const dropped = await columns.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'col-news',
		discardBookmarks: true,
	});
	assert.equal(dropped.ok, true, dropped.error);
	assert.equal(
		backupsOf(columns).safety[0].reason,
		'Before deleting a bookmark column',
	);
	const moved = createWorkerHarness(columnState);
	await moved.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'col-news',
		targetColumnId: 'bookmark-default',
	});
	assert.equal(backupsOf(moved).safety.length, 0, 'moving links loses nothing');

	for (let index = 0; index < 8; index += 1) {
		await harness.sendMessage({
			type: 'ADD_BOOKMARK',
			bookmark: {url: `https://r${index}.example/`},
		});
		await harness.sendMessage({type: 'ERASE_DATA', scope: 'bookmarks'});
	}

	assert.equal(backupsOf(harness).safety.length, 5);
});

test('erasing stops when the safety backup cannot be written', async () => {
	const harness = createWorkerHarness(bookmarksState());
	await harness.sendMessage({type: 'GET_STATE'});
	harness.setStorageFailure(new Error('quota'));
	const response = await harness.sendMessage({
		type: 'ERASE_DATA',
		scope: 'all',
	});
	assert.equal(response.ok, false);
	assert.match(response.error ?? '', /safety backup/i);
	assert.equal(harness.state.bookmarks.length, 3);
});

test('RESTORE_BACKUP brings data back, keeps current settings, and takes its own safety backup', async () => {
	const harness = createWorkerHarness(bookmarksState());
	const made = await harness.sendMessage({type: 'BACKUP_NOW'});
	await harness.sendMessage({type: 'ERASE_DATA', scope: 'all'});
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {copyFormat: 'url'},
	});
	assert.equal(harness.state.bookmarks.length, 0);
	const restored = await harness.sendMessage({
		type: 'RESTORE_BACKUP',
		id: made.backup.id,
	});
	assert.equal(restored.ok, true, restored.error);
	assert.equal(restored.sessions, 1);
	assert.equal(restored.bookmarks, 3);
	assert.equal(harness.state.bookmarks.length, 3);
	assert.equal(harness.state.groups[0].id, 'session-1');
	assert.equal(harness.state.settings.copyFormat, 'url', 'settings are kept');
	// Restoring over data that exists keeps that data as a safety backup first.
	await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {url: 'https://newer.example/', title: 'Newer'},
	});
	await harness.sendMessage({type: 'RESTORE_BACKUP', id: made.backup.id});
	assert.equal(
		backupsOf(harness).safety[0].reason,
		'Before restoring a backup',
	);
	assert.equal(harness.state.bookmarks.length, 3);
	assert.equal(
		(await harness.sendMessage({type: 'RESTORE_BACKUP', id: 'nope'})).ok,
		false,
	);
	assert.equal(
		(await harness.sendMessage({type: 'DELETE_BACKUP', id: made.backup.id})).ok,
		true,
	);
	assert.equal(backupsOf(harness).auto.length, 0);
});

const fullBackupInput = (overrides: Record<string, unknown> = {}) => ({
	type: 'RESTORE_FULL_BACKUP' as const,
	format: 'tablodge-full-backup',
	version: 1,
	state: {
		schemaVersion: 7,
		groups: [],
		bookmarks: [
			{
				id: 'in-1',
				title: 'Imported',
				url: 'https://imported.example/',
				columnId: 'bookmark-default',
				createdAt: 1,
				updatedAt: 1,
			},
		],
		settings: {copyFormat: 'url', excludedOrigins: ['skip.example']},
	},
	preferences: {uiTheme: 'dark'},
	snapshots: {
		version: 1,
		history: [
			{
				id: 'snap-in',
				at: 5,
				reason: 'interval',
				windows: [
					{
						focused: true,
						state: 'normal',
						groups: [],
						tabs: [{url: 'https://snap.example/', title: 'Snap'}],
					},
				],
			},
		],
	},
	trash: {
		version: 1,
		items: [
			{
				id: 'trash-in',
				kind: 'bookmark',
				deletedAt: Date.now(),
				label: 'Gone',
				origin: '',
				count: 1,
				data: {},
			},
		],
	},
	...overrides,
});

test('RESTORE_FULL_BACKUP replaces state, settings, snapshots, trash and the theme, after a safety backup', async () => {
	const harness = createWorkerHarness(bookmarksState(), undefined, {
		storage: {uiTheme: 'light'},
	});
	const result = await harness.sendMessage(fullBackupInput());
	assert.equal(result.ok, true, result.error);
	assert.equal(result.sessions, 0);
	assert.equal(result.bookmarks, 1);
	assert.equal(result.snapshots, 1);
	assert.equal(result.trash, 1);
	assert.ok(result.undoId);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => bookmark.id),
		['in-1'],
	);
	assert.equal(harness.state.groups.length, 0);
	assert.equal(harness.state.settings.copyFormat, 'url');
	assert.deepEqual(harness.state.settings.excludedOrigins, ['skip.example']);
	assert.equal(harness.extraStorage.uiTheme, 'dark');
	const {history} = harness.extraStorage[HISTORY_KEY] as {
		history: Array<{id: string}>;
	};
	assert.deepEqual(
		history.map((entry) => entry.id),
		['snap-in'],
	);
	assert.deepEqual(
		trashOf(harness).map((item) => item.id),
		['trash-in'],
	);
	assert.equal(
		backupsOf(harness).safety[0].reason,
		'Before importing a full backup',
	);
});

test('RESTORE_FULL_BACKUP undo brings back the previous data', async () => {
	const harness = createWorkerHarness(bookmarksState(), undefined, {
		storage: {uiTheme: 'light'},
	});
	const result = await harness.sendMessage(fullBackupInput());
	assert.equal(result.ok, true, result.error);
	const undone = await harness.sendMessage({type: 'UNDO', id: result.undoId!});
	assert.equal(undone.ok, true, undone.error);
	assert.equal(harness.state.bookmarks.length, 3);
	assert.equal(harness.state.groups.length, 1);
	assert.equal(harness.extraStorage.uiTheme, 'light');
	assert.equal(Object.hasOwn(harness.extraStorage, HISTORY_KEY), false);
	assert.equal(trashOf(harness).length, 0);
});

test('RESTORE_FULL_BACKUP normalizes junk and drops what it cannot trust', async () => {
	const harness = createWorkerHarness(bookmarksState());
	const result = await harness.sendMessage(
		fullBackupInput({
			state: {
				groups: 'nope',
				bookmarks: [
					null,
					5,
					{url: 'javascript:alert(1)'},
					{url: 'https://ok.example/', title: 'Ok'},
				],
				settings: {snapshotKeep: 9999, excludedOrigins: [42]},
			},
			preferences: {uiTheme: '<script>'},
			snapshots: {
				history: [
					null,
					{id: 'a', at: 'x', windows: []},
					{
						id: 'b',
						at: 3,
						reason: 'bogus',
						windows: [
							{
								tabs: [
									{url: 'file:///etc/passwd'},
									{url: 'https://s.example/'},
								],
							},
						],
					},
				],
			},
			trash: {
				items: [null, {id: 'k', kind: 'weird', data: {}}, {id: 'x', data: {}}],
			},
		}),
	);
	assert.equal(result.ok, true, result.error);
	assert.equal(result.bookmarks, 1);
	assert.equal(harness.state.bookmarks[0].url, 'https://ok.example/');
	assert.equal(harness.state.settings.snapshotKeep, 25);
	assert.deepEqual(harness.state.settings.excludedOrigins, []);
	assert.equal(harness.extraStorage.uiTheme, 'system');
	const {history} = harness.extraStorage[HISTORY_KEY] as {
		history: Array<{
			id: string;
			reason: string;
			windows: Array<{tabs: Array<{url: string}>}>;
		}>;
	};
	assert.equal(history.length, 1);
	assert.equal(history[0].reason, 'manual');
	assert.deepEqual(
		history[0].windows[0].tabs.map((tab) => tab.url),
		['https://s.example/'],
	);
	assert.equal(trashOf(harness).length, 0);
});

test('RESTORE_FULL_BACKUP rejects a newer format, another format and missing data, changing nothing', async () => {
	const harness = createWorkerHarness(bookmarksState());
	const newer = await harness.sendMessage(fullBackupInput({version: 2}));
	assert.equal(newer.ok, false);
	assert.match(newer.error ?? '', /newer TabLodge version/);
	const newerSchema = await harness.sendMessage(
		fullBackupInput({state: {schemaVersion: 999}}),
	);
	assert.equal(newerSchema.ok, false);
	assert.match(newerSchema.error ?? '', /newer TabLodge version/);
	assert.equal(
		(await harness.sendMessage(fullBackupInput({format: 'other'}))).ok,
		false,
	);
	assert.equal(
		(await harness.sendMessage(fullBackupInput({state: null}))).ok,
		false,
	);
	assert.equal(harness.state.bookmarks.length, 3);
	assert.equal(backupsOf(harness).safety.length, 0);
});

test('GET_FULL_BACKUP returns the state, theme, snapshot history and trash', async () => {
	const harness = createWorkerHarness(bookmarksState(), undefined, {
		storage: {uiTheme: 'dark'},
	});
	await harness.sendMessage({type: 'DELETE_BOOKMARK', bookmarkId: 'bm-0'});
	const result = await harness.sendMessage({type: 'GET_FULL_BACKUP'});
	assert.equal(result.ok, true, result.error);
	const state = result.state as {bookmarks: unknown[]; settings: unknown};
	assert.equal(state.bookmarks.length, 2);
	assert.equal(typeof state.settings, 'object');
	assert.deepEqual(structuredClone(result.preferences), {
		uiTheme: 'dark',
	});
	assert.deepEqual(structuredClone(result.snapshots), {
		version: 1,
		history: [],
	});
	assert.equal((result.trash as {items: unknown[]}).items.length, 1);
	assert.equal(JSON.stringify(result).includes('tablodge.backups'), false);
});

test('deleting a session moves it to the trash and restoring puts it back where it was', async () => {
	const state = stateWithSession();
	state.groups = ['a', 'b', 'c'].map((id) => ({
		...structuredClone(state.groups[0]),
		id: `session-${id}`,
		name: `Session ${id}`,
	}));
	const harness = createWorkerHarness(state);
	const deleted = await harness.sendMessage({
		type: 'DELETE_GROUP',
		groupId: 'session-b',
	});
	assert.equal(deleted.ok, true, deleted.error);
	assert.ok(deleted.trashId);
	assert.deepEqual(
		harness.state.groups.map((group) => group.id),
		['session-a', 'session-c'],
	);
	const listed = await harness.sendMessage({type: 'GET_TRASH'});
	assert.equal(listed.items.length, 1);
	assert.equal(listed.items[0].kind, 'session');
	assert.equal(listed.items[0].label, 'Session b');
	assert.equal(listed.items[0].count, 1);
	const restored = await harness.sendMessage({
		type: 'RESTORE_TRASH',
		id: deleted.trashId,
	});
	assert.equal(restored.ok, true, restored.error);
	assert.deepEqual(
		harness.state.groups.map((group) => group.id),
		['session-a', 'session-b', 'session-c'],
	);
	assert.equal(trashOf(harness).length, 0);
	assert.equal(
		(await harness.sendMessage({type: 'RESTORE_TRASH', id: deleted.trashId}))
			.ok,
		false,
	);
});

test('a restored session whose folder is gone lands in Unfiled', async () => {
	const state = stateWithSession();
	state.folders.push({
		id: 'work',
		name: 'Work',
		createdAt: 5,
		isDefault: false,
	});
	state.groups[0].folderId = 'work';
	const harness = createWorkerHarness(state);
	const deleted = await harness.sendMessage({
		type: 'DELETE_GROUP',
		groupId: 'session-1',
	});
	const folder = await harness.sendMessage({
		type: 'DELETE_FOLDER',
		folderId: 'work',
	});
	assert.ok(folder.trashId);
	const restored = await harness.sendMessage({
		type: 'RESTORE_TRASH',
		id: deleted.trashId!,
	});
	assert.equal(restored.ok, true, restored.error);
	assert.equal(restored.placed, 'Unfiled');
	assert.equal(harness.state.groups[0].folderId, 'unfiled');
	// Restoring the folder afterwards recreates it.
	const back = await harness.sendMessage({
		type: 'RESTORE_TRASH',
		id: folder.trashId,
	});
	assert.equal(back.ok, true, back.error);
	assert.equal(
		harness.state.folders.some((item) => item.id === 'work'),
		true,
	);
});

test('deleted saved links come back at their position, or recreate a vanished session', async () => {
	const state = stateWithSession();
	state.groups[0].tabs = ['a', 'b', 'c'].map((id, index) => ({
		id: `tab-${id}`,
		title: `Tab ${id}`,
		url: `https://${id}.example/`,
		pinned: false,
		originalIndex: index,
	}));
	const harness = createWorkerHarness(state);
	const removed = await harness.sendMessage({
		type: 'DELETE_TAB',
		groupId: 'session-1',
		tabId: 'tab-b',
	});
	assert.ok(removed.trashId);
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => tab.id),
		['tab-a', 'tab-c'],
	);
	const back = await harness.sendMessage({
		type: 'RESTORE_TRASH',
		id: removed.trashId,
	});
	assert.equal(back.ok, true, back.error);
	assert.equal(back.placed, 'Research');
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => tab.id),
		['tab-a', 'tab-b', 'tab-c'],
	);

	// Deleting the last links removes the session; undo recreates it with the same id.
	for (const id of ['tab-a', 'tab-b']) {
		await harness.sendMessage({
			type: 'DELETE_TAB',
			groupId: 'session-1',
			tabId: id,
		});
	}

	const last = await harness.sendMessage({
		type: 'DELETE_TAB',
		groupId: 'session-1',
		tabId: 'tab-c',
	});
	assert.equal(harness.state.groups.length, 0);
	const recreated = await harness.sendMessage({
		type: 'RESTORE_TRASH',
		id: last.trashId!,
	});
	assert.equal(recreated.ok, true, recreated.error);
	assert.equal(harness.state.groups[0].id, 'session-1');
	assert.equal(harness.state.groups[0].name, 'Research');
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => tab.id),
		['tab-c'],
	);
	// With the session still there, the link joins it instead.
	const other = await harness.sendMessage({type: 'GET_TRASH'});
	assert.equal(
		other.items.length,
		2,
		'the two earlier deletions are still there',
	);
});

test('bookmarks and columns restore into their old place, falling back to the first column', async () => {
	const harness = createWorkerHarness(bookmarksState(5));
	const removed = await harness.sendMessage({
		type: 'DELETE_BOOKMARK',
		bookmarkId: 'bm-1',
	});
	assert.ok(removed.trashId);
	assert.equal(harness.state.bookmarks.length, 4);
	await harness.sendMessage({type: 'RESTORE_TRASH', id: removed.trashId});
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => bookmark.id),
		['bm-0', 'bm-1', 'bm-2', 'bm-3', 'bm-4'],
	);

	// A bookmark whose column was deleted goes to the first column.
	const second = await harness.sendMessage({
		type: 'DELETE_BOOKMARK',
		bookmarkId: 'bm-3',
	});
	await harness.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'col-news',
		targetColumnId: 'bookmark-default',
	});
	const fallback = await harness.sendMessage({
		type: 'RESTORE_TRASH',
		id: second.trashId!,
	});
	assert.equal(fallback.ok, true, fallback.error);
	assert.equal(fallback.placed, 'Bookmarks');
	assert.equal(
		harness.state.bookmarks.find((bookmark) => bookmark.id === 'bm-3')
			?.columnId,
		'bookmark-default',
	);

	// Restoring the column sends its moved links back.
	const trash = await harness.sendMessage({type: 'GET_TRASH'});
	const column = trash.items.find((item) => item.kind === 'column')!;
	const back = await harness.sendMessage({
		type: 'RESTORE_TRASH',
		id: column.id,
	});
	assert.equal(back.ok, true, back.error);
	assert.equal(harness.state.bookmarkColumns.at(-1)?.id, 'col-news');
	assert.equal(
		harness.state.bookmarks.find((bookmark) => bookmark.id === 'bm-4')
			?.columnId,
		'col-news',
	);
	assert.equal(
		harness.state.bookmarks.find((bookmark) => bookmark.id === 'bm-3')
			?.columnId,
		'bookmark-default',
		'a link moved by hand since stays where it is',
	);
});

test('a column deleted with its bookmarks restores them too', async () => {
	const harness = createWorkerHarness(bookmarksState(5));
	const response = await harness.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'col-news',
		discardBookmarks: true,
	});
	assert.equal(response.deleted, 3);
	assert.equal(harness.state.bookmarks.length, 2);
	const back = await harness.sendMessage({
		type: 'RESTORE_TRASH',
		id: response.trashId!,
	});
	assert.equal(back.ok, true, back.error);
	assert.equal(harness.state.bookmarks.length, 5);
	assert.equal(
		harness.state.bookmarks.filter(
			(bookmark) => bookmark.columnId === 'col-news',
		).length,
		3,
	);
});

test('trash can be emptied, items deleted permanently, and old items are purged by retention', async () => {
	const harness = createWorkerHarness(bookmarksState(), undefined, {
		storage: {
			[TRASH_KEY]: {
				version: 1,
				items: [
					{
						id: 'old',
						kind: 'bookmark',
						deletedAt: Date.now() - 40 * 86_400_000,
						label: 'Old',
						origin: '',
						count: 1,
						data: {
							bookmark: {id: 'x', url: 'https://old.example/', title: 'Old'},
						},
					},
					{
						id: 'fresh',
						kind: 'bookmark',
						deletedAt: Date.now() - 2 * 86_400_000,
						label: 'Fresh',
						origin: '',
						count: 1,
						data: {
							bookmark: {
								id: 'y',
								url: 'https://fresh.example/',
								title: 'Fresh',
							},
						},
					},
				],
			},
		},
	});
	const listed = await harness.sendMessage({type: 'GET_TRASH'});
	assert.deepEqual(
		listed.items.map((item) => item.id),
		['fresh'],
		'30 days is the default retention',
	);
	await harness.fire('alarm', {name: 'tablodge-trash'});
	assert.deepEqual(
		trashOf(harness).map((item) => item.id),
		['fresh'],
	);
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {trashRetentionDays: 7},
	});
	// A new deletion prunes with the new retention too.
	const removed = await harness.sendMessage({
		type: 'DELETE_BOOKMARK',
		bookmarkId: 'bm-0',
	});
	assert.ok(removed.trashId);
	assert.equal(trashOf(harness).length, 2);
	assert.equal(
		(await harness.sendMessage({type: 'DELETE_TRASH', id: 'fresh'})).ok,
		true,
	);
	assert.equal(
		(await harness.sendMessage({type: 'DELETE_TRASH', id: 'fresh'})).ok,
		false,
	);
	const emptied = await harness.sendMessage({type: 'EMPTY_TRASH'});
	assert.equal(emptied.count, 1);
	assert.equal(trashOf(harness).length, 0);
});

test('storage usage reports each area', async () => {
	const harness = recoveryHarness();
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	await harness.sendMessage({type: 'BACKUP_NOW'});
	await harness.sendMessage({type: 'DELETE_GROUP', groupId: 'session-1'});
	const response = await harness.sendMessage({type: 'GET_STORAGE_USAGE'});
	assert.equal(response.ok, true);
	assert.equal(response.usage.snapshots > 0, true);
	assert.equal(response.usage.backups > 0, true);
	assert.equal(response.usage.trash > 0, true);
	assert.equal(response.usage.state > 0, true);
});

test('undo paths: restore-and-remove, move between sessions and close-after-save are reversible', async () => {
	// Restore-and-remove: the removed links sit in the trash and Undo puts them back.
	const state = stateWithSession({
		restoreTarget: 'current-window',
		restoreDuplicateHandling: 'open',
	});
	state.groups[0].tabs.push({
		id: 'saved-tab-2',
		title: 'Second',
		url: 'https://second.example/',
		pinned: false,
		originalIndex: 1,
	});
	const harness = createWorkerHarness(state, [
		webTab(1, 10, 0, {active: true, url: 'https://current.example/'}),
	]);
	const restored = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
		forceRemove: true,
	});
	assert.equal(restored.ok, true, restored.error);
	assert.equal(restored.removed, true);
	assert.equal(harness.state.groups.length, 0);
	assert.ok(restored.trashId);
	const undone = await harness.sendMessage({
		type: 'RESTORE_TRASH',
		id: restored.trashId,
	});
	assert.equal(undone.ok, true, undone.error);
	assert.equal(harness.state.groups[0].tabs.length, 2);
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => tab.id),
		['saved-tab-1', 'saved-tab-2'],
	);

	// Single-tab restore-and-remove.
	const single = await harness.sendMessage({
		type: 'RESTORE_TAB',
		groupId: 'session-1',
		tabId: 'saved-tab-1',
		restoreMode: 'remove',
		restoreTarget: 'current-window',
	});
	assert.equal(single.ok, true, single.error);
	assert.ok(single.trashId);
	assert.equal(harness.state.groups[0].tabs.length, 1);
	await harness.sendMessage({type: 'RESTORE_TRASH', id: single.trashId});
	assert.equal(harness.state.groups[0].tabs[0].id, 'saved-tab-1');

	// Moving a link and moving it back to the neighbor it sat next to.
	const two = stateWithSession();
	two.groups = [
		{
			...structuredClone(two.groups[0]),
			id: 'from',
			tabs: ['a', 'b', 'c'].map((id, index) => ({
				id: `t-${id}`,
				title: id,
				url: `https://${id}.example/`,
				pinned: false,
				originalIndex: index,
			})),
		},
		{...structuredClone(two.groups[0]), id: 'to'},
	];
	const mover = createWorkerHarness(two);
	await mover.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'from',
		tabId: 't-b',
		toGroupId: 'to',
	});
	assert.equal(mover.state.groups[1].tabs.at(-1)?.id, 't-b');
	await mover.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'to',
		tabId: 't-b',
		toGroupId: 'from',
		targetTabId: 't-c',
		position: 'before',
	});
	assert.deepEqual(
		mover.state.groups[0].tabs.map((tab) => tab.id),
		['t-a', 't-b', 't-c'],
	);

	// Close-after-save: restoring the saved session into the current window reopens the closed tabs.
	const saving = createWorkerHarness(stateWithSession({closeOnSave: true}), [
		webTab(1, 10, 0, {active: true, url: 'https://keep.example/'}),
		webTab(2, 10, 1, {url: 'https://gone.example/'}),
	]);
	const saved = await saving.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(saved.ok, true, saved.error);
	assert.equal(
		saving.tabs.some((tab) => tab.url === 'https://gone.example/'),
		false,
		'the saved tabs were closed',
	);
	const reopened = await saving.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: saved.groupId!,
		restoreTarget: 'current-window',
		restoreMode: 'keep',
		activate: false,
	});
	assert.equal(reopened.ok, true, reopened.error);
	assert.equal(
		saving.tabs.some((tab) => tab.url === 'https://gone.example/'),
		true,
	);
	assert.equal(
		saving.createdWindows.length,
		0,
		'it reopens in the same window',
	);
});

test('the worker writes the same backup format id and version as the pages', async () => {
	const {BACKUP_FORMAT_ID, BACKUP_VERSION} =
		await import('../src/app/backup-format');
	const harness = createWorkerHarness(bookmarksState());
	const made = await harness.sendMessage({type: 'BACKUP_NOW'});
	const stored = backupsOf(harness).auto.find(
		(item) => item.id === made.backup.id,
	)!;
	const file = JSON.parse(stored.json) as {format: string; version: number};
	assert.equal(file.format, BACKUP_FORMAT_ID);
	assert.equal(file.version, BACKUP_VERSION);
});

test('the manifest asks for alarms up front and Downloads only as an optional permission', () => {
	assert.equal(manifest.permissions?.includes('alarms'), true);
	assert.equal(manifest.permissions?.includes('downloads'), false);
	assert.deepEqual(manifest.optional_permissions, ['downloads']);
});

// ---- Limits, moves, scopes and recovery details ----

const manyTabs = (count: number, windowId = 10): MockTab[] =>
	Array.from({length: count}, (_, index) =>
		webTab(index + 1, windowId, index, {active: index === 0}),
	);
const filler = (id: string, tabCount = 1): Partial<Session> => ({
	id,
	name: id,
	folderId: 'unfiled',
	createdAt: 1,
	updatedAt: 1,
	tabs: Array.from({length: tabCount}, (_, index) => ({
		id: `${id}-t${index}`,
		title: `${id} ${index}`,
		url: `https://${id}-${index}.example/`,
		pinned: false,
		originalIndex: index,
	})) as SavedTab[],
});

test('MOVE_TAB trashes a session emptied by the move, and Undo brings it back with its link', async () => {
	const harness = createWorkerHarness(reorderState());
	const moved = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'C',
		tabId: 'c1',
		toGroupId: 'A',
	});
	assert.equal(moved.ok, true, moved.error);
	assert.equal(typeof moved.trashId, 'string');
	assert.equal(
		harness.state.groups.some((group) => group.id === 'C'),
		false,
	);
	assert.equal(trashOf(harness).length, 1);
	assert.equal(trashOf(harness)[0].id, moved.trashId);

	const undone = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'A',
		tabId: 'c1',
		toGroupId: 'C',
		restoreTrashId: moved.trashId,
	});
	assert.equal(undone.ok, true, undone.error);
	assert.deepEqual(tabIdsOf(harness.state, 'C'), ['c1']);
	assert.deepEqual(tabIdsOf(harness.state, 'A'), ['a1', 'a2', 'a3']);
	assert.equal(harness.state.groups.find((g) => g.id === 'C')?.name, 'C');
	assert.equal(trashOf(harness).length, 0);

	// A move that leaves the source non-empty adds no trash entry.
	const plain = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'A',
		tabId: 'a3',
		toGroupId: 'B',
	});
	assert.equal(plain.trashId, undefined);
});

test('a capture of more than 1000 tabs becomes numbered sessions and loses nothing', async () => {
	const harness = createWorkerHarness(
		stateWithSession({closeOnSave: false}),
		manyTabs(2500),
	);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.count, 2500);
	assert.equal(response.groups, 3);
	const saved = harness.state.groups.slice(0, 3);
	assert.deepEqual(
		saved.map((group) => group.tabs.length),
		[1000, 1000, 500],
	);
	assert.match(String(saved[0].name), /\(1\/3\)$/);
	assert.match(String(saved[2].name), /\(3\/3\)$/);
	assert.equal(response.groupId, saved[0].id);
});

test('saving is refused with a clear error when it would exceed 1000 sessions, and no tab is closed', async () => {
	const state = stateWithSession();
	state.groups = Array.from(
		{length: 1000},
		(_, index) => filler(`s${index}`) as Session,
	);
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(response.ok, false);
	assert.match(String(response.error), /1000 sessions/);
	assert.equal(harness.removedTabIds.length, 0);
	assert.equal(harness.state.groups.length, 1000);
});

test('adding into a full session is refused for a move and for saving the current tab', async () => {
	const state = reorderState();
	state.groups[0] = {...state.groups[0], ...filler('A', 1000)};
	const harness = createWorkerHarness(state);
	const moved = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'B',
		tabId: 'b1',
		toGroupId: 'A',
	});
	assert.equal(moved.ok, false);
	assert.match(String(moved.error), /1000 links/);
	assert.deepEqual(tabIdsOf(harness.state, 'B'), ['b1', 'b2']);

	const saved = await harness.sendMessage({type: 'SAVE_CURRENT_TAB_TO_GROUP'});
	assert.equal(saved.ok, false);
	assert.match(String(saved.error), /1000 links/);
	assert.equal(harness.state.groups[0].tabs.length, 1000);
});

test('importing a session of more than 1000 links splits it into numbered sessions', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const result = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: {
			groups: [
				{
					name: 'Huge',
					tabs: Array.from({length: 1500}, (_, index) => ({
						url: `https://huge${index}.example/`,
					})),
				},
			],
		},
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.groups, 2);
	assert.equal(result.count, 1500);
	const parts = harness.state.groups.filter((group) =>
		String(group.name).startsWith('Huge'),
	);
	assert.deepEqual(
		parts.map((group) => [group.name, group.tabs.length]),
		[
			['Huge (1/2)', 1000],
			['Huge (2/2)', 500],
		],
	);

	const full = stateWithSession();
	full.groups = Array.from(
		{length: 1000},
		(_, index) => filler(`s${index}`) as Session,
	);
	const refused = createWorkerHarness(full);
	const second = await refused.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: {
			groups: [{name: 'One more', tabs: [{url: 'https://more.example/'}]}],
		},
	});
	assert.equal(second.ok, false);
	assert.match(String(second.error), /1000 sessions/);
	assert.equal(refused.state.groups.length, 1000);
});

test('excluded sites ignore a trailing dot in the host, also when capturing', async () => {
	const harness = createWorkerHarness(
		stateWithSession({excludedOrigins: ['bank.example'], closeOnSave: false}),
		[
			webTab(1, 10, 0, {active: true, url: 'https://bank.example./account'}),
			webTab(2, 10, 1, {url: 'https://www.bank.example/'}),
			webTab(3, 10, 2, {url: 'https://fine.example/'}),
		],
	);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.count, 1);
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => tab.url),
		['https://fine.example/'],
	);
});

test('the excluded-sites list dedupes before it caps, and reports sites that do not fit', async () => {
	const existing = Array.from({length: 499}, (_, index) => `site${index}.test`);
	const harness = createWorkerHarness(
		stateWithSession({excludedOrigins: existing}),
	);
	const partial = await harness.sendMessage({
		type: 'ADD_EXCLUDED_ORIGINS',
		origins: ['site0.test', 'new-a.test', 'new-b.test'],
	});
	assert.equal(partial.ok, true, partial.error);
	assert.equal(partial.added, 1);
	assert.equal(partial.notAdded, 1);
	assert.equal(partial.settings.excludedOrigins.length, 500);

	const full = await harness.sendMessage({
		type: 'ADD_EXCLUDED_ORIGINS',
		origins: ['new-c.test'],
	});
	assert.equal(full.ok, false);
	assert.match(String(full.error), /full/i);

	// Repeats in a long raw list no longer eat into the 500.
	const repeated = createWorkerHarness(
		stateWithSession({
			excludedOrigins: [
				...Array.from({length: 600}, () => 'same.test'),
				'later.test',
			],
		}),
	);
	const state = await repeated.sendMessage({type: 'GET_STATE'});
	assert.deepEqual(
		[...state.settings.excludedOrigins],
		['same.test', 'later.test'],
	);
});

test('importing a TabLodge export keeps its pinned tabs even with pinned tabs off in Settings', async () => {
	const harness = createWorkerHarness(
		stateWithSession({includePinnedTabs: false}),
	);
	const result = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: {
			groups: [
				{
					name: 'Native',
					tabs: [
						{url: 'https://pinned.example/', pinned: true},
						{url: 'https://plain.example/'},
					],
				},
			],
		},
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.count, 2);
	const imported = harness.state.groups.find((g) => g.name === 'Native')!;
	assert.deepEqual(
		imported.tabs.map((tab) => [tab.url, Boolean(tab.pinned)]),
		[
			['https://pinned.example/', true],
			['https://plain.example/', false],
		],
	);

	// A plain list of tabs is a foreign shape: the setting still applies.
	const plain = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: [
			{url: 'https://p2.example/', pinned: true},
			{url: 'https://n2.example/'},
		],
	});
	assert.equal(plain.ok, true, plain.error);
	assert.equal(plain.count, 1);
});

test('manual backups never push scheduled ones out, and keep a cap of their own', async () => {
	const harness = createWorkerHarness(bookmarksState(), undefined, {});
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoBackup: 'daily', autoBackupKeep: 7},
	});
	await harness.fire('alarm', {name: 'tablodge-backup'});
	for (let index = 0; index < 12; index += 1) {
		await harness.sendMessage({type: 'BACKUP_NOW'});
	}

	const kinds = backupsOf(harness).auto.map((record) => record.kind);
	assert.equal(kinds.filter((kind) => kind === 'auto').length, 1);
	assert.equal(kinds.filter((kind) => kind === 'manual').length, 10);
});

test('a skipped unchanged backup run still counts, so the catch-up is not due on every start', async () => {
	const harness = createWorkerHarness(bookmarksState(), undefined, {});
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoBackup: 'daily'},
	});
	await harness.fire('onStartup');
	assert.equal(backupsOf(harness).auto.length, 1);
	// Age the record out of the list, as a small keep count would over time.
	const stored = harness.extraStorage[BACKUPS_KEY] as {
		auto: unknown[];
		lastAutoCheckAt: number;
	};
	assert.ok(stored.lastAutoCheckAt > 0);
	stored.auto = [];
	await harness.fire('onStartup');
	assert.equal(
		backupsOf(harness).auto.length,
		0,
		'the recent check keeps the catch-up from running again',
	);
});

test('a run that starts with no window is not marked open, so exiting without one is not a crash', async () => {
	const harness = recoveryHarness();
	await harness.fire('tabCreated', {});
	await harness.runTimers();
	await harness.closeWindow(20);
	await harness.closeWindow(10);
	assert.equal(metaOf(harness)?.sessionOpen, false);
	await harness.fire('onStartup');
	assert.equal(metaOf(harness)?.sessionOpen, false, 'no window, not open');
	await harness.fire('onStartup');
	const response = await harness.sendMessage({type: 'GET_SNAPSHOTS'});
	assert.equal(response.recovery, null);
});

// ---- Worker CPU and memory use ----

const stateReads = (harness: {storageGets: string[][]}) =>
	harness.storageGets.filter((keys) => keys.includes(storageKey)).length;

test('the settings cache follows changes written by another context', async () => {
	const harness = createWorkerHarness(stateWithSession({newTabEnabled: true}), [
		{id: 7, windowId: 10, index: 0, active: true, url: ''},
	]);
	const tab = harness.tabs[0];
	// Warms the cache with newTabEnabled on: nothing to hand off.
	await harness.fire('tabCreated', {id: 7, pendingUrl: 'chrome://newtab/'});
	assert.equal(tab.url, '');
	harness.externalSetState({
		settings: {...harness.state.settings, newTabEnabled: false},
	});
	await harness.fire('tabCreated', {id: 7, pendingUrl: 'chrome://newtab/'});
	assert.equal(tab.url, 'chrome://new-tab-page/');
});

test('tab activation and focus changes do not read the stored state once settings are cached', async () => {
	const harness = createWorkerHarness(stateWithSession());
	await harness.fire('tabActivated', {tabId: 1, windowId: 10});
	assert.ok(stateReads(harness) >= 1, 'the first event loads the settings');
	harness.storageGets.length = 0;
	for (let index = 0; index < 20; index += 1) {
		await harness.fire('tabActivated', {tabId: 1, windowId: 10});
		await harness.fire(
			'tabUpdated',
			1,
			{url: 'https://x.example/'},
			{active: true, url: 'https://x.example/'},
		);
		await harness.fire('windowFocusChanged', 10);
	}

	assert.equal(stateReads(harness), 0);
});

test('snapshot captures compare against the signature in the meta record, not the live snapshot', async () => {
	const harness = recoveryHarness();
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	const live = liveOf(harness)!;
	assert.equal(metaOf(harness)?.liveSig, live.sig);
	harness.storageGets.length = 0;
	harness.storageSets.length = 0;
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	assert.equal(
		harness.storageGets.some((keys) => keys.includes(LIVE_KEY)),
		false,
		'the live snapshot is not read for the comparison',
	);
	assert.equal(
		harness.storageSets.some((keys) => keys.includes(LIVE_KEY)),
		false,
		'an unchanged capture does not rewrite it',
	);
	harness.tabs.push(webTab(40, 10, 2));
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	assert.notEqual(liveOf(harness)!.sig, live.sig);
	assert.equal(metaOf(harness)?.liveSig, liveOf(harness)!.sig);
	// An older meta without the signature falls back to reading the live record, and clearing forgets it.
	const meta = harness.extraStorage[META_KEY] as Record<string, unknown>;
	delete meta.liveSig;
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	assert.equal(metaOf(harness)?.liveSig, liveOf(harness)!.sig);
	await harness.sendMessage({type: 'CLEAR_SNAPSHOTS'});
	assert.equal(liveOf(harness), undefined);
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	assert.ok(
		liveOf(harness),
		'a capture after clearing writes the live snapshot again',
	);
});

test('the trash is capped by total size, dropping the oldest items first', async () => {
	const big = (id: string, age: number) => ({
		id,
		kind: 'bookmark',
		deletedAt: Date.now() - age * 1000,
		label: id,
		origin: '',
		count: 1,
		data: {
			bookmark: {id, url: 'https://x.example/', title: 'x'.repeat(3_000_000)},
		},
	});
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		storage: {
			[TRASH_KEY]: {version: 1, items: [big('a', 3), big('b', 2), big('c', 1)]},
		},
	});
	const response = await harness.sendMessage({
		type: 'DELETE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	const ids = trashOf(harness).map((item) => item.label);
	assert.equal(ids.length, 3, ids.join(','));
	assert.deepEqual(ids.slice(1), ['a', 'b']);
	assert.equal(
		(trashOf(harness) as Array<{size?: number}>).every(
			(item) => typeof item.size === 'number',
		),
		true,
		'sizes are cached on the stored entries',
	);
});

test('the schema migration is written once, inside a mutation, and reads never write', async () => {
	const state = stateWithSession();
	state.schemaVersion = 3;
	const harness = createWorkerHarness(state);
	const stateWrites = () =>
		harness.storageSets.filter((keys) => keys.includes(storageKey)).length;
	await harness.sendMessage({type: 'GET_STATE'});
	await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(stateWrites(), 0, 'reads do not migrate');
	assert.notEqual(harness.state.schemaVersion, 7);
	const first = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {url: 'https://one.example/'},
	});
	assert.equal(first.ok, true, first.error);
	assert.equal(stateWrites(), 2, 'one migration write plus the mutation');
	const second = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {url: 'https://two.example/'},
	});
	assert.equal(second.ok, true, second.error);
	assert.equal(stateWrites(), 3, 'no further migration');
});

test('favicon URLs are no longer stored and are stripped from older data', async () => {
	const state = stateWithSession();
	state.groups[0].tabs[0] = {
		...state.groups[0].tabs[0],
		faviconUrl: 'data:image/png;base64,AAAA',
	} as never;
	const harness = createWorkerHarness(state, [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://current.example/',
			title: 'Current',
			favIconUrl: 'https://current.example/favicon.ico',
		} as MockTab,
	]);
	const loaded = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal('faviconUrl' in loaded.groups[0].tabs[0], false);
	const saved = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'current-tab',
	});
	assert.equal(saved.ok, true, saved.error);
	const raw = JSON.stringify(harness.state);
	assert.equal(raw.includes('faviconUrl'), false);
	assert.equal(raw.includes('favicon.ico'), false);
});

test('session description and old notes merge into one description on load, import, and backup', async () => {
	const long = 'n'.repeat(10_000);
	const cases: Array<[Record<string, unknown>, string]> = [
		[{description: 'Trip', notes: 'Pack light'}, 'Trip\n\nPack light'],
		[{description: 'Trip'}, 'Trip'],
		[{notes: 'Pack light'}, 'Pack light'],
		[{description: 'Same', notes: 'Same'}, 'Same'],
		[{description: '  ', notes: 'Pack light'}, 'Pack light'],
		[
			{description: 'd'.repeat(600), notes: long},
			`${'d'.repeat(500)}\n\n${long}`,
		],
		[{notes: 'x'.repeat(20_000)}, 'x'.repeat(10_502)],
	];
	for (const [fields, expected] of cases) {
		const state = stateWithSession();
		Object.assign(state.groups[0], fields);
		const harness = createWorkerHarness(state);
		const response = await harness.sendMessage({type: 'GET_STATE'});
		assert.equal(response.groups[0].description, expected);
		assert.equal('notes' in response.groups[0], false);

		const imported = await harness.sendMessage({
			type: 'IMPORT_SESSIONS',
			data: {
				groups: [
					{
						name: 'Old export',
						...fields,
						tabs: [{url: 'https://old.example/', title: 'Old'}],
					},
				],
			},
		});
		assert.equal(imported.ok, true, imported.error);
		const added = harness.state.groups.find(
			(group) => group.name === 'Old export',
		);
		assert.equal(added!.description, expected);
		assert.equal('notes' in added!, false);
	}
});

test('UPDATE_GROUP stores one description and ignores a notes field', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const updated = await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-1',
		fields: {description: 'Line one\nLine two', notes: 'ignored'} as never,
	});
	assert.equal(updated.ok, true, updated.error);
	assert.equal(updated.group.description, 'Line one\nLine two');
	assert.equal('notes' in updated.group, false);
});

// ---- Archive and lock were removed: older data is migrated on read.
type LegacyState = StoredState & {groups: Array<Record<string, unknown>>};
function legacyState(): LegacyState {
	const state = stateWithSession({restoreMode: 'archive'}) as LegacyState;
	state.schemaVersion = 7;
	state.folders.push({id: 'work', name: 'Work', createdAt: 1});
	const tab = (id: string, extra: Record<string, unknown> = {}) => ({
		id,
		title: id,
		url: `https://${id}.example/`,
		pinned: false,
		originalIndex: 0,
		...extra,
	});
	state.groups = [
		{
			id: 'kept',
			name: 'In a folder',
			folderId: 'work',
			archived: true,
			archivedAt: 5,
			createdAt: 1,
			updatedAt: 1,
			tabs: [tab('a')],
		},
		{
			id: 'loose',
			name: 'No folder',
			folderId: 'unfiled',
			archived: true,
			archivedAt: 6,
			createdAt: 2,
			updatedAt: 2,
			tabs: [tab('b', {archived: true})],
		},
		{
			id: 'loose-2',
			name: 'Also no folder',
			folderId: 'missing-folder',
			archived: true,
			createdAt: 3,
			updatedAt: 3,
			tabs: [tab('c')],
		},
		{
			id: 'plain',
			name: 'Locked',
			folderId: 'unfiled',
			locked: true,
			createdAt: 4,
			updatedAt: 4,
			tabs: [tab('d', {archived: true})],
		},
	];
	return state;
}

test('stored archived sessions and links become normal data, with an Archived folder for the unfiled ones', async () => {
	const harness = createWorkerHarness(legacyState());
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(response.ok, true, response.error);
	const {groups, folders, settings} = response;
	const byId = new Map(groups.map((group) => [group.id, group]));
	const archivedFolders = folders.filter(
		(folder) => folder.name === 'Archived',
	);
	assert.equal(archivedFolders.length, 1, 'created once');
	assert.equal(archivedFolders[0].icon, 'archive');
	assert.equal(byId.get('kept')?.folderId, 'work', 'a folder is kept');
	assert.equal(byId.get('loose')?.folderId, archivedFolders[0].id);
	assert.equal(byId.get('loose-2')?.folderId, archivedFolders[0].id);
	assert.equal(byId.get('plain')?.folderId, 'unfiled');
	assert.equal(settings.restoreMode, 'keep', 'never remove');
	for (const group of groups) {
		assert.equal('archived' in group, false);
		assert.equal('archivedAt' in group, false);
		assert.equal('locked' in group, false);
		for (const tab of group.tabs) {
			assert.equal('archived' in tab, false);
		}
	}
});

test('the archive migration is persisted once and is idempotent', async () => {
	const harness = createWorkerHarness(legacyState());
	await harness.sendMessage({type: 'GET_STATE'});
	// Any mutation runs the persisted migration.
	await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'plain',
		fields: {name: 'Renamed'},
	});
	const first = structuredClone(harness.state);
	assert.equal(
		harness.state.folders.filter((folder) => folder.name === 'Archived').length,
		1,
	);
	assert.doesNotMatch(JSON.stringify(first), /"archived(At)?":/);
	assert.doesNotMatch(JSON.stringify(first), /"locked":/);
	await harness.sendMessage({type: 'GET_STATE'});
	await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'plain',
		fields: {name: 'Renamed'},
	});
	assert.deepEqual(
		harness.state.folders.map((folder) => folder.id),
		first.folders.map((folder) => folder.id),
	);
	assert.deepEqual(
		harness.state.groups.map((group) => group.folderId),
		first.groups.map((group) => group.folderId),
	);
});

test('an existing folder named Archived is reused', async () => {
	const state = legacyState();
	state.folders.push({
		id: 'mine',
		name: 'Archived',
		createdAt: 2,
		icon: 'star',
	});
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({type: 'GET_STATE'});
	const folders = response.folders.filter(
		(folder) => folder.name === 'Archived',
	);
	assert.equal(folders.length, 1);
	assert.equal(folders[0].id, 'mine');
	assert.equal(
		response.groups.find((group) => group.id === 'loose')?.folderId,
		'mine',
	);
});

test('without archived sessions no Archived folder is created', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(
		response.folders.some((folder) => folder.name === 'Archived'),
		false,
	);
});

test('importing an older export with archived sessions applies the same migration', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const response = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: {
			groups: [
				{
					name: 'Old export',
					folderId: 'unfiled',
					archived: true,
					locked: true,
					tabs: [{title: 'X', url: 'https://x.example/', archived: true}],
				},
			],
		},
		importOptions: {duplicateMode: 'allow'},
	});
	assert.equal(response.ok, true, response.error);
	const folder = harness.state.folders.find(
		(entry) => entry.name === 'Archived',
	);
	assert.ok(folder);
	const imported = harness.state.groups.find(
		(group) => group.name === 'Old export',
	);
	assert.equal(imported?.folderId, folder.id);
	assert.doesNotMatch(JSON.stringify(imported), /"archived(At)?":/);
	assert.doesNotMatch(JSON.stringify(imported), /"locked":/);
});

test('restoreMode archive is not accepted any more and falls back to keep', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const response = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {restoreMode: 'archive' as never},
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.settings.restoreMode, 'keep');
	const restored = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
		restoreMode: 'archive' as never,
	});
	assert.equal(restored.ok, true, restored.error);
	assert.equal(harness.state.groups[0].tabs.length, 1);
});

test('restore-and-remove removes tabs of any session (there is no lock)', async () => {
	const harness = createWorkerHarness(
		stateWithSession({restoreMode: 'remove'}),
	);
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.removed, true);
});

test('UPDATE_TAB changes the address of only that saved link, not other copies of the old URL', async () => {
	const state = stateWithSession();
	state.groups.push({
		...structuredClone(state.groups[0]),
		id: 'session-2',
		tabs: [{...structuredClone(state.groups[0].tabs[0]), id: 'copy-tab'}],
	});
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({
		type: 'UPDATE_TAB',
		groupId: 'session-1',
		tabId: 'saved-tab-1',
		fields: {url: ' https://changed.example/page ', title: 'New title'},
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.shared, 0);
	assert.equal(
		harness.state.groups[0].tabs[0].url,
		'https://changed.example/page',
	);
	assert.equal(harness.state.groups[0].tabs[0].title, 'New title');
	assert.equal(
		harness.state.groups[1].tabs[0].url,
		'https://saved.example/article',
	);
	assert.equal(harness.state.groups[1].tabs[0].title, 'Saved page');
	const undone = await harness.sendMessage({
		type: 'UPDATE_TAB',
		groupId: 'session-1',
		tabId: 'saved-tab-1',
		fields: {url: 'https://saved.example/article', title: 'Saved page'},
	});
	assert.equal(undone.ok, true, undone.error);
	assert.equal(
		harness.state.groups[0].tabs[0].url,
		'https://saved.example/article',
	);
});

test('UPDATE_TAB rejects addresses that are not http or https', async () => {
	const harness = createWorkerHarness(stateWithSession());
	for (const url of [
		'javascript:alert(1)',
		'chrome://settings',
		'not a url',
		'',
	]) {
		const response = await harness.sendMessage({
			type: 'UPDATE_TAB',
			groupId: 'session-1',
			tabId: 'saved-tab-1',
			fields: {url},
		});
		assert.equal(response.ok, false, url);
	}

	assert.equal(
		harness.state.groups[0].tabs[0].url,
		'https://saved.example/article',
	);
});

test('UPDATE_TAB title and notes still apply to every saved copy of the same URL', async () => {
	const state = stateWithSession();
	state.groups.push({
		...structuredClone(state.groups[0]),
		id: 'session-2',
		tabs: [{...structuredClone(state.groups[0].tabs[0]), id: 'copy-tab'}],
	});
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({
		type: 'UPDATE_TAB',
		groupId: 'session-1',
		tabId: 'saved-tab-1',
		fields: {title: 'Shared'},
	});
	assert.equal(response.shared, 1);
	assert.equal(harness.state.groups[1].tabs[0].title, 'Shared');
});

// ---- Session name setting ----

// Saturday, Oct 25 2025, 10:42 PM in the machine's time zone (the worker formats in local time).
const NAME_NOW = new Date(2025, 9, 25, 22, 42).getTime();
const nameTabs = (): MockTab[] => [
	webTab(1, 10, 0, {
		active: true,
		url: 'https://www.flights.example/search',
		title: 'Google Flights',
	}),
	webTab(2, 10, 1, {url: 'https://docs.example/a', title: 'Docs'}),
];
const nameHarness = (
	settings: Record<string, unknown> = {},
	tabs = nameTabs(),
	options: HarnessOptions = {},
) =>
	createWorkerHarness(
		stateWithSession({closeOnSave: false, ...settings}),
		tabs,
		{
			now: NAME_NOW,
			...options,
		},
	);
const savedName = async (
	settings: Record<string, unknown>,
	message: Record<string, unknown> = {},
) => {
	const harness = nameHarness(settings);
	const result = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
		...message,
	} as never);
	assert.equal(result.ok, true, result.error);
	return harness.state.groups[0].name;
};

test('session names: every style, with date-title as the default', async () => {
	assert.equal(await savedName({sessionNameStyle: 'title'}), 'Google Flights');
	assert.equal(
		await savedName({sessionNameStyle: 'datetime'}),
		'Sat, Oct 25 · 10:42 PM',
	);
	assert.equal(
		await savedName({sessionNameStyle: 'date-title'}),
		'Sat, Oct 25 · Google Flights',
	);
	assert.equal(await savedName({}), 'Sat, Oct 25 · Google Flights');
	assert.equal(
		await savedName({sessionNameStyle: 'bogus'}),
		'Sat, Oct 25 · Google Flights',
	);
});

test('session names: the date and time follow the browser locale', async () => {
	const harness = nameHarness({sessionNameStyle: 'datetime'}, nameTabs(), {
		locale: 'de-DE',
	});
	await harness.sendMessage({type: 'SAVE_TABS', scope: 'window'});
	assert.equal(harness.state.groups[0].name, 'Sa., 25. Okt. · 22:42');
});

test('session names: custom templates fill placeholders and keep unknown tokens', async () => {
	assert.equal(
		await savedName({
			sessionNameStyle: 'custom',
			sessionNameTemplate:
				'{weekday} {time} - {domain} (+{count}) {title} {nope} {window}|',
		}),
		'Sat 10:42 PM - flights.example (+2) Google Flights {nope} |',
	);
	assert.equal(
		await savedName({
			sessionNameStyle: 'custom',
			sessionNameTemplate: ' '.repeat(3),
		}),
		'Sat, Oct 25 · Google Flights',
	);
});

test('session names: {title} falls back to the domain and names are capped', async () => {
	const harness = nameHarness(
		{sessionNameStyle: 'custom', sessionNameTemplate: '{title}'},
		[
			webTab(1, 10, 0, {
				active: true,
				url: 'https://www.bare.example/',
				title: '',
			}),
		],
	);
	await harness.sendMessage({type: 'SAVE_TABS', scope: 'window'});
	assert.equal(harness.state.groups[0].name, 'https://www.bare.example/');
	const long = await savedName({
		sessionNameStyle: 'custom',
		sessionNameTemplate: 'x'.repeat(200),
	});
	assert.equal(long?.length, 120);
});

test('session names: {window} numbers each window when saving all windows', async () => {
	const harness = createWorkerHarness(
		stateWithSession({
			closeOnSave: false,
			sessionNameStyle: 'custom',
			sessionNameTemplate: 'W{window} {title}',
		}),
		[webTab(1, 10, 0, {active: true}), webTab(2, 20, 0, {active: true})],
		{extraWindows: [20], now: NAME_NOW},
	);
	const result = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'all-windows',
	});
	assert.equal(result.ok, true, result.error);
	assert.deepEqual(
		harness.state.groups.slice(0, 2).map((group) => group.name),
		['W2 Site 2', 'W1 Site 1'],
	);
});

test('session names: a tab group title and a typed name win, an untitled group uses the setting', async () => {
	const grouped = (title: string) =>
		nameHarness(
			{},
			[
				webTab(1, 10, 0, {active: true, groupId: 7}),
				webTab(2, 10, 1, {groupId: 7}),
			],
			{tabGroups: [{id: 7, title, color: 'blue', collapsed: false}]},
		);
	const titled = grouped('Trip');
	await titled.sendMessage({type: 'SAVE_TABS', scope: 'current-group'});
	assert.equal(titled.state.groups[0].name, 'Trip');
	const untitled = grouped('');
	await untitled.sendMessage({type: 'SAVE_TABS', scope: 'current-group'});
	assert.equal(untitled.state.groups[0].name, 'Sat, Oct 25 · Site 1');
	assert.equal(
		await savedName({}, {groupName: 'My name', tabIds: [1]}),
		'My name',
	);
});

test('session names: Saved links keeps its name', async () => {
	const harness = nameHarness();
	await harness.fire(
		'contextMenuClicked',
		{menuItemId: 'tablodge-link-save', linkUrl: 'https://later.example/'},
		{id: 1, windowId: 10, groupId: -1},
	);
	await new Promise((resolve) => {
		setTimeout(resolve, 20);
	});
	assert.equal(harness.state.groups[0].name, 'Saved links');
});

test('session names: chunk suffixes follow the generated name', async () => {
	const tabs = Array.from({length: 1500}, (_, index) =>
		webTab(index + 1, 10, index, {active: index === 0}),
	);
	const harness = nameHarness({sessionNameStyle: 'datetime'}, tabs);
	const result = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(result.ok, true, result.error);
	assert.deepEqual(
		harness.state.groups.slice(0, 2).map((group) => group.name),
		['Sat, Oct 25 · 10:42 PM (1/2)', 'Sat, Oct 25 · 10:42 PM (2/2)'],
	);
});

test('session name settings are validated and reset', async () => {
	const harness = nameHarness();
	const defaults = (await harness.sendMessage({type: 'GET_STATE'})).settings;
	assert.equal(defaults.sessionNameStyle, 'date-title');
	assert.equal(defaults.sessionNameTemplate, '{date} · {title}');
	const bad = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {
			sessionNameStyle: 'weird',
			sessionNameTemplate: ` ${'y'.repeat(300)}`,
		} as unknown as Partial<Settings>,
	});
	assert.equal(bad.settings.sessionNameStyle, 'date-title');
	assert.equal(bad.settings.sessionNameTemplate, 'y'.repeat(200));
	const custom = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {sessionNameStyle: 'custom', sessionNameTemplate: ''},
	});
	assert.equal(custom.settings.sessionNameStyle, 'custom');
	assert.equal(custom.settings.sessionNameTemplate, '{date} · {title}');
	const reset = await harness.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.sessionNameStyle, 'date-title');
});

test('PREVIEW_SESSION_NAME formats the next save from the window tabs', async () => {
	const harness = nameHarness({sessionNameStyle: 'title'});
	const stored = await harness.sendMessage({
		type: 'PREVIEW_SESSION_NAME',
	});
	assert.equal(stored.name, 'Google Flights');
	const custom = await harness.sendMessage({
		type: 'PREVIEW_SESSION_NAME',
		style: 'custom',
		template: '{domain} +{count}',
	});
	assert.equal(custom.name, 'flights.example +2');
	const datetime = await harness.sendMessage({
		type: 'PREVIEW_SESSION_NAME',
		style: 'datetime',
	});
	assert.equal(datetime.name, 'Sat, Oct 25 · 10:42 PM');
});

test('deleting a column moves its bookmarks after the target column’s own, in order', async () => {
	const harness = createWorkerHarness(bookmarksState(4));
	const result = await harness.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'bookmark-default',
		targetColumnId: 'col-news',
	});
	assert.equal(result.ok, true, result.error);
	assert.deepEqual(
		harness.state.bookmarks.map(
			(bookmark) => `${bookmark.id}@${bookmark.columnId}`,
		),
		['bm-2@col-news', 'bm-3@col-news', 'bm-0@col-news', 'bm-1@col-news'],
	);
});

test('restored tabs are unloaded only after their address commits, so they never reopen blank', async () => {
	const state = stateWithSession({
		unloadRestoredTabs: true,
		unloadRestoredTabsThreshold: 1,
	});
	state.groups[0].tabs.push({
		id: 'saved-tab-2',
		title: 'Background',
		url: 'https://background.example/',
		pinned: false,
	});
	const harness = createWorkerHarness(state, undefined, {
		pendingNavigation: true,
	});
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.deepEqual(
		harness.discardedTabs,
		[],
		'nothing is discarded mid-navigation',
	);
	const background = harness.tabs.find(
		(tab) => tab.pendingUrl === 'https://background.example/',
	)!;
	background.url = background.pendingUrl!;
	delete background.pendingUrl;
	await harness.fire(
		'tabUpdated',
		background.id,
		{url: background.url},
		{...background},
	);
	assert.deepEqual(harness.discardedTabs, [background.id]);
});

test('MERGE_GROUPS moves the links into the target, skips duplicates, removes the source, and undoes', async () => {
	const state = stateWithSession();
	state.groups[0].description = 'Target notes';
	state.groups.push({
		id: 'session-2',
		name: 'Reading',
		folderId: 'unfiled',
		description: 'Source notes',
		createdAt: 1,
		updatedAt: 1,
		tabs: [
			{
				id: 'dup',
				title: 'Same page',
				url: 'https://saved.example/article',
				notes: 'From the source',
				pinned: false,
			},
			{
				id: 'new',
				title: 'New page',
				url: 'https://new.example/',
				pinned: false,
			},
		],
	});
	const harness = createWorkerHarness(state);
	const result = await harness.sendMessage({
		type: 'MERGE_GROUPS',
		sourceGroupId: 'session-2',
		targetGroupId: 'session-1',
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.added, 1);
	assert.equal(result.skipped, 1);
	assert.deepEqual(
		harness.state.groups.map((group) => group.id),
		['session-1'],
	);
	const target = harness.state.groups[0];
	assert.deepEqual(
		target.tabs.map((tab) => tab.url),
		['https://saved.example/article', 'https://new.example/'],
	);
	assert.equal(target.tabs[0].notes, 'From the source');
	assert.equal(target.description, 'Target notes\n\nSource notes');

	const undone = await harness.sendMessage({
		type: 'UNDO',
		id: result.undoId!,
	});
	assert.equal(undone.ok, true, undone.error);
	assert.deepEqual(
		harness.state.groups.map((group) => group.id),
		['session-1', 'session-2'],
	);

	const self = await harness.sendMessage({
		type: 'MERGE_GROUPS',
		sourceGroupId: 'session-1',
		targetGroupId: 'session-1',
	});
	assert.equal(self.ok, false);
});
