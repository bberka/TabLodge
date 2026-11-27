import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {test, vi} from 'vite-plus/test';
import {applyStateChanges} from '../src/shared/state-changes';
import type {
	ActionFailure,
	ActionSuccess,
	Bookmark,
	BookmarkColumn,
	Folder,
	SavedTab,
	Session,
	Settings,
	TabLodgeMessage,
	TabLodgeMessageType,
} from '../src/shared/types';
import {createApi} from '../../server/src/api';
import {sqlite} from '../../server/src/node-sqlite';
import {
	MAX_SESSIONS,
	MAX_TABS_PER_SESSION,
} from '../src/shared/library-normalize';
import {SqlPageStore} from '../../server/src/shared-pages';
import {SqlChangeLog} from '../../server/src/sql-change-log';
import {ChangeLog} from '../src/shared/sync/change-log';
import {stampAt} from '../src/shared/sync/clock';
import {
	logicalState,
	recordsLayout,
	sortKeysDeep,
	storeLibrary,
} from './library-fixtures';
import {PNG, WEBP} from './image-fixtures';
import {buildWorkerSource} from './worker-source';

const workerPath = join(
	import.meta.dirname,
	'..',
	'shell',
	'service-worker.ts',
);
const workerSource = await buildWorkerSource();
const storageKey = 'tablodge.state';
const manifest = JSON.parse(
	readFileSync(
		join(import.meta.dirname, '..', 'shell', 'manifest.json'),
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
	incognito?: boolean;
	discarded?: boolean;
	highlighted?: boolean;
	groupId?: number;
	splitViewId?: number;
	status?: 'loading' | 'complete';
};
type MockCreateProperties = Partial<MockTab> & {splitWithTabId?: number};
type MockWindow = {
	id: number;
	type: string;
	focused: boolean;
	title: string;
	left?: number;
	top?: number;
	width?: number;
	height?: number;
	tabs: MockTab[];
	state?: string;
	incognito?: boolean;
};
type SidePanelCall = {
	method: 'setOptions' | 'setPanelBehavior';
	value: {enabled?: boolean; path?: string; openPanelOnActionClick?: boolean};
};
type HarnessOptions = {
	legacyLayout?: boolean;
	layout10?: boolean;
	incognitoContext?: boolean;
	failedCreateUrls?: string[];
	bookmarkTree?: unknown[];
	withoutContextMenuShown?: boolean;
	splitApi?: 'native' | 'missing' | 'throws';
	misplacedCreateUrls?: string[];
	tabEvents?: boolean;
	fetch?: (url: string, init: RequestInit) => Promise<Response>;
	afterLocalSet?: (values: Record<string, unknown>) => void;
	storage?: Record<string, unknown>;
	manualTimers?: boolean;
	sessionStorage?: Record<string, unknown>;
	extraWindows?: number[];
	incognitoWindows?: number[];
	tabGroups?: Array<{
		id: number;
		title: string;
		color: string;
		collapsed: boolean;
	}>;
	downloads?: boolean;
	pendingNavigation?: boolean;
	loadingTabs?: boolean;
	noAlarms?: boolean;
	rejectWindowBounds?: boolean;
	now?: number;
	locale?: string;
	firefox?: boolean;
	scriptingFails?: boolean;
	scriptResult?: unknown;
	grantedOrigins?: string[];
	refusePermissions?: boolean;
	holdPermissionCheck?: {origins: string[]; until: Promise<void>};
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

type EventListener = (...args: any[]) => unknown;

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

type TestResponse<K extends TabLodgeMessageType> = Omit<
	ActionSuccess<K>,
	'ok' | 'locked'
> & {
	ok: boolean;
	error?: string;
	field?: ActionFailure['field'];
} & (ActionSuccess<K> extends {locked: infer L}
		? {locked: L}
		: {locked?: boolean});

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
	const openedTabs: MockTab[] = [];
	const removedTabIds: number[] = [];
	const sidePanelCalls: SidePanelCall[] = [];
	const executeScriptCalls: Array<{
		target: {tabId: number};
		args?: unknown[];
		files?: string[];
	}> = [];
	const grantedOrigins = new Set(options.grantedOrigins);
	const registeredScripts = new Map<
		string,
		{id: string; matches: string[]; js: string[]}
	>();
	const sidePanelOpened: Array<{windowId: number}> = [];
	let sidebarOpened = 0;
	const popupCalls: string[] = [];
	const createdWindows: Array<Omit<MockWindow, 'tabs'> & {tabs: undefined}> =
		[];
	const windowCreateCalls: Array<Record<string, unknown>> = [];
	const discardedTabs: number[] = [];
	const menuItems: MenuItem[] = [];
	let storageFailure: Error | null = null;
	let storageFailureKey: string | undefined;
	const extraStorage: Record<string, unknown> = {
		...(!options.legacyLayout &&
			recordsLayout(structuredClone(initialState), options.layout10 ? 10 : 11)),
		...structuredClone(options.storage ?? {}),
	};
	extraStorage[storageKey] ??= structuredClone(initialState);
	const state = (logicalState(extraStorage) ?? {}) as StoredState;
	let syncedState = JSON.stringify(state);
	const pushState = () => {
		const now = JSON.stringify(state);
		if (now === syncedState) {
			return;
		}

		storeLibrary(extraStorage, structuredClone(state));
		syncedState = now;
	};

	const pullState = () => {
		const next = (logicalState(extraStorage) ?? {}) as StoredState;
		for (const key of Object.keys(state)) {
			Reflect.deleteProperty(state, key);
		}

		Object.assign(state, next);
		syncedState = JSON.stringify(state);
	};

	const alarms = new Map<
		string,
		{name: string; periodInMinutes?: number; delayInMinutes?: number}
	>();
	const alarmCalls: string[] = [];
	const downloads: Array<{url: string; filename: string}> = [];
	const windowUpdates: Array<{id: number; properties: unknown}> = [];
	const defaultSuggestions: string[] = [];
	const timers = new Map<number, {callback: () => void; delay: number}>();
	let nextTimerId = 1;
	let nextTabId = 200;
	let nextWindowId = 20;
	let nextGroupId = 500;
	let nextSplitId = 900;
	let lastFocusedWindowId = 10;
	const tabs = structuredClone(initialTabs);
	const privateWindowIds =
		options.incognitoWindows ?? (options.incognitoContext ? [10] : []);
	const windows: MockWindow[] = [
		{
			id: 10,
			type: 'normal',
			focused: true,
			title: 'Test window',
			left: 120,
			top: 80,
			width: 1280,
			height: 900,
			tabs,
			incognito: privateWindowIds.includes(10),
		},
		...(options.extraWindows ?? []).map((id) => ({
			id,
			type: 'normal',
			focused: false,
			title: `Window ${id}`,
			tabs: [] as MockTab[],
			incognito: privateWindowIds.includes(id),
		})),
	];
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

	const sessionStore: Record<string, unknown> = structuredClone(
		options.sessionStorage ?? {},
	);
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
	const refuseBrowserUrls = (url: string | string[] | undefined) => {
		if (
			options.firefox &&
			[url ?? []]
				.flat()
				.some((entry) => /^(?:chrome:|about:(?!blank))/.test(entry))
		) {
			throw new Error(`Illegal URL: ${[url].flat().join(',')}`);
		}
	};

	const chrome = {
		extension: {inIncognitoContext: options.incognitoContext === true},
		runtime: {
			getURL: (file: string) =>
				`${options.firefox ? 'moz-extension' : 'chrome-extension'}://tablodge/${file}`,
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
				async get(keys: string[] | null) {
					pushState();
					const wanted = keys ?? Object.keys(extraStorage);
					const out: Record<string, unknown> = {};
					for (const key of wanted) {
						if (Object.hasOwn(extraStorage, key)) {
							out[key] = sortKeysDeep(structuredClone(extraStorage[key]));
						}
					}

					return out;
				},
				async set(values: Record<string, unknown>) {
					pushState();
					if (
						storageFailure &&
						(!storageFailureKey || Object.hasOwn(values, storageFailureKey))
					) {
						throw storageFailure;
					}

					storageSets.push(Object.keys(values));
					const changes: Record<string, unknown> = {};
					for (const [key, value] of Object.entries(values)) {
						const oldValue = structuredClone(extraStorage[key]);
						extraStorage[key] = structuredClone(value);
						changes[key] = {oldValue, newValue: structuredClone(value)};
					}

					pullState();
					notifyChanged(changes);
					options.afterLocalSet?.(values);
				},
				async remove(keys: string | string[]) {
					pushState();
					const changes: Record<string, unknown> = {};
					for (const key of [keys].flat()) {
						changes[key] = {oldValue: structuredClone(extraStorage[key])};
						Reflect.deleteProperty(extraStorage, key);
					}

					pullState();
					notifyChanged(changes);
				},
				async getBytesInUse(keys: string[]) {
					let total = 0;
					for (const key of keys) {
						const value = extraStorage[key];
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
				removeListener(
					callback: (changes: Record<string, unknown>, area: string) => void,
				) {
					const index = changeListeners.indexOf(callback);
					if (index !== -1) {
						changeListeners.splice(index, 1);
					}
				},
			},
			session: {
				async get(keys: string | string[]) {
					return Object.fromEntries(
						[keys]
							.flat()
							.filter((key) => Object.hasOwn(sessionStore, key))
							.map((key) => [key, structuredClone(sessionStore[key])]),
					);
				},
				async set(values: Record<string, unknown>) {
					Object.assign(sessionStore, structuredClone(values));
				},
				async remove(keys: string | string[]) {
					for (const key of [keys].flat()) {
						Reflect.deleteProperty(sessionStore, key);
					}
				},
			},
		},
		idle: {onStateChanged: event('idleStateChanged')},
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
					incognito: Boolean(win.incognito),
					left: win.left,
					top: win.top,
					width: win.width,
					height: win.height,
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
					incognito?: boolean;
					url?: string | string[];
					left?: number;
					top?: number;
					width?: number;
					height?: number;
				} = {},
			) {
				windowCreateCalls.push({...properties});
				refuseBrowserUrls(properties.url);
				if (
					options.rejectWindowBounds &&
					(properties.left !== undefined || properties.top !== undefined)
				) {
					throw new Error('Invalid value for bounds');
				}

				const id = nextWindowId++;
				const win: MockWindow = {
					id,
					type: properties.type || 'normal',
					focused: properties.focused !== false,
					title: 'Restored window',
					tabs: [],
					incognito: properties.incognito === true,
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
			async query(
				query: {
					windowId?: number;
					active?: boolean;
					lastFocusedWindow?: boolean;
					url?: string[];
				} = {},
			) {
				return tabs
					.filter(
						(tab) =>
							(query.url === undefined ||
								query.url.some((pattern) =>
									(tab.url ?? '').startsWith(pattern.replace(/\*$/, '')),
								)) &&
							(query.windowId === undefined ||
								tab.windowId === query.windowId) &&
							(query.active === undefined ||
								Boolean(tab.active) === query.active) &&
							(!query.lastFocusedWindow ||
								tab.windowId === lastFocusedWindowId),
					)
					.map((tab) => ({...tab}));
			},
			async get(id: number) {
				return {...findTab(id)};
			},
			async create(properties: MockCreateProperties) {
				refuseBrowserUrls(properties.url);
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

				if (options.loadingTabs) {
					created.status = 'loading';
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
				findTab(id).discarded = true;
				return tabs.find((entry) => entry.id === id);
			},
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
			onCreated: event('bookmarkCreated'),
			onImportBegan: event('bookmarkImportBegan'),
			onImportEnded: event('bookmarkImportEnded'),
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
		scripting: {
			async registerContentScripts(
				scripts: Array<{id: string; matches: string[]; js: string[]}>,
			) {
				for (const script of scripts) {
					if (registeredScripts.has(script.id)) {
						throw new Error(`Duplicate script ID '${script.id}'`);
					}

					registeredScripts.set(script.id, structuredClone(script));
				}
			},
			async getRegisteredContentScripts(filter: {ids?: string[]} = {}) {
				return [...registeredScripts.values()].filter(
					(script) => !filter.ids || filter.ids.includes(script.id),
				);
			},
			async unregisterContentScripts(filter: {ids: string[]}) {
				for (const id of filter.ids) {
					registeredScripts.delete(id);
				}
			},
			async executeScript(injection: {
				target: {tabId: number};
				args?: unknown[];
				files?: string[];
			}) {
				executeScriptCalls.push(injection);
				if (options.scriptingFails) {
					throw new Error('Cannot access contents of the page.');
				}

				return [
					{
						result:
							options.scriptResult === undefined
								? true
								: structuredClone(options.scriptResult),
					},
				];
			},
		},
		...(options.firefox
			? {
					sidebarAction: {
						async open() {
							sidebarOpened++;
						},
					},
				}
			: {
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
				}),
		commands: {onCommand: event('onCommand')},
		omnibox: {
			async setDefaultSuggestion(suggestion: {description: string}) {
				defaultSuggestions.push(suggestion.description);
			},
			onInputChanged: event('omniboxInputChanged'),
			onInputEntered: event('omniboxInputEntered'),
		},
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
			async contains(request: {origins?: string[]} = {}) {
				const hold = options.holdPermissionCheck;
				if (
					hold &&
					request.origins?.some((origin) => hold.origins.includes(origin))
				) {
					await hold.until;
				}

				return request.origins
					? request.origins.every((origin) => grantedOrigins.has(origin))
					: Boolean(options.downloads);
			},
			async remove(request: {origins?: string[]} = {}) {
				const origins = (request.origins ?? []).filter((origin) =>
					grantedOrigins.has(origin),
				);
				for (const origin of origins) {
					grantedOrigins.delete(origin);
				}

				if (origins.length > 0) {
					listeners.permissionsRemoved?.({origins, permissions: []});
				}

				return true;
			},
			onRemoved: event('permissionsRemoved'),
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
		URLSearchParams,
		console,
		crypto: webcrypto,
		structuredClone,
		TextEncoder,
		TextDecoder,
		// eslint-disable-next-line no-restricted-globals -- the worker uses btoa and atob, so the mock context provides them
		btoa,
		// eslint-disable-next-line no-restricted-globals -- the worker reads base64 back with atob
		atob,
		globalThis: null,
		fetch: options.fetch,
		setInterval,
		clearInterval,
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
		executeScriptCalls,
		registeredScripts,
		grantOrigins(origins: string[]) {
			if (!options.refusePermissions) {
				for (const origin of origins) {
					grantedOrigins.add(origin);
				}
			}
		},
		async revokeOrigins(origins: string[], {fire = true} = {}) {
			for (const origin of origins) {
				grantedOrigins.delete(origin);
			}

			if (fire) {
				listeners.permissionsRemoved?.({origins, permissions: []});
			}

			await settle();
		},
		openedTabs,
		removedTabIds,
		sidePanelCalls,
		sidePanelOpened,
		sidebarOpened: () => sidebarOpened,
		popupCalls,
		createdWindows,
		windowCreateCalls,
		discardedTabs,
		completeLoading() {
			for (const tab of tabs) {
				tab.status = 'complete';
			}
		},
		menuItems,
		listeners,
		tabs,
		windows,
		extraStorage,
		sessionStore,
		alarms,
		alarmCalls,
		downloads,
		windowUpdates,
		defaultSuggestions,
		timers,
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
		async fire(name: string, ...args: unknown[]) {
			listeners[name]?.(...args);
			await settle();
		},
		async openWindow({incognito = false, fire = true} = {}) {
			const id = nextWindowId++;
			windows.push({
				id,
				type: 'normal',
				focused: false,
				title: `Window ${id}`,
				tabs: [] as MockTab[],
				incognito,
			});
			if (fire) {
				listeners.windowCreated?.({id, incognito});
				await settle();
			}

			return id;
		},
		async closeWindow(id: number, {fire = true} = {}) {
			const at = windows.findIndex((win) => win.id === id);
			if (at !== -1) {
				windows.splice(at, 1);
			}

			for (let index = tabs.length - 1; index >= 0; index -= 1) {
				if (tabs[index].windowId === id) {
					tabs.splice(index, 1);
				}
			}

			if (fire) {
				listeners.windowRemoved?.(id);
			}

			await settle();
		},
		apiLog,
		tabsForWindow,
		setStorageFailure(error: Error, key?: string) {
			storageFailure = error;
			storageFailureKey = key;
		},
		clearStorageFailure() {
			storageFailure = null;
			storageFailureKey = undefined;
		},
		state,
		storageSets,
		externalSetState(next: Partial<StoredState>) {
			pushState();
			const oldValue = structuredClone(extraStorage[storageKey]);
			Object.assign(state, structuredClone(next));
			storeLibrary(extraStorage, structuredClone(state));
			syncedState = JSON.stringify(state);
			notifyChanged({
				[storageKey]: {
					oldValue,
					newValue: structuredClone(extraStorage[storageKey]),
				},
			});
		},
		externalStorage(values: Record<string, unknown>) {
			const changes: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(values)) {
				const oldValue = structuredClone(extraStorage[key]);
				if (value === undefined) {
					Reflect.deleteProperty(extraStorage, key);
					changes[key] = {oldValue};
				} else {
					extraStorage[key] = structuredClone(value);
					changes[key] = {oldValue, newValue: structuredClone(value)};
				}
			}

			notifyChanged(changes);
		},
		async sendMessage<M extends TabLodgeMessage>(
			message: M,
			sender: {tab?: Partial<MockTab>; url?: string} = {
				tab: {id: 1, windowId: 10},
			},
		) {
			assert.equal(
				typeof messageListener,
				'function',
				'service worker should register its runtime message listener',
			);
			return new Promise<TestResponse<M['type']>>((resolve, reject) => {
				let returnedAsync: unknown;
				try {
					returnedAsync = messageListener!(
						message,
						{url: chrome.runtime.getURL('newtab.html'), ...sender},
						resolve,
					);
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

test('private dashboards require setup before exposing the shared library', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		incognitoContext: true,
	});
	const config = await harness.sendMessage({type: 'GET_PRIVATE_CONFIG'});
	assert.equal(config.ok, true);
	assert.equal(config.mode, 'shared');
	assert.equal(config.configured, false);
	const state = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(state.ok, false);
});

test('private storage modes keep the normal, saved, and browser session libraries separate', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		incognitoContext: true,
	});
	for (const mode of ['saved', 'temporary'] as const) {
		const configured = await harness.sendMessage({
			type: 'SET_PRIVATE_CONFIG',
			mode,
		});
		assert.equal(configured.ok, true, configured.error);
		const empty = await harness.sendMessage({type: 'GET_STATE'});
		assert.equal(empty.groups?.length, 0);
		assert.equal(empty.bookmarks?.length, 0);
		const added = await harness.sendMessage({
			type: 'ADD_BOOKMARK',
			bookmark: {title: mode, url: `https://${mode}.example/`},
		});
		assert.equal(added.ok, true, added.error);
		assert.equal(harness.state.bookmarks?.length, 0);
	}

	for (const mode of ['saved', 'temporary', 'shared'] as const) {
		await harness.sendMessage({type: 'SET_PRIVATE_CONFIG', mode});
		const library = await harness.sendMessage({type: 'GET_STATE'});
		assert.equal(library.ok, true, library.error);
		assert.equal(library.groups?.length, mode === 'shared' ? 1 : 0);
		assert.deepEqual(
			structuredClone(library.bookmarks?.map((bookmark) => bookmark.title)),
			mode === 'shared' ? [] : [mode],
		);
	}
});

test('temporary private data survives a worker restart but not a browser restart', async () => {
	const options = {
		incognitoContext: true,
		storage: {'tablodge.private.config': {mode: 'temporary', configured: true}},
	};
	const first = createWorkerHarness(stateWithSession(), undefined, options);
	await first.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'Private', url: 'https://private.example/'},
	});
	const restartedWorker = createWorkerHarness(stateWithSession(), undefined, {
		...options,
		sessionStorage: first.sessionStore,
	});
	const kept = await restartedWorker.sendMessage({type: 'GET_STATE'});
	assert.equal(kept.bookmarks?.[0]?.title, 'Private');
	const restartedBrowser = createWorkerHarness(
		stateWithSession(),
		undefined,
		options,
	);
	const cleared = await restartedBrowser.sendMessage({type: 'GET_STATE'});
	assert.equal(cleared.bookmarks?.length, 0);
	assert.equal(restartedBrowser.state.groups.length, 1);
});

test('normal windows ignore the private storage mode', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		storage: {'tablodge.private.config': {mode: 'temporary', configured: true}},
	});
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(response.groups?.[0]?.name, 'Research');
	const invalid = await harness.sendMessage({
		type: 'SET_PRIVATE_CONFIG',
		mode: 'invalid' as never,
	});
	assert.equal(invalid.ok, false);
});

test('opening a private dashboard never reuses a normal window dashboard', async () => {
	const harness = createWorkerHarness(
		stateWithSession(),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				incognito: true,
				url: 'https://private.example/',
			},
			{
				id: 2,
				windowId: 20,
				index: 0,
				active: true,
				url: 'chrome-extension://tablodge/newtab.html',
			},
		],
		{
			incognitoContext: true,
			incognitoWindows: [10],
			extraWindows: [20],
			storage: {'tablodge.private.config': {mode: 'shared', configured: true}},
		},
	);
	await harness.fire('onCommand', 'open-dashboard', harness.tabs[0]);
	assert.equal(harness.openedTabs.length, 1);
	assert.equal(harness.openedTabs[0].windowId, 10);
	assert.equal(
		harness.openedTabs[0].url,
		'chrome-extension://tablodge/newtab.html',
	);
	assert.equal(
		harness.windowUpdates.some((update) => update.id === 20),
		false,
	);
});

test('separate private backups and deleted bookmarks never enter normal recovery storage', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		incognitoContext: true,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			uiTheme: 'dark',
			uiAccent: 'blue',
		},
	});
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'Private', url: 'https://private.example/'},
	});
	assert.equal(added.ok, true, added.error);
	const backup = await harness.sendMessage({type: 'GET_FULL_BACKUP'});
	assert.equal(backup.ok, true, backup.error);
	if (backup.ok) {
		assert.deepEqual(structuredClone(backup.preferences), {
			uiTheme: 'dark',
			uiAccent: 'blue',
		});
	}

	if (added.ok) {
		await harness.sendMessage({
			type: 'DELETE_BOOKMARK',
			bookmarkId: added.bookmark.id,
		});
	}

	const trash = await harness.sendMessage({type: 'GET_TRASH'});
	assert.ok(trash.ok);
	assert.equal(trash.items.length, 1);
	assert.equal(harness.extraStorage['tablodge.trash'], undefined);
	assert.equal(harness.extraStorage['tablodge.backups'], undefined);
	assert.equal(harness.state.groups[0]?.name, 'Research');
});

const PRIVATE_PREFIX = 'tablodge.private.';
const LOCK_RECORD = 'tablodge.private.lock';
const LOCK_KEY = 'tablodge.privatelock.key';
const lockPassword = 'correct horse battery';
const privateDataKeys = (storage: Record<string, unknown>) =>
	Object.keys(storage).filter(
		(key) =>
			key.startsWith(PRIVATE_PREFIX) &&
			key !== 'tablodge.private.config' &&
			key !== LOCK_RECORD,
	);
async function eventually(check: () => boolean) {
	for (let attempt = 0; attempt < 500 && !check(); attempt += 1) {
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 10);
		});
	}
}

const LOCK_ACTIVITY = 'tablodge.privatelock.active';
const ageLock = (
	harness: {sessionStore: Record<string, unknown>},
	minutes: number,
) => {
	harness.sessionStore[LOCK_ACTIVITY] =
		(harness.sessionStore[LOCK_ACTIVITY] as number) - minutes * 60_000;
};

const isSealedValue = (value: unknown) =>
	typeof value === 'object' &&
	value !== null &&
	(value as {tlock?: unknown}).tlock === 1;

async function plainPrivateLibrary(
	extra: HarnessOptions = {},
	storage: Record<string, unknown> = {},
) {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		incognitoContext: true,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			uiTheme: 'dark',
			...storage,
		},
		...extra,
	});
	const bookmark = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'Hidden', url: 'https://secret-bookmark.example/'},
	});
	assert.equal(bookmark.ok, true, bookmark.error);
	const folder = await harness.sendMessage({
		type: 'CREATE_FOLDER',
		name: 'Secret folder',
	});
	assert.equal(folder.ok, true, folder.error);
	return harness;
}

function restartPrivate(
	before: ReturnType<typeof createWorkerHarness>,
	{browserRestart = false}: {browserRestart?: boolean} = {},
	extra: HarnessOptions = {},
) {
	return createWorkerHarness(stateWithSession(), undefined, {
		incognitoContext: true,
		storage: structuredClone(before.extraStorage),
		sessionStorage: browserRestart ? {} : structuredClone(before.sessionStore),
		...extra,
	});
}

const enableLock = (harness: ReturnType<typeof createWorkerHarness>) =>
	harness.sendMessage({
		type: 'ENABLE_PRIVATE_LOCK',
		credential: lockPassword,
	});

test('the private lock encrypts the saved library at rest and leaves the config, appearance, and regular library alone', async () => {
	const harness = await plainPrivateLibrary();
	const enabled = await enableLock(harness);
	assert.equal(enabled.ok, true, enabled.error);
	assert.equal(enabled.locked, false);
	assert.equal(enabled.state, 'encrypted');
	const keys = privateDataKeys(harness.extraStorage);
	assert.ok(keys.includes('tablodge.private.tablodge.state'));
	assert.ok(keys.length >= 2, 'the index and the bookmarks exist');
	for (const key of keys) {
		assert.equal(isSealedValue(harness.extraStorage[key]), true, key);
	}

	const stored = JSON.stringify(harness.extraStorage);
	assert.equal(stored.includes('secret-bookmark.example'), false);
	assert.equal(stored.includes('Secret folder'), false);
	assert.equal(stored.includes(lockPassword), false);
	assert.deepEqual(harness.extraStorage['tablodge.private.config'], {
		mode: 'saved',
		configured: true,
	});
	assert.equal(harness.extraStorage.uiTheme, 'dark');
	assert.equal(harness.state.groups[0]?.name, 'Research');
	const state = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(state.bookmarks?.length, 1);
	assert.equal(state.bookmarks?.[0]?.title, 'Hidden');
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'Later', url: 'https://later-secret.example/'},
	});
	assert.equal(added.ok, true, added.error);
	for (const key of privateDataKeys(harness.extraStorage)) {
		assert.equal(isSealedValue(harness.extraStorage[key]), true, key);
	}

	assert.equal(
		JSON.stringify(harness.extraStorage).includes('later-secret.example'),
		false,
	);
	assert.ok(harness.sessionStore[LOCK_KEY]);
	assert.equal(
		JSON.stringify(harness.extraStorage).includes(
			(harness.sessionStore[LOCK_KEY] as {key: string}).key,
		),
		false,
	);
	assert.ok(harness.alarms.has('tablodge-private-lock'));
});

test('a locked private library refuses reads, writes, backups, and exports until the credential is entered', async () => {
	const harness = await plainPrivateLibrary();
	await enableLock(harness);
	const locked = await harness.sendMessage({type: 'LOCK_PRIVATE'});
	assert.equal(locked.ok, true, locked.error);
	assert.equal(locked.locked, true);
	assert.equal(harness.sessionStore[LOCK_KEY], undefined);
	assert.equal(harness.sessionStore[LOCK_ACTIVITY], undefined);
	assert.equal(harness.alarms.has('tablodge-private-lock'), false);
	for (const message of [
		{type: 'GET_STATE'},
		{type: 'ADD_BOOKMARK', bookmark: {title: 'x', url: 'https://x.example/'}},
		{type: 'GET_FULL_BACKUP'},
		{type: 'GET_BACKUP_DATA'},
		{type: 'BACKUP_NOW'},
		{type: 'GET_TRASH'},
		{type: 'GET_STORAGE_USAGE'},
		{type: 'ERASE_DATA'},
		{type: 'SET_PRIVATE_CONFIG', mode: 'shared'},
	] as TabLodgeMessage[]) {
		const refused = await harness.sendMessage(message);
		assert.equal(refused.ok, false, message.type);
		assert.equal(refused.locked, true, message.type);
	}

	assert.equal(
		JSON.stringify(harness.extraStorage).includes('x.example'),
		false,
	);
	assert.equal(
		(await harness.sendMessage({type: 'GET_PRIVATE_CONFIG'})).mode,
		'saved',
	);
	const handoff = await harness.sendMessage({type: 'HANDOFF_NEW_TAB'});
	assert.deepEqual([handoff.ok, handoff.handedOff], [true, false]);
	const wrong = await harness.sendMessage({
		type: 'UNLOCK_PRIVATE',
		credential: 'wrong wrong wrong',
	});
	assert.equal(wrong.ok, false);
	assert.equal(wrong.locked, undefined);
	assert.match(wrong.error ?? '', /not correct/);
	assert.equal((await harness.sendMessage({type: 'GET_STATE'})).ok, false);
	const opened = await harness.sendMessage({
		type: 'UNLOCK_PRIVATE',
		credential: lockPassword,
	});
	assert.equal(opened.ok, true, opened.error);
	assert.equal(opened.locked, false);
	const state = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(state.bookmarks?.[0]?.title, 'Hidden');
	const backup = await harness.sendMessage({type: 'GET_FULL_BACKUP'});
	assert.equal(backup.ok, true, backup.error);
});

test('the private worker keeps the library open across a restart, and a browser restart locks it', async () => {
	const first = await plainPrivateLibrary();
	await enableLock(first);
	const restarted = restartPrivate(first);
	const kept = await restarted.sendMessage({type: 'GET_STATE'});
	assert.equal(kept.ok, true, kept.error);
	assert.equal(kept.bookmarks?.[0]?.title, 'Hidden');
	const afterBrowser = restartPrivate(first, {browserRestart: true});
	const locked = await afterBrowser.sendMessage({type: 'GET_STATE'});
	assert.equal(locked.ok, false);
	assert.equal(locked.locked, true);
	const status = await afterBrowser.sendMessage({type: 'GET_PRIVATE_LOCK'});
	assert.equal(status.ok, true);
	assert.equal(status.enabled, true);
	assert.equal(status.locked, true);
	assert.equal(status.manageHere, true);
});

const LOCK_WINDOWS = 'tablodge.privatelock.windows';
const ownedLock = (harness: ReturnType<typeof createWorkerHarness>) => ({
	key: harness.sessionStore[LOCK_KEY],
	active: harness.sessionStore[LOCK_ACTIVITY],
	windows: harness.sessionStore[LOCK_WINDOWS],
});

test('unlocking records the open private windows, and Lock now forgets them', async () => {
	const harness = await plainPrivateLibrary({
		extraWindows: [50, 51],
		incognitoWindows: [10, 50],
	});
	await enableLock(harness);
	assert.deepEqual(harness.sessionStore[LOCK_WINDOWS], [10, 50]);
	const opened = await harness.openWindow({incognito: true});
	await harness.openWindow();
	assert.deepEqual(harness.sessionStore[LOCK_WINDOWS], [10, 50, opened]);
	await harness.closeWindow(50);
	assert.deepEqual(harness.sessionStore[LOCK_WINDOWS], [10, opened]);
	await harness.sendMessage({type: 'LOCK_PRIVATE'});
	assert.deepEqual(ownedLock(harness), {
		key: undefined,
		active: undefined,
		windows: undefined,
	});
});

test('closing the last private window locks at once while the worker is awake, and a window left open does not', async () => {
	const harness = await plainPrivateLibrary({
		extraWindows: [20],
		incognitoWindows: [10, 20],
	});
	await enableLock(harness);
	await harness.closeWindow(10);
	assert.ok(harness.sessionStore[LOCK_KEY], 'window 20 keeps it open');
	assert.equal((await harness.sendMessage({type: 'GET_STATE'})).ok, true);
	await harness.closeWindow(20);
	assert.deepEqual(ownedLock(harness), {
		key: undefined,
		active: undefined,
		windows: undefined,
	});
	const locked = await harness.sendMessage({type: 'GET_STATE'});
	assert.deepEqual([locked.ok, locked.locked], [false, true]);
	await harness.sendMessage({type: 'GET_PRIVATE_LOCK'});
	assert.equal(harness.alarms.has('tablodge-private-lock'), false);
});

test('a private worker that was stopped when the last private window closed locks before it serves anything', async () => {
	const first = await plainPrivateLibrary();
	await enableLock(first);
	assert.deepEqual(first.sessionStore[LOCK_WINDOWS], [10]);
	const next = restartPrivate(
		first,
		{},
		{
			extraWindows: [20],
			incognitoWindows: [20],
		},
	);
	const state = await next.sendMessage({type: 'GET_STATE'});
	assert.deepEqual([state.ok, state.locked], [false, true]);
	assert.equal(JSON.stringify(state).includes('Hidden'), false);
	assert.deepEqual(ownedLock(next), {
		key: undefined,
		active: undefined,
		windows: undefined,
	});
	const status = await next.sendMessage({type: 'GET_PRIVATE_LOCK'});
	assert.equal(status.locked, true);
	const opened = await next.sendMessage({
		type: 'UNLOCK_PRIVATE',
		credential: lockPassword,
	});
	assert.equal(opened.ok, true, opened.error);
	assert.deepEqual(next.sessionStore[LOCK_WINDOWS], [20]);
	const kept = await next.sendMessage({type: 'GET_STATE'});
	assert.equal(kept.bookmarks?.[0]?.title, 'Hidden');
});

test('every kind of first message to a worker that missed the last close finds the library locked', async () => {
	const first = await plainPrivateLibrary();
	await enableLock(first);
	for (const message of [
		{type: 'GET_PRIVATE_LOCK'},
		{type: 'GET_STATE'},
		{type: 'TOUCH_PRIVATE_LOCK'},
		{type: 'GET_FULL_BACKUP'},
	] as TabLodgeMessage[]) {
		const next = restartPrivate(
			first,
			{},
			{
				extraWindows: [20],
				incognitoWindows: [20],
			},
		);
		const answer = await next.sendMessage(message);
		assert.equal(
			JSON.stringify(answer).includes('Hidden'),
			false,
			message.type,
		);
		assert.equal(next.sessionStore[LOCK_KEY], undefined, message.type);
		assert.notEqual(answer.locked, false, message.type);
	}

	const waking = restartPrivate(
		first,
		{},
		{
			extraWindows: [20],
			incognitoWindows: [20],
		},
	);
	await waking.fire('alarm', {name: 'unrelated'});
	assert.equal(waking.sessionStore[LOCK_KEY], undefined);
});

test('a worker evicted while a private window stays open keeps the library unlocked', async () => {
	const first = await plainPrivateLibrary({
		extraWindows: [20],
		incognitoWindows: [10, 20],
	});
	await enableLock(first);
	const next = restartPrivate(
		first,
		{},
		{
			extraWindows: [30],
			incognitoWindows: [10, 30],
		},
	);
	const state = await next.sendMessage({type: 'GET_STATE'});
	assert.equal(state.ok, true, state.error);
	assert.equal(state.bookmarks?.[0]?.title, 'Hidden');
	assert.deepEqual(next.sessionStore[LOCK_WINDOWS], [10, 30]);
	const later = restartPrivate(
		next,
		{},
		{
			extraWindows: [40],
			incognitoWindows: [40],
		},
	);
	assert.equal((await later.sendMessage({type: 'GET_STATE'})).locked, true);
});

test('a window that opens as the last one closes cannot read the library, whichever message arrives first', async () => {
	for (const order of ['window first', 'page first', 'together'] as const) {
		const first = await plainPrivateLibrary();
		await enableLock(first);
		const next = restartPrivate(
			first,
			{},
			{
				extraWindows: [20],
				incognitoWindows: [20],
			},
		);
		if (order === 'window first') {
			await next.fire('windowCreated', {id: 20, incognito: true});
		}

		const [state] = await Promise.all([
			next.sendMessage({type: 'GET_STATE'}),
			order === 'together'
				? next.fire('windowCreated', {id: 20, incognito: true})
				: undefined,
		]);
		assert.deepEqual([state.ok, state.locked], [false, true], order);
		assert.equal(JSON.stringify(state).includes('Hidden'), false, order);
		assert.equal(next.sessionStore[LOCK_KEY], undefined, order);
	}
});

test('regular windows only show the lock status and never lock on windows', async () => {
	const first = await plainPrivateLibrary();
	await enableLock(first);
	const normal = createWorkerHarness(stateWithSession(), undefined, {
		storage: structuredClone(first.extraStorage),
		sessionStorage: structuredClone(first.sessionStore),
	});
	const status = await normal.sendMessage({type: 'GET_PRIVATE_LOCK'});
	assert.equal(status.locked, false);
	assert.ok(normal.sessionStore[LOCK_KEY]);
	await normal.closeWindow(10);
	assert.ok(normal.sessionStore[LOCK_KEY]);
});

test('the idle timeout locks the library and the alarm checks it', async () => {
	const harness = await plainPrivateLibrary();
	await enableLock(harness);
	ageLock(harness, 6);
	await harness.fire('alarm', {name: 'tablodge-private-lock'});
	assert.equal(harness.sessionStore[LOCK_KEY], undefined);
	assert.equal((await harness.sendMessage({type: 'GET_STATE'})).locked, true);
	await harness.sendMessage({type: 'UNLOCK_PRIVATE', credential: lockPassword});
	const shortened = await harness.sendMessage({
		type: 'SET_PRIVATE_LOCK_IDLE',
		minutes: 1,
	});
	assert.equal(shortened.idleMinutes, 1);
	ageLock(harness, 2);
	const late = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(late.locked, true);
	const invalid = await harness.sendMessage({
		type: 'SET_PRIVATE_LOCK_IDLE',
		minutes: 7,
	});
	assert.equal(invalid.ok, false);
});

test('locking the screen locks the library, other idle states do not', async () => {
	const harness = await plainPrivateLibrary();
	await enableLock(harness);
	await harness.fire('idleStateChanged', 'idle');
	assert.ok(harness.sessionStore[LOCK_KEY]);
	await harness.fire('idleStateChanged', 'locked');
	assert.equal(harness.sessionStore[LOCK_KEY], undefined);
	assert.equal((await harness.sendMessage({type: 'GET_STATE'})).locked, true);
});

test('the lock needs the saved separate library, and regular windows cannot manage it', async () => {
	const shared = createWorkerHarness(stateWithSession(), undefined, {
		incognitoContext: true,
		storage: {'tablodge.private.config': {mode: 'shared', configured: true}},
	});
	const refused = await enableLock(shared);
	assert.equal(refused.ok, false);
	assert.match(refused.error ?? '', /separate saved private library/);
	const status = await shared.sendMessage({type: 'GET_PRIVATE_LOCK'});
	assert.equal(status.available, false);
	const normal = createWorkerHarness(stateWithSession(), undefined, {
		storage: {'tablodge.private.config': {mode: 'saved', configured: true}},
	});
	const normalRefused = await enableLock(normal);
	assert.equal(normalRefused.ok, false);
	assert.match(normalRefused.error ?? '', /private window/);
	assert.equal(
		(await normal.sendMessage({type: 'GET_PRIVATE_LOCK'})).manageHere,
		false,
	);
});

test('changing the storage mode is refused while a lock exists, locked or not, from either kind of window', async () => {
	const harness = await plainPrivateLibrary();
	await enableLock(harness);
	const before = structuredClone(harness.extraStorage);
	const blocked = await harness.sendMessage({
		type: 'SET_PRIVATE_CONFIG',
		mode: 'temporary',
	});
	assert.equal(blocked.ok, false);
	assert.match(blocked.error ?? '', /remove the lock/);
	assert.deepEqual(harness.extraStorage, before);
	const regular = createWorkerHarness(stateWithSession(), undefined, {
		storage: structuredClone(before),
	});
	const refusedThere = await regular.sendMessage({
		type: 'SET_PRIVATE_CONFIG',
		mode: 'shared',
	});
	assert.equal(refusedThere.ok, false);
	assert.match(refusedThere.error ?? '', /remove the lock/);
	assert.deepEqual(
		regular.extraStorage['tablodge.private.config'],
		before['tablodge.private.config'],
	);
	const same = await regular.sendMessage({
		type: 'SET_PRIVATE_CONFIG',
		mode: 'saved',
	});
	assert.equal(same.ok, true, same.error);
	const removed = await harness.sendMessage({
		type: 'REMOVE_PRIVATE_LOCK',
		credential: lockPassword,
	});
	assert.equal(removed.ok, true, removed.error);
	const changed = await harness.sendMessage({
		type: 'SET_PRIVATE_CONFIG',
		mode: 'temporary',
	});
	assert.equal(changed.ok, true, changed.error);
});

test('removing the lock restores the plain library byte for byte', async () => {
	const harness = await plainPrivateLibrary();
	const plain = structuredClone(
		Object.fromEntries(
			privateDataKeys(harness.extraStorage).map((key) => [
				key,
				harness.extraStorage[key],
			]),
		),
	);
	await enableLock(harness);
	const wrong = await harness.sendMessage({
		type: 'REMOVE_PRIVATE_LOCK',
		credential: 'wrong wrong wrong',
	});
	assert.equal(wrong.ok, false);
	assert.ok(harness.extraStorage[LOCK_RECORD]);
	for (const key of privateDataKeys(harness.extraStorage)) {
		assert.equal(isSealedValue(harness.extraStorage[key]), true, key);
	}

	const removed = await harness.sendMessage({
		type: 'REMOVE_PRIVATE_LOCK',
		credential: lockPassword,
	});
	assert.equal(removed.ok, true, removed.error);
	assert.equal(removed.enabled, false);
	assert.equal(harness.extraStorage[LOCK_RECORD], undefined);
	assert.equal(harness.sessionStore[LOCK_KEY], undefined);
	for (const [key, value] of Object.entries(plain)) {
		assert.deepEqual(
			harness.extraStorage[key],
			// eslint-disable-next-line unicorn/prefer-structured-clone -- JSON drops undefined fields, as storage does
			JSON.parse(JSON.stringify(value)),
			key,
		);
	}

	const state = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(state.bookmarks?.[0]?.title, 'Hidden');
});

test('the credential can change, and only the new one unlocks', async () => {
	const harness = await plainPrivateLibrary();
	await enableLock(harness);
	const refused = await harness.sendMessage({
		type: 'CHANGE_PRIVATE_LOCK_CREDENTIAL',
		current: 'wrong wrong wrong',
		credential: '2468',
	});
	assert.equal(refused.ok, false);
	const changed = await harness.sendMessage({
		type: 'CHANGE_PRIVATE_LOCK_CREDENTIAL',
		current: lockPassword,
		credential: '2468',
	});
	assert.equal(changed.ok, true, changed.error);
	await harness.sendMessage({type: 'LOCK_PRIVATE'});
	const old = await harness.sendMessage({
		type: 'UNLOCK_PRIVATE',
		credential: lockPassword,
	});
	assert.equal(old.ok, false);
	const fresh = await harness.sendMessage({
		type: 'UNLOCK_PRIVATE',
		credential: '2468',
	});
	assert.equal(fresh.ok, true, fresh.error);
	assert.equal(
		(await harness.sendMessage({type: 'GET_STATE'})).bookmarks?.[0]?.title,
		'Hidden',
	);
});

test('an enable cut off before any value was sealed finishes on the next worker start', async () => {
	const harness = await plainPrivateLibrary();
	harness.setStorageFailure(
		new Error('worker stopped'),
		'tablodge.private.tablodge.state',
	);
	const failed = await enableLock(harness);
	assert.equal(failed.ok, false);
	assert.equal(
		(harness.extraStorage[LOCK_RECORD] as {state: string}).state,
		'encrypting',
	);
	assert.equal(
		isSealedValue(harness.extraStorage['tablodge.private.tablodge.state']),
		false,
	);
	const restarted = restartPrivate(harness);
	await eventually(
		() =>
			(restarted.extraStorage[LOCK_RECORD] as {state: string}).state ===
			'encrypted',
	);
	assert.equal(
		(restarted.extraStorage[LOCK_RECORD] as {state: string}).state,
		'encrypted',
	);
	for (const key of privateDataKeys(restarted.extraStorage)) {
		assert.equal(isSealedValue(restarted.extraStorage[key]), true, key);
	}

	const state = await restarted.sendMessage({type: 'GET_STATE'});
	assert.equal(state.bookmarks?.[0]?.title, 'Hidden');
});

test('a private library still in the old single entry layout is sealed whole, then migrated while sealed', async () => {
	const legacy = stateWithSession();
	legacy.groups[0].name = 'Old private session';
	legacy.groups[0].tabs[0].url = 'https://old-private.example/page';
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		incognitoContext: true,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			'tablodge.private.tablodge.state': legacy,
		},
	});
	const enabled = await enableLock(harness);
	assert.equal(enabled.ok, true, enabled.error);
	assert.equal(
		isSealedValue(harness.extraStorage['tablodge.private.tablodge.state']),
		true,
	);
	const state = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(state.groups?.[0]?.name, 'Old private session');
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'New', url: 'https://new-private.example/'},
	});
	assert.equal(added.ok, true, added.error);
	const keys = privateDataKeys(harness.extraStorage);
	assert.ok(keys.some((key) => key.includes('tablodge.session.')));
	for (const key of keys) {
		assert.equal(isSealedValue(harness.extraStorage[key]), true, key);
	}

	const stored = JSON.stringify(harness.extraStorage);
	assert.equal(stored.includes('old-private.example'), false);
	const removed = await harness.sendMessage({
		type: 'REMOVE_PRIVATE_LOCK',
		credential: lockPassword,
	});
	assert.equal(removed.ok, true, removed.error);
	assert.equal(
		JSON.stringify(harness.extraStorage).includes('old-private.example'),
		true,
	);
	const after = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(after.groups?.[0]?.name, 'Old private session');
	assert.equal(after.bookmarks?.[0]?.title, 'New');
});

test('deleted private items and undo records are sealed too', async () => {
	const harness = await plainPrivateLibrary();
	await enableLock(harness);
	const state = await harness.sendMessage({type: 'GET_STATE'});
	const id = state.bookmarks?.[0]?.id ?? '';
	const deleted = await harness.sendMessage({
		type: 'DELETE_BOOKMARK',
		bookmarkId: id,
	});
	assert.equal(deleted.ok, true, deleted.error);
	assert.equal(
		isSealedValue(harness.extraStorage['tablodge.private.tablodge.trash']),
		true,
	);
	assert.equal(
		JSON.stringify(harness.extraStorage).includes('secret-bookmark.example'),
		false,
	);
	const trash = await harness.sendMessage({type: 'GET_TRASH'});
	assert.ok(trash.ok);
	assert.equal(trash.items.length, 1);
});

test('a damaged lock record blocks the library instead of being ignored', async () => {
	const harness = await plainPrivateLibrary();
	harness.extraStorage[LOCK_RECORD] = {version: 1, state: 'oops'};
	const state = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(state.ok, false);
	assert.match(state.error ?? '', /damaged/);
	const status = await harness.sendMessage({type: 'GET_PRIVATE_LOCK'});
	assert.equal(status.state, 'damaged');
});

test('RESTORE_GROUP stamps lastOpenedAt and keeps it through a reload', async () => {
	const harness = createWorkerHarness(stateWithSession());
	assert.equal(harness.state.groups[0].lastOpenedAt, undefined);
	const before = Date.now();
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});

	assert.equal(response.ok, true, response.error);
	const stored = harness.state.groups.find((group) => group.id === 'session-1');
	const openedAt = stored?.lastOpenedAt ?? 0;
	assert.ok(openedAt >= before);
	const state = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(state.groups[0].lastOpenedAt, openedAt);
});

test('default preferences use newest-first, keep-on-restore, quick-popup action, opt-out pinned tabs, and the TabLodge new tab', async () => {
	const harness = createWorkerHarness({...stateWithSession(), settings: {}});
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(response.settings.actionMode, 'popup');
	assert.equal(response.settings.includePinnedTabs, false);
	assert.equal(response.settings.newTabEnabled, true);
	assert.equal(response.settings.sessionSort, 'newest');
	assert.equal(response.settings.restoreMode, 'keep');
	assert.equal(response.settings.restoreTarget, 'new-window-unless-only-tab');
	assert.equal(response.settings.removeTrackingParameters, false);
});

test('RESTORE_GROUP strips X share parameters from status links when enabled', async () => {
	const enabled = createWorkerHarness(
		stateWithSession({removeTrackingParameters: true}),
	);
	enabled.state.groups[0].tabs[0].url =
		'https://x.com/user/status/123?s=20&t=abc&lang=en';
	const result = await enabled.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(
		enabled.openedTabs[0].url,
		'https://x.com/user/status/123?lang=en',
	);
});

test('RESTORE_GROUP strips trackers only when enabled and keeps the saved URL unchanged', async () => {
	const originalUrl =
		'https://saved.example/article?utm_source=mail&gclid=abc&ref=story#details';
	const enabled = createWorkerHarness(
		stateWithSession({removeTrackingParameters: true}),
	);
	enabled.state.groups[0].tabs[0].url = originalUrl;
	const stripped = await enabled.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(stripped.ok, true, stripped.error);
	assert.equal(
		enabled.openedTabs[0].url,
		'https://saved.example/article?ref=story#details',
	);
	assert.equal(enabled.state.groups[0].tabs[0].url, originalUrl);

	const disabled = createWorkerHarness(stateWithSession());
	disabled.state.groups[0].tabs[0].url = originalUrl;
	const untouched = await disabled.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(untouched.ok, true, untouched.error);
	assert.equal(disabled.openedTabs[0].url, originalUrl);
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

test('RESTORE_GROUP restores saved bounds only when the preference is enabled', async () => {
	const state = stateWithSession({
		restoreTarget: 'always-new-window',
		restoreWindowBounds: true,
	});
	state.groups[0].windowBounds = {left: 80, top: 60, width: 1200, height: 800};
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(harness.windowCreateCalls[0].left, 80);
	assert.equal(harness.windowCreateCalls[0].top, 60);
	assert.equal(harness.windowCreateCalls[0].width, 1200);
	assert.equal(harness.windowCreateCalls[0].height, 800);
});

test('saving a window stores its bounds on the session', async () => {
	const harness = createWorkerHarness(stateWithSession({closeOnSave: false}), [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://saved.example/',
			title: 'Saved page',
		},
	]);
	const saved = await harness.sendMessage({type: 'SAVE_TABS', scope: 'window'});
	assert.deepEqual(
		harness.state.groups.find((group) => group.id === saved.groupId)
			?.windowBounds,
		{
			left: 120,
			top: 80,
			width: 1280,
			height: 900,
		},
	);
});

test('saving a single tab does not store window bounds', async () => {
	const harness = createWorkerHarness(stateWithSession({closeOnSave: false}), [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'https://saved.example/',
			title: 'Saved page',
		},
	]);
	const saved = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'current-tab',
	});
	assert.equal(
		harness.state.groups.find((group) => group.id === saved.groupId)
			?.windowBounds,
		undefined,
	);
});

test('RESTORE_GROUP retries without saved bounds when the browser rejects them', async () => {
	const state = stateWithSession({
		restoreTarget: 'always-new-window',
		restoreWindowBounds: true,
	});
	state.groups[0].windowBounds = {
		left: -5000,
		top: 70,
		width: 1000,
		height: 700,
	};
	const harness = createWorkerHarness(state, [], {rejectWindowBounds: true});
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(harness.windowCreateCalls.length, 2);
	assert.equal(harness.windowCreateCalls[0].left, -5000);
	assert.equal(harness.windowCreateCalls[1].left, undefined);
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

test('new tab hand-off only happens for browser-opened new tabs while TabLodge new tab is off', async () => {
	const off = createWorkerHarness(stateWithSession({newTabEnabled: false}), [
		{id: 7, windowId: 10, index: 0, active: true, url: ''},
	]);
	const tab = off.tabs.find((entry) => entry.id === 7)!;
	assert.equal(
		(await off.sendMessage({type: 'HANDOFF_NEW_TAB'}, {tab})).handedOff,
		false,
	);
	await off.fire('tabCreated', {id: 7, pendingUrl: 'chrome://newtab/'});
	assert.equal(tab.url, 'chrome://new-tab-page/');
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

test('private browser new tabs redirect to the dashboard by default', async () => {
	const created = createWorkerHarness(
		stateWithSession({newTabEnabled: false}),
		[{id: 14, windowId: 10, index: 0, active: true, incognito: true, url: ''}],
		{incognitoContext: true},
	);
	await created.fire('tabCreated', {
		id: 14,
		incognito: true,
		pendingUrl: 'chrome://newtab/',
	});
	assert.equal(created.tabs[0].url, 'chrome-extension://tablodge/newtab.html');

	const updated = createWorkerHarness(
		stateWithSession(),
		[{id: 15, windowId: 10, index: 0, active: true, incognito: true, url: ''}],
		{incognitoContext: true},
	);
	await updated.fire('tabCreated', {id: 15, incognito: true});
	await updated.fire(
		'tabUpdated',
		15,
		{url: 'edge://newtab/'},
		{id: 15, incognito: true, url: 'edge://newtab/'},
	);
	assert.equal(updated.tabs[0].url, 'chrome-extension://tablodge/newtab.html');
});

test('private windows cannot read or change the regular windows snapshots', async () => {
	const harness = recoveryHarness({}, undefined, {
		storage: {
			...cleanStorage(seededSnapshotStorage({sessionOpen: false})),
			'tablodge.private.config': {mode: 'shared', configured: true},
		},
		incognitoContext: true,
	});
	const listed = await harness.sendMessage({type: 'GET_SNAPSHOTS'});
	assert.equal(listed.ok, true);
	assert.equal(listed.snapshots.length, 0);
	assert.equal(listed.recovery, null);
	assert.equal(
		(await harness.sendMessage({type: 'RESTORE_SNAPSHOT', id: 'x'})).ok,
		false,
	);
	assert.equal(
		(await harness.sendMessage({type: 'DELETE_SNAPSHOT', id: 'x'})).ok,
		false,
	);
	assert.equal(
		(await harness.sendMessage({type: 'CLEAR_SNAPSHOTS'})).ok,
		false,
	);
});

test('private new-tab redirect can be disabled without completing private setup', async () => {
	const harness = createWorkerHarness(
		stateWithSession(),
		[{id: 16, windowId: 10, index: 0, active: true, incognito: true, url: ''}],
		{incognitoContext: true},
	);
	const disabled = await harness.sendMessage({
		type: 'SET_PRIVATE_NEW_TAB_REDIRECT',
		enabled: false,
	});
	assert.equal(disabled.ok, true, disabled.error);
	assert.equal(disabled.redirectNewTabs, false);
	assert.equal(disabled.configured, false);

	await harness.sendMessage({type: 'SET_PRIVATE_CONFIG', mode: 'saved'});
	const config = await harness.sendMessage({type: 'GET_PRIVATE_CONFIG'});
	assert.equal(config.redirectNewTabs, false);

	await harness.fire('tabCreated', {
		id: 16,
		incognito: true,
		pendingUrl: 'chrome://newtab/',
	});
	assert.equal(harness.tabs[0].url, '');
});

test('private accent defaults to teal and rejects unknown values', async () => {
	const harness = createWorkerHarness(stateWithSession(), [], {
		incognitoContext: true,
	});
	const initial = await harness.sendMessage({type: 'GET_PRIVATE_CONFIG'});
	assert.equal(initial.accent, 'teal');

	const rejected = await harness.sendMessage({
		type: 'SET_PRIVATE_ACCENT',
		accent: 'chartreuse',
	});
	assert.equal(rejected.ok, false);

	const saved = await harness.sendMessage({
		type: 'SET_PRIVATE_ACCENT',
		accent: 'same',
	});
	assert.equal(saved.ok, true, saved.error);
	assert.equal(saved.accent, 'same');
	assert.equal(saved.configured, false);

	await harness.sendMessage({type: 'SET_PRIVATE_CONFIG', mode: 'saved'});
	const config = await harness.sendMessage({type: 'GET_PRIVATE_CONFIG'});
	assert.equal(config.accent, 'same');
});

test('concurrent new tabs retain separate hand-off claims', async () => {
	const harness = createWorkerHarness(
		stateWithSession({newTabEnabled: false}),
		[
			{id: 7, windowId: 10, index: 0, active: true, url: ''},
			{id: 8, windowId: 10, index: 1, active: false, url: ''},
		],
	);
	await Promise.all([
		harness.fire('tabCreated', {id: 7, pendingUrl: 'chrome://newtab/'}),
		harness.fire('tabCreated', {id: 8, pendingUrl: 'chrome://newtab/'}),
	]);
	for (const tab of harness.tabs) {
		const result = await harness.sendMessage({type: 'HANDOFF_NEW_TAB'}, {tab});
		assert.equal(result.handedOff, true, `tab ${tab.id} retains its claim`);
	}
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
		await harness.fire('tabCreated', {id: 7, pendingUrl: 'chrome://newtab/'});
		assert.equal(harness.tabs[0].url, url);
	}
});

test('resetting settings restores the defaults', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const changed = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {newTabEnabled: false, includePinnedTabs: true},
	});
	assert.equal(changed.ok, true);
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(response.settings.newTabEnabled, false);
	const reset = await harness.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.newTabEnabled, true);
	assert.equal(reset.settings.includePinnedTabs, false);
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

const windowTabs: MockTab[] = [
	{
		id: 1,
		windowId: 10,
		index: 0,
		active: true,
		url: 'https://one.example/',
		title: 'One',
	},
	{
		id: 2,
		windowId: 10,
		index: 1,
		active: false,
		pinned: true,
		url: 'https://pinned.example/',
		title: 'Pinned',
	},
	{
		id: 3,
		windowId: 10,
		index: 2,
		active: false,
		url: 'https://saved.example/article',
		title: 'Also saved',
	},
];

test('SWITCH_WORKSPACE saves the window, opens the chosen session there, and closes the saved tabs', async () => {
	const harness = createWorkerHarness(
		stateWithSession({openDashboardAfterSave: false}),
		windowTabs,
	);
	const response = await harness.sendMessage({
		type: 'SWITCH_WORKSPACE',
		groupId: 'session-1',
	});

	assert.equal(response.ok, true, response.error);
	assert.equal(response.saved, 2);
	assert.equal(response.count, 1);
	assert.equal(response.closed, 2);
	const saved = harness.state.groups.find(
		(group) => group.id === response.savedGroupId,
	)!;
	assert.deepEqual(
		saved.tabs.map((tab) => tab.url),
		['https://one.example/', 'https://saved.example/article'],
	);
	assert.equal(harness.createdWindows.length, 0);
	assert.deepEqual(
		harness.openedTabs.map((tab) => [tab.windowId, tab.url]),
		[[10, 'https://saved.example/article']],
		'the chosen session opens in the same window even though one of its URLs is already open',
	);
	assert.deepEqual(
		harness.removedTabIds.toSorted((a, b) => a - b),
		[1, 3],
	);
});

test('SWITCH_WORKSPACE does not save the window again when a saved session already has exactly those pages', async () => {
	const state = stateWithSession({openDashboardAfterSave: false});
	state.groups.push({
		id: 'same-as-window',
		name: 'Same as the window',
		tabs: [
			{id: 'a', url: 'https://saved.example/article', title: 'Article'},
			{id: 'b', url: 'https://one.example/', title: 'One'},
		],
	});
	const harness = createWorkerHarness(state, windowTabs);
	const before = harness.state.groups.length;
	const response = await harness.sendMessage({
		type: 'SWITCH_WORKSPACE',
		groupId: 'session-1',
	});

	assert.equal(response.ok, true, response.error);
	assert.equal(response.saved, 0);
	assert.equal(response.savedGroupId, 'same-as-window');
	assert.equal(harness.state.groups.length, before, 'no duplicate session');
	assert.equal(response.closed, 2, 'the window still switches over');
});

test('SWITCH_WORKSPACE keeps the window open when the chosen session cannot be restored', async () => {
	const harness = createWorkerHarness(
		stateWithSession({openDashboardAfterSave: false}),
		windowTabs,
	);
	harness.state.groups[0].tabs[0].url = 'chrome://settings/';
	const response = await harness.sendMessage({
		type: 'SWITCH_WORKSPACE',
		groupId: 'session-1',
	});

	assert.equal(response.ok, false);
	assert.deepEqual(harness.removedTabIds, []);
});

test('SWITCH_WORKSPACE reports a session that no longer exists without touching the window', async () => {
	const harness = createWorkerHarness(stateWithSession(), windowTabs);
	const response = await harness.sendMessage({
		type: 'SWITCH_WORKSPACE',
		groupId: 'missing',
	});

	assert.equal(response.ok, false);
	assert.equal(harness.state.groups.length, 1);
	assert.deepEqual(harness.removedTabIds, []);
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

test('emptyWindowAfterSave close-extra closes an emptied window when another window is open', async () => {
	const tab = {
		id: 1,
		windowId: 10,
		index: 0,
		active: true,
		url: 'https://only.example/',
		title: 'Only',
	};
	const other = {
		id: 2,
		windowId: 21,
		index: 0,
		active: true,
		url: 'https://other.example/',
		title: 'Other',
	};
	const run = async (
		emptyWindowAfterSave: 'new-tab' | 'close-extra',
		extraWindows: number[],
	) => {
		const harness = createWorkerHarness(
			stateWithSession({
				closeOnSave: true,
				openDashboardAfterSave: false,
				emptyWindowAfterSave,
			}),
			extraWindows.length > 0 ? [tab, other] : [tab],
			{extraWindows},
		);
		const response = await harness.sendMessage({
			type: 'SAVE_TABS',
			scope: 'window',
		});
		assert.equal(response.ok, true, response.error);
		return harness;
	};

	const closing = await run('close-extra', [21]);
	assert.equal(
		closing.windows.some((win) => win.id === 10),
		false,
		'the emptied window closes',
	);
	assert.equal(
		closing.windowUpdates.some(
			(update) =>
				update.id === 21 && (update.properties as {focused?: boolean}).focused,
		),
		true,
		'the other window is focused',
	);
	assert.equal(closing.tabsForWindow(21).length, 1, 'no new tab is opened');

	const lastWindow = await run('close-extra', []);
	assert.equal(
		lastWindow.windows.some((win) => win.id === 10),
		true,
	);
	assert.equal(lastWindow.tabsForWindow(10).length, 1, 'keeps a new tab');

	const keeping = await run('new-tab', [21]);
	assert.equal(
		keeping.windows.some((win) => win.id === 10),
		true,
	);
	assert.equal(keeping.tabsForWindow(10).length, 1);
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

test('the toolbar action switches the toolbar icon between popup and side panel', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const result = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {actionMode: 'sidepanel'},
	});
	assert.equal(result.ok, true);
	assert.equal(harness.state.settings.actionMode, 'sidepanel');
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
		settings: {actionMode: 'popup'},
	});
	assert.equal(last('setPanelBehavior')?.value.openPanelOnActionClick, false);
	assert.equal(harness.popupCalls.at(-1), 'popup.html');
});

test('the toolbar action migrates its legacy side panel settings', async () => {
	const bad = createWorkerHarness({
		...stateWithSession(),
		settings: {toolbarOpens: 'dock'},
	});
	assert.equal(
		(await bad.sendMessage({type: 'GET_STATE'})).settings.actionMode,
		'popup',
	);
	const legacy = createWorkerHarness({
		...stateWithSession(),
		settings: {sidePanelEnabled: true},
	});
	assert.equal(
		(await legacy.sendMessage({type: 'GET_STATE'})).settings.actionMode,
		'sidepanel',
	);
	const oldToolbarChoice = createWorkerHarness({
		...stateWithSession(),
		settings: {actionMode: 'popup', toolbarOpens: 'sidepanel'},
	} as never);
	assert.equal(
		(await oldToolbarChoice.sendMessage({type: 'GET_STATE'})).settings
			.actionMode,
		'sidepanel',
	);
});

test('the toggle-side-panel command opens the side panel for the window', async () => {
	const harness = createWorkerHarness(stateWithSession());
	await harness.fire('onCommand', 'toggle-side-panel', {id: 1, windowId: 7});
	assert.deepEqual(structuredClone(harness.sidePanelOpened), [{windowId: 7}]);
});

test('Firefox restores into a new window that starts blank, then removes that bootstrap tab', async () => {
	const harness = createWorkerHarness(
		stateWithSession({restoreTarget: 'always-new-window'}),
		undefined,
		{firefox: true},
	);
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(harness.windowCreateCalls[0].url, 'about:blank');
	assert.equal(harness.createdWindows.length, 1);
	assert.equal(harness.openedTabs[0].windowId, harness.createdWindows[0].id);
	assert.equal(harness.removedTabIds.length, 1, 'the bootstrap tab is removed');
});

const REDDIT_ICON = 'data:image/png;base64,iVBORw0KGgo=';
const SITE_ICONS = 'tablodge.siteIcons';
const iconTab = (url: string, extra: Record<string, unknown> = {}) =>
	({id: 1, windowId: 10, index: 0, active: true, url, ...extra}) as MockTab;

test('Firefox remembers the icon of each site a tab shows, by host', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		firefox: true,
	});
	await harness.fire(
		'tabUpdated',
		1,
		{favIconUrl: REDDIT_ICON},
		iconTab('https://www.reddit.com/r/typescript/', {favIconUrl: REDDIT_ICON}),
	);
	await harness.fire(
		'tabUpdated',
		1,
		{status: 'complete'},
		iconTab('https://www.reddit.com/', {favIconUrl: REDDIT_ICON}),
	);
	assert.deepEqual(harness.extraStorage[SITE_ICONS], {
		'www.reddit.com': REDDIT_ICON,
	});
});

test('Firefox skips private tabs and icons that are a web address', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		firefox: true,
	});
	await harness.fire(
		'tabUpdated',
		1,
		{favIconUrl: REDDIT_ICON},
		iconTab('https://private.example/', {
			favIconUrl: REDDIT_ICON,
			incognito: true,
		}),
	);
	await harness.fire(
		'tabUpdated',
		1,
		{favIconUrl: 'https://web.example/favicon.ico'},
		iconTab('https://web.example/', {
			favIconUrl: 'https://web.example/favicon.ico',
		}),
	);
	assert.equal(harness.extraStorage[SITE_ICONS], undefined);
});

test('Chromium keeps no icon cache of its own', async () => {
	const harness = createWorkerHarness(stateWithSession());
	await harness.fire(
		'tabUpdated',
		1,
		{favIconUrl: REDDIT_ICON},
		iconTab('https://www.reddit.com/', {favIconUrl: REDDIT_ICON}),
	);
	assert.equal(harness.extraStorage[SITE_ICONS], undefined);
});

test('Firefox keeps an emptied window open on the new tab page without naming a browser address', async () => {
	const harness = createWorkerHarness(
		stateWithSession({
			closeOnSave: true,
			openDashboardAfterSave: false,
			emptyWindowAfterSave: 'new-tab',
		}),
		undefined,
		{firefox: true},
	);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(harness.tabsForWindow(10).length, 1, 'the window keeps a tab');
});

test('Firefox shows the popup for the side panel toolbar mode and opens its sidebar from commands and the menu', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		firefox: true,
	});
	const result = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {actionMode: 'sidepanel'},
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(harness.popupCalls.at(-1), 'popup.html');
	assert.equal(harness.sidePanelCalls.length, 0);

	await harness.fire('onInstalled', {reason: 'update'});
	await new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
	await harness.fire('onCommand', 'toggle-side-panel', {id: 1, windowId: 7});
	assert.equal(harness.sidebarOpened(), 1);
	assert.equal(harness.sidePanelOpened.length, 0);

	await harness.fire(
		'contextMenuClicked',
		{
			menuItemId: 'tablodge-action-side-panel',
		},
		{id: 1, windowId: 7},
	);
	assert.equal(harness.sidebarOpened(), 2);
	assert.equal(
		harness.menuItems.some((item) => item.id === 'tablodge-action-side-panel'),
		true,
		'the toolbar menu offers the sidebar',
	);
});

test('Firefox always keeps the new-tab page on, since it cannot hand a new tab on', async () => {
	const firefox = createWorkerHarness(
		stateWithSession({newTabEnabled: false}),
		undefined,
		{firefox: true},
	);
	assert.equal(
		(await firefox.sendMessage({type: 'GET_STATE'})).settings.newTabEnabled,
		true,
	);
	const chromium = createWorkerHarness(
		stateWithSession({newTabEnabled: false}),
	);
	assert.equal(
		(await chromium.sendMessage({type: 'GET_STATE'})).settings.newTabEnabled,
		false,
	);
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

test('an imported source column keeps its id and joins the one already here', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const file = (url: string) => ({
		format: 'tablodge',
		version: 1,
		bookmarkColumns: [
			{id: 'source-reddit', name: 'Reddit', icon: 'message-circle'},
			{id: 'source-mastodon', name: 'Mastodon'},
		],
		bookmarks: [
			{title: 'Post', url, columnId: 'source-reddit'},
			{title: 'Toot', url: `${url}toot`, columnId: 'source-mastodon'},
		],
	});
	const first = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: file('https://www.reddit.com/r/a/comments/1/'),
	});
	assert.equal(first.ok, true, first.error);
	const second = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: file('https://www.reddit.com/r/a/comments/2/'),
	});
	assert.equal(second.ok, true, second.error);
	assert.deepEqual(
		harness.state.bookmarkColumns
			.map((column) => String(column.id))
			.filter((id) => id.startsWith('source-')),
		['source-reddit', 'source-mastodon'],
	);
	assert.deepEqual(
		harness.state.bookmarks
			.filter((bookmark) => bookmark.title === 'Post')
			.map((bookmark) => bookmark.columnId),
		['source-reddit', 'source-reddit'],
	);
});

test('imported duplicate Archived folders keep their sessions archived', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const response = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: {
			folders: [
				{id: 'archive-first', name: 'Archived'},
				{id: 'archive-duplicate', name: 'archived'},
			],
			groups: [
				{
					name: 'Imported archived session',
					folderId: 'archive-duplicate',
					tabs: [
						{
							title: 'Archived note',
							url: 'https://archived-import.example/',
						},
					],
				},
			],
		},
	});
	const archivedId = harness.state.folders.find(
		(folder) => folder.name === 'Archived',
	)?.id;

	assert.equal(response.ok, true, response.error);
	assert.equal(
		harness.state.groups.find(
			(group) => group.name === 'Imported archived session',
		)?.folderId,
		archivedId,
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

test('a bookmark note is saved, changed, cleared, and imported', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {
			title: 'Noted',
			url: 'https://noted.example/',
			notes: '  Why I saved it  ',
		},
	});
	assert.equal(added.ok, true, added.error);
	const id = String(harness.state.bookmarks[0].id);
	assert.equal(harness.state.bookmarks[0].notes, 'Why I saved it');

	const kept = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK',
		bookmarkId: id,
		fields: {title: 'Renamed'},
	});
	assert.equal(kept.ok, true, kept.error);
	assert.equal(harness.state.bookmarks[0].notes, 'Why I saved it');

	await harness.sendMessage({
		type: 'UPDATE_BOOKMARK',
		bookmarkId: id,
		fields: {notes: ' '},
	});
	assert.equal('notes' in harness.state.bookmarks[0], false);

	const imported = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: {
			bookmarks: [{url: 'https://imported.example/', notes: 'From a file'}],
		},
	});
	assert.equal(imported.ok, true, imported.error);
	assert.equal(harness.state.bookmarks.at(-1)?.notes, 'From a file');
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
	assert.equal(
		shouldBlockDocumentDrop(
			event([SESSION_DRAG_TYPE, 'text/uri-list'], {defaultPrevented: true}),
		),
		false,
	);
	assert.equal(
		shouldBlockDocumentDrop(event([SESSION_DRAG_TYPE, 'text/uri-list'])),
		true,
	);
	assert.equal(shouldBlockDocumentDrop(event(['text/uri-list'])), true);
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

test('save duplicates can be allowed or rejected and forced in, with existing or latest title', async () => {
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
	assert.deepEqual([...latestResult.rejectedTabIds], [1]);
	assert.deepEqual(
		[...latest.removedTabIds],
		[2],
		'the rejected duplicate stays open, the new tab closes',
	);

	const forced = await latest.sendMessage({
		type: 'SAVE_TABS',
		scope: 'all-windows',
		tabIds: [...latestResult.rejectedTabIds],
		allowDuplicates: true,
	});
	assert.equal(forced.ok, true, forced.error);
	assert.equal(forced.count, 1);
	assert.equal(forced.skipped, 0);
	assert.equal(forced.rejectedTabIds.length, 0);
	assert.equal(latest.state.groups.length, 3);
});

test('writeClipboard writes HTML beside plain text when the browser allows it, else plain text only', async () => {
	const {writeClipboard} = await import('../src/app/interaction-actions');
	const rich = {
		text: 'Reading <list>\nhttps://a.example/?x=1&y=2',
		html: '<h3>Reading &lt;list&gt;</h3>',
	};

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
	assert.deepEqual(texts, [rich.text]);
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

test('explicit quick-popup tab picks are saved whether or not they are highlighted, and other highlighted tabs are left out', async () => {
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
			highlighted: true,
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

test('a single tab dragged out of a session keeps its title when dropped', async () => {
	const {buildLinkDragData, parseDraggedLink} =
		await import('../src/app/interaction-actions');
	const data = buildLinkDragData([
		{title: 'My saved title', url: 'https://a.example/page'},
	])!;
	const globals = globalThis as {DOMParser?: unknown};
	const original = globals.DOMParser;
	globals.DOMParser = class {
		parseFromString(html: string) {
			const match = /<a href="([^"]*)">([^<]*)<\/a>/.exec(html);
			return {
				querySelector: () =>
					match && {
						getAttribute: () => match[1],
						textContent: match[2],
					},
			};
		}
	};
	let link;
	try {
		link = parseDraggedLink({getData: (type: string) => data[type] ?? ''});
	} finally {
		globals.DOMParser = original;
	}

	assert.deepEqual(link, {
		url: 'https://a.example/page',
		title: 'My saved title',
	});
});

test('a multi-bookmark drag exposes every selected link to session drop targets', async () => {
	const {
		BOOKMARK_DRAG_TYPE,
		SESSION_DRAG_TYPE,
		buildLinkDragData,
		parseDroppedLinks,
	} = await import('../src/app/interaction-actions');
	const links = [
		{title: 'First', url: 'https://first.example/'},
		{title: 'Second', url: 'https://second.example/'},
	];
	const sessionPayload = buildLinkDragData(links, '2 selected bookmarks')!;
	const data = {
		types: [BOOKMARK_DRAG_TYPE, SESSION_DRAG_TYPE, 'text/uri-list'],
		getData(type: string) {
			if (type === SESSION_DRAG_TYPE) {
				return sessionPayload[SESSION_DRAG_TYPE];
			}

			return type === 'text/uri-list' ? links[0].url : '';
		},
	};

	assert.deepEqual(parseDroppedLinks(data), links);
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
		sessionSort: 'oldest',
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
	{id: 'unfiled', name: 'Unfiled', icon: undefined, isDefault: true},
	{
		id: 'archived-sessions',
		name: 'Archived',
		icon: 'archive',
		isDefault: false,
	},
];
const summarizeFolders = (folders: StoredState['folders']) =>
	folders.map(({id, name, icon, isDefault}) => ({id, name, icon, isDefault}));
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
	assert.deepEqual(summarizeFolders(harness.state.folders), freshFolders);
	assert.equal(harness.state.bookmarks.length, 3);
	assert.deepEqual(
		harness.state.bookmarkColumns.map((column) => column.id),
		['column-news'],
	);
	assert.deepEqual(harness.state.settings.excludedOrigins, ['private.example']);
	assert.equal(harness.state.settings.sessionSort, 'oldest');
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
		settings: {sessionSort: 'oldest'},
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
	assert.notEqual(harness.state.settings.sessionSort, 'oldest');
	await harness.sendMessage({type: 'UNDO', id: reset.undoId});
	assert.equal(harness.state.settings.sessionSort, 'oldest');
});

test('ADD_BOOKMARKS skips links already in the column and reports them', async () => {
	const state = stateWithSession();
	state.bookmarks = [];
	const harness = createWorkerHarness(state);
	const columnId = 'bookmark-unfiled';
	const first = await harness.sendMessage({
		type: 'ADD_BOOKMARKS',
		columnId,
		bookmarks: [{url: 'https://example.com/a', title: 'A'}],
	});
	assert.equal(first.ok, true, first.error);
	const mixed = await harness.sendMessage({
		type: 'ADD_BOOKMARKS',
		columnId,
		bookmarks: [
			{url: 'https://example.com/a', title: 'A'},
			{url: 'https://example.com/b', title: 'B'},
		],
	});
	assert.equal(mixed.ok, true, mixed.error);
	assert.equal(mixed.count, 1);
	assert.equal(mixed.skipped, 1);
	const again = await harness.sendMessage({
		type: 'ADD_BOOKMARKS',
		columnId,
		bookmarks: [{url: 'https://example.com/a', title: 'A'}],
	});
	assert.equal(again.ok, false);
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

	assert.equal(undoRecordsOf(harness).length, 3);
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
		['unfiled', 'folder-work', 'archived-sessions'],
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
	assert.deepEqual(summarizeFolders(harness.state.folders), freshFolders);
	assert.deepEqual(harness.state.bookmarks, []);
	assert.deepEqual(harness.state.bookmarkColumns, freshColumns);
	assert.deepEqual(harness.state.settings.excludedOrigins, ['private.example']);
	assert.equal(harness.state.settings.sessionSort, 'oldest');

	const invalid = await harness.sendMessage({
		type: 'ERASE_DATA',
		scope: 'everything' as 'all',
	});
	assert.equal(invalid.ok, false);
});

test('null stored settings are treated as defaults', async () => {
	const harness = createWorkerHarness({
		...stateWithSession(),
		settings: null,
	} as unknown as StoredState);
	const result = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.settings.restoreTarget, 'new-window-unless-only-tab');
	assert.equal(result.groups.length, 1);
});

test('install opens a dashboard tab, but extension updates do not', async () => {
	const installed = createWorkerHarness(stateWithSession());
	await installed.fire('onInstalled', {reason: 'install'});
	assert.equal(installed.openedTabs.length, 1);
	assert.equal(
		installed.openedTabs[0].url,
		'chrome-extension://tablodge/newtab.html',
	);
	assert.equal(installed.openedTabs[0].active, true);

	const updated = createWorkerHarness(stateWithSession());
	await updated.fire('onInstalled', {reason: 'update'});
	assert.equal(updated.openedTabs.length, 0);
});

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

test('restore duplicate skipping opens a lone half without splitting', async () => {
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

for (const [key, fallback] of [
	['expandSessionsByDefault', false],
	['pasteLinkToBookmark', true],
	['removeTrackingParameters', false],
	['showSaveWindowButton', true],
	['showTrashBinButton', false],
	['linkPreviews', false],
	['showAllBookmarks', true],
	['showSessionFaviconPreviews', true],
	['stretchBookmarkColumns', true],
	['limitBookmarksPerColumn', true],
] as const) {
	test(`${key} is ${fallback ? 'on' : 'off'} by default, only an explicit ${String(!fallback)} changes it, and it resets`, async () => {
		const readStored = async (stored: unknown) =>
			(
				await createWorkerHarness(
					stateWithSession({[key]: stored}),
				).sendMessage({type: 'GET_STATE'})
			).settings[key];
		const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
		assert.equal(
			(await defaults.sendMessage({type: 'GET_STATE'})).settings[key],
			fallback,
		);
		assert.equal(await readStored(fallback ? 0 : 'yes'), fallback);
		assert.equal(await readStored(!fallback), !fallback, 'explicit is kept');

		const updated = await defaults.sendMessage({
			type: 'UPDATE_SETTINGS',
			settings: {[key]: !fallback},
		});
		assert.equal(updated.ok, true, updated.error);
		assert.equal(defaults.state.settings[key], !fallback);
		const reset = await defaults.sendMessage({type: 'RESET_SETTINGS'});
		assert.equal(reset.settings[key], fallback);
	});
}

test('Site icons is Through my server by default, keeps only Browser only, and resets', async () => {
	const read = async (stored: unknown) =>
		(
			await createWorkerHarness(
				stateWithSession({siteIcons: stored}),
			).sendMessage({type: 'GET_STATE'})
		).settings.siteIcons;
	assert.equal(await read(undefined), 'server');
	assert.equal(await read('direct'), 'server');
	assert.equal(await read('browser'), 'browser');
	const harness = createWorkerHarness(stateWithSession({siteIcons: 'browser'}));
	const reset = await harness.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.siteIcons, 'server');
});

test('bookmark column batch size defaults to sixteen, is clamped, and resets', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	assert.equal(
		(await defaults.sendMessage({type: 'GET_STATE'})).settings
			.bookmarkColumnPageSize,
		16,
	);

	const configured = await defaults.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {bookmarkColumnPageSize: 42},
	});
	assert.equal(configured.ok, true, configured.error);
	assert.equal(defaults.state.settings.bookmarkColumnPageSize, 42);

	const invalid = createWorkerHarness(
		stateWithSession({bookmarkColumnPageSize: 'many'}),
	);
	assert.equal(
		(await invalid.sendMessage({type: 'GET_STATE'})).settings
			.bookmarkColumnPageSize,
		16,
	);
	const tooSmall = createWorkerHarness(
		stateWithSession({bookmarkColumnPageSize: 0}),
	);
	assert.equal(
		(await tooSmall.sendMessage({type: 'GET_STATE'})).settings
			.bookmarkColumnPageSize,
		1,
	);
	const tooLarge = createWorkerHarness(
		stateWithSession({bookmarkColumnPageSize: 501}),
	);
	assert.equal(
		(await tooLarge.sendMessage({type: 'GET_STATE'})).settings
			.bookmarkColumnPageSize,
		500,
	);
	assert.equal(
		(await defaults.sendMessage({type: 'RESET_SETTINGS'})).settings
			.bookmarkColumnPageSize,
		16,
	);
});

test('link, quick-action, ordering and pin settings normalize with defaults', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	const s = (await defaults.sendMessage({type: 'GET_STATE'})).settings;
	assert.equal(s.bookmarkClickAction, 'current');
	assert.equal(s.sessionLinkClickAction, 'new');
	assert.deepEqual(Array.from(s.bookmarkQuickActions), ['open-new']);
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
			bookmarkQuickActions: [
				'copy',
				'bad',
				'copy',
				'edit',
				'delete',
				'open-new',
			],
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
	assert.deepEqual(Array.from(j.bookmarkQuickActions), [
		'copy',
		'edit',
		'delete',
	]);
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

test('quick actions migrate old preferences and accept up to three selected actions', async () => {
	const legacy = createWorkerHarness(
		stateWithSession({
			showBookmarkQuickActions: true,
			bookmarkQuickAction: 'copy',
		}),
	);
	assert.deepEqual(
		Array.from(
			(await legacy.sendMessage({type: 'GET_STATE'})).settings
				.bookmarkQuickActions,
		),
		['copy'],
	);

	const harness = createWorkerHarness(stateWithSession());
	const selected = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {
			bookmarkQuickActions: ['move-up', 'move-down', 'move', 'copy'],
		},
	});
	assert.deepEqual(Array.from(selected.settings.bookmarkQuickActions), [
		'move-up',
		'move-down',
		'move',
	]);

	const cleared = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {bookmarkQuickActions: []},
	});
	assert.deepEqual(Array.from(cleared.settings.bookmarkQuickActions), []);
});

test('session quick actions default to Archive and migrate the old switches', async () => {
	const actionsFrom = async (settings: Record<string, unknown>) =>
		Array.from(
			(
				await createWorkerHarness(stateWithSession(settings)).sendMessage({
					type: 'GET_STATE',
				})
			).settings.sessionQuickActions,
		);

	assert.deepEqual(await actionsFrom({}), ['archive']);
	assert.deepEqual(
		await actionsFrom({
			showSessionArchiveQuickAction: false,
			showSessionDeleteQuickAction: true,
		}),
		['delete'],
	);
	assert.deepEqual(await actionsFrom({showSessionDeleteQuickAction: true}), [
		'archive',
		'delete',
	]);

	const harness = createWorkerHarness(stateWithSession());
	const selected = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {
			sessionQuickActions: [
				'share',
				'edit',
				'move-up',
				'move-down',
				'switch-to',
				'delete',
				'unknown',
				'share',
			],
		} as unknown as Partial<Settings>,
	});
	assert.deepEqual(Array.from(selected.settings.sessionQuickActions), [
		'share',
		'edit',
		'move-up',
		'move-down',
		'switch-to',
	]);

	const cleared = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {sessionQuickActions: []},
	});
	assert.deepEqual(Array.from(cleared.settings.sessionQuickActions), []);
	const reset = await harness.sendMessage({type: 'RESET_SETTINGS'});
	assert.deepEqual(Array.from(reset.settings.sessionQuickActions), ['archive']);
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

test('dashboardWidth defaults to the existing layout, validates choices, and resets', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	assert.equal(
		(await defaults.sendMessage({type: 'GET_STATE'})).settings.dashboardWidth,
		'default',
	);

	for (const width of ['wider', 'full', 'narrower'] as const) {
		const configured = createWorkerHarness(
			stateWithSession({dashboardWidth: width}),
		);
		assert.equal(
			(await configured.sendMessage({type: 'GET_STATE'})).settings
				.dashboardWidth,
			width,
		);
	}

	const invalid = createWorkerHarness(
		stateWithSession({dashboardWidth: 'giant'}),
	);
	assert.equal(
		(await invalid.sendMessage({type: 'GET_STATE'})).settings.dashboardWidth,
		'default',
	);

	const updated = await invalid.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {dashboardWidth: 'full'},
	});
	assert.equal(updated.ok, true, updated.error);
	assert.equal(invalid.state.settings.dashboardWidth, 'full');

	const reset = await invalid.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.dashboardWidth, 'default');
});

test('bookmarkBoardView defaults to focus, validates choices, and resets', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	assert.equal(
		(await defaults.sendMessage({type: 'GET_STATE'})).settings
			.bookmarkBoardView,
		'focus',
	);

	const configured = createWorkerHarness(
		stateWithSession({bookmarkBoardView: 'board'}),
	);
	assert.equal(
		(await configured.sendMessage({type: 'GET_STATE'})).settings
			.bookmarkBoardView,
		'board',
	);

	const invalid = createWorkerHarness(
		stateWithSession({bookmarkBoardView: 'deck'}),
	);
	assert.equal(
		(await invalid.sendMessage({type: 'GET_STATE'})).settings.bookmarkBoardView,
		'focus',
	);

	const updated = await invalid.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {bookmarkBoardView: 'board'},
	});
	assert.equal(updated.ok, true, updated.error);
	assert.equal(invalid.state.settings.bookmarkBoardView, 'board');

	const reset = await invalid.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.bookmarkBoardView, 'focus');
});

test('sessionFolderView defaults to auto, validates choices, and resets', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	assert.equal(
		(await defaults.sendMessage({type: 'GET_STATE'})).settings
			.sessionFolderView,
		'auto',
	);

	const invalid = createWorkerHarness(
		stateWithSession({sessionFolderView: 'grid'}),
	);
	assert.equal(
		(await invalid.sendMessage({type: 'GET_STATE'})).settings.sessionFolderView,
		'auto',
	);

	const updated = await invalid.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {sessionFolderView: 'list'},
	});
	assert.equal(updated.ok, true, updated.error);
	assert.equal(invalid.state.settings.sessionFolderView, 'list');

	const reset = await invalid.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.sessionFolderView, 'auto');
});

test('bookmark board layout settings default to the current layout, validate choices, and reset', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	const {settings} = await defaults.sendMessage({type: 'GET_STATE'});
	assert.equal(settings.bookmarkColumnWidth, 'default');
	assert.equal(settings.bookmarkColumnsPerRow, 0);
	assert.equal(settings.bookmarkDensity, 'comfortable');

	const configured = createWorkerHarness(
		stateWithSession({
			bookmarkColumnWidth: 'extra-wide',
			bookmarkColumnsPerRow: 4,
			bookmarkDensity: 'compact',
		}),
	);
	const kept = (await configured.sendMessage({type: 'GET_STATE'})).settings;
	assert.equal(kept.bookmarkColumnWidth, 'extra-wide');
	assert.equal(kept.bookmarkColumnsPerRow, 4);
	assert.equal(kept.bookmarkDensity, 'compact');

	const invalid = createWorkerHarness(
		stateWithSession({
			bookmarkColumnWidth: 'huge',
			bookmarkColumnsPerRow: 'many',
			bookmarkDensity: 'tight',
		}),
	);
	const fallback = (await invalid.sendMessage({type: 'GET_STATE'})).settings;
	assert.equal(fallback.bookmarkColumnWidth, 'default');
	assert.equal(fallback.bookmarkColumnsPerRow, 0);
	assert.equal(fallback.bookmarkDensity, 'comfortable');

	for (const [stored, expected] of [
		[-3, 0],
		[99, 6],
		[2.9, 2],
	] as const) {
		const clamped = createWorkerHarness(
			stateWithSession({bookmarkColumnsPerRow: stored}),
		);
		assert.equal(
			(await clamped.sendMessage({type: 'GET_STATE'})).settings
				.bookmarkColumnsPerRow,
			expected,
		);
	}

	const updated = await invalid.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {
			bookmarkColumnWidth: 'narrow',
			bookmarkColumnsPerRow: 3,
			bookmarkDensity: 'compact',
		},
	});
	assert.equal(updated.ok, true, updated.error);
	assert.equal(invalid.state.settings.bookmarkColumnWidth, 'narrow');
	assert.equal(invalid.state.settings.bookmarkColumnsPerRow, 3);
	assert.equal(invalid.state.settings.bookmarkDensity, 'compact');

	const reset = await invalid.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.bookmarkColumnWidth, 'default');
	assert.equal(reset.settings.bookmarkColumnsPerRow, 0);
	assert.equal(reset.settings.bookmarkDensity, 'comfortable');
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
		await import('../src/shared/import-formats');
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
		dev?.id,
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

test('CREATE_SESSION_FROM_LINKS builds a named session from web links, drops repeats and others, and undoes', async () => {
	const harness = createWorkerHarness(reorderState());
	const before = harness.state.groups.length;
	const result = await harness.sendMessage({
		type: 'CREATE_SESSION_FROM_LINKS',
		name: '  Reading list ',
		links: [
			{url: 'https://example.com/one', title: 'One'},
			{url: 'https://example.com/one', title: 'One again'},
			{url: 'chrome://settings', title: 'Settings'},
			{url: 'https://example.com/two', title: 'Two'},
		],
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.count, 2);
	assert.equal(result.skipped, 1);
	assert.equal(harness.state.groups.length, before + 1);
	const created = harness.state.groups.find(
		(group) => group.id === result.groupId,
	)!;
	assert.equal(created.name, 'Reading list');
	assert.deepEqual(
		created.tabs.map((tab) => tab.url),
		['https://example.com/one', 'https://example.com/two'],
	);

	const undo = await harness.sendMessage({type: 'UNDO', id: result.undoId!});
	assert.equal(undo.ok, true, undo.error);
	assert.equal(harness.state.groups.length, before);

	const none = await harness.sendMessage({
		type: 'CREATE_SESSION_FROM_LINKS',
		links: [{url: 'about:blank', title: ''}],
	});
	assert.equal(none.ok, false);
});

test('CREATE_SESSION_FROM_LINKS names an unnamed session by the session name settings, and previews that name', async () => {
	const harness = nameHarness({sessionNameStyle: 'title'}, []);
	const links = [
		{url: 'https://docs.example/a', title: 'Docs'},
		{url: 'https://docs.example/b', title: 'More docs'},
	];
	const preview = await harness.sendMessage({
		type: 'PREVIEW_SESSION_NAME',
		links,
	});
	assert.equal(preview.ok, true);
	assert.equal(preview.name, 'Docs');
	const result = await harness.sendMessage({
		type: 'CREATE_SESSION_FROM_LINKS',
		links,
		name: ' '.repeat(3),
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(
		harness.state.groups.find((group) => group.id === result.groupId)!.name,
		'Docs',
	);
});

test('ADD_LINKS_TO_SESSION inserts web links at the target, skips known addresses, and rejects others', async () => {
	const harness = createWorkerHarness(reorderState());
	const known = 'https://example.com/known';
	harness.state.groups.find((group) => group.id === 'B')!.tabs[0].url = known;
	const added = await harness.sendMessage({
		type: 'ADD_LINKS_TO_SESSION',
		groupId: 'B',
		targetTabId: 'b1',
		position: 'after',
		links: [
			{url: 'https://example.com/new', title: 'New page'},
			{url: known, title: 'Known'},
			{url: 'javascript:alert(1)', title: 'Bad'},
		],
	});
	assert.equal(added.ok, true, added.error);
	assert.equal(added.added, 1);
	assert.equal(added.skipped, 1);
	const {tabs} = harness.state.groups.find((group) => group.id === 'B')!;
	assert.deepEqual(
		tabs.map((t) => t.url === 'https://example.com/new'),
		[false, true, false],
	);

	const none = await harness.sendMessage({
		type: 'ADD_LINKS_TO_SESSION',
		groupId: 'B',
		links: [{url: 'chrome://settings', title: 'x'}],
	});
	assert.equal(none.ok, false);
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
		undefined,
		{tabEvents: true, manualTimers: true},
	);
	await harness.fire('onStartup');
	await harness.runTimers();
	assert.equal(pinnedLodges(harness, 10).length, 1);
	assert.equal(pinnedLodges(harness, 10)[0].active, false);

	harness.listeners.windowFocusChanged(10);
	await harness.runTimers();
	assert.equal(pinnedLodges(harness, 10).length, 1);

	const restored = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(restored.ok, true, restored.error);
	harness.listeners.windowCreated({id: 20, type: 'normal'});
	await harness.runTimers();
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
		{tabEvents: true, manualTimers: true},
	);
	await harness.fire('onStartup');
	await harness.runTimers();
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
	await harness.runTimers();
	assert.equal(pinnedLodges(harness, 10).length, 1);
});

test('keepLodgePinned recreates a closed tab once, then waits for window focus when the user closes it again quickly', async () => {
	const harness = createWorkerHarness(
		stateWithSession({keepLodgePinned: true}),
		undefined,
		{tabEvents: true, manualTimers: true},
	);
	await harness.fire('onStartup');
	await harness.runTimers();
	const close = async () => {
		const lodge = pinnedLodges(harness, 10)[0];
		const index = harness.tabs.indexOf(lodge);
		harness.tabs.splice(index, 1);
		harness.listeners.tabRemoved(lodge.id, {
			windowId: 10,
			isWindowClosing: false,
		});
		await harness.runTimers();
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
	await harness.runTimers();
	assert.equal(
		pinnedLodges(harness, 10).length,
		1,
		'focusing the window restores it',
	);
});

test('keepLodgePinned off leaves windows alone, and enabling it adds the pinned tab', async () => {
	const harness = createWorkerHarness(
		stateWithSession({keepLodgePinned: false}),
		undefined,
		{tabEvents: true, manualTimers: true},
	);
	await harness.fire('onStartup');
	harness.listeners.windowCreated({id: 10, type: 'normal'});
	await harness.runTimers();
	assert.equal(harness.openedTabs.length, 0);

	const enabled = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {keepLodgePinned: true},
	});
	assert.equal(enabled.ok, true, enabled.error);
	await harness.runTimers();
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

test('bookmark columns store a color from the accent palette and drop anything else', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const created = await harness.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'Reading',
		color: 'teal',
	});
	assert.equal(created.ok, true, created.error);
	assert.equal(created.column.color, 'teal');
	for (const [name, color] of [
		['Default one', 'default'],
		['System one', 'system'],
		['Odd one', 'chartreuse'],
		['Short hex', '#abc'],
		['Upper hex', '#ABCDEF'],
	] as const) {
		const made = await harness.sendMessage({
			type: 'CREATE_BOOKMARK_COLUMN',
			name,
			color,
		});
		assert.equal(made.ok, true, made.error);
		assert.equal('color' in made.column, false, `${name} stores no color`);
	}

	const custom = await harness.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'Custom',
		color: '#a1b2c3',
	});
	assert.equal(custom.column.color, '#a1b2c3');

	const renamed = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK_COLUMN',
		columnId: created.column.id,
		name: 'Reads',
	});
	assert.equal(renamed.column.color, 'teal');
	const swapped = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK_COLUMN',
		columnId: created.column.id,
		name: 'Reads',
		color: 'rose',
	});
	assert.equal(swapped.column.color, 'rose');
	const reset = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK_COLUMN',
		columnId: created.column.id,
		name: 'Reads',
		color: '',
	});
	assert.equal(reset.ok, true, reset.error);
	assert.equal('color' in reset.column, false);
});

test('stored column colors are validated on load and kept by imports', async () => {
	const state = stateWithSession();
	state.bookmarkColumns = [
		{id: 'bookmark-default', name: 'Bookmarks', color: 'bogus'},
		{id: 'column-a', name: 'Alpha', color: 'violet'},
		{id: 'column-b', name: 'Beta', color: '#102030'},
	];
	const harness = createWorkerHarness(state);
	const loaded = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(loaded.bookmarkColumns[0].color, undefined);
	assert.equal(loaded.bookmarkColumns[1].color, 'violet');
	assert.equal(loaded.bookmarkColumns[2].color, '#102030');
	const imported = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: {
			bookmarkColumns: [
				{id: 'x', name: 'Imported', color: 'green'},
				{id: 'y', name: 'Other', color: 'nope'},
			],
			bookmarks: [{url: 'https://a.example/', columnId: 'x'}],
		},
	});
	assert.equal(imported.ok, true, imported.error);
	const columns = harness.state.bookmarkColumns;
	assert.equal(
		columns.find((column) => column.name === 'Imported')?.color,
		'green',
	);
	assert.equal(
		columns.find((column) => column.name === 'Other')?.color,
		undefined,
	);
});

test('a column with domains takes matching bookmarks when none is chosen', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const dev = await harness.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'Dev',
		domains: ['https://www.GitHub.com/', 'github.com', 'nope', ''],
	});
	assert.equal(dev.ok, true, dev.error);
	assert.deepEqual([...dev.column.domains!], ['github.com']);
	const docs = await harness.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'Docs',
		domains: ['docs.github.com'],
	});

	const add = async (url: string) =>
		(await harness.sendMessage({type: 'ADD_BOOKMARK', bookmark: {url}}))
			.bookmark.columnId;
	assert.equal(await add('https://github.com/a'), dev.column.id);
	assert.equal(await add('https://gist.github.com/a'), dev.column.id);
	assert.equal(await add('https://docs.github.com/a'), docs.column.id);
	assert.notEqual(await add('https://notgithub.com/a'), dev.column.id);

	const repo = await harness.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'Mine',
		domains: ['https://github.com/bberka/?tab=x#y'],
	});
	assert.deepEqual([...repo.column.domains!], ['github.com/bberka']);
	assert.equal(await add('https://github.com/bberka'), repo.column.id);
	assert.equal(await add('https://github.com/bberka/TabLodge'), repo.column.id);
	assert.equal(await add('https://github.com/bberkaa/x'), dev.column.id);
	assert.equal(await add('https://github.com/other'), dev.column.id);

	const explicit = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {url: 'https://github.com/b', columnId: docs.column.id},
	});
	assert.equal(explicit.bookmark.columnId, docs.column.id);

	const kept = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK_COLUMN',
		columnId: dev.column.id,
		name: 'Dev',
	});
	assert.deepEqual([...kept.column.domains!], ['github.com']);
	const cleared = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK_COLUMN',
		columnId: dev.column.id,
		name: 'Dev',
		domains: [],
	});
	assert.equal('domains' in cleared.column, false);
});

test('stored column sites are normalized on load, as for columns that arrive from sync', async () => {
	const state = stateWithSession();
	state.bookmarkColumns = [
		{
			id: 'column-a',
			name: 'Alpha',
			domains: ['GitHub.com/bberka/', 'junk', 7, 'github.com/bberka?x=1'],
		},
		{id: 'column-b', name: 'Beta', domains: 'github.com'},
	] as unknown as typeof state.bookmarkColumns;
	const harness = createWorkerHarness(state);
	const loaded = await harness.sendMessage({type: 'GET_STATE'});
	const [alpha, beta] = loaded.bookmarkColumns;
	assert.deepEqual([...alpha.domains!], ['github.com/bberka']);
	assert.equal('domains' in beta, false);
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

test('a folder color is stored, validated and applied to sessions moved in only when the switch is on', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const created = await harness.sendMessage({
		type: 'CREATE_FOLDER',
		name: 'Work',
		color: 'blue',
		colorSessions: true,
	});
	assert.equal(created.ok, true, created.error);
	assert.equal(created.folder.color, 'blue');
	assert.equal(created.folder.colorSessions, true);
	const bad = await harness.sendMessage({
		type: 'CREATE_FOLDER',
		name: 'Bad',
		color: 'not-a-color',
	});
	assert.equal('color' in bad.folder, false);
	assert.equal('colorSessions' in bad.folder, false);

	const moved = await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-1',
		fields: {folderId: created.folder.id},
	});
	assert.equal(moved.group.color, 'blue');

	const other = await harness.sendMessage({
		type: 'CREATE_FOLDER',
		name: 'Other',
		color: 'red',
		colorSessions: true,
	});
	const explicit = await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-1',
		fields: {folderId: other.folder.id, color: ''},
	});
	assert.equal('color' in explicit.group, false);

	const off = await harness.sendMessage({
		type: 'UPDATE_FOLDER',
		folderId: other.folder.id,
		name: 'Other',
		colorSessions: false,
	});
	assert.equal(off.folder.color, 'red');
	assert.equal('colorSessions' in off.folder, false);
	const back = await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-1',
		fields: {folderId: created.folder.id},
	});
	assert.equal(back.group.color, 'blue');
	const unchanged = await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-1',
		fields: {folderId: other.folder.id},
	});
	assert.equal(unchanged.group.color, 'blue');
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

test('auto-archive moves stale sessions to the Archived folder and leaves recent ones', async () => {
	const state = stateWithSession({autoArchiveDays: 30});
	const old = state.groups[0];
	const day = 86_400_000;
	const recent = (id: string, extra: Record<string, number>) => ({
		...old,
		id,
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		...extra,
	});
	state.groups.push(
		recent('opened-recently', {lastOpenedAt: Date.now() - 5 * day}),
		recent('edited-recently', {updatedAt: Date.now() - 5 * day}),
		recent('opened-long-ago', {lastOpenedAt: Date.now() - 60 * day}),
	);
	const harness = createWorkerHarness(state);
	await harness.fire('alarm', {name: 'tablodge-archive'});
	const folderOf = (id: string) =>
		harness.state.groups.find((group) => group.id === id)?.folderId;
	const archived = harness.state.folders.find(
		(folder) => folder.name === 'Archived',
	);
	assert.ok(archived);
	assert.equal(folderOf('session-1'), archived.id);
	assert.equal(folderOf('opened-long-ago'), archived.id);
	assert.equal(folderOf('opened-recently'), 'unfiled');
	assert.equal(folderOf('edited-recently'), 'unfiled');
	assert.equal(harness.state.groups.length, 4, 'nothing is deleted');

	await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-1',
		fields: {folderId: 'unfiled'},
	});
	await harness.fire('alarm', {name: 'tablodge-archive'});
	assert.equal(folderOf('session-1'), 'unfiled');
	assert.equal(
		harness.state.folders.filter((folder) => folder.name === 'Archived').length,
		1,
	);
});

test('ARCHIVE_GROUP moves one session to Archived even when auto-archive is off', async () => {
	const state = stateWithSession({autoArchiveDays: 0});
	state.groups[0].createdAt = 1_700_000_000_000;
	state.groups[0].updatedAt = 1_700_000_000_000;
	state.groups.push({
		...state.groups[0],
		id: 'session-2',
		name: 'Keep here',
	});
	const harness = createWorkerHarness(state);
	const result = await harness.sendMessage({
		type: 'ARCHIVE_GROUP',
		groupId: 'session-1',
	});
	const archived = harness.state.folders.find(
		(folder) => folder.name === 'Archived',
	);

	assert.equal(result.ok, true);
	assert.equal(archived?.icon, 'archive');
	assert.equal(
		harness.state.groups.find((group) => group.id === 'session-1')?.folderId,
		archived?.id,
	);
	assert.equal(
		harness.state.groups.find((group) => group.id === 'session-2')?.folderId,
		'unfiled',
	);
	assert.equal(harness.state.groups.length, 2, 'nothing is deleted');
});

test('ARCHIVE_GROUP uses an existing Archived folder', async () => {
	const state = stateWithSession({autoArchiveDays: 0});
	state.folders.push({
		id: 'archived-existing',
		name: 'Archived',
		icon: 'archive',
		createdAt: 1,
		isDefault: false,
	});
	const harness = createWorkerHarness(state);
	const result = await harness.sendMessage({
		type: 'ARCHIVE_GROUP',
		groupId: 'session-1',
	});

	assert.equal(result.ok, true);
	assert.equal(result.group.folderId, 'archived-existing');
	assert.equal(
		harness.state.folders.filter((folder) => folder.name === 'Archived').length,
		1,
	);
});

test('auto-archive is off by default, runs at browser start, and its alarm follows the setting', async () => {
	const off = createWorkerHarness(stateWithSession(), undefined, {
		legacyLayout: true,
	});
	await off.fire('alarm', {name: 'tablodge-archive'});
	assert.equal(off.state.groups[0].folderId, 'unfiled');
	assert.equal(off.state.folders.length, 2);
	assert.equal(off.alarms.has('tablodge-archive'), false);

	const harness = createWorkerHarness(stateWithSession());
	const response = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoArchiveDays: 90},
	});
	assert.equal(response.settings.autoArchiveDays, 90);
	assert.equal(harness.alarms.has('tablodge-archive'), true);
	await harness.fire('onStartup');
	assert.equal(harness.state.groups[0].folderId, 'archived-sessions');

	const twentyOne = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoArchiveDays: 21},
	});
	assert.equal(twentyOne.settings.autoArchiveDays, 21);
	assert.equal(harness.alarms.has('tablodge-archive'), true);

	const custom = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoArchiveDays: 99_999},
	});
	assert.equal(custom.settings.autoArchiveDays, 3650);

	const invalid = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {autoArchiveDays: NaN},
	});
	assert.equal(invalid.settings.autoArchiveDays, 0);
	assert.equal(harness.alarms.has('tablodge-archive'), false);
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
	await harness.fire('tabUpdated', 1, {title: 'Renamed'}, {});
	assert.equal(harness.timers.size, 0);
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	assert.equal(historyOf(harness).length, 1);
	const rewritten = liveOf(harness)!;
	assert.equal(rewritten.sig, firstLive.sig);
	assert.equal(
		rewritten.id,
		firstLive.id,
		'identical live snapshot is left alone',
	);
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	assert.equal(historyOf(harness).length, 1);
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

test('startup restores the latest active session, not a newer archived session', async () => {
	const state = stateWithSession({
		openDashboardOnStartup: true,
		startupBehavior: 'last-session',
	});
	state.folders.push({
		id: 'archived-sessions',
		name: 'Archived',
		createdAt: 2,
	});
	const active = state.groups[0];
	assert.ok(active);
	const activeCreatedAt = active.createdAt ?? 0;
	state.groups.push({
		...structuredClone(active),
		id: 'archived-latest',
		name: 'Archived latest',
		folderId: 'archived-sessions',
		createdAt: activeCreatedAt + 1,
		tabs: [
			{
				...active.tabs[0],
				id: 'archived-tab',
				url: 'https://archived.example/',
			},
		],
	});
	const harness = createWorkerHarness(state);
	await harness.fire('onStartup');

	const [opened] = harness.openedTabs;
	assert.ok(opened);
	assert.equal(opened.url, 'https://saved.example/article');
});

test('startup opens the dashboard when every session is archived', async () => {
	const state = stateWithSession({
		openDashboardOnStartup: true,
		startupBehavior: 'last-session',
	});
	state.folders.push({
		id: 'archived-sessions',
		name: 'Archived',
		createdAt: 2,
	});
	state.groups[0].folderId = 'archived-sessions';
	const harness = createWorkerHarness(state);
	await harness.fire('onStartup');

	const [opened] = harness.openedTabs;
	assert.ok(opened);
	assert.ok(opened.url);
	assert.match(opened.url, /newtab\.html/);
});

test('startup removes the storage keys of the removed locked area and leaves the library alone', async () => {
	const keys = [
		'tablodge.locked',
		'tablodge.locked.key',
		'tablodge.locked.flag',
		'tablodge.locked.attempts',
	];
	const harness = createWorkerHarness(bookmarksState(), undefined, {
		storage: {
			'tablodge.locked': {version: 1, kind: 'pin', envelope: 'VExFTg=='},
			'tablodge.locked.attempts': {count: 1, until: 0},
			unrelated: 'kept',
		},
		sessionStorage: {
			'tablodge.locked.key': {key: 'AAAA', lastActive: 1},
			'tablodge.locked.flag': {unlocked: true},
			'tablodge.locked.attempts': {count: 1, until: 0},
		},
	});
	await harness.fire('onStartup');
	for (const key of keys) {
		assert.equal(harness.extraStorage[key], undefined, key);
		assert.equal(harness.sessionStore[key], undefined, key);
	}

	assert.equal(harness.extraStorage.unrelated, 'kept');
	assert.equal(harness.state.bookmarks.length, 3);
});

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

test('a 5,000-tab snapshot stays small', async () => {
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
	await harness.fire('alarm', {name: 'tablodge-snapshot'});
	const live = liveOf(harness)!;
	const size = JSON.stringify(live).length;
	assert.equal(
		live.windows.reduce((sum, win) => sum + win.tabs.length, 0),
		5000,
	);
	assert.ok(size < 1_200_000, `snapshot is ${size} characters`);
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

function duplicateBookmarksState(): StoredState {
	const state = bookmarksState(0);
	const add = (
		id: string,
		url: string,
		columnId: string,
		createdAt: number,
	) => {
		state.bookmarks.push({
			id,
			title: id,
			url,
			columnId,
			createdAt,
			updatedAt: createdAt,
		});
	};

	add('a-1', 'https://dup.example/', 'bookmark-default', 1);
	add('solo', 'https://solo.example/', 'bookmark-default', 2);
	add('a-2', 'https://dup.example/', 'col-news', 3);
	add('b-1', 'https://other.example/', 'col-news', 4);
	add('a-3', 'https://dup.example/', 'col-news', 5);
	return state;
}

test('REMOVE_DUPLICATE_BOOKMARKS trashes the extra copies and Undo restores them in place', async () => {
	const harness = createWorkerHarness(duplicateBookmarksState());
	const removed = await harness.sendMessage({
		type: 'REMOVE_DUPLICATE_BOOKMARKS',
		bookmarkIds: ['a-2', 'a-3'],
	});
	assert.equal(removed.ok, true, removed.error);
	assert.equal(removed.removed, 2);
	assert.equal(removed.trashIds.length, 2);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => bookmark.id),
		['a-1', 'solo', 'b-1'],
	);
	const trash = await harness.sendMessage({type: 'GET_TRASH'});
	assert.ok(trash.ok);
	assert.equal(trash.items.length, 2);
	assert.equal(trash.items[0].kind, 'bookmark');
	for (const id of removed.trashIds.toReversed()) {
		const restored = await harness.sendMessage({type: 'RESTORE_TRASH', id});
		assert.equal(restored.ok, true, restored.error);
	}

	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => bookmark.id),
		['a-1', 'solo', 'a-2', 'b-1', 'a-3'],
	);
	assert.equal(harness.state.bookmarks[2].columnId, 'col-news');
});

test('REMOVE_DUPLICATE_BOOKMARKS Undo keeps each column in its old order', async () => {
	const state = bookmarksState(0);
	const row = (
		id: string,
		url: string,
		columnId: string,
		createdAt: number,
	) => ({
		id,
		title: id,
		url,
		columnId,
		createdAt,
		updatedAt: createdAt,
	});
	state.bookmarks = [
		row('r1', 'https://r.example/', 'bookmark-default', 1),
		row('s1', 'https://s.example/', 'bookmark-default', 2),
		row('r2', 'https://r.example/', 'col-news', 3),
		row('d1', 'https://d.example/', 'bookmark-default', 4),
		row('d2', 'https://d.example/', 'col-news', 5),
		row('r3', 'https://r.example/', 'bookmark-default', 6),
	];
	const harness = createWorkerHarness(state);
	const removed = await harness.sendMessage({
		type: 'REMOVE_DUPLICATE_BOOKMARKS',
		bookmarkIds: ['r2', 'r3', 'd1'],
	});
	assert.equal(removed.ok, true, removed.error);
	for (const id of removed.trashIds.toReversed()) {
		await harness.sendMessage({type: 'RESTORE_TRASH', id});
	}

	for (const columnId of ['bookmark-default', 'col-news']) {
		assert.deepEqual(
			harness.state.bookmarks
				.filter((bookmark) => bookmark.columnId === columnId)
				.map((bookmark) => bookmark.id),
			state.bookmarks
				.filter((bookmark) => bookmark.columnId === columnId)
				.map((bookmark) => bookmark.id),
		);
	}
});

test('REMOVE_DUPLICATE_BOOKMARKS never removes the last copy of an address', async () => {
	const harness = createWorkerHarness(duplicateBookmarksState());
	const all = await harness.sendMessage({
		type: 'REMOVE_DUPLICATE_BOOKMARKS',
		bookmarkIds: ['a-1', 'a-2', 'a-3'],
	});
	assert.equal(all.ok, false);
	const single = await harness.sendMessage({
		type: 'REMOVE_DUPLICATE_BOOKMARKS',
		bookmarkIds: ['solo'],
	});
	assert.equal(single.ok, false);
	assert.equal(harness.state.bookmarks.length, 5);
	const trash = await harness.sendMessage({type: 'GET_TRASH'});
	assert.ok(trash.ok);
	assert.equal(trash.items.length, 0);
});

test('REMOVE_DUPLICATE_BOOKMARKS rejects unknown ids, repeated ids and oversized requests', async () => {
	const harness = createWorkerHarness(duplicateBookmarksState());
	for (const bookmarkIds of [
		['missing'],
		['a-2', 'a-2'],
		[],
		Array.from({length: 501}, (_, index) => `x${index}`),
	]) {
		const response = await harness.sendMessage({
			type: 'REMOVE_DUPLICATE_BOOKMARKS',
			bookmarkIds,
		});
		assert.equal(response.ok, false);
	}

	assert.equal(harness.state.bookmarks.length, 5);
});

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

test('adding a backup to the library merges it: both are kept, duplicates are skipped, settings stay', async () => {
	const mine = createWorkerHarness(bookmarksState(3));
	const before = mine.state.settings.closeOnSave;
	const theirsState = bookmarksState(5);
	theirsState.settings = {...theirsState.settings, closeOnSave: !before};
	theirsState.groups = [
		...theirsState.groups,
		{
			id: 'session-2',
			name: 'Other session',
			folderId: 'unfiled',
			createdAt: 1,
			updatedAt: 1,
			tabs: [
				{
					id: 'other-tab',
					title: 'Other page',
					url: 'https://other.example/page',
					pinned: false,
					originalIndex: 0,
				},
			],
		},
	];
	const theirs = createWorkerHarness(theirsState);
	await theirs.sendMessage({type: 'BACKUP_NOW'});
	const backup = JSON.parse(backupsOf(theirs).auto[0].json) as unknown;

	const merged = await mine.sendMessage({
		type: 'IMPORT_GROUPS',
		data: backup,
		importOptions: {duplicateMode: 'skip', titlePolicy: 'existing'},
	});
	assert.equal(merged.ok, true, merged.error);
	assert.equal(merged.groups, 1, 'only the session that was new');
	assert.equal(merged.bookmarks, 2, 'only the two bookmarks that were new');
	assert.ok(merged.skipped >= 4, 'the repeated tab and bookmarks are skipped');
	assert.deepEqual(
		mine.state.groups
			.map((group) => String(group.name))
			.toSorted((a, b) => a.localeCompare(b)),
		['Other session', 'Research'],
	);
	assert.equal(mine.state.bookmarks.length, 5);
	assert.equal(
		mine.state.settings.closeOnSave,
		before,
		'a merge never changes the settings',
	);
	assert.ok(merged.undoId);
	const undone = await mine.sendMessage({type: 'UNDO', id: merged.undoId});
	assert.equal(undone.ok, true, undone.error);
	assert.equal(mine.state.bookmarks.length, 3);
	assert.equal(mine.state.groups.length, 1);
});

test('importing a file takes every session in it, up to the library limit', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const groups = Array.from({length: 600}, (_, index) => ({
		name: `Imported ${index}`,
		tabs: [{url: `https://many${index}.example/`, title: `Page ${index}`}],
	}));
	const result = await harness.sendMessage({
		type: 'IMPORT_GROUPS',
		data: {groups},
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.groups, 600, 'no session past the 500th is dropped');
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
}, 30_000);

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
	harness.setStorageFailure(new Error('quota'), 'tablodge.backups');
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
		settings: {sessionSort: 'oldest'},
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
	assert.equal(
		harness.state.settings.sessionSort,
		'oldest',
		'settings are kept',
	);
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
		settings: {sessionSort: 'oldest', excludedOrigins: ['skip.example']},
	},
	preferences: {uiTheme: 'dark', uiAccent: '#12ab9f'},
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
		storage: {uiTheme: 'light', uiAccent: 'rose'},
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
	assert.equal(harness.state.settings.sessionSort, 'oldest');
	assert.deepEqual(harness.state.settings.excludedOrigins, ['skip.example']);
	assert.equal(harness.extraStorage.uiTheme, 'dark');
	assert.equal(harness.extraStorage.uiAccent, '#12ab9f');
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

test('RESTORE_FULL_BACKUP restores a phone-made backup, whose preferences, snapshots, and trash are empty', async () => {
	const harness = createWorkerHarness(bookmarksState(), undefined, {
		storage: {uiTheme: 'light', uiAccent: 'rose'},
	});
	const result = await harness.sendMessage(
		fullBackupInput({preferences: null, snapshots: null, trash: null}),
	);
	assert.equal(result.ok, true, result.error);
	assert.equal(result.bookmarks, 1);
	assert.equal(result.snapshots, 0);
	assert.equal(result.trash, 0);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => bookmark.id),
		['in-1'],
	);
	assert.equal(harness.extraStorage.uiTheme, 'light');
	assert.equal(harness.extraStorage.uiAccent, 'rose');
	assert.equal(trashOf(harness).length, 0);
});

test('RESTORE_FULL_BACKUP undo brings back the previous data', async () => {
	const harness = createWorkerHarness(bookmarksState(), undefined, {
		storage: {uiTheme: 'light', uiAccent: 'rose'},
	});
	const result = await harness.sendMessage(fullBackupInput());
	assert.equal(result.ok, true, result.error);
	const undone = await harness.sendMessage({type: 'UNDO', id: result.undoId!});
	assert.equal(undone.ok, true, undone.error);
	assert.equal(harness.state.bookmarks.length, 3);
	assert.equal(harness.state.groups.length, 1);
	assert.equal(harness.extraStorage.uiTheme, 'light');
	assert.equal(harness.extraStorage.uiAccent, 'rose');
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
			preferences: {uiTheme: '<script>', uiAccent: '<script>'},
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
	assert.equal(harness.extraStorage.uiAccent, 'default');
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
		storage: {uiTheme: 'dark', uiAccent: 'green'},
	});
	await harness.sendMessage({type: 'DELETE_BOOKMARK', bookmarkId: 'bm-0'});
	const result = await harness.sendMessage({type: 'GET_FULL_BACKUP'});
	assert.equal(result.ok, true, result.error);
	const state = result.state as {bookmarks: unknown[]; settings: unknown};
	assert.equal(state.bookmarks.length, 2);
	assert.equal(typeof state.settings, 'object');
	assert.deepEqual(structuredClone(result.preferences), {
		uiTheme: 'dark',
		uiAccent: 'green',
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
	assert.equal(folder.ok, true, folder.error);
	assert.ok(
		folder.undoId,
		'a folder delete is undone directly, not from the trash bin',
	);
	const trash = await harness.sendMessage({type: 'GET_TRASH'});
	assert.equal(
		trash.items.some((item) => item.kind === 'folder'),
		false,
	);
	const restored = await harness.sendMessage({
		type: 'RESTORE_TRASH',
		id: deleted.trashId!,
	});
	assert.equal(restored.ok, true, restored.error);
	assert.equal(restored.placed, 'Unfiled');
	assert.equal(harness.state.groups[0].folderId, 'unfiled');
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
	assert.equal(response.usage.images, 0);
	assert.equal(response.usage.imageBudget, 100_000_000);
});

test('undo paths: restore-and-remove, move between sessions and close-after-save are reversible', async () => {
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

test('the manifest asks for alarms up front and Downloads only as an optional permission', () => {
	assert.equal(manifest.permissions?.includes('alarms'), true);
	assert.equal(manifest.permissions?.includes('downloads'), false);
	assert.deepEqual(manifest.optional_permissions, ['downloads']);
});

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

	const plain = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'A',
		tabId: 'a3',
		toGroupId: 'B',
	});
	assert.equal(plain.trashId, undefined);
});

test('a capture of more tabs than one session holds becomes numbered sessions and loses nothing', async () => {
	const total = MAX_TABS_PER_SESSION * 2 + 500;
	const harness = createWorkerHarness(
		stateWithSession({closeOnSave: false}),
		manyTabs(total),
	);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.count, total);
	assert.equal(response.groups, 3);
	const saved = harness.state.groups.slice(0, 3);
	assert.deepEqual(
		saved.map((group) => group.tabs.length),
		[MAX_TABS_PER_SESSION, MAX_TABS_PER_SESSION, 500],
	);
	assert.match(String(saved[0].name), /\(1\/3\)$/);
	assert.match(String(saved[2].name), /\(3\/3\)$/);
	assert.equal(response.groupId, saved[0].id);
});

test('saving is refused with a clear error when it would exceed the session limit, and no tab is closed', async () => {
	const state = stateWithSession();
	state.groups = Array.from(
		{length: MAX_SESSIONS},
		(_, index) => filler(`s${index}`) as Session,
	);
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'window',
	});
	assert.equal(response.ok, false);
	assert.match(String(response.error), new RegExp(`${MAX_SESSIONS} sessions`));
	assert.equal(harness.removedTabIds.length, 0);
	assert.equal(harness.state.groups.length, MAX_SESSIONS);
}, 60_000);

test('adding into a full session is refused for a move and for saving the current tab', async () => {
	const state = reorderState();
	state.groups[0] = {
		...state.groups[0],
		...filler('A', MAX_TABS_PER_SESSION),
		updatedAt: 9_999_999_999_999,
	};
	const harness = createWorkerHarness(state);
	const moved = await harness.sendMessage({
		type: 'MOVE_TAB',
		fromGroupId: 'B',
		tabId: 'b1',
		toGroupId: 'A',
	});
	assert.equal(moved.ok, false);
	assert.match(
		String(moved.error),
		new RegExp(`${MAX_TABS_PER_SESSION} links`),
	);
	assert.deepEqual(tabIdsOf(harness.state, 'B'), ['b1', 'b2']);

	const saved = await harness.sendMessage({type: 'SAVE_CURRENT_TAB_TO_GROUP'});
	assert.equal(saved.ok, false);
	assert.match(
		String(saved.error),
		new RegExp(`${MAX_TABS_PER_SESSION} links`),
	);
	assert.equal(harness.state.groups[0].tabs.length, MAX_TABS_PER_SESSION);
});

test('importing a session of more links than one session holds splits it into numbered sessions', async () => {
	const huge = MAX_TABS_PER_SESSION + 500;
	const harness = createWorkerHarness(stateWithSession());
	const result = await harness.sendMessage({
		type: 'IMPORT_SESSIONS',
		data: {
			groups: [
				{
					name: 'Huge',
					tabs: Array.from({length: huge}, (_, index) => ({
						url: `https://huge${index}.example/`,
					})),
				},
			],
		},
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.groups, 2);
	assert.equal(result.count, huge);
	const parts = harness.state.groups.filter((group) =>
		String(group.name).startsWith('Huge'),
	);
	assert.deepEqual(
		parts.map((group) => [group.name, group.tabs.length]),
		[
			['Huge (1/2)', MAX_TABS_PER_SESSION],
			['Huge (2/2)', 500],
		],
	);

	const full = stateWithSession();
	full.groups = Array.from(
		{length: MAX_SESSIONS},
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
	assert.match(String(second.error), new RegExp(`${MAX_SESSIONS} sessions`));
	assert.equal(refused.state.groups.length, MAX_SESSIONS);
}, 60_000);

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

test('the settings cache follows changes written by another context', async () => {
	const harness = createWorkerHarness(stateWithSession({newTabEnabled: true}), [
		{id: 7, windowId: 10, index: 0, active: true, url: ''},
	]);
	const tab = harness.tabs[0];
	await harness.fire('tabCreated', {id: 7, pendingUrl: 'chrome://newtab/'});
	assert.equal(tab.url, '');
	harness.externalSetState({
		settings: {...harness.state.settings, newTabEnabled: false},
	});
	await harness.fire('tabCreated', {id: 7, pendingUrl: 'chrome://newtab/'});
	assert.equal(tab.url, 'chrome://new-tab-page/');
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
});

const PREMIGRATION = 'tablodge.state.premigration';
const MIGRATION_MARKER = 'tablodge.migration';
const sessionKeysOf = (storage: Record<string, unknown>) =>
	Object.keys(storage).filter((key) => key.startsWith('tablodge.session.'));

function legacyLibrary(count: number, tabs = 3): StoredState {
	const state = stateWithSession();
	state.groups = Array.from({length: count}, (_, index) => ({
		id: `legacy-${index}`,
		name: `Legacy ${index}`,
		folderId: 'unfiled',
		createdAt: 1_700_000_000_000 + index,
		updatedAt: 1_700_000_000_000 + index,
		tabs: Array.from({length: tabs}, (_unused, tab) => ({
			id: `legacy-${index}-${tab}`,
			url: `https://legacy${index}.example/${tab}`,
			title: `Legacy ${index} tab ${tab}`,
			createdAt: 1_700_000_000_000,
		})),
	}));
	return state;
}

test('an old single entry library is moved to per-session records when the worker starts', async () => {
	const seed = legacyLibrary(5);
	const harness = createWorkerHarness(seed, undefined, {legacyLayout: true});
	await settle();
	const index = harness.extraStorage[storageKey] as {
		layout: string;
		schemaVersion: number;
		sessionPages: Array<{count: number}>;
	};
	assert.equal(index.layout, 'records');
	assert.equal(index.schemaVersion, 11);
	assert.equal(
		index.sessionPages.reduce((sum, page) => sum + page.count, 0),
		5,
	);
	assert.equal(sessionKeysOf(harness.extraStorage).length, 5);
	assert.equal(harness.extraStorage[MIGRATION_MARKER], undefined);
	const copy = harness.extraStorage[PREMIGRATION] as {state: unknown};
	assert.deepEqual(copy.state, seed, 'the old entry is kept exactly as it was');
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.deepEqual(
		structuredClone(response.groups?.map((group) => group.id)),
		seed.groups.map((group) => group.id),
	);
	assert.equal(
		response.groups?.[2].tabs[1].url,
		'https://legacy2.example/1',
		'tabs survive the move',
	);
	assert.equal(backupsOf(harness).safety.length, 1);
	assert.equal(
		backupsOf(harness).safety[0].reason,
		'Before upgrading how the library is stored',
	);
});

test('an upgraded library is not migrated again', async () => {
	const harness = createWorkerHarness(legacyLibrary(30, 20), undefined, {
		legacyLayout: true,
	});
	await settle();
	const copyBefore = structuredClone(harness.extraStorage[PREMIGRATION]);
	const renamed = await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'legacy-7',
		fields: {name: 'Renamed'},
	});
	assert.equal(renamed.ok, true, renamed.error);
	assert.deepEqual(harness.extraStorage[PREMIGRATION], copyBefore);
	assert.equal(backupsOf(harness).safety.length, 1, 'one backup for the move');
});

test('a migration that cannot finish leaves the old library in charge and working', async () => {
	const seed = legacyLibrary(4);
	const harness = createWorkerHarness(seed, undefined, {legacyLayout: true});
	harness.setStorageFailure(
		new Error('QUOTA_BYTES quota exceeded'),
		'tablodge.sidx.0.1',
	);
	await settle();
	const entry = harness.extraStorage[storageKey] as Record<string, unknown>;
	assert.equal(entry.layout, undefined, 'still the old single entry');
	assert.ok(sessionKeysOf(harness.extraStorage).length <= 4);
	assert.deepEqual(
		(harness.extraStorage[PREMIGRATION] as {state: unknown}).state,
		seed,
		'the recovery copy exists before anything else is written',
	);
	const read = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(read.groups?.length, 4, 'the app still reads the old entry');
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'While broken', url: 'https://broken.example/'},
	});
	assert.equal(added.ok, true, added.error);
	const after = harness.extraStorage[storageKey] as {
		bookmarks: Array<{title: string}>;
		schemaVersion: number;
	};
	assert.equal(after.schemaVersion, 9, 'older builds can still open it');
	assert.equal(after.bookmarks.at(-1)?.title, 'While broken');
});

test('a worker restart after an interrupted migration finishes it without losing or duplicating a session', async () => {
	const seed = legacyLibrary(6, 4);
	const first = createWorkerHarness(seed, undefined, {legacyLayout: true});
	first.setStorageFailure(new Error('worker stopped'), 'tablodge.sidx.0.1');
	await settle();
	assert.ok(
		first.extraStorage[MIGRATION_MARKER],
		'the marker records the unfinished work',
	);
	const restarted = createWorkerHarness(seed, undefined, {
		legacyLayout: true,
		storage: structuredClone(first.extraStorage),
	});
	await settle();
	const index = restarted.extraStorage[storageKey] as {layout: string};
	assert.equal(index.layout, 'records');
	assert.deepEqual(
		structuredClone(
			logicalState(restarted.extraStorage)?.groups?.map((group) => group.id),
		),
		seed.groups.map((group) => group.id),
	);
	assert.equal(restarted.extraStorage[MIGRATION_MARKER], undefined);
	const response = await restarted.sendMessage({type: 'GET_STATE'});
	assert.equal(response.groups?.length, 6);
	assert.equal(
		response.groups?.reduce((sum, group) => sum + group.tabs.length, 0),
		24,
	);
	assert.equal(
		backupsOf(restarted).safety.length,
		1,
		'the resumed run does not take another safety backup',
	);
});

test('a library written by a dev tool in the current state shape is migrated and stays editable', async () => {
	const seed = legacyLibrary(3);
	seed.schemaVersion = 10;
	const harness = createWorkerHarness(seed, undefined, {legacyLayout: true});
	await settle();
	assert.equal(
		(harness.extraStorage[storageKey] as {layout?: string}).layout,
		'records',
	);
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {url: 'https://tool.example/'},
	});
	assert.equal(added.ok, true, added.error);
	assert.equal(harness.state.bookmarks.length, 1);
});

test('a library in layout 10 is upgraded to pages and chunks when the worker starts, after a safety backup', async () => {
	const seed = legacyLibrary(5);
	seed.bookmarks = Array.from({length: 130}, (_unused, index) => ({
		id: `bm-${index}`,
		title: `Bookmark ${index}`,
		url: `https://bm${index}.example/`,
		columnId: 'bookmark-default',
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
	}));
	const harness = createWorkerHarness(seed, undefined, {layout10: true});
	assert.equal(
		(harness.extraStorage[storageKey] as {schemaVersion: number}).schemaVersion,
		10,
	);
	await settle();
	const index = harness.extraStorage[storageKey] as {
		schemaVersion: number;
		sessionPages: Array<{count: number}>;
		bookmarkChunks: Array<{count: number}>;
	};
	assert.equal(index.schemaVersion, 11);
	assert.equal(index.sessionPages.length, 1);
	assert.deepEqual(
		index.bookmarkChunks.map((chunk) => chunk.count),
		[100, 30],
	);
	assert.equal(harness.extraStorage[MIGRATION_MARKER], undefined);
	assert.ok(harness.extraStorage['tablodge.state.preupgrade']);
	assert.ok(harness.extraStorage['tablodge.bookmarks.1']);
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(response.groups?.length, 5);
	assert.equal(response.bookmarks?.length, 130);
	assert.equal(backupsOf(harness).safety.length, 1);
	assert.equal(
		backupsOf(harness).safety[0].reason,
		'Before upgrading how the library is stored',
	);
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'After', url: 'https://after.example/'},
	});
	assert.equal(added.ok, true, added.error);
	assert.equal(harness.state.bookmarks.length, 131);
	assert.equal(backupsOf(harness).safety.length, 1, 'only one backup');
});

test('a layout 10 upgrade that cannot finish leaves the library in layout 10, reading and writing', async () => {
	const seed = legacyLibrary(4);
	const harness = createWorkerHarness(seed, undefined, {layout10: true});
	harness.setStorageFailure(
		new Error('QUOTA_BYTES quota exceeded'),
		'tablodge.sidx.0.2',
	);
	await settle();
	const before = harness.extraStorage[storageKey] as {
		schemaVersion: number;
		sessions: unknown[];
	};
	assert.equal(before.schemaVersion, 10);
	assert.equal(before.sessions.length, 4);
	assert.equal(
		Object.keys(harness.extraStorage).filter(
			(key) =>
				key.startsWith('tablodge.sidx.') || key.startsWith('tablodge.bmchunk.'),
		).length,
		0,
	);
	const read = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(read.groups?.length, 4);
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'While broken', url: 'https://broken.example/'},
	});
	assert.equal(added.ok, true, added.error);
	assert.equal(
		(harness.extraStorage[storageKey] as {schemaVersion: number}).schemaVersion,
		10,
	);
	assert.equal(harness.state.bookmarks.at(-1)?.title, 'While broken');
});

test('a library saved by a newer version is left alone', async () => {
	const future = {schemaVersion: 11, groups: [], note: 'newer'};
	const harness = createWorkerHarness(future, undefined, {
		legacyLayout: true,
	});
	await settle();
	assert.deepEqual(harness.extraStorage[storageKey], future);
	const response = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(response.ok, false);
	assert.match(response.error ?? '', /newer version/);
	const write = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {url: 'https://x.example/'},
	});
	assert.equal(write.ok, false);
	assert.deepEqual(harness.extraStorage[storageKey], future);
});

test('Undo restores a library across the per-record layout', async () => {
	const harness = createWorkerHarness(legacyLibrary(4), undefined, {
		legacyLayout: true,
	});
	await settle();
	const deleted = await harness.sendMessage({
		type: 'DELETE_GROUP',
		groupId: 'legacy-1',
	});
	assert.equal(deleted.ok, true, deleted.error);
	assert.equal(harness.state.groups.length, 3);
	const erased = await harness.sendMessage({
		type: 'ERASE_DATA',
		scope: 'sessions',
	});
	assert.equal(erased.ok, true, erased.error);
	assert.equal(harness.state.groups.length, 0);
	assert.ok(erased.undoId);
	const undone = await harness.sendMessage({type: 'UNDO', id: erased.undoId});
	assert.equal(undone.ok, true, undone.error);
	assert.deepEqual(
		structuredClone(harness.state.groups.map((group) => group.id)),
		['legacy-0', 'legacy-2', 'legacy-3'],
	);
	assert.deepEqual(
		structuredClone(harness.state.groups[1].tabs.map((tab) => tab.url)),
		[0, 1, 2].map((tab) => `https://legacy2.example/${tab}`),
	);
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

test('Archived exists by default even when no sessions have been archived', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const response = await harness.sendMessage({type: 'GET_STATE'});
	const archived = response.folders.find(
		(folder) => folder.name === 'Archived',
	);
	assert.ok(archived);
	assert.equal(archived.icon, 'archive');
});

test('the Archived folder does not use one of the 200 regular folder slots', async () => {
	const state = stateWithSession();
	state.folders.push(
		...Array.from({length: 198}, (_, index) => ({
			id: `folder-${index}`,
			name: `Folder ${index}`,
			createdAt: index,
		})),
	);
	const harness = createWorkerHarness(state);
	const existing = await harness.sendMessage({type: 'GET_STATE'});
	const archived = existing.folders.find(
		(folder) => folder.name === 'Archived',
	);
	assert.ok(archived);
	assert.equal(
		existing.folders.filter((folder) => folder.id !== archived.id).length,
		199,
	);

	const lastAllowed = await harness.sendMessage({
		type: 'CREATE_FOLDER',
		name: 'The 200th folder',
	});
	assert.equal(lastAllowed.ok, true);
	assert.equal(
		harness.state.folders.filter((folder) => folder.id !== archived.id).length,
		200,
	);

	const overLimit = await harness.sendMessage({
		type: 'CREATE_FOLDER',
		name: 'One too many',
	});
	assert.equal(overLimit.ok, false);
	assert.ok(harness.state.folders.some((folder) => folder.id === archived.id));
});

test('the Archived folder cannot be renamed or deleted', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const initial = await harness.sendMessage({type: 'GET_STATE'});
	const archived = initial.folders.find((folder) => folder.name === 'Archived');
	assert.ok(archived);
	const moved = await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-1',
		fields: {folderId: archived.id},
	});
	assert.equal(moved.ok, true, moved.error);

	const renamed = await harness.sendMessage({
		type: 'UPDATE_FOLDER',
		folderId: archived.id,
		name: 'Old sessions',
	});
	assert.equal(renamed.ok, false);
	const deleted = await harness.sendMessage({
		type: 'DELETE_FOLDER',
		folderId: archived.id,
	});
	assert.equal(deleted.ok, false);

	const after = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(
		after.folders.find((folder) => folder.id === archived.id)?.name,
		'Archived',
	);
	assert.equal(
		after.groups.find((group) => group.id === 'session-1')?.folderId,
		archived.id,
	);
});

test('a lower-case archived folder is reused and normalized', async () => {
	const state = stateWithSession();
	state.folders.push({
		id: 'existing-archive',
		name: 'archived',
		createdAt: 2,
	});
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({type: 'GET_STATE'});
	const archived = response.folders.filter(
		(folder) => folder.name.toLocaleLowerCase() === 'archived',
	);
	assert.equal(archived.length, 1);
	assert.equal(archived[0].id, 'existing-archive');
	assert.equal(archived[0].name, 'Archived');
});

test('sessions stay archived when duplicate Archived folders are normalized', async () => {
	const state = stateWithSession();
	state.folders.push(
		{id: 'archive-first', name: 'Archived', createdAt: 1},
		{id: 'archive-duplicate', name: 'archived', createdAt: 2},
	);
	state.groups[0].folderId = 'archive-duplicate';
	const harness = createWorkerHarness(state);
	const response = await harness.sendMessage({type: 'GET_STATE'});
	const archived = response.folders.filter(
		(folder) => folder.name === 'Archived',
	);

	assert.equal(archived.length, 1);
	assert.equal(
		response.groups.find((group) => group.id === 'session-1')?.folderId,
		archived[0].id,
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

test('session names: {title} falls back to the page address and names are capped', async () => {
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

test('session names: chunk suffixes follow the generated name', async () => {
	const tabs = Array.from({length: MAX_TABS_PER_SESSION + 500}, (_, index) =>
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

test('the Android app preferences are kept as plain values so they sync between phones', async () => {
	const harness = nameHarness();
	const saved = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {
			mobileApp: {
				look: 'ios',
				floatingBar: true,
				swipes: 2,
				nested: {a: 1},
				long: 'x'.repeat(100),
			},
		} as unknown as Partial<Settings>,
	});
	assert.deepEqual(
		{...saved.settings.mobileApp},
		{
			look: 'ios',
			floatingBar: true,
			swipes: 2,
		},
	);
	const reset = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {mobileApp: 'nope'} as unknown as Partial<Settings>,
	});
	assert.deepEqual({...reset.settings.mobileApp}, {});
});

test('session name setting: "Ask each time" and its fallback are validated and reset', async () => {
	const harness = nameHarness();
	assert.equal(
		(await harness.sendMessage({type: 'GET_STATE'})).settings
			.sessionNameFallback,
		'date-title',
	);
	const ask = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {sessionNameStyle: 'ask', sessionNameFallback: 'datetime'},
	});
	assert.equal(ask.settings.sessionNameStyle, 'ask');
	assert.equal(ask.settings.sessionNameFallback, 'datetime');
	const bad = await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {sessionNameFallback: 'ask'} as unknown as Partial<Settings>,
	});
	assert.equal(bad.settings.sessionNameFallback, 'date-title');
	const reset = await harness.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.sessionNameStyle, 'date-title');
	assert.equal(reset.settings.sessionNameFallback, 'date-title');
});

test('with "ask", a save that was not named uses the fallback and a typed name still wins', async () => {
	assert.equal(
		await savedName({sessionNameStyle: 'ask'}),
		'Sat, Oct 25 · Google Flights',
	);
	assert.equal(
		await savedName({sessionNameStyle: 'ask', sessionNameFallback: 'title'}),
		'Google Flights',
	);
	assert.equal(
		await savedName(
			{
				sessionNameStyle: 'ask',
				sessionNameFallback: 'custom',
				sessionNameTemplate: '{domain} +{count}',
			},
			{groupName: ''},
		),
		'flights.example +2',
	);
	assert.equal(
		await savedName({sessionNameStyle: 'ask'}, {groupName: 'Trip planning'}),
		'Trip planning',
	);
	const harness = nameHarness({sessionNameStyle: 'ask'});
	await harness.sendMessage({type: 'SAVE_TABS', scope: 'window'});
	assert.equal(harness.windowCreateCalls.length, 0);
});

test('PREVIEW_SESSION_NAME reports "ask" with the fallback name and honours the scope', async () => {
	const harness = nameHarness({
		sessionNameStyle: 'ask',
		sessionNameFallback: 'title',
	});
	const stored = await harness.sendMessage({type: 'PREVIEW_SESSION_NAME'});
	assert.equal(stored.asks, true);
	assert.equal(stored.name, 'Google Flights');
	const picked = await harness.sendMessage({
		type: 'PREVIEW_SESSION_NAME',
		tabIds: [2],
	});
	assert.equal(picked.name, 'Docs');
	const plain = await harness.sendMessage({
		type: 'PREVIEW_SESSION_NAME',
		style: 'title',
	});
	assert.equal(plain.asks, false);
});

test('a typed name across several windows is numbered per window', async () => {
	const harness = createWorkerHarness(
		stateWithSession({closeOnSave: false}),
		[
			webTab(1, 10, 0, {active: true, url: 'https://a.example/', title: 'A'}),
			webTab(2, 11, 0, {active: true, url: 'https://b.example/', title: 'B'}),
		],
		{now: NAME_NOW, extraWindows: [11]},
	);
	const result = await harness.sendMessage({
		type: 'SAVE_TABS',
		scope: 'all-windows',
		groupName: 'Trip',
	});
	assert.equal(result.ok, true, result.error);
	assert.deepEqual(
		harness.state.groups
			.slice(0, 2)
			.map((group) => group.name)
			.toSorted((a, b) => String(a).localeCompare(String(b))),
		['Trip (1/2)', 'Trip (2/2)'],
	);
});

test('shortcut and menu saves with "ask" save first, then open the name prompt window', async () => {
	const shortcut = nameHarness({sessionNameStyle: 'ask'});
	(shortcut.listeners.onCommand as (c: string, t: unknown) => void)(
		'save-window',
		{id: 1, windowId: 10},
	);
	await settle();
	assert.equal(shortcut.state.groups[0].name, 'Sat, Oct 25 · Google Flights');
	assert.equal(shortcut.windowCreateCalls.length, 1);
	const call = shortcut.windowCreateCalls[0] as {
		type: string;
		url: string;
		focused: boolean;
	};
	assert.equal(call.type, 'popup');
	assert.equal(call.focused, true);
	assert.equal(
		call.url,
		`chrome-extension://tablodge/name-session.html?groupId=${shortcut.state.groups[0].id}`,
	);

	const menu = nameHarness({sessionNameStyle: 'ask'});
	(
		menu.listeners.contextMenuClicked as (
			info: {menuItemId: string},
			tab: unknown,
		) => void
	)({menuItemId: 'tablodge-page-save-window'}, {id: 1, windowId: 10});
	await settle();
	assert.equal(menu.state.groups[0].tabs.length, 2);
	assert.equal(menu.windowCreateCalls.length, 1);

	const selected = nameHarness({sessionNameStyle: 'ask'}, [
		webTab(1, 10, 0, {
			active: true,
			highlighted: true,
			url: 'https://a.example/',
			title: 'A',
		}),
		webTab(2, 10, 1, {
			highlighted: true,
			url: 'https://b.example/',
			title: 'B',
		}),
	]);
	(selected.listeners.onCommand as (c: string, t: unknown) => void)(
		'save-window',
		{id: 1, windowId: 10},
	);
	await settle();
	assert.equal(selected.state.groups[0].tabs.length, 2);
	assert.equal(selected.windowCreateCalls.length, 1);
});

test('the save shortcut saves the selected tabs, or the whole window without a selection', async () => {
	const three = (highlight: number[]) =>
		nameHarness({}, [
			webTab(1, 10, 0, {
				active: true,
				highlighted: highlight.includes(1),
				url: 'https://a.example/',
				title: 'A',
			}),
			webTab(2, 10, 1, {
				highlighted: highlight.includes(2),
				url: 'https://b.example/',
				title: 'B',
			}),
			webTab(3, 10, 2, {
				highlighted: highlight.includes(3),
				url: 'https://c.example/',
				title: 'C',
			}),
		]);
	const press = async (harness: ReturnType<typeof three>, command: string) => {
		(harness.listeners.onCommand as (c: string, t: unknown) => void)(command, {
			id: 1,
			windowId: 10,
		});
		await settle();
	};

	const two = three([1, 2]);
	await press(two, 'save-window');
	assert.equal(two.state.groups[0].tabs.length, 2);

	const one = three([1]);
	await press(one, 'save-window');
	assert.equal(one.state.groups[0].tabs.length, 3);
});

test('saves record native tab groups, unless "Ignore tab groups" is on', async () => {
	const group = {id: 5, title: 'Work', color: 'blue', collapsed: false};
	const tabs = () => [
		webTab(1, 10, 0, {
			active: true,
			groupId: 5,
			url: 'https://a.example/',
			title: 'A',
		}),
		webTab(2, 10, 1, {url: 'https://b.example/', title: 'B'}),
	];
	for (const ignore of [false, true]) {
		const harness = createWorkerHarness(
			stateWithSession({closeOnSave: false, ignoreTabGroups: ignore}),
			tabs(),
			{now: NAME_NOW, tabGroups: [group]},
		);
		const result = await harness.sendMessage({
			type: 'SAVE_TABS',
			scope: 'window',
		});
		assert.equal(result.ok, true, result.error);
		const saved = harness.state.groups[0].tabs;
		assert.equal(saved[0].nativeGroup?.title, ignore ? undefined : 'Work');
		assert.equal(saved[1].nativeGroup, null);
	}

	const defaults = createWorkerHarness(stateWithSession({}), tabs());
	const response = await defaults.sendMessage({type: 'GET_STATE'});
	assert.equal(response.settings.ignoreTabGroups, false);
});

test('the bookmark shortcut opens the add-bookmark window for a web page only', async () => {
	const web = nameHarness({}, [
		webTab(1, 10, 0, {
			active: true,
			url: 'https://a.example/page?x=1&y=2',
			title: 'A & B',
		}),
	]);
	(web.listeners.onCommand as (c: string, t: unknown) => void)(
		'bookmark-page',
		{id: 1, windowId: 10},
	);
	await settle();
	assert.equal(web.windowCreateCalls.length, 1);
	const call = web.windowCreateCalls[0] as {type: string; url: string};
	assert.equal(call.type, 'popup');
	const url = new URL(call.url);
	assert.equal(url.pathname, '/add-bookmark.html');
	assert.equal(url.searchParams.get('url'), 'https://a.example/page?x=1&y=2');
	assert.equal(url.searchParams.get('title'), 'A & B');

	const internal = nameHarness({}, [
		webTab(1, 10, 0, {active: true, url: 'chrome://settings/', title: 'S'}),
	]);
	(internal.listeners.onCommand as (c: string, t: unknown) => void)(
		'bookmark-page',
		{id: 1, windowId: 10},
	);
	await settle();
	assert.equal(internal.windowCreateCalls.length, 0);
});

test('the bookmark shortcut saves into a column that claims the site without opening the window', async () => {
	const harness = nameHarness({}, [
		webTab(1, 10, 0, {
			active: true,
			url: 'https://github.com/bberka/asdadsads',
			title: 'Repo',
		}),
	]);
	const column = await harness.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'Mine',
		domains: ['github.com/bberka'],
	});
	(harness.listeners.onCommand as (c: string, t: unknown) => void)(
		'bookmark-page',
		{id: 1, windowId: 10},
	);
	await settle();
	assert.equal(harness.windowCreateCalls.length, 0);
	const state = await harness.sendMessage({type: 'GET_STATE'});
	const saved = state.bookmarks.find(
		(bookmark: {url: string}) =>
			bookmark.url === 'https://github.com/bberka/asdadsads',
	);
	assert.equal(saved?.columnId, column.column.id);
});

test('the palette shortcut opens one palette window over the focused window on any page, and a second press closes it', async () => {
	const harness = nameHarness({}, [
		webTab(1, 10, 0, {active: true, url: 'chrome://settings/', title: 'S'}),
	]);
	const press = async () => {
		(harness.listeners.onCommand as (c: string, t: unknown) => void)(
			'open-palette',
			{id: 1, windowId: 10},
		);
		await settle();
	};

	await press();
	assert.equal(harness.windowCreateCalls.length, 1);
	const call = harness.windowCreateCalls[0] as {
		type: string;
		url: string;
		focused: boolean;
	};
	assert.equal(call.type, 'popup');
	assert.equal(call.focused, true);
	const url = new URL(call.url);
	assert.equal(url.pathname, '/palette.html');
	assert.equal(url.searchParams.get('window'), '10');
	assert.equal(url.searchParams.get('tab'), '1');

	await press();
	assert.equal(harness.windowCreateCalls.length, 1);
	assert.equal(
		harness.createdWindows.length,
		1,
		'the palette window was created once',
	);
});

test('the palette location setting defaults to the current page, keeps an explicit window choice, and normalizes unknown values', async () => {
	const defaults = createWorkerHarness({...stateWithSession(), settings: {}});
	assert.equal(
		(await defaults.sendMessage({type: 'GET_STATE'})).settings.paletteLocation,
		'page',
	);
	const explicit = createWorkerHarness(
		stateWithSession({paletteLocation: 'window'}),
	);
	assert.equal(
		(await explicit.sendMessage({type: 'GET_STATE'})).settings.paletteLocation,
		'window',
	);
	const invalid = createWorkerHarness(
		stateWithSession({paletteLocation: 'tab'}),
	);
	assert.equal(
		(await invalid.sendMessage({type: 'GET_STATE'})).settings.paletteLocation,
		'page',
	);
	const updated = await invalid.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {paletteLocation: 'window'},
	});
	assert.equal(updated.ok, true, updated.error);
	assert.equal(invalid.state.settings.paletteLocation, 'window');
	const reset = await invalid.sendMessage({type: 'RESET_SETTINGS'});
	assert.equal(reset.settings.paletteLocation, 'page');
});

test('by default the shortcut injects the overlay on demand and opens no window', async () => {
	const harness = nameHarness({}, [
		webTab(1, 10, 0, {active: true, url: 'https://page.example/', title: 'P'}),
	]);
	(harness.listeners.onCommand as (c: string, t: unknown) => void)(
		'open-palette',
		{id: 1, windowId: 10, url: 'https://page.example/'},
	);
	await settle();
	assert.equal(harness.windowCreateCalls.length, 0);
	assert.equal(harness.executeScriptCalls.length, 1);
	const [call] = harness.executeScriptCalls;
	assert.equal(call.target.tabId, 1);
	const url = new URL(String(call.args?.[0]));
	assert.equal(url.pathname, '/palette.html');
	assert.equal(url.searchParams.get('overlay'), '1');
	assert.equal(url.searchParams.get('window'), '10');
	assert.equal(url.searchParams.get('tab'), '1');
});

test('by default, pages that cannot be scripted open the window instead', async () => {
	const press = async (
		harness: ReturnType<typeof nameHarness>,
		tab: Record<string, unknown>,
	) => {
		(harness.listeners.onCommand as (c: string, t: unknown) => void)(
			'open-palette',
			tab,
		);
		await settle();
	};

	const restricted = nameHarness({}, [
		webTab(1, 10, 0, {active: true, url: 'chrome://settings/', title: 'S'}),
	]);
	await press(restricted, {id: 1, windowId: 10, url: 'chrome://settings/'});
	assert.equal(restricted.executeScriptCalls.length, 0);
	assert.equal(restricted.windowCreateCalls.length, 1);

	const refused = nameHarness(
		{},
		[
			webTab(1, 10, 0, {
				active: true,
				url: 'https://chromewebstore.google.com/',
				title: 'S',
			}),
		],
		{scriptingFails: true},
	);
	await press(refused, {
		id: 1,
		windowId: 10,
		url: 'https://chromewebstore.google.com/',
	});
	assert.equal(refused.executeScriptCalls.length, 1);
	assert.equal(refused.windowCreateCalls.length, 1);

	const standard = nameHarness({paletteLocation: 'window'}, [
		webTab(1, 10, 0, {active: true, url: 'https://page.example/', title: 'P'}),
	]);
	await press(standard, {id: 1, windowId: 10, url: 'https://page.example/'});
	assert.equal(standard.executeScriptCalls.length, 0);
	assert.equal(standard.windowCreateCalls.length, 1);
});

test('messages from the palette window act on the window it was opened over', async () => {
	const harness = createWorkerHarness(
		stateWithSession({restoreTarget: 'current-window', restoreMode: 'keep'}),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://front.example/',
			},
			{
				id: 2,
				windowId: 20,
				index: 0,
				active: true,
				url: 'chrome-extension://tablodge/palette.html?window=10',
			},
		],
		{extraWindows: [20]},
	);
	const response = await harness.sendMessage(
		{type: 'RESTORE_GROUP', groupId: 'session-1'},
		{
			url: 'chrome-extension://tablodge/palette.html?window=10',
			tab: {id: 2, windowId: 20},
		},
	);
	assert.equal(response.ok, true, response.error);
	assert.ok(harness.openedTabs.length > 0);
	assert.ok(harness.openedTabs.every((tab) => tab.windowId === 10));
});

test('a palette restore that moves the session to the trash offers Undo on the tab the palette was over, and Undo brings it back', async () => {
	const harness = createWorkerHarness(
		stateWithSession({restoreTarget: 'current-window', restoreMode: 'remove'}),
		[
			webTab(1, 10, 0, {url: 'https://front.example/', title: 'Front'}),
			webTab(3, 10, 1, {
				active: true,
				url: 'https://opened.example/',
				title: 'Opened',
			}),
			{
				id: 2,
				windowId: 20,
				index: 0,
				active: true,
				url: 'chrome-extension://tablodge/palette.html?window=10',
			},
		],
		{extraWindows: [20]},
	);
	const palette = {
		url: 'chrome-extension://tablodge/palette.html?window=10&tab=1',
		tab: {id: 2, windowId: 20},
	};
	const restored = await harness.sendMessage(
		{type: 'RESTORE_GROUP', groupId: 'session-1'},
		palette,
	);
	assert.equal(restored.ok, true, restored.error);
	assert.ok(restored.trashId);

	const message = 'Restored “Research”. Removed it from your sessions.';
	const shown = await harness.sendMessage(
		{type: 'SHOW_TRASH_UNDO', tabId: 1, message, trashId: restored.trashId},
		palette,
	);
	assert.equal(shown.ok, true, shown.error);
	assert.equal(harness.executeScriptCalls.length, 1);
	const [call] = harness.executeScriptCalls;
	assert.equal(
		call.target.tabId,
		1,
		'it draws on the tab the palette was over, the one the activeTab grant covers',
	);
	assert.equal((call.args?.[0] as {message: string}).message, message);

	const otherTab = await harness.sendMessage(
		{type: 'TRASH_UNDO', id: restored.trashId},
		{url: 'https://opened.example/', tab: {id: 3, windowId: 10}},
	);
	assert.equal(otherTab.ok, false);

	const undo = await harness.sendMessage(
		{type: 'TRASH_UNDO', id: restored.trashId},
		{url: 'https://front.example/', tab: {id: 1, windowId: 10}},
	);
	assert.equal(undo.ok, true, undo.error);
	assert.equal(undo.message, 'Restored to Research.');
	assert.equal(
		(await harness.sendMessage({type: 'GET_TRASH'})).items.length,
		0,
	);
	assert.ok(
		(await harness.sendMessage({type: 'GET_STATE'})).groups.some(
			(group) => group.id === 'session-1',
		),
	);
});

test('Undo from a palette toast still works in a worker that stopped and started again', async () => {
	const tabs = [
		webTab(1, 10, 0, {
			active: true,
			url: 'https://front.example/',
			title: 'Front',
		}),
		{
			id: 2,
			windowId: 20,
			index: 0,
			active: true,
			url: 'chrome-extension://tablodge/palette.html?window=10&tab=1',
		},
	];
	const first = createWorkerHarness(
		stateWithSession({restoreTarget: 'current-window', restoreMode: 'remove'}),
		tabs,
		{extraWindows: [20]},
	);
	const restored = await first.sendMessage(
		{type: 'RESTORE_GROUP', groupId: 'session-1'},
		{
			url: 'chrome-extension://tablodge/palette.html?window=10&tab=1',
			tab: {id: 2, windowId: 20},
		},
	);
	assert.ok(restored.trashId);
	const shown = await first.sendMessage(
		{
			type: 'SHOW_TRASH_UNDO',
			tabId: 1,
			message: 'Restored “Research”. Removed it from your sessions.',
			trashId: restored.trashId,
		},
		{
			url: 'chrome-extension://tablodge/palette.html?window=10&tab=1',
			tab: {id: 2, windowId: 20},
		},
	);
	assert.equal(shown.ok, true, shown.error);

	const restarted = createWorkerHarness(stateWithSession(), tabs, {
		extraWindows: [20],
		storage: structuredClone(first.extraStorage),
		sessionStorage: structuredClone(first.sessionStore),
	});
	const undo = await restarted.sendMessage(
		{type: 'TRASH_UNDO', id: restored.trashId},
		{url: 'https://front.example/', tab: {id: 1, windowId: 10}},
	);
	assert.equal(undo.ok, true, undo.error);
	assert.equal(undo.message, 'Restored to Research.');
	assert.equal(
		(await restarted.sendMessage({type: 'GET_TRASH'})).items.length,
		0,
	);
});

test('a palette restore still works, and shows no error, where the page cannot show the Undo toast', async () => {
	const harness = createWorkerHarness(
		stateWithSession({restoreTarget: 'current-window', restoreMode: 'remove'}),
		[
			webTab(1, 10, 0, {active: true, url: 'https://front.example/'}),
			{
				id: 2,
				windowId: 20,
				index: 0,
				active: true,
				url: 'chrome-extension://tablodge/palette.html?window=10&tab=1',
			},
		],
		{extraWindows: [20], scriptingFails: true},
	);
	const palette = {
		url: 'chrome-extension://tablodge/palette.html?window=10&tab=1',
		tab: {id: 2, windowId: 20},
	};
	const restored = await harness.sendMessage(
		{type: 'RESTORE_GROUP', groupId: 'session-1'},
		palette,
	);
	assert.equal(restored.ok, true, restored.error);
	assert.ok(restored.trashId);
	const shown = await harness.sendMessage(
		{
			type: 'SHOW_TRASH_UNDO',
			tabId: 1,
			message: 'Restored “Research”. Removed it from your sessions.',
			trashId: restored.trashId,
		},
		palette,
	);
	assert.equal(shown.ok, false);
	assert.equal(shown.error, 'That page cannot show a message.');
	assert.equal(
		(await harness.sendMessage({type: 'GET_TRASH'})).items.length,
		1,
		'the session waits in the trash',
	);
});

test('an all-windows toolbar save asks once for every session it created', async () => {
	const harness = createWorkerHarness(
		stateWithSession({
			closeOnSave: false,
			sessionNameStyle: 'ask',
			actionMode: 'all-windows',
		}),
		[
			webTab(1, 10, 0, {active: true, url: 'https://a.example/', title: 'A'}),
			webTab(2, 11, 0, {active: true, url: 'https://b.example/', title: 'B'}),
		],
		{now: NAME_NOW, extraWindows: [11]},
	);
	(harness.listeners.actionClicked as (tab: unknown) => void)({
		id: 1,
		windowId: 10,
	});
	await settle();
	assert.equal(harness.windowCreateCalls.length, 1);
	const url = new URL((harness.windowCreateCalls[0] as {url: string}).url);
	const ids = url.searchParams.getAll('groupId');
	assert.equal(ids.length, 2);
	assert.deepEqual(
		new Set(ids),
		new Set(harness.state.groups.slice(0, 2).map((group) => group.id)),
	);
});

test('without "ask", shortcut and menu saves never open the name prompt window', async () => {
	for (const settings of [{}, {sessionNameStyle: 'title'}]) {
		const harness = nameHarness(settings);
		(harness.listeners.onCommand as (c: string, t: unknown) => void)(
			'save-window',
			{id: 1, windowId: 10},
		);
		await settle();
		assert.equal(harness.state.groups.length, 2);
		assert.equal(harness.windowCreateCalls.length, 0);
	}
});

test('the toolbar button in a direct-save mode asks after saving, except for a titled tab group', async () => {
	const groupTab = [
		webTab(1, 10, 0, {
			active: true,
			groupId: 5,
			url: 'https://a.example/',
			title: 'A',
		}),
	];
	const click = (harness: ReturnType<typeof nameHarness>) =>
		(harness.listeners.actionClicked as (tab: unknown) => void)({
			id: 1,
			windowId: 10,
		});
	const titled = nameHarness(
		{sessionNameStyle: 'ask', actionMode: 'current-group'},
		groupTab,
		{tabGroups: [{id: 5, title: 'Research', color: 'blue', collapsed: false}]},
	);
	click(titled);
	await settle();
	assert.equal(titled.state.groups[0].name, 'Research');
	assert.equal(titled.windowCreateCalls.length, 0);

	const untitled = nameHarness(
		{sessionNameStyle: 'ask', actionMode: 'current-group'},
		groupTab,
		{tabGroups: [{id: 5, title: '', color: 'blue', collapsed: false}]},
	);
	click(untitled);
	await settle();
	assert.equal(untitled.state.groups[0].name, 'Sat, Oct 25 · A');
	assert.equal(untitled.windowCreateCalls.length, 1);

	const window = nameHarness({
		sessionNameStyle: 'ask',
		actionMode: 'full-window',
	});
	click(window);
	await settle();
	assert.equal(window.windowCreateCalls.length, 1);
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

test('Undo after deleting a folder brings the folder back with its sessions in it', async () => {
	const state = stateWithSession();
	state.folders.push({
		id: 'work',
		name: 'Work',
		createdAt: 1,
		isDefault: false,
	});
	state.groups[0].folderId = 'work';
	const harness = createWorkerHarness(state);
	const deleted = await harness.sendMessage({
		type: 'DELETE_FOLDER',
		folderId: 'work',
	});
	assert.equal(deleted.ok, true, deleted.error);
	assert.equal(deleted.moved, 1);
	assert.equal(harness.state.groups[0].folderId, 'unfiled');
	const undone = await harness.sendMessage({type: 'UNDO', id: deleted.undoId!});
	assert.equal(undone.ok, true, undone.error);
	assert.equal(
		harness.state.folders.some((folder) => folder.id === 'work'),
		true,
	);
	assert.equal(harness.state.groups[0].folderId, 'work');
});

test('saving cleans notification counters from page titles unless Clean page titles is off', async () => {
	const tabs = [
		['(1) YouTube', 'https://youtube.example/'],
		['(12+) Feed', 'https://feed.example/'],
		['[3] Inbox', 'https://mail.example/'],
		['● Draft', 'https://docs.example/'],
		['Chapter (2) notes', 'https://book.example/'],
		['(5)', 'https://only.example/'],
	].map(([title, url], index) => ({
		id: index + 1,
		windowId: 10,
		index,
		active: index === 0,
		highlighted: index === 0,
		url,
		title,
	}));
	const titlesAfterSave = async (settings: Record<string, unknown>) => {
		const harness = createWorkerHarness(
			stateWithSession({closeOnSave: false, ...settings}),
			structuredClone(tabs),
		);
		const response = await harness.sendMessage({
			type: 'SAVE_TABS',
			scope: 'window',
		});
		assert.equal(response.ok, true, response.error);
		return harness.state.groups[0].tabs.map((tab) => tab.title);
	};

	assert.deepEqual(await titlesAfterSave({}), [
		'YouTube',
		'Feed',
		'Inbox',
		'Draft',
		'Chapter (2) notes',
		'(5)',
	]);
	assert.deepEqual(
		await titlesAfterSave({cleanTitles: false}),
		tabs.map((tab) => tab.title),
	);
});

test('bookmarking a page cleans a leading notification counter from its title', async () => {
	const harness = createWorkerHarness(bookmarksState(0));
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: '(3) YouTube', url: 'https://youtube.example/'},
	});
	assert.equal(added.ok, true, added.error);
	assert.equal(added.bookmark.title, 'YouTube');
});

const browserColumns = [
	{id: 'bookmark-default', name: 'Bookmarks', createdAt: 0, isDefault: true},
	{id: 'col-2', name: 'Reading', createdAt: 1},
];

function browserBookmarkHarness(
	settings: Partial<Settings>,
	extra: Partial<StoredState> = {},
	sessionStorage: Record<string, unknown> = {},
) {
	return createWorkerHarness(
		{
			...stateWithSession(settings),
			bookmarkColumns: browserColumns,
			...extra,
		},
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
		{manualTimers: true, sessionStorage},
	);
}

const starNode = (overrides: Record<string, unknown> = {}) => ({
	id: 'b1',
	title: 'Starred title',
	url: 'https://current.example/',
	...overrides,
});

test('browser bookmark: off does nothing', async () => {
	const harness = browserBookmarkHarness({});
	harness.listeners.bookmarkCreated('b1', starNode());
	await harness.runTimers();
	assert.equal(harness.windowCreateCalls.length, 0);
	assert.equal(harness.state.bookmarks.length, 0);
});

test('browser bookmark: ask opens the prompt window with the browser title', async () => {
	const harness = browserBookmarkHarness({browserBookmarkAction: 'ask'});
	harness.listeners.bookmarkCreated('b1', starNode());
	await harness.runTimers();
	assert.equal(harness.windowCreateCalls.length, 1);
	const url = new URL(String(harness.windowCreateCalls[0].url));
	assert.match(url.pathname, /add-bookmark\.html$/);
	assert.equal(url.searchParams.get('url'), 'https://current.example/');
	assert.equal(url.searchParams.get('title'), 'Starred title');
	assert.equal(url.searchParams.get('source'), 'browser');
	assert.equal(harness.state.bookmarks.length, 0);
});

test('browser bookmark: add puts it in the chosen column, or the first when it is gone', async () => {
	const chosen = browserBookmarkHarness({
		browserBookmarkAction: 'add',
		browserBookmarkColumn: 'col-2',
	});
	chosen.listeners.bookmarkCreated('b1', starNode());
	await chosen.runTimers();
	assert.equal(chosen.state.bookmarks.length, 1);
	assert.equal(chosen.state.bookmarks[0].columnId, 'col-2');
	assert.equal(chosen.state.bookmarks[0].url, 'https://current.example/');
	assert.equal(chosen.windowCreateCalls.length, 0);

	const gone = browserBookmarkHarness({
		browserBookmarkAction: 'add',
		browserBookmarkColumn: 'deleted-column',
	});
	gone.listeners.bookmarkCreated('b1', starNode());
	await gone.runTimers();
	assert.equal(gone.state.bookmarks[0].columnId, 'bookmark-default');
});

test('browser bookmark: folders, non-web pages and other pages are ignored', async () => {
	const harness = browserBookmarkHarness({browserBookmarkAction: 'add'});
	harness.listeners.bookmarkCreated('f', {id: 'f', title: 'Folder'});
	await harness.runTimers();
	harness.listeners.bookmarkCreated('c', starNode({url: 'chrome://settings/'}));
	await harness.runTimers();
	harness.listeners.bookmarkCreated(
		'o',
		starNode({url: 'https://elsewhere.example/'}),
	);
	await harness.runTimers();
	assert.equal(harness.state.bookmarks.length, 0);
	assert.equal(harness.windowCreateCalls.length, 0);
});

test('browser bookmark: a burst of bookmarks is ignored', async () => {
	const harness = browserBookmarkHarness({browserBookmarkAction: 'add'});
	harness.listeners.bookmarkCreated('b1', starNode());
	harness.listeners.bookmarkCreated(
		'b2',
		starNode({id: 'b2', url: 'https://two.example/'}),
	);
	await harness.runTimers();
	assert.equal(harness.state.bookmarks.length, 0);
});

test('browser bookmark: imports are ignored, also after a worker restart', async () => {
	const harness = browserBookmarkHarness({browserBookmarkAction: 'add'});
	harness.listeners.bookmarkImportBegan();
	harness.listeners.bookmarkCreated('b1', starNode());
	await harness.runTimers();
	assert.equal(harness.state.bookmarks.length, 0);
	harness.listeners.bookmarkImportEnded();
	await harness.runTimers();
	harness.listeners.bookmarkCreated('b1', starNode());
	await harness.runTimers();
	assert.equal(harness.state.bookmarks.length, 1);

	const fresh = browserBookmarkHarness(
		{browserBookmarkAction: 'add'},
		{},
		{
			browserBookmarkImporting: true,
		},
	);
	fresh.listeners.bookmarkCreated('b1', starNode());
	await fresh.runTimers();
	assert.equal(fresh.state.bookmarks.length, 0);
});

test('browser bookmark: existing TabLodge bookmarks and a disabled board are ignored', async () => {
	const existing = browserBookmarkHarness(
		{browserBookmarkAction: 'ask'},
		{
			bookmarks: [
				{
					id: 'x',
					title: 'Have it',
					url: 'https://current.example/',
					columnId: 'bookmark-default',
					createdAt: 1,
					updatedAt: 1,
				},
			],
		},
	);
	existing.listeners.bookmarkCreated('b1', starNode());
	await existing.runTimers();
	assert.equal(existing.windowCreateCalls.length, 0);
});

function sessionToEdit(settings: Record<string, unknown> = {}): StoredState {
	const state = stateWithSession({openDashboardAfterSave: false, ...settings});
	Object.assign(state.groups[0], {
		description: 'Keep this',
		tabs: [
			{
				id: 'old',
				title: 'Old page',
				url: 'https://old.example/',
				notes: 'old note',
				pinned: false,
				originalIndex: 0,
			},
			{
				id: 'kept',
				title: 'Saved page',
				url: 'https://saved.example/article',
				notes: 'my note',
				pinned: false,
				originalIndex: 1,
			},
		],
	});
	return state;
}

test('UPDATE_GROUP_FROM_WINDOW replace swaps the links for the window, keeps the session identity and notes, and undoes', async () => {
	const harness = createWorkerHarness(sessionToEdit(), windowTabs);
	const result = await harness.sendMessage({
		type: 'UPDATE_GROUP_FROM_WINDOW',
		groupId: 'session-1',
		mode: 'replace',
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.count, 2);
	assert.equal(result.added, 1);
	assert.equal(result.removed, 1);
	const group = harness.state.groups[0];
	assert.equal(harness.state.groups.length, 1);
	assert.equal(group.id, 'session-1');
	assert.equal(group.name, 'Research');
	assert.equal(group.description, 'Keep this');
	assert.deepEqual(
		group.tabs.map((tab) => tab.url),
		['https://one.example/', 'https://saved.example/article'],
		'pinned tabs stay out by default',
	);
	assert.equal(group.tabs[1].notes, 'my note');
	assert.deepEqual(harness.removedTabIds, [], 'the window keeps its tabs');
	assert.equal(harness.createdWindows.length, 0);

	const undo = await harness.sendMessage({type: 'UNDO', id: result.undoId!});
	assert.equal(undo.ok, true, undo.error);
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => tab.id),
		['old', 'kept'],
	);
});

test('UPDATE_GROUP_FROM_WINDOW follows the excluded sites and pinned tab settings', async () => {
	const harness = createWorkerHarness(
		sessionToEdit({includePinnedTabs: true, excludedOrigins: ['one.example']}),
		windowTabs,
	);
	const result = await harness.sendMessage({
		type: 'UPDATE_GROUP_FROM_WINDOW',
		groupId: 'session-1',
		mode: 'replace',
	});
	assert.equal(result.ok, true, result.error);
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => [tab.url, tab.pinned]),
		[
			['https://pinned.example/', true],
			['https://saved.example/article', false],
		],
	);
});

test('UPDATE_GROUP_FROM_WINDOW replace refuses a window with nothing to save and leaves the session alone', async () => {
	const harness = createWorkerHarness(sessionToEdit(), [
		{
			id: 1,
			windowId: 10,
			index: 0,
			active: true,
			url: 'chrome://settings/',
			title: 'Settings',
		},
	]);
	const result = await harness.sendMessage({
		type: 'UPDATE_GROUP_FROM_WINDOW',
		groupId: 'session-1',
		mode: 'replace',
	});
	assert.equal(result.ok, false);
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => tab.id),
		['old', 'kept'],
	);
	const missing = await harness.sendMessage({
		type: 'UPDATE_GROUP_FROM_WINDOW',
		groupId: 'nope',
		mode: 'append',
	});
	assert.equal(missing.ok, false);
});

test('UPDATE_GROUP_FROM_WINDOW append adds only new addresses at the end and undoes', async () => {
	const harness = createWorkerHarness(sessionToEdit(), windowTabs);
	const result = await harness.sendMessage({
		type: 'UPDATE_GROUP_FROM_WINDOW',
		groupId: 'session-1',
		mode: 'append',
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.count, 3);
	assert.equal(result.added, 1);
	assert.equal(result.skipped, 1);
	assert.equal(result.removed, 0);
	assert.deepEqual(
		harness.state.groups[0].tabs.map((tab) => tab.url),
		[
			'https://old.example/',
			'https://saved.example/article',
			'https://one.example/',
		],
	);
	assert.equal(harness.state.groups[0].tabs[1].notes, 'my note');

	const again = await harness.sendMessage({
		type: 'UPDATE_GROUP_FROM_WINDOW',
		groupId: 'session-1',
		mode: 'append',
	});
	assert.equal(again.ok, false, 'nothing new to add');
	assert.equal(harness.state.groups[0].tabs.length, 3);

	const undo = await harness.sendMessage({type: 'UNDO', id: result.undoId!});
	assert.equal(undo.ok, true, undo.error);
	assert.equal(harness.state.groups[0].tabs.length, 2);
});

test('UPDATE_GROUP_FROM_WINDOW honors duplicate rejection against other sessions', async () => {
	const state = sessionToEdit({saveDuplicateHandling: 'reject'});
	state.groups.push({
		...structuredClone(state.groups[0]),
		id: 'session-2',
		name: 'Other',
		tabs: [
			{
				id: 'o1',
				title: 'One elsewhere',
				url: 'https://one.example/',
				pinned: false,
				originalIndex: 0,
			},
		],
	});
	const replaced = createWorkerHarness(structuredClone(state), windowTabs);
	const replace = await replaced.sendMessage({
		type: 'UPDATE_GROUP_FROM_WINDOW',
		groupId: 'session-1',
		mode: 'replace',
	});
	assert.equal(replace.ok, true, replace.error);
	assert.equal(replace.skipped, 1);
	assert.deepEqual(
		replaced.state.groups[0].tabs.map((tab) => tab.url),
		['https://saved.example/article'],
		"its own links don't count as duplicates, other sessions' do",
	);

	const allowed = createWorkerHarness(
		{
			...structuredClone(state),
			settings: {...state.settings, saveDuplicateHandling: 'allow'},
		},
		windowTabs,
	);
	const allow = await allowed.sendMessage({
		type: 'UPDATE_GROUP_FROM_WINDOW',
		groupId: 'session-1',
		mode: 'replace',
	});
	assert.equal(allow.ok, true, allow.error);
	assert.equal(allowed.state.groups[0].tabs.length, 2);
});

test('UPDATE_GROUP_FROM_WINDOW keeps split pairs from the window and refuses a session over the link limit', async () => {
	const harness = createWorkerHarness(sessionToEdit(), splitWindowTabs());
	const result = await harness.sendMessage({
		type: 'UPDATE_GROUP_FROM_WINDOW',
		groupId: 'session-1',
		mode: 'replace',
	});
	assert.equal(result.ok, true, result.error);
	assert.deepEqual(savedUrlsAndSplits(harness.state.groups[0]), [
		['left', 0],
		['right', 1],
		['plain', null],
		['docs', 0],
		['notes', 1],
	]);

	const full = sessionToEdit();
	full.groups[0].tabs = Array.from(
		{length: MAX_TABS_PER_SESSION},
		(_, index) => ({
			id: `t${index}`,
			title: `T${index}`,
			url: `https://full.example/${index}`,
			pinned: false,
			originalIndex: index,
		}),
	);
	const overflow = createWorkerHarness(full, windowTabs);
	const refused = await overflow.sendMessage({
		type: 'UPDATE_GROUP_FROM_WINDOW',
		groupId: 'session-1',
		mode: 'append',
	});
	assert.equal(refused.ok, false);
	assert.equal(overflow.state.groups[0].tabs.length, MAX_TABS_PER_SESSION);
});

function splittable(): StoredState {
	const state = reorderState();
	state.groups[0].tabs[2].notes = 'keep me';
	return state;
}

test('SPLIT_GROUP moves the chosen links into a new session next to the source and undoes', async () => {
	const harness = createWorkerHarness(splittable());
	const result = await harness.sendMessage({
		type: 'SPLIT_GROUP',
		groupId: 'A',
		tabIds: ['a3', 'a1'],
	});
	assert.equal(result.ok, true, result.error);
	assert.equal(result.count, 2);
	assert.deepEqual(
		harness.state.groups.map((group) => group.id),
		['A', result.groupId, 'B', 'C'],
	);
	assert.deepEqual(tabIdsOf(harness.state, 'A'), ['a2']);
	const created = harness.state.groups[1];
	assert.deepEqual(
		created.tabs.map((tab) => tab.id),
		['a1', 'a3'],
		'links keep their order from the source',
	);
	assert.equal(created.name, 'A (split)');
	assert.equal(created.folderId, harness.state.groups[0].folderId);
	assert.equal(
		harness.state.groups
			.flatMap((group) => group.tabs)
			.filter((tab) => tab.split).length,
		0,
		'a pair broken by the split loses its split info',
	);

	const undo = await harness.sendMessage({type: 'UNDO', id: result.undoId!});
	assert.equal(undo.ok, true, undo.error);
	assert.deepEqual(
		harness.state.groups.map((group) => group.id),
		['A', 'B', 'C'],
	);
	assert.deepEqual(tabIdsOf(harness.state, 'A'), ['a1', 'a2', 'a3']);
});

test('SPLIT_GROUP keeps a whole split pair together, uses the given name, and rejects empty or complete selections', async () => {
	const harness = createWorkerHarness(splittable());
	const result = await harness.sendMessage({
		type: 'SPLIT_GROUP',
		groupId: 'A',
		tabIds: ['a1', 'a2'],
		name: 'Pair',
	});
	assert.equal(result.ok, true, result.error);
	const created = harness.state.groups.find(
		(group) => group.id === result.groupId,
	)!;
	assert.equal(created.name, 'Pair');
	assert.deepEqual(
		created.tabs.map((tab) => [tab.id, tab.split?.position]),
		[
			['a1', 0],
			['a2', 1],
		],
	);
	assert.equal(created.tabs[0].split!.id, created.tabs[1].split!.id);
	assert.deepEqual(tabIdsOf(harness.state, 'A'), ['a3']);

	for (const tabIds of [[], ['nope'], ['a3']]) {
		const refused = await harness.sendMessage({
			type: 'SPLIT_GROUP',
			groupId: 'A',
			tabIds,
		});
		assert.equal(refused.ok, false, JSON.stringify(tabIds));
	}

	const missing = await harness.sendMessage({
		type: 'SPLIT_GROUP',
		groupId: 'zzz',
		tabIds: ['a1'],
	});
	assert.equal(missing.ok, false);
});

type OmniboxSuggestion = {content: string; description: string};

function omniboxHarness(settings: Record<string, unknown> = {}) {
	const state = stateWithSession(settings);
	state.bookmarks = [
		{
			id: 'bookmark-1',
			title: 'Hacker News',
			url: 'https://news.ycombinator.com/?utm_source=x',
			columnId: 'bookmark-default',
			createdAt: 1,
			updatedAt: 1,
		},
	];
	const harness = createWorkerHarness(state, [
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
			windowId: 11,
			index: 0,
			active: true,
			url: 'https://news.example/',
			title: 'Hacker daily',
		},
		{
			id: 3,
			windowId: 10,
			index: 1,
			active: false,
			url: 'chrome-extension://tablodge/newtab.html',
			title: 'TabLodge',
		},
	]);
	return {
		harness,
		async suggest(text: string) {
			let suggestions: OmniboxSuggestion[] = [];
			(
				harness.listeners.omniboxInputChanged as (
					text: string,
					suggest: (list: OmniboxSuggestion[]) => void,
				) => void
			)(text, (list) => {
				suggestions = list;
			});
			await settle();
			return [...suggestions];
		},
		async enter(text: string, disposition = 'currentTab') {
			(
				harness.listeners.omniboxInputEntered as (
					text: string,
					disposition: string,
				) => void
			)(text, disposition);
			await settle();
		},
	};
}

test('omnibox: suggests open tabs, saved tabs, bookmarks and sessions, never the dashboard tab', async () => {
	const {harness, suggest} = omniboxHarness();
	assert.match(harness.defaultSuggestions[0], /%s/);
	assert.deepEqual(
		(await suggest('hacker')).map((entry) => entry.content),
		['tab:2', 'bookmark:bookmark-1'],
	);
	assert.deepEqual(
		(await suggest('research')).map((entry) => entry.content),
		['session:session-1', 'saved-tab:session-1:saved-tab-1'],
	);
	assert.deepEqual(
		(await suggest('saved page')).map((entry) => entry.content),
		['saved-tab:session-1:saved-tab-1'],
	);
	assert.deepEqual(await suggest('tablodge'), []);
	assert.deepEqual(await suggest('zzzzqqq'), []);
});

test('omnibox: entering an open tab switches to it and focuses its window', async () => {
	const {harness, enter} = omniboxHarness();
	await enter('tab:2');
	assert.equal(harness.tabs.find((tab) => tab.id === 2)?.active, true);
	assert.ok(harness.windowUpdates.some((update) => update.id === 11));
	assert.equal(harness.openedTabs.length, 0);
});

test('omnibox: entering a bookmark follows the address bar disposition', async () => {
	const current = omniboxHarness();
	await current.enter('bookmark:bookmark-1', 'currentTab');
	assert.equal(
		current.harness.tabs.find((tab) => tab.id === 1)?.url,
		'https://news.ycombinator.com/?utm_source=x',
	);
	assert.equal(current.harness.openedTabs.length, 0);

	const foreground = omniboxHarness({removeTrackingParameters: true});
	await foreground.enter('bookmark:bookmark-1', 'newForegroundTab');
	assert.deepEqual(
		foreground.harness.openedTabs.map((tab) => [tab.url, tab.active]),
		[['https://news.ycombinator.com/', true]],
	);

	const background = omniboxHarness();
	await background.enter('saved-tab:session-1:saved-tab-1', 'newBackgroundTab');
	assert.deepEqual(
		background.harness.openedTabs.map((tab) => [tab.url, tab.active]),
		[['https://saved.example/article', false]],
	);
});

test('omnibox: a pinned TabLodge tab is not navigated away', async () => {
	const {harness, enter} = omniboxHarness({keepLodgePinned: true});
	const lodge = harness.tabs.find((tab) => tab.id === 3)!;
	Object.assign(lodge, {pinned: true, active: true});
	harness.tabs.find((tab) => tab.id === 1)!.active = false;
	await enter('bookmark:bookmark-1', 'currentTab');
	assert.equal(lodge.url, 'chrome-extension://tablodge/newtab.html');
	assert.equal(harness.openedTabs.length, 1);
});

test('omnibox: entering a session opens the dashboard focused on it', async () => {
	const {harness, enter} = omniboxHarness();
	await enter('session:session-1');
	assert.equal(
		harness.tabs.find((tab) => tab.id === 3)?.url,
		'chrome-extension://tablodge/newtab.html?group=session-1',
	);
});

test('omnibox: entering plain text searches in the dashboard', async () => {
	const {harness, enter} = omniboxHarness();
	await enter('some words');
	assert.equal(
		harness.tabs.find((tab) => tab.id === 3)?.url,
		'chrome-extension://tablodge/newtab.html?q=some+words',
	);
});

test('omnibox: a bookmark saved after the first search shows up in the next one', async () => {
	const {harness, suggest} = omniboxHarness();
	assert.deepEqual(await suggest('lemmings'), []);
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'Lemmings fan site', url: 'https://lemmings.example/'},
	});
	assert.equal(added.ok, true, added.error);
	assert.equal((await suggest('lemmings')).length, 1);
});

const manyTabsSession = (
	count: number,
	settings: Record<string, unknown> = {},
) => {
	const state = stateWithSession(settings);
	state.groups[0].tabs = Array.from({length: count}, (_, index) => ({
		id: `bulk-${index}`,
		title: `Bulk ${index}`,
		url: `https://bulk${index}.example/${index}`,
	}));
	return state;
};

test('a large restore opens tabs in batches and waits for each batch to load', async () => {
	const harness = createWorkerHarness(manyTabsSession(130), undefined, {
		loadingTabs: true,
		manualTimers: true,
	});
	const restoring = harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	const seen: number[] = [];
	for (let batch = 0; batch < 5; batch += 1) {
		await settle();
		seen.push(harness.openedTabs.length);
		await harness.runTimers();
		assert.equal(harness.openedTabs.length, seen[batch], 'still waiting');
		harness.completeLoading();
		await harness.runTimers();
	}

	const response = await restoring;
	assert.equal(response.ok, true, response.error);
	assert.deepEqual(seen, [25, 50, 75, 100, 125]);
	assert.equal(harness.openedTabs.length, 130);
	assert.equal(response.count, 130);
});

test('a restore at or below the batch threshold opens every tab without waiting', async () => {
	const harness = createWorkerHarness(manyTabsSession(100), undefined, {
		loadingTabs: true,
	});
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(harness.openedTabs.length, 100);
});

test('a batch that never finishes loading does not hold the restore forever', async () => {
	const harness = createWorkerHarness(manyTabsSession(101), undefined, {
		loadingTabs: true,
	});
	const response = await harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	assert.equal(response.ok, true, response.error);
	assert.equal(response.count, 101);
}, 30_000);

test('with unloading on, each batch is unloaded before the next opens, and the active tab stays', async () => {
	const harness = createWorkerHarness(
		manyTabsSession(130, {
			unloadRestoredTabs: true,
			unloadRestoredTabsThreshold: 5,
		}),
		undefined,
		{loadingTabs: true, manualTimers: true},
	);
	const restoring = harness.sendMessage({
		type: 'RESTORE_GROUP',
		groupId: 'session-1',
	});
	await settle();
	assert.equal(harness.openedTabs.length, 25);
	assert.equal(
		harness.discardedTabs.length,
		0,
		'nothing unloaded while it loads',
	);
	harness.completeLoading();
	await harness.runTimers();
	assert.equal(harness.openedTabs.length, 50);
	assert.equal(harness.discardedTabs.length, 24);
	for (let batch = 0; batch < 4; batch += 1) {
		harness.completeLoading();
		await harness.runTimers();
	}

	const response = await restoring;
	assert.equal(response.ok, true, response.error);
	assert.equal(response.count, 130);
	assert.equal(harness.openedTabs.length, 130);
	assert.equal(harness.discardedTabs.length, 129);
});

const SYNC_TOKEN = 'worker-sync-token-0123456789-abcdefghij';

function syncServer() {
	const log = new ChangeLog();
	const privateLog = new ChangeLog();
	const app = createApi({token: SYNC_TOKEN, log: () => log});
	const privateApp = createApi({token: SYNC_TOKEN, log: () => privateLog});
	return {
		log,
		privateLog,
		async fetch(url: string, init: RequestInit) {
			const {pathname, search} = new URL(url);
			return pathname.startsWith('/private/')
				? privateApp.request(pathname.slice('/private'.length) + search, init)
				: app.request(url, init);
		},
	};
}

const SYNC_URL = 'https://sync.example.test';
const regularSync = {
	'tablodge.sync.config': {url: SYNC_URL, token: SYNC_TOKEN},
};

function privateValues(log: ChangeLog): unknown[] {
	const page = log.pull(0, 1000);
	return page.resync
		? []
		: page.changes.flatMap((change) => (change.deleted ? [] : [change.value]));
}

test('a page with its own link goes only to the server that link names', async () => {
	const sql = sqlite(':memory:');
	const pages = new SqlPageStore(sql);
	const log = new SqlChangeLog(sql);
	const app = createApi({
		token: SYNC_TOKEN,
		log: () => log,
		pages: () => pages,
	});
	const regular = createWorkerHarness(stateWithSession(), undefined, {
		fetch: async (url: string, init: RequestInit) => app.request(url, init),
		storage: regularSync,
	});
	const ready = await regular.sendMessage({type: 'GET_SHARED_PAGES'});
	assert.equal(ready.linkBase, `${SYNC_URL}/p/`);

	const moved = await regular.sendMessage({
		type: 'UPLOAD_SHARED_PAGE',
		title: 'Reading',
		html: '<p>Reading</p>',
		id: 'AAAAAAAAAAAAAAAAAAAAAA',
		linkBase: 'https://old-server.example.test/p/',
	});
	assert.equal(moved.ok, false);
	assert.match(String(moved.error), /sync server changed/);
	assert.deepEqual(pages.list(), []);

	const kept = await regular.sendMessage({
		type: 'UPLOAD_SHARED_PAGE',
		title: 'Reading',
		html: '<p>Reading</p>',
		id: 'AAAAAAAAAAAAAAAAAAAAAA',
		linkBase: ready.linkBase,
		source: 'column:c1',
	});
	assert.equal(kept.ok, true, kept.error);
	assert.equal(kept.page?.url, `${SYNC_URL}/p/AAAAAAAAAAAAAAAAAAAAAA`);
	assert.equal(kept.page?.source, 'column:c1');
});

test('a regular window uploads, lists, and deletes shared pages; a private window cannot', async () => {
	const sql = sqlite(':memory:');
	const pages = new SqlPageStore(sql);
	const app = createApi({
		token: SYNC_TOKEN,
		log: (() => {
			const log = new SqlChangeLog(sql);
			return () => log;
		})(),
		pages: () => pages,
	});
	const fetch = async (url: string, init: RequestInit) =>
		app.request(url, init);
	const regular = createWorkerHarness(stateWithSession(), undefined, {
		fetch,
		storage: regularSync,
	});
	const ready = await regular.sendMessage({type: 'GET_SHARED_PAGES'});
	assert.equal(ready.server, 'ready');

	const uploaded = await regular.sendMessage({
		type: 'UPLOAD_SHARED_PAGE',
		title: 'Reading',
		html: '<p>Reading</p>',
	});
	assert.equal(uploaded.ok, true, uploaded.error);
	assert.ok(String(uploaded.page?.url).startsWith(`${SYNC_URL}/p/`));
	const listed = await regular.sendMessage({
		type: 'GET_SHARED_PAGES',
		list: true,
	});
	assert.deepEqual(
		listed.pages?.map((page: {title: string}) => page.title),
		['Reading'],
	);

	const inPrivate = createWorkerHarness(stateWithSession(), undefined, {
		incognitoContext: true,
		fetch,
		storage: {
			'tablodge.private.config': {mode: 'shared', configured: true},
			...regularSync,
		},
	});
	assert.equal(
		(await inPrivate.sendMessage({type: 'GET_SHARED_PAGES', list: true}))
			.server,
		'none',
	);
	assert.equal(
		(
			await inPrivate.sendMessage({
				type: 'UPLOAD_SHARED_PAGE',
				title: 'Secret',
				html: '<p>Secret</p>',
			})
		).ok,
		false,
	);

	assert.equal(
		(
			await regular.sendMessage({
				type: 'DELETE_SHARED_PAGE',
				id: String(uploaded.page?.id),
			})
		).ok,
		true,
	);
	assert.deepEqual(pages.list(), []);

	const noServer = createWorkerHarness(stateWithSession());
	assert.equal(
		(await noServer.sendMessage({type: 'GET_SHARED_PAGES'})).server,
		'none',
	);
});

const remoteSource = (id: string, value?: Record<string, unknown>) => ({
	kind: 'source' as const,
	id,
	h: stampAt(Date.now() + 60_000),
	d: 'other-browser',
	...(value ? {value} : {deleted: true as const}),
});

test('the theme and accents from another browser apply here, and the rest of the private config stays', async () => {
	const server = syncServer();
	const remoteSetting = (id: string, value: unknown) => ({
		kind: 'setting' as const,
		id,
		h: stampAt(Date.now() + 60_000),
		d: 'other-browser',
		value,
	});
	assert.deepEqual(
		server.log.push(
			[
				remoteSetting('uiTheme', 'dark'),
				remoteSetting('uiAccent', 'not-an-accent'),
				remoteSetting('privateAccent', 'violet'),
			],
			Date.now(),
		),
		['applied', 'applied', 'applied'],
	);
	const privateConfig = {
		mode: 'saved',
		configured: true,
		redirectNewTabs: false,
		accent: 'teal',
	};
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		fetch: server.fetch,
		storage: {
			...regularSync,
			uiAccent: 'rose',
			'tablodge.private.config': privateConfig,
		},
	});
	await harness.sendMessage({type: 'SYNC_NOW'});
	assert.equal(harness.extraStorage.uiTheme, 'dark');
	assert.equal(harness.extraStorage.uiAccent, 'rose', 'a value not valid here');
	assert.deepEqual(
		structuredClone(harness.extraStorage['tablodge.private.config']),
		{
			...privateConfig,
			accent: 'violet',
		},
	);
});

test('Sources choices pulled from another browser show as on there, not here', async () => {
	const server = syncServer();
	assert.deepEqual(
		server.log.push([remoteSource('youtube', {columnId: 'c'})], Date.now()),
		['applied'],
	);
	const harness = sourcesHarness({fetch: server.fetch, storage: regularSync});
	await harness.sendMessage({type: 'SYNC_NOW'});
	const result = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.deepEqual(result.ok && structuredClone(result.sources[0]), {
		id: 'youtube',
		enabled: false,
		wanted: true,
		columnId: 'c',
	});
	assert.equal(harness.registeredScripts.size, 0);
});

test('a site removed in another browser goes off here: script, access, and Not now answers', async () => {
	const server = syncServer();
	const harness = sourcesHarness({
		fetch: server.fetch,
		storage: {
			...regularSync,
			'tablodge.sourceCatchUp': {
				version: 1,
				dismissed: {youtube: ['https://www.youtube.com/watch?v=jNQXAC9IVRw']},
			},
		},
	});
	await switchOnYoutube(harness);
	await harness.sendMessage({type: 'SYNC_NOW'});
	const pushed = server.log.pull(0, 100);
	assert.equal(pushed.resync, false);
	assert.deepEqual(
		pushed.resync
			? []
			: pushed.changes
					.filter((change) => change.kind === 'source')
					.map(({id, value}) => [id, structuredClone(value)]),
		[['youtube', {}]],
		'the choice went to the server',
	);

	server.log.push([remoteSource('youtube')], Date.now());
	await harness.sendMessage({type: 'SYNC_NOW'});
	const result = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.deepEqual(result.ok && structuredClone(result.sources[0]), {
		id: 'youtube',
		enabled: false,
		wanted: false,
	});
	assert.equal(harness.registeredScripts.size, 0);
	const again = await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'youtube',
		enabled: true,
	});
	assert.equal(again.ok, false, 'the access was given back');
	assert.deepEqual(
		structuredClone(
			(harness.extraStorage['tablodge.sourceCatchUp'] as {dismissed: unknown})
				.dismissed,
		),
		{youtube: []},
	);
});

test('a site removed in another browser after this one lost its access clears its Not now answers here too', async () => {
	const server = syncServer();
	const harness = sourcesHarness({
		fetch: server.fetch,
		storage: {
			...regularSync,
			'tablodge.sourceCatchUp': {
				version: 1,
				dismissed: {youtube: ['https://www.youtube.com/watch?v=jNQXAC9IVRw']},
			},
		},
	});
	await switchOnYoutube(harness);
	await harness.sendMessage({type: 'SYNC_NOW'});
	await harness.revokeOrigins(YOUTUBE_ORIGINS);
	server.log.push([remoteSource('youtube')], Date.now());
	await harness.sendMessage({type: 'SYNC_NOW'});
	const result = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.deepEqual(result.ok && structuredClone(result.sources[0]), {
		id: 'youtube',
		enabled: false,
		wanted: false,
	});
	assert.deepEqual(
		structuredClone(
			(harness.extraStorage['tablodge.sourceCatchUp'] as {dismissed: unknown})
				.dismissed,
		),
		{youtube: []},
	);
});

test('a separate private library syncs to its own space on the server, apart from the regular library', async () => {
	const server = syncServer();
	const first = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	const status = await first.sendMessage({type: 'PRIVATE_SYNC_STATUS'});
	assert.equal(status.privateSync?.availability, 'ready');
	assert.equal(status.privateSync?.status.connected, false);
	assert.equal((await enableLock(first)).ok, true);

	const enabled = await first.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});
	assert.equal(enabled.ok, true, enabled.error);
	assert.equal(enabled.privateSync?.status.connected, true);
	assert.equal(enabled.privateSync?.encrypted, true);
	assert.equal(server.log.cursor, 0, 'nothing went to the regular library');
	assert.ok(server.privateLog.cursor > 0);

	const second = createWorkerHarness({}, undefined, {
		incognitoContext: true,
		fetch: server.fetch,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			...regularSync,
		},
	});
	assert.equal((await enableLock(second)).ok, true);
	assert.equal(
		(
			await second.sendMessage({
				type: 'PRIVATE_SYNC_ENABLE',
				credential: lockPassword,
			})
		).ok,
		true,
	);
	const library = await second.sendMessage({type: 'GET_STATE'});
	assert.ok(
		library.bookmarks?.some(
			(bookmark) => bookmark.url === 'https://secret-bookmark.example/',
		),
	);

	const off = await second.sendMessage({type: 'PRIVATE_SYNC_DISABLE'});
	assert.equal(off.privateSync?.status.connected, false);
});

test('a regular window opens Settings in a private window to turn private sync on', async () => {
	const regular = createWorkerHarness(stateWithSession(), undefined, {
		storage: {'tablodge.private.config': {mode: 'saved', configured: true}},
	});
	assert.equal(
		(await regular.sendMessage({type: 'OPEN_PRIVATE_SYNC'})).ok,
		true,
	);
	assert.equal(regular.windowCreateCalls.length, 1);
	assert.equal(regular.windowCreateCalls[0].incognito, true);
	assert.match(
		String(regular.windowCreateCalls[0].url),
		/options\.html\?privateSync=ask#settings-sync$/,
	);

	const inPrivate = await plainPrivateLibrary({});
	assert.equal(
		(await inPrivate.sendMessage({type: 'OPEN_PRIVATE_SYNC'})).ok,
		false,
	);
	assert.equal(inPrivate.windowCreateCalls.length, 0);
});

test('private sync waits for a regular sync server and separate saved storage', async () => {
	const server = syncServer();
	const noServer = await plainPrivateLibrary({fetch: server.fetch});
	assert.equal(
		(await noServer.sendMessage({type: 'PRIVATE_SYNC_STATUS'})).privateSync
			?.availability,
		'no-server',
	);
	assert.equal(
		(await noServer.sendMessage({type: 'PRIVATE_SYNC_ENABLE'})).ok,
		false,
	);

	const shared = createWorkerHarness(stateWithSession(), undefined, {
		incognitoContext: true,
		fetch: server.fetch,
		storage: {
			'tablodge.private.config': {mode: 'shared', configured: true},
			...regularSync,
		},
	});
	assert.equal(
		(await shared.sendMessage({type: 'PRIVATE_SYNC_STATUS'})).privateSync
			?.availability,
		'shared',
	);
	const regular = createWorkerHarness(stateWithSession(), undefined, {
		fetch: server.fetch,
	});
	assert.equal(
		(await regular.sendMessage({type: 'PRIVATE_SYNC_STATUS'})).ok,
		false,
	);
	assert.equal(server.privateLog.cursor, 0);
});

test('a private library with a password syncs encrypted, and another browser needs the same one to read it', async () => {
	const server = syncServer();
	const first = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	assert.equal((await enableLock(first)).ok, true);

	const asked = await first.sendMessage({type: 'PRIVATE_SYNC_ENABLE'});
	assert.equal(asked.ok, false);
	assert.equal(asked.field, 'credential');
	const wrong = await first.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: 'not the password',
	});
	assert.equal(wrong.field, 'credential');
	assert.equal(server.privateLog.key, null);

	const enabled = await first.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});
	assert.equal(enabled.ok, true, enabled.error);
	assert.equal(enabled.privateSync?.encrypted, true);
	assert.notEqual(server.privateLog.key, null);
	const onServer = JSON.stringify(privateValues(server.privateLog));
	assert.ok(server.privateLog.cursor > 0);
	assert.equal(onServer.includes('secret-bookmark'), false);
	assert.equal(onServer.includes('Secret folder'), false);
	assert.equal(
		JSON.stringify(first.extraStorage).includes(lockPassword),
		false,
	);

	const second = createWorkerHarness({}, undefined, {
		incognitoContext: true,
		fetch: server.fetch,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			...regularSync,
		},
	});
	const unlocked = await second.sendMessage({type: 'PRIVATE_SYNC_ENABLE'});
	assert.equal(unlocked.ok, false);
	assert.equal(
		unlocked.field,
		undefined,
		'a library without a lock is refused',
	);
	assert.equal((await enableLock(second)).ok, true);
	const needs = await second.sendMessage({type: 'PRIVATE_SYNC_ENABLE'});
	assert.equal(needs.field, 'credential');
	assert.match(needs.error ?? '', /protects private data on the sync server/);
	assert.equal(
		(
			await second.sendMessage({
				type: 'PRIVATE_SYNC_ENABLE',
				credential: 'a different password',
			})
		).field,
		'credential',
	);
	const joined = await second.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});
	assert.equal(joined.ok, true, joined.error);
	const library = await second.sendMessage({type: 'GET_STATE'});
	assert.ok(library.folders?.some((folder) => folder.name === 'Secret folder'));
	await second.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {
			title: 'From the second',
			url: 'https://second-private.example/',
		},
	});
	await second.sendMessage({type: 'PRIVATE_SYNC_NOW'});
	assert.equal(
		JSON.stringify(privateValues(server.privateLog)).includes('second-private'),
		false,
	);
	await first.sendMessage({type: 'PRIVATE_SYNC_NOW'});
	const firstLibrary = await first.sendMessage({type: 'GET_STATE'});
	assert.ok(
		firstLibrary.bookmarks?.some(
			(bookmark) => bookmark.url === 'https://second-private.example/',
		),
	);
});

test('private sync is refused until the library has a password, and the lock cannot come off while it syncs', async () => {
	const server = syncServer();
	const harness = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	const refused = await harness.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});
	assert.equal(refused.ok, false);
	assert.match(refused.error ?? '', /Set a password/);
	assert.equal(server.privateLog.cursor, 0);
	assert.equal(server.privateLog.key, null);

	assert.equal((await enableLock(harness)).ok, true);
	assert.equal(
		(
			await harness.sendMessage({
				type: 'PRIVATE_SYNC_ENABLE',
				credential: lockPassword,
			})
		).ok,
		true,
	);
	const removed = await harness.sendMessage({
		type: 'REMOVE_PRIVATE_LOCK',
		credential: lockPassword,
	});
	assert.equal(removed.ok, false);
	assert.match(removed.error ?? '', /Turn off private sync/);

	await harness.sendMessage({type: 'PRIVATE_SYNC_DISABLE'});
	assert.equal(
		(
			await harness.sendMessage({
				type: 'REMOVE_PRIVATE_LOCK',
				credential: lockPassword,
			})
		).ok,
		true,
	);
});

test('a library kept on the device with its own password adopts the server’s when it turns sync on, and the data merges', async () => {
	const server = syncServer();
	const first = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	await enableLock(first);
	await first.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});

	const other = createWorkerHarness({}, undefined, {
		incognitoContext: true,
		fetch: server.fetch,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			...regularSync,
		},
	});
	await other.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'Local only', url: 'https://local-only.example/'},
	});
	await other.sendMessage({
		type: 'ENABLE_PRIVATE_LOCK',
		credential: 'another password',
	});
	const asked = await other.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: 'another password',
	});
	assert.equal(asked.ok, false);
	assert.equal(asked.field, 'serverCredential');
	assert.equal(
		(await other.sendMessage({type: 'PRIVATE_SYNC_STATUS'})).privateSync?.status
			.connected,
		false,
	);
	const wrong = await other.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: 'another password',
		serverCredential: 'not the server password',
	});
	assert.equal(wrong.field, 'serverCredential');

	const joined = await other.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: 'another password',
		serverCredential: lockPassword,
	});
	assert.equal(joined.ok, true, joined.error);
	const library = await other.sendMessage({type: 'GET_STATE'});
	const urls = library.bookmarks?.map((bookmark) => bookmark.url) ?? [];
	assert.ok(urls.includes('https://local-only.example/'), 'local data stays');
	assert.ok(
		urls.includes('https://secret-bookmark.example/'),
		'the server’s data merged in',
	);
	await other.sendMessage({type: 'LOCK_PRIVATE'});
	assert.equal(
		(
			await other.sendMessage({
				type: 'UNLOCK_PRIVATE',
				credential: 'another password',
			})
		).ok,
		false,
	);
	assert.equal(
		(
			await other.sendMessage({
				type: 'UNLOCK_PRIVATE',
				credential: lockPassword,
			})
		).ok,
		true,
	);
});

test('a first password set with the sync choice also turns private sync on and sends the library encrypted', async () => {
	const server = syncServer();
	const harness = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	const set = await harness.sendMessage({
		type: 'ENABLE_PRIVATE_LOCK',
		credential: lockPassword,
		sync: true,
	});
	assert.equal(set.ok, true, set.error);
	const status = await harness.sendMessage({type: 'PRIVATE_SYNC_STATUS'});
	assert.equal(status.privateSync?.status.connected, true);
	assert.equal(status.privateSync?.encrypted, true);
	assert.notEqual(server.privateLog.key, null);

	const kept = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	assert.equal((await enableLock(kept)).ok, true);
	assert.equal(
		(await kept.sendMessage({type: 'PRIVATE_SYNC_STATUS'})).privateSync?.status
			.connected,
		false,
		'without the choice the library stays on the device',
	);
});

test('erasing the private library removes its data, its lock, and its sync key, and keeps the regular library and the storage choice', async () => {
	const server = syncServer();
	const harness = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	await enableLock(harness);
	await harness.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});

	const erased = await harness.sendMessage({type: 'RESET_PRIVATE_LIBRARY'});
	assert.equal(erased.ok, true, erased.error);
	assert.equal(erased.enabled, false);
	assert.equal(erased.needsLock, true);
	assert.deepEqual(privateDataKeys(harness.extraStorage), []);
	assert.equal(harness.extraStorage[LOCK_RECORD], undefined);
	assert.deepEqual(harness.extraStorage['tablodge.private.config'], {
		mode: 'saved',
		configured: true,
	});
	assert.equal(
		(await harness.sendMessage({type: 'PRIVATE_SYNC_STATUS'})).privateSync
			?.status.connected,
		false,
	);

	const regular = createWorkerHarness(stateWithSession());
	assert.equal(
		(await regular.sendMessage({type: 'RESET_PRIVATE_LIBRARY'})).ok,
		false,
	);
});

test('a new browser joins the sync server’s private library with its password, which becomes its lock', async () => {
	const server = syncServer();
	const first = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	const empty = await first.sendMessage({type: 'GET_PRIVATE_SERVER'});
	assert.equal(
		JSON.stringify(empty.privateServer),
		'{"connected":true,"hasKey":false}',
	);
	await enableLock(first);
	await first.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});

	const second = createWorkerHarness({}, undefined, {
		incognitoContext: true,
		fetch: server.fetch,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			...regularSync,
		},
	});
	assert.equal(
		JSON.stringify(
			(await second.sendMessage({type: 'GET_PRIVATE_SERVER'})).privateServer,
		),
		'{"connected":true,"hasKey":true}',
	);
	const wrong = await second.sendMessage({
		type: 'JOIN_PRIVATE_SERVER',
		credential: 'not the password',
	});
	assert.equal(wrong.ok, false);
	assert.equal(wrong.field, 'credential');
	assert.equal(
		(await second.sendMessage({type: 'GET_PRIVATE_LOCK'})).needsLock,
		true,
		'a wrong entry locks nothing',
	);

	const joined = await second.sendMessage({
		type: 'JOIN_PRIVATE_SERVER',
		credential: lockPassword,
	});
	assert.equal(joined.ok, true, joined.error);
	assert.equal(joined.enabled, true);
	assert.equal(joined.needsLock, false);
	const status = await second.sendMessage({type: 'PRIVATE_SYNC_STATUS'});
	assert.equal(status.privateSync?.status.connected, true);
	const library = await second.sendMessage({type: 'GET_STATE'});
	assert.ok(
		library.bookmarks?.some(
			(bookmark) => bookmark.url === 'https://secret-bookmark.example/',
		),
		'the server’s data joined this library',
	);
	assert.equal(
		(
			await second.sendMessage({
				type: 'JOIN_PRIVATE_SERVER',
				credential: 'a different password',
			})
		).ok,
		false,
		'a library that has a lock cannot join with another password',
	);
});

test('a browser with no sync server has nothing to join', async () => {
	const harness = await plainPrivateLibrary();
	assert.equal(
		JSON.stringify(
			(await harness.sendMessage({type: 'GET_PRIVATE_SERVER'})).privateServer,
		),
		'{"connected":false,"hasKey":false}',
	);
	assert.equal(
		(
			await harness.sendMessage({
				type: 'JOIN_PRIVATE_SERVER',
				credential: lockPassword,
			})
		).ok,
		false,
	);
});

test('a lock an older version made with a 4 digit PIN still unlocks, and its key still joins on the server', async () => {
	const server = syncServer();
	const first = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	const sent = await first.sendMessage({
		type: 'ENABLE_PRIVATE_LOCK',
		credential: '2468',
		sync: true,
	});
	assert.equal(sent.ok, true, sent.error);
	const record = first.extraStorage[LOCK_RECORD] as Record<string, unknown>;
	assert.equal(record.kind, 'password', 'a new lock is written as a password');
	first.extraStorage[LOCK_RECORD] = {...record, kind: 'pin'};

	await first.sendMessage({type: 'LOCK_PRIVATE'});
	assert.equal(
		(await first.sendMessage({type: 'UNLOCK_PRIVATE', credential: '1357'})).ok,
		false,
	);
	const opened = await first.sendMessage({
		type: 'UNLOCK_PRIVATE',
		credential: '2468',
	});
	assert.equal(opened.ok, true, opened.error);

	const second = createWorkerHarness({}, undefined, {
		incognitoContext: true,
		fetch: server.fetch,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			...regularSync,
		},
	});
	const joined = await second.sendMessage({
		type: 'JOIN_PRIVATE_SERVER',
		credential: '2468',
	});
	assert.equal(joined.ok, true, joined.error);
	const library = await second.sendMessage({type: 'GET_STATE'});
	assert.ok(
		library.bookmarks?.some(
			(bookmark) => bookmark.url === 'https://secret-bookmark.example/',
		),
	);
});

test('two workers connected to one server share sessions and bookmarks', async () => {
	const server = syncServer();
	const first = createWorkerHarness(stateWithSession(), undefined, {
		fetch: server.fetch,
	});
	const second = createWorkerHarness(
		{...stateWithSession(), groups: []},
		undefined,
		{fetch: server.fetch},
	);
	const connect = {
		type: 'SYNC_CONNECT',
		url: 'https://sync.example.test',
		token: SYNC_TOKEN,
	} as const;

	const connected = await first.sendMessage(connect);
	assert.equal(connected.ok, true, connected.error);
	assert.equal(connected.status?.phase, 'idle');
	assert.equal(connected.status?.pending, 0);
	assert.ok(server.log.cursor > 0);

	assert.equal((await second.sendMessage(connect)).ok, true);
	assert.deepEqual(
		second.state.groups.map((group) => group.name),
		['Research'],
	);
	assert.equal(
		second.state.groups[0]?.tabs[0]?.url,
		'https://saved.example/article',
	);

	await second.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'From the second device', url: 'https://second.example/'},
	});
	await second.sendMessage({type: 'SYNC_NOW'});
	await first.sendMessage({type: 'SYNC_NOW'});
	assert.ok(
		first.state.bookmarks?.some(
			(bookmark) => bookmark.url === 'https://second.example/',
		),
	);

	const status = await first.sendMessage({type: 'SYNC_DISCONNECT'});
	assert.equal(status.status?.connected, false);
	assert.equal(first.state.groups[0]?.name, 'Research');
});

test('settings that arrive through sync take effect here: the snapshot and backup alarms follow them', async () => {
	const server = syncServer();
	const first = createWorkerHarness(stateWithSession(), undefined, {
		fetch: server.fetch,
	});
	const second = createWorkerHarness(stateWithSession(), undefined, {
		fetch: server.fetch,
	});
	const connect = {
		type: 'SYNC_CONNECT',
		url: 'https://sync.example.test',
		token: SYNC_TOKEN,
	} as const;
	assert.equal((await first.sendMessage(connect)).ok, true);
	assert.equal((await second.sendMessage(connect)).ok, true);
	await second.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {snapshotsEnabled: true, autoBackup: 'off'},
	});
	assert.ok(second.alarms.get('tablodge-snapshot'));
	assert.equal(second.alarms.get('tablodge-backup'), undefined);

	await first.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {snapshotsEnabled: false, autoBackup: 'daily'},
	});
	await first.sendMessage({type: 'SYNC_NOW'});
	await second.sendMessage({type: 'SYNC_NOW'});
	assert.equal(second.state.settings.autoBackup, 'daily');
	assert.equal(second.alarms.get('tablodge-snapshot'), undefined);
	assert.equal(second.alarms.get('tablodge-backup')?.periodInMinutes, 1440);
});

test('sync refuses a plain http server and is off in private windows', async () => {
	const server = syncServer();
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		fetch: server.fetch,
	});
	const refused = await harness.sendMessage({
		type: 'SYNC_CONNECT',
		// eslint-disable-next-line unicorn/prefer-https -- plain HTTP to another host is what is refused
		url: 'http://sync.example.test',
		token: SYNC_TOKEN,
	});
	assert.equal(refused.ok, false);
	assert.match(refused.error ?? '', /https/);
	assert.equal(server.log.cursor, 0);

	const privateWorker = createWorkerHarness(stateWithSession(), undefined, {
		incognitoContext: true,
		storage: {'tablodge.private.config': {mode: 'temporary', configured: true}},
	});
	const off = await privateWorker.sendMessage({type: 'SYNC_STATUS'});
	assert.equal(off.ok, false);
});

test('a private window saving to the shared library tells the regular worker to sync, and a separate one does not', async () => {
	for (const mode of ['shared', 'saved'] as const) {
		const harness = createWorkerHarness(stateWithSession(), undefined, {
			incognitoContext: true,
			storage: {'tablodge.private.config': {mode, configured: true}},
		});
		harness.storageSets.length = 0;
		await harness.sendMessage({
			type: 'ADD_BOOKMARK',
			bookmark: {title: 'Private', url: 'https://private.example/'},
		});
		assert.equal(
			harness.storageSets.some((keys) => keys.includes('tablodge.sync.nudge')),
			mode === 'shared',
			mode,
		);
	}
});

test('a failed sync connect names the field the page should flag', async () => {
	const server = syncServer();
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		fetch: server.fetch,
	});
	const wrongToken = await harness.sendMessage({
		type: 'SYNC_CONNECT',
		url: 'https://sync.example.test',
		token: 'x'.repeat(SYNC_TOKEN.length),
	});
	assert.equal(wrongToken.ok, false);
	assert.equal(wrongToken.field, 'token');

	const unreachable = createWorkerHarness(stateWithSession(), undefined, {
		async fetch() {
			throw new TypeError('Failed to fetch');
		},
	});
	const offline = await unreachable.sendMessage({
		type: 'SYNC_CONNECT',
		url: 'https://sync.example.test',
		token: SYNC_TOKEN,
	});
	assert.equal(offline.ok, false);
	assert.equal(offline.field, 'url');
});

test('syncing an unchanged library sends nothing, even when normalizing adds the Archived folder', async () => {
	vi.useFakeTimers({toFake: ['Date']});
	try {
		await syncUnchangedLibraryRounds();
	} finally {
		vi.useRealTimers();
	}
});

async function syncUnchangedLibraryRounds() {
	const server = syncServer();
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		fetch: server.fetch,
	});
	assert.ok(
		!stateWithSession().folders?.some(
			(folder) => (folder as {name?: string}).name === 'Archived',
		),
		'the fixture has no stored Archived folder',
	);
	const connected = await harness.sendMessage({
		type: 'SYNC_CONNECT',
		url: 'https://sync.example.test',
		token: SYNC_TOKEN,
	});
	assert.equal(connected.ok, true, connected.error);
	const {cursor} = server.log;
	for (let round = 0; round < 3; round += 1) {
		vi.advanceTimersByTime(5);
		await harness.sendMessage({type: 'SYNC_NOW'});
	}

	assert.equal(server.log.cursor, cursor);
	assert.equal(
		(await harness.sendMessage({type: 'SYNC_STATUS'})).status?.pending,
		0,
	);
}

test('a new password rewraps the private sync key before it is reported changed, so other browsers keep syncing and new ones join with it', async () => {
	const server = syncServer();
	const first = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	await enableLock(first);
	await first.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});
	const before = server.privateLog.key;
	const changed = await first.sendMessage({
		type: 'CHANGE_PRIVATE_LOCK_CREDENTIAL',
		current: lockPassword,
		credential: 'a brand new password',
	});
	assert.equal(changed.ok, true, changed.error);
	assert.notEqual(server.privateLog.key, before);

	const late = createWorkerHarness({}, undefined, {
		incognitoContext: true,
		fetch: server.fetch,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			...regularSync,
		},
	});
	await late.sendMessage({
		type: 'ENABLE_PRIVATE_LOCK',
		credential: 'a brand new password',
	});
	assert.equal(
		(
			await late.sendMessage({
				type: 'PRIVATE_SYNC_ENABLE',
				credential: lockPassword,
			})
		).field,
		'credential',
	);
	const joined = await late.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: 'a brand new password',
	});
	assert.equal(joined.ok, true, joined.error);
	const synced = await first.sendMessage({type: 'PRIVATE_SYNC_NOW'});
	assert.equal(synced.privateSync?.status.error, null);
});

test('removing the sync server ends private sync, so the lock can come off and nothing stale is left', async () => {
	const server = syncServer();
	const harness = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	await enableLock(harness);
	await harness.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});
	assert.equal(
		(
			await harness.sendMessage({
				type: 'REMOVE_PRIVATE_LOCK',
				credential: lockPassword,
			})
		).ok,
		false,
		'still blocked while sync runs',
	);

	harness.externalStorage({'tablodge.sync.config': undefined});
	await settle();
	assert.equal(
		harness.extraStorage['tablodge.private.sync.private.key'],
		undefined,
	);
	assert.equal(
		harness.extraStorage['tablodge.private.sync.private.on'],
		undefined,
	);
	const removed = await harness.sendMessage({
		type: 'REMOVE_PRIVATE_LOCK',
		credential: lockPassword,
	});
	assert.equal(removed.ok, true, removed.error);
});

test('moving to another sync server ends private sync, and a new password is then accepted', async () => {
	const server = syncServer();
	const harness = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	await enableLock(harness);
	await harness.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});

	harness.externalStorage({
		'tablodge.sync.config': {
			url: 'https://other-sync.example.test',
			token: SYNC_TOKEN,
		},
	});
	await settle();
	const status = await harness.sendMessage({type: 'PRIVATE_SYNC_STATUS'});
	assert.equal(status.privateSync?.status.connected, false);
	assert.equal(
		harness.extraStorage['tablodge.private.sync.private.key'],
		undefined,
	);

	const changed = await harness.sendMessage({
		type: 'CHANGE_PRIVATE_LOCK_CREDENTIAL',
		current: lockPassword,
		credential: 'a brand new password',
	});
	assert.equal(changed.ok, true, changed.error);
});

test('turning private sync off deletes its key even when no client is running', async () => {
	const harness = await plainPrivateLibrary();
	await enableLock(harness);
	harness.externalStorage({
		'tablodge.private.sync.private.key': {id: 'x', raw: 'x', wrapped: 'x'},
		'tablodge.private.sync.private.on': true,
	});
	await settle();
	const status = await harness.sendMessage({type: 'PRIVATE_SYNC_STATUS'});
	assert.equal(status.privateSync?.status.connected, false);

	const off = await harness.sendMessage({type: 'PRIVATE_SYNC_DISABLE'});
	assert.equal(off.ok, true, off.error);
	assert.equal(
		harness.extraStorage['tablodge.private.sync.private.key'],
		undefined,
	);
	assert.equal(
		harness.extraStorage['tablodge.private.sync.private.on'],
		undefined,
	);
});

test('a server password made in one Unicode form joins when typed in an equivalent one that the new rule would call too short', async () => {
	const server = syncServer();
	const {createSyncKey, serverKeyText} =
		await import('../src/shared/private-sync');
	const key = await createSyncKey({value: 'e\u0301e\u0301', verified: true});
	const posted = await server.fetch(
		'https://sync.example.test/private/v1/key',
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${SYNC_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({key: serverKeyText(key), previous: null}),
		},
	);
	assert.equal(posted.status, 200);

	const browser = createWorkerHarness({}, undefined, {
		incognitoContext: true,
		fetch: server.fetch,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			...regularSync,
		},
	});
	const joined = await browser.sendMessage({
		type: 'JOIN_PRIVATE_SERVER',
		credential: 'éé',
	});
	assert.equal(joined.ok, true, joined.error);
	assert.equal(
		(await browser.sendMessage({type: 'GET_PRIVATE_LOCK'})).needsLock,
		false,
	);
});

test('two password changes started together run one after another, so the server and the browser end on the same one', async () => {
	const server = syncServer();
	const first = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	await enableLock(first);
	await first.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});
	const [one, two] = await Promise.all([
		first.sendMessage({
			type: 'CHANGE_PRIVATE_LOCK_CREDENTIAL',
			current: lockPassword,
			credential: 'blue blue blue',
		}),
		first.sendMessage({
			type: 'CHANGE_PRIVATE_LOCK_CREDENTIAL',
			current: 'blue blue blue',
			credential: 'plum plum plum',
		}),
	]);
	assert.equal(one.ok, true, one.error);
	assert.equal(two.ok, true, two.error);

	const other = createWorkerHarness({}, undefined, {
		incognitoContext: true,
		fetch: server.fetch,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			...regularSync,
		},
	});
	assert.equal(
		(
			await other.sendMessage({
				type: 'JOIN_PRIVATE_SERVER',
				credential: 'blue blue blue',
			})
		).ok,
		false,
		'the first password no longer opens the server key',
	);
	const joined = await other.sendMessage({
		type: 'JOIN_PRIVATE_SERVER',
		credential: 'plum plum plum',
	});
	assert.equal(joined.ok, true, joined.error);

	await first.sendMessage({type: 'LOCK_PRIVATE'});
	assert.equal(
		(
			await first.sendMessage({
				type: 'UNLOCK_PRIVATE',
				credential: 'blue blue blue',
			})
		).ok,
		false,
	);
	assert.equal(
		(
			await first.sendMessage({
				type: 'UNLOCK_PRIVATE',
				credential: 'plum plum plum',
			})
		).ok,
		true,
	);
});

test('a password change whose reply was lost, but that the server applied, is kept', async () => {
	const server = syncServer();
	let drop = false;
	const lossy = async (url: string, init: RequestInit) => {
		const response = await server.fetch(url, init);
		return drop && init.method === 'POST' && url.endsWith('/private/v1/key')
			? new Response('{}', {status: 500})
			: response;
	};

	const first = await plainPrivateLibrary({fetch: lossy}, regularSync);
	await enableLock(first);
	await first.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});
	drop = true;
	const changed = await first.sendMessage({
		type: 'CHANGE_PRIVATE_LOCK_CREDENTIAL',
		current: lockPassword,
		credential: 'blue blue blue',
	});
	assert.equal(changed.ok, true, changed.error);
	drop = false;
	await first.sendMessage({type: 'LOCK_PRIVATE'});
	assert.equal(
		(
			await first.sendMessage({
				type: 'UNLOCK_PRIVATE',
				credential: lockPassword,
			})
		).ok,
		false,
		'the library did not go back to the old password',
	);
	assert.equal(
		(
			await first.sendMessage({
				type: 'UNLOCK_PRIVATE',
				credential: 'blue blue blue',
			})
		).ok,
		true,
	);
});

test('a password change that the server may have taken, and that cannot be confirmed, is not undone', async () => {
	const server = syncServer();
	let blind = false;
	let posted = false;
	const lossy = async (url: string, init: RequestInit) => {
		if (posted && url.endsWith('/private/v1/key')) {
			throw new TypeError('offline');
		}

		const response = await server.fetch(url, init);
		if (blind && init.method === 'POST' && url.endsWith('/private/v1/key')) {
			posted = true;
			return new Response('{}', {status: 500});
		}

		return response;
	};

	const first = await plainPrivateLibrary({fetch: lossy}, regularSync);
	await enableLock(first);
	await first.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});
	const {key} = server.privateLog;
	blind = true;
	const changed = await first.sendMessage({
		type: 'CHANGE_PRIVATE_LOCK_CREDENTIAL',
		current: lockPassword,
		credential: 'blue blue blue',
	});
	blind = false;
	posted = false;
	assert.notEqual(server.privateLog.key, key, 'the server took the change');
	assert.equal(changed.ok, false);
	assert.match(changed.error ?? '', /did not confirm/);

	await first.sendMessage({type: 'LOCK_PRIVATE'});
	assert.equal(
		(
			await first.sendMessage({
				type: 'UNLOCK_PRIVATE',
				credential: lockPassword,
			})
		).ok,
		false,
	);
	assert.equal(
		(
			await first.sendMessage({
				type: 'UNLOCK_PRIVATE',
				credential: 'blue blue blue',
			})
		).ok,
		true,
	);
});

test('a join that saved the lock but could not reach the server carries on when it is tried again with the same password', async () => {
	const server = syncServer();
	const first = await plainPrivateLibrary({fetch: server.fetch}, regularSync);
	await enableLock(first);
	await first.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});

	let statusCalls = 0;
	const flaky = async (url: string, init: RequestInit) => {
		if (url.endsWith('/v1/status')) {
			statusCalls += 1;
			if (statusCalls === 1) {
				throw new TypeError('offline');
			}
		}

		return server.fetch(url, init);
	};

	const second = createWorkerHarness({}, undefined, {
		incognitoContext: true,
		fetch: flaky,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			...regularSync,
		},
	});
	const attempt = await second.sendMessage({
		type: 'JOIN_PRIVATE_SERVER',
		credential: lockPassword,
	});
	assert.equal(attempt.ok, false);
	assert.equal(
		(await second.sendMessage({type: 'GET_PRIVATE_LOCK'})).needsLock,
		false,
		'the lock was saved',
	);

	const wrong = await second.sendMessage({
		type: 'JOIN_PRIVATE_SERVER',
		credential: 'another password',
	});
	assert.equal(wrong.ok, false);
	const again = await second.sendMessage({
		type: 'JOIN_PRIVATE_SERVER',
		credential: lockPassword,
	});
	assert.equal(again.ok, true, again.error);
	assert.equal(
		(await second.sendMessage({type: 'PRIVATE_SYNC_STATUS'})).privateSync
			?.status.connected,
		true,
	);
});

test('a password change the sync server cannot take is undone, so the library and the server keep one', async () => {
	const server = syncServer();
	let reject = false;
	const fetchServer = async (url: string, init: RequestInit) =>
		reject && init.method === 'POST' && url.endsWith('/private/v1/key')
			? new Response('{}', {status: 409})
			: server.fetch(url, init);
	const first = await plainPrivateLibrary({fetch: fetchServer}, regularSync);
	await enableLock(first);
	await first.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});
	const before = server.privateLog.key;

	reject = true;
	const changed = await first.sendMessage({
		type: 'CHANGE_PRIVATE_LOCK_CREDENTIAL',
		current: lockPassword,
		credential: 'a brand new password',
	});
	assert.equal(changed.ok, false);
	assert.match(changed.error ?? '', /sync server could not take/);
	assert.equal(server.privateLog.key, before);

	reject = false;
	await first.sendMessage({type: 'LOCK_PRIVATE'});
	assert.equal(
		(
			await first.sendMessage({
				type: 'UNLOCK_PRIVATE',
				credential: lockPassword,
			})
		).ok,
		true,
		'the old password still opens the library',
	);
});

test('a session keeps the device that saved it, and a bad device kind is read as a computer', async () => {
	const state = stateWithSession();
	Object.assign(state.groups[0], {
		deviceName: " Berkay's  Mac ",
		deviceKind: 'toaster',
	});
	const {groups} = await createWorkerHarness(state).sendMessage({
		type: 'GET_STATE',
	});
	assert.equal(groups[0].deviceName, "Berkay's Mac");
	assert.equal(groups[0].deviceKind, 'desktop');
	const plain = await createWorkerHarness(stateWithSession()).sendMessage({
		type: 'GET_STATE',
	});
	assert.equal(plain.groups[0].deviceName, undefined);
});

test('a bookmark saved here carries this device, and a stored or imported one keeps its own', async () => {
	const harness = createWorkerHarness(stateWithSession(), [], {
		storage: {'tablodge.device': {name: 'Work laptop'}},
	});
	const here = {deviceName: 'Work laptop', deviceKind: 'desktop'};
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'One', url: 'https://one.example/'},
	});
	assert.equal(added.ok, true, added.error);
	assert.deepEqual(
		{
			deviceName: added.bookmark.deviceName,
			deviceKind: added.bookmark.deviceKind,
		},
		here,
	);
	const several = await harness.sendMessage({
		type: 'ADD_BOOKMARKS',
		bookmarks: [{title: 'Two', url: 'https://two.example/'}],
	});
	assert.equal(several.ok, true, several.error);
	const quoted = await harness.sendMessage({
		type: 'SAVE_QUOTE',
		url: 'https://three.example/',
		quote: 'A line',
	});
	assert.equal(quoted.ok, true, quoted.error);
	const imported = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: {
			format: 'tablodge',
			version: 1,
			bookmarks: [
				{
					title: 'Phone',
					url: 'https://phone.example/',
					deviceName: 'Pixel 9',
					deviceKind: 'mobile',
				},
				{title: 'Old', url: 'https://old.example/'},
			],
		},
	});
	assert.equal(imported.ok, true, imported.error);
	const device = (url: string) => {
		const bookmark = harness.state.bookmarks.find((entry) => entry.url === url);
		return bookmark && [bookmark.deviceName, bookmark.deviceKind];
	};

	assert.deepEqual(device('https://two.example/'), ['Work laptop', 'desktop']);
	assert.deepEqual(device('https://three.example/'), [
		'Work laptop',
		'desktop',
	]);
	assert.deepEqual(device('https://phone.example/'), ['Pixel 9', 'mobile']);
	const old = harness.state.bookmarks.find(
		(entry) => entry.url === 'https://old.example/',
	);
	assert.equal(old && 'deviceName' in old, false, 'an import has no device');
	assert.equal(old && 'deviceKind' in old, false);

	const edited = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK',
		bookmarkId: added.bookmark.id,
		fields: {title: 'Renamed'},
	});
	assert.equal(edited.bookmark.deviceName, 'Work laptop', 'an edit keeps it');
});

test('a stored bookmark keeps its device, and a bad device kind is read as a computer', async () => {
	const state = stateWithSession();
	state.bookmarks = [
		{
			id: 'b1',
			title: 'A',
			url: 'https://a.example/',
			columnId: 'bookmark-default',
			deviceName: ' Pixel  9 ',
			deviceKind: 'toaster',
			createdAt: 1,
			updatedAt: 1,
		},
		{
			id: 'b2',
			title: 'B',
			url: 'https://b.example/',
			columnId: 'bookmark-default',
			createdAt: 1,
			updatedAt: 1,
		},
		{
			id: 'b3',
			title: 'C',
			url: 'https://c.example/',
			columnId: 'bookmark-default',
			deviceName: {name: 'not text'},
			deviceKind: 'mobile',
			createdAt: 1,
			updatedAt: 1,
		},
	] as never;
	const {bookmarks} = await createWorkerHarness(state).sendMessage({
		type: 'GET_STATE',
	});
	assert.equal(bookmarks[0].deviceName, 'Pixel 9');
	assert.equal(bookmarks[0].deviceKind, 'desktop');
	assert.equal('deviceName' in bookmarks[1], false);
	assert.equal('deviceKind' in bookmarks[1], false);
	assert.equal(
		'deviceName' in bookmarks[2],
		false,
		'a name that is not text is dropped',
	);
});

test('a session takes a color like a column does: a preset or a hex, kept when omitted, removed with an empty one', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const update = async (fields: Record<string, unknown>) =>
		harness.sendMessage({
			type: 'UPDATE_GROUP',
			groupId: 'session-1',
			fields: fields as never,
		});
	assert.equal((await update({color: 'blue'})).group.color, 'blue');
	assert.equal((await update({name: 'Renamed'})).group.color, 'blue');
	assert.equal((await update({color: '#12ab9f'})).group.color, '#12ab9f');
	for (const bad of ['system', 'default', 'chartreuse', '#12']) {
		assert.equal((await update({color: bad})).group.color, undefined, bad);
	}

	assert.equal((await update({color: 'red'})).group.color, 'red');
	assert.equal((await update({color: ''})).group.color, undefined);
	const state = stateWithSession();
	Object.assign(state.groups[0], {color: 'nope'});
	const {groups} = await createWorkerHarness(state).sendMessage({
		type: 'GET_STATE',
	});
	assert.equal(groups[0].color, undefined);
});

function iconNetwork() {
	const asked: string[] = [];
	return {
		asked,
		async fetch(url: string) {
			const {pathname, searchParams} = new URL(url);
			assert.equal(pathname, '/v1/icon', `unexpected request to ${url}`);
			asked.push(searchParams.get('host')!);
			return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
				headers: {'Content-Type': 'image/png'},
			});
		},
	};
}

test('with a server connected, a site with no browser icon gets one from the server, asked once', async () => {
	const network = iconNetwork();
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		fetch: network.fetch,
		storage: regularSync,
	});
	assert.equal(
		(await harness.sendMessage({type: 'GET_SERVER_ICONS'})).on,
		true,
	);
	const first = await harness.sendMessage({
		type: 'GET_SERVER_ICON',
		url: 'https://imported.example/page',
	});
	assert.equal(first.icon, 'data:image/png;base64,iVBORw==');
	await harness.sendMessage({
		type: 'GET_SERVER_ICON',
		url: 'https://imported.example/other',
	});
	assert.deepEqual(network.asked, ['imported.example']);
	assert.deepEqual(harness.extraStorage[SITE_ICONS], {
		'imported.example': first.icon,
	});
});

test('no icon is asked for without a server, with Browser only, or from a private window with its own library', async () => {
	const network = iconNetwork();
	const ask = async (harness: ReturnType<typeof createWorkerHarness>) => {
		assert.equal(
			(await harness.sendMessage({type: 'GET_SERVER_ICONS'})).on,
			false,
		);
		const answer = await harness.sendMessage({
			type: 'GET_SERVER_ICON',
			url: 'https://imported.example/',
		});
		assert.equal(answer.ok, true, answer.error);
		assert.equal(answer.icon, null);
		assert.equal(harness.extraStorage[SITE_ICONS], undefined);
	};

	await ask(
		createWorkerHarness(stateWithSession(), undefined, {fetch: network.fetch}),
	);
	await ask(
		createWorkerHarness(stateWithSession({siteIcons: 'browser'}), undefined, {
			fetch: network.fetch,
			storage: regularSync,
		}),
	);
	await ask(
		createWorkerHarness({}, undefined, {
			incognitoContext: true,
			fetch: network.fetch,
			storage: {
				'tablodge.private.config': {mode: 'saved', configured: true},
				...regularSync,
			},
		}),
	);
	assert.deepEqual(network.asked, []);
});

test('an import skips addresses that are in the trash, and GET_TRASH lists them for the preview', async () => {
	const harness = createWorkerHarness(bookmarksState());
	await harness.sendMessage({type: 'DELETE_BOOKMARK', bookmarkId: 'bm-0'});
	await harness.sendMessage({type: 'DELETE_GROUP', groupId: 'session-1'});
	const trash = await harness.sendMessage({type: 'GET_TRASH'});
	assert.equal(trash.ok, true, trash.error);
	assert.equal(
		JSON.stringify(trash.urls),
		JSON.stringify({
			sessions: ['https://saved.example/article'],
			bookmarks: ['https://bm0.example/'],
		}),
	);

	const bookmarks = await harness.sendMessage({
		type: 'IMPORT_BOOKMARKS_FILE',
		data: {
			bookmarks: [
				{url: 'https://bm0.example/', title: 'Deleted'},
				{url: 'https://new.example/', title: 'New'},
			],
		},
	});
	assert.equal(bookmarks.ok, true, bookmarks.error);
	assert.equal(bookmarks.bookmarks, 1);
	assert.equal(bookmarks.skipped, 1);
	assert.equal(
		harness.state.bookmarks.some(
			(bookmark) => bookmark.url === 'https://bm0.example/',
		),
		false,
	);

	const sessions = await harness.sendMessage({
		type: 'IMPORT_GROUPS',
		data: {
			groups: [
				{
					name: 'Again',
					tabs: [
						{url: 'https://saved.example/article'},
						{url: 'https://fresh.example/'},
					],
				},
			],
		},
	});
	assert.equal(sessions.ok, true, sessions.error);
	assert.deepEqual(
		harness.state.groups.flatMap((group) => group.tabs.map((tab) => tab.url)),
		['https://fresh.example/'],
	);
});

test('a saved image follows its bookmark into the trash and goes when the trash is emptied and Undo has passed', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		scriptResult: {
			ok: true,
			type: 'image/png',
			width: 640,
			height: 480,
			data: PNG,
			thumb: WEBP,
		},
	});
	const url = 'https://cdn.example/full/cat.png';
	await harness.fire(
		'contextMenuClicked',
		{
			menuItemId: 'tablodge-image-save',
			mediaType: 'image',
			srcUrl: url,
			pageUrl: 'https://photos.example/album',
		},
		{id: 1, windowId: 1, url: 'https://photos.example/album'},
	);
	const imageKeys = () =>
		Object.keys(harness.extraStorage).filter((key) =>
			/^tablodge\.(?:image|thumb)\./.test(key),
		).length;
	const bookmark = harness.state.bookmarks.find((entry) => entry.url === url);
	assert.ok(bookmark, 'the image is bookmarked');
	assert.equal(imageKeys(), 2, 'the original and its thumbnail');
	assert.equal(
		(await harness.sendMessage({type: 'GET_STORAGE_USAGE'})).usage.images,
		70,
		'Settings counts the bytes of the originals',
	);

	await harness.sendMessage({
		type: 'DELETE_BOOKMARK',
		bookmarkId: bookmark.id!,
	});
	await settle();
	assert.equal(imageKeys(), 2, 'in the trash, the picture stays');

	await harness.sendMessage({type: 'EMPTY_TRASH'});
	await settle();
	assert.equal(imageKeys(), 2, 'while Undo can bring the bookmark back, too');

	const undo = harness.extraStorage['tablodge.undo'] as {
		records: Array<{createdAt: number}>;
	};
	for (const record of undo.records) {
		record.createdAt -= 10 * 60_000;
	}

	await harness.fire('alarm', {name: 'tablodge-undo'});
	await settle();
	assert.equal(imageKeys(), 0);
	const listed = await harness.sendMessage({type: 'GET_SAVED_IMAGES'});
	assert.equal(listed.items.length, 0);
});

test('a private window keeps no image', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		incognitoContext: true,
		scriptResult: {
			ok: true,
			type: 'image/png',
			width: 1,
			height: 1,
			data: PNG,
			thumb: WEBP,
		},
	});
	await harness.fire(
		'contextMenuClicked',
		{
			menuItemId: 'tablodge-image-save',
			mediaType: 'image',
			srcUrl: 'https://cdn.example/cat.png',
			pageUrl: 'https://photos.example/album',
		},
		{id: 1, windowId: 1, url: 'https://photos.example/album', incognito: true},
	);
	assert.deepEqual(
		Object.keys(harness.extraStorage).filter((key) =>
			key.startsWith('tablodge.image'),
		),
		[],
	);
});

const capturedPage = {
	v: 1,
	title: 'Current page',
	blocks: [
		{type: 'heading', text: 'A heading'},
		{type: 'paragraph', text: 'The text worth keeping.'},
	],
};

const copyIndexUrls = (harness: ReturnType<typeof createWorkerHarness>) => {
	const index = harness.extraStorage['tablodge.copies'] as
		{items: Array<{url: string}>} | undefined;
	return (index?.items ?? []).map((item) => item.url);
};

test('Keep a copy reads the tab, bookmarks an unsaved page, and goes to the trash with its link', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		scriptResult: capturedPage,
	});
	const kept = await harness.sendMessage({type: 'KEEP_PAGE_COPY', tabId: 1});
	assert.equal(kept.ok, true, kept.error);
	assert.equal(kept.bookmarked, true);
	assert.equal(kept.url, 'https://current.example/');
	assert.deepEqual(
		harness.executeScriptCalls.map((call) => call.target.tabId),
		[1, 1],
	);
	for (const call of harness.executeScriptCalls as Array<{func?: unknown}>) {
		if (call.func) {
			assert.match(String(call.func), /^function \w+\(/);
		}
	}

	const bookmark = harness.state.bookmarks.find(
		(entry) => entry.url === 'https://current.example/',
	);
	assert.ok(bookmark, 'the page was bookmarked to hold the copy');
	const read = await harness.sendMessage({
		type: 'GET_PAGE_COPY',
		url: 'https://current.example/',
	});
	assert.deepEqual(structuredClone(read.copy?.blocks), capturedPage.blocks);
	assert.equal(read.copy?.title, 'Current page');

	const again = await harness.sendMessage({type: 'KEEP_PAGE_COPY', tabId: 1});
	assert.equal(again.bookmarked, false);
	assert.equal(
		harness.state.bookmarks.filter(
			(entry) => entry.url === 'https://current.example/',
		).length,
		1,
	);

	await harness.sendMessage({
		type: 'DELETE_BOOKMARK',
		bookmarkId: bookmark.id!,
	});
	await settle();
	assert.deepEqual(copyIndexUrls(harness), ['https://current.example/']);

	const emptied = await harness.sendMessage({type: 'EMPTY_TRASH'});
	assert.ok(emptied.undoId);
	await settle();
	assert.deepEqual(copyIndexUrls(harness), ['https://current.example/']);

	const undo = harness.extraStorage['tablodge.undo'] as {
		records: Array<{createdAt: number}>;
	};
	for (const record of undo.records) {
		record.createdAt -= 10 * 60_000;
	}

	await harness.fire('alarm', {name: 'tablodge-undo'});
	await settle();
	assert.deepEqual(copyIndexUrls(harness), []);
	assert.deepEqual(
		Object.keys(harness.extraStorage).filter((key) =>
			key.startsWith('tablodge.copy.'),
		),
		[],
	);
	const listed = await harness.sendMessage({type: 'GET_PAGE_COPIES'});
	assert.deepEqual(structuredClone(listed.urls), []);
});

const copyKeys = (harness: ReturnType<typeof createWorkerHarness>) =>
	Object.keys(harness.extraStorage).filter((key) =>
		key.startsWith('tablodge.copy.'),
	);

test('DELETE_PAGE_COPY removes the copy at once and Undo brings back the same copy, link intact', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		scriptResult: capturedPage,
	});
	await harness.sendMessage({type: 'KEEP_PAGE_COPY', tabId: 1});
	const url = 'https://current.example/';
	const before = structuredClone(
		(await harness.sendMessage({type: 'GET_PAGE_COPY', url})).copy,
	);
	assert.ok(before);

	const deleted = await harness.sendMessage({type: 'DELETE_PAGE_COPY', url});
	assert.equal(deleted.ok, true);
	assert.ok(deleted.undoId);
	const {undoId} = deleted;
	assert.deepEqual(copyIndexUrls(harness), []);
	assert.deepEqual(copyKeys(harness), []);
	assert.equal(
		(await harness.sendMessage({type: 'GET_PAGE_COPY', url})).copy,
		null,
	);
	assert.ok(
		harness.state.bookmarks.some((entry) => entry.url === url),
		'the link stays saved',
	);

	const undone = await harness.sendMessage({type: 'UNDO', id: undoId});
	assert.equal(undone.ok, true, undone.error);
	assert.deepEqual(copyIndexUrls(harness), [url]);
	assert.deepEqual(
		structuredClone(
			(await harness.sendMessage({type: 'GET_PAGE_COPY', url})).copy,
		),
		before,
	);
});

test('a deleted copy and its Undo record are gone once the Undo window has passed', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		scriptResult: capturedPage,
	});
	await harness.sendMessage({type: 'KEEP_PAGE_COPY', tabId: 1});
	const deleted = await harness.sendMessage({
		type: 'DELETE_PAGE_COPY',
		url: 'https://current.example/',
	});
	assert.ok(deleted.undoId);

	const undo = harness.extraStorage['tablodge.undo'] as {
		records: Array<{createdAt: number}>;
	};
	for (const record of undo.records) {
		record.createdAt -= 10 * 60_000;
	}

	await harness.fire('alarm', {name: 'tablodge-undo'});
	await settle();
	assert.equal(harness.extraStorage['tablodge.undo'], undefined);
	assert.deepEqual(copyIndexUrls(harness), []);
	assert.deepEqual(copyKeys(harness), []);
	const late = await harness.sendMessage({type: 'UNDO', id: deleted.undoId});
	assert.equal(late.ok, false);
});

test('Undo of a deleted copy is refused when a new copy was kept since', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		scriptResult: capturedPage,
	});
	await harness.sendMessage({type: 'KEEP_PAGE_COPY', tabId: 1});
	const deleted = await harness.sendMessage({
		type: 'DELETE_PAGE_COPY',
		url: 'https://current.example/',
	});
	await harness.sendMessage({type: 'KEEP_PAGE_COPY', tabId: 1});
	const undone = await harness.sendMessage({type: 'UNDO', id: deleted.undoId!});
	assert.equal(undone.ok, false);
	assert.match(undone.error!, /changed since/);
	assert.deepEqual(copyIndexUrls(harness), ['https://current.example/']);
});

test('deleting a copy that is not there offers no Undo', async () => {
	const harness = createWorkerHarness(stateWithSession());
	const result = await harness.sendMessage({
		type: 'DELETE_PAGE_COPY',
		url: 'https://nothing.example/',
	});
	assert.equal(result.ok, true);
	assert.equal(result.undoId, undefined);
});

test('Keep a copy attaches to the saved link and refuses with the budget message when full', async () => {
	const state = stateWithSession();
	const savedUrl = state.groups[0].tabs[0].url!;
	state.bookmarks.push({
		id: 'bm-elsewhere',
		title: 'Elsewhere',
		url: 'https://elsewhere.example/',
		columnId: 'bookmark-default',
		createdAt: 1,
		updatedAt: 1,
	});
	const harness = createWorkerHarness(
		state,
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: savedUrl,
				title: 'Saved',
			},
		],
		{
			scriptResult: capturedPage,
			storage: {
				'tablodge.copies': {
					v: 1,
					items: [
						{
							url: 'https://elsewhere.example/',
							key: 'tablodge.copy.big',
							title: 'Big',
							savedAt: 1,
							size: 25_000_000,
						},
					],
				},
			},
		},
	);
	const full = await harness.sendMessage({type: 'KEEP_PAGE_COPY', tabId: 1});
	assert.equal(full.ok, false);
	assert.match(full.error!, /Copies are full/);

	await harness.sendMessage({
		type: 'DELETE_PAGE_COPY',
		url: 'https://elsewhere.example/',
	});
	const kept = await harness.sendMessage({type: 'KEEP_PAGE_COPY', tabId: 1});
	assert.equal(kept.ok, true, kept.error);
	assert.equal(kept.bookmarked, false);
	assert.equal(kept.url, savedUrl);
	assert.equal(
		harness.state.bookmarks.some((entry) => entry.url === savedUrl),
		false,
	);
});

test('Keep a copy is refused in private windows and on pages that cannot be read', async () => {
	const incognito = createWorkerHarness(stateWithSession(), undefined, {
		scriptResult: capturedPage,
		incognitoWindows: [10],
	});
	const tab = incognito.tabs[0];
	tab.incognito = true;
	const refused = await incognito.sendMessage({
		type: 'KEEP_PAGE_COPY',
		tabId: 1,
	});
	assert.equal(refused.ok, false);
	assert.match(refused.error!, /private windows/);
	assert.equal(incognito.executeScriptCalls.length, 0);

	const privateWorker = createWorkerHarness(stateWithSession(), undefined, {
		scriptResult: capturedPage,
		incognitoContext: true,
	});
	const fromPrivate = await privateWorker.sendMessage({
		type: 'KEEP_PAGE_COPY',
		tabId: 1,
	});
	assert.equal(fromPrivate.ok, false);

	const blocked = createWorkerHarness(stateWithSession(), undefined, {
		scriptingFails: true,
	});
	const unreadable = await blocked.sendMessage({
		type: 'KEEP_PAGE_COPY',
		tabId: 1,
	});
	assert.equal(unreadable.ok, false);
	assert.match(unreadable.error!, /could not read this page/);
	assert.equal(
		blocked.state.bookmarks.length,
		stateWithSession().bookmarks.length,
	);
});

test('a full backup carries the copies and a restore brings them back with their links', async () => {
	const harness = createWorkerHarness(stateWithSession(), undefined, {
		scriptResult: capturedPage,
	});
	await harness.sendMessage({type: 'KEEP_PAGE_COPY', tabId: 1});
	const backup = await harness.sendMessage({type: 'GET_FULL_BACKUP'});
	assert.equal(backup.copies.length, 1);
	assert.equal(backup.copies[0].url, 'https://current.example/');

	const fresh = createWorkerHarness(stateWithSession());
	const restored = await fresh.sendMessage({
		type: 'RESTORE_FULL_BACKUP',
		format: 'tablodge-full-backup',
		version: 1,
		state: backup.state,
		trash: backup.trash,
		copies: [...backup.copies, {v: 1, url: 'javascript:alert(1)', blocks: []}],
	});
	assert.equal(restored.ok, true, restored.error);
	assert.equal(restored.copies, 1);
	const read = await fresh.sendMessage({
		type: 'GET_PAGE_COPY',
		url: 'https://current.example/',
	});
	assert.deepEqual(structuredClone(read.copy?.blocks), capturedPage.blocks);

	const merging = createWorkerHarness(stateWithSession());
	assert.equal(
		(
			await merging.sendMessage({
				type: 'ADD_PAGE_COPIES',
				copies: backup.copies,
			})
		).copies,
		0,
		'the page is not saved here, so its copy has no link to belong to',
	);
	await merging.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'Current', url: 'https://current.example/'},
	});
	assert.equal(
		(
			await merging.sendMessage({
				type: 'ADD_PAGE_COPIES',
				copies: backup.copies,
			})
		).copies,
		1,
	);
	assert.equal(
		(
			await merging.sendMessage({
				type: 'ADD_PAGE_COPIES',
				copies: backup.copies,
			})
		).copies,
		0,
		'a copy already here is kept',
	);
});

test('a noted bookmark keeps its note and its copy together through delete, backup, and restore', async () => {
	const harness = createWorkerHarness(
		stateWithSession(),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://noted.example/',
				title: 'Noted',
			},
		],
		{scriptResult: capturedPage},
	);
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {
			title: 'Noted',
			url: 'https://noted.example/',
			notes: 'Why I saved it',
		},
	});
	assert.equal(added.ok, true, added.error);
	const kept = await harness.sendMessage({type: 'KEEP_PAGE_COPY', tabId: 1});
	assert.equal(kept.bookmarked, false, 'the copy joins the noted bookmark');

	const backup = await harness.sendMessage({type: 'GET_FULL_BACKUP'});
	const fresh = createWorkerHarness(stateWithSession());
	const restored = await fresh.sendMessage({
		type: 'RESTORE_FULL_BACKUP',
		format: 'tablodge-full-backup',
		version: 1,
		state: backup.state,
		trash: backup.trash,
		copies: backup.copies,
	});
	assert.equal(restored.copies, 1);
	assert.equal(
		fresh.state.bookmarks.find(
			(entry) => entry.url === 'https://noted.example/',
		)?.notes,
		'Why I saved it',
	);

	const id = harness.state.bookmarks.find(
		(entry) => entry.url === 'https://noted.example/',
	)!.id!;
	await harness.sendMessage({type: 'DELETE_BOOKMARK', bookmarkId: id});
	await settle();
	assert.deepEqual(copyIndexUrls(harness), ['https://noted.example/']);
	await harness.sendMessage({type: 'EMPTY_TRASH'});
	const undo = harness.extraStorage['tablodge.undo'] as {
		records: Array<{createdAt: number}>;
	};
	for (const record of undo.records) {
		record.createdAt -= 10 * 60_000;
	}

	await harness.fire('alarm', {name: 'tablodge-undo'});
	await settle();
	assert.deepEqual(copyIndexUrls(harness), []);
});

const YOUTUBE_ORIGINS = ['https://www.youtube.com/*'];
const youtubeTab = {
	id: 5,
	windowId: 10,
	index: 1,
	active: false,
	url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
	title: 'Big Buck Bunny - YouTube',
};
const fromYoutube = {tab: youtubeTab, url: youtubeTab.url};
const watchLater = (
	url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=WL',
) =>
	({
		type: 'SITE_SOURCE_SAVE',
		source: 'youtube',
		url,
		title: 'Never Gonna Give You Up',
	}) as const;

function sourcesHarness(options: HarnessOptions = {}) {
	return createWorkerHarness(
		stateWithSession(),
		[
			{
				id: 1,
				windowId: 10,
				index: 0,
				active: true,
				url: 'https://current.example/',
				title: 'Current',
			},
			youtubeTab,
		],
		options,
	);
}

async function switchOnYoutube(harness: ReturnType<typeof sourcesHarness>) {
	harness.grantOrigins(YOUTUBE_ORIGINS);
	return harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'youtube',
		enabled: true,
	});
}

test('a YouTube page bookmarked by hand goes to the YouTube column a save on the site made', async () => {
	const harness = sourcesHarness();
	await switchOnYoutube(harness);
	await harness.sendMessage(watchLater(), fromYoutube);
	(harness.listeners.onCommand as (c: string, t: unknown) => void)(
		'bookmark-page',
		youtubeTab,
	);
	await settle();
	assert.equal(harness.windowCreateCalls.length, 0);
	assert.equal(
		harness.state.bookmarks.find((bookmark) => bookmark.url === youtubeTab.url)
			?.columnId,
		'source-youtube',
	);
});

test('a source column leaves out a site another column already claims', async () => {
	const harness = sourcesHarness();
	const mine = await harness.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'Videos',
		domains: ['youtube.com'],
	});
	await switchOnYoutube(harness);
	await harness.sendMessage(watchLater(), fromYoutube);
	const domains = (id: string) =>
		harness.state.bookmarkColumns.find((column) => column.id === id)?.domains;
	assert.deepEqual(domains('source-youtube'), ['youtu.be']);
	assert.deepEqual(domains(mine.column.id), ['youtube.com']);
});

test('a save on a site carries this device', async () => {
	const harness = sourcesHarness({
		storage: {'tablodge.device': {name: 'Desk'}},
	});
	await switchOnYoutube(harness);
	await harness.sendMessage(watchLater(), fromYoutube);
	const saved = harness.state.bookmarks.find(
		(bookmark) => bookmark.title === 'Never Gonna Give You Up',
	);
	assert.deepEqual([saved?.deviceName, saved?.deviceKind], ['Desk', 'desktop']);
});

test('sources are off at install and no content script is registered', async () => {
	const harness = sourcesHarness();
	harness.listeners.onInstalled({reason: 'install'});
	await settle();
	const result = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.equal(result.ok, true, result.error);
	assert.deepEqual(structuredClone(result.sources), [
		{id: 'youtube', enabled: false, wanted: false},
		{id: 'reddit', enabled: false, wanted: false},
		{id: 'x', enabled: false, wanted: false},
		{id: 'instagram', enabled: false, wanted: false},
		{id: 'github', enabled: false, wanted: false},
		{id: 'hackernews', enabled: false, wanted: false},
		{id: 'stackoverflow', enabled: false, wanted: false},
		{id: 'devto', enabled: false, wanted: false},
		{id: 'lobsters', enabled: false, wanted: false},
		{id: 'bluesky', enabled: false, wanted: false},
		{id: 'soundcloud', enabled: false, wanted: false},
		{id: 'spotify', enabled: false, wanted: false},
		{id: 'letterboxd', enabled: false, wanted: false},
		{id: 'imdb', enabled: false, wanted: false},
		{id: 'goodreads', enabled: false, wanted: false},
		{id: 'medium', enabled: false, wanted: false},
		{id: 'substack', enabled: false, wanted: false},
	]);
	assert.equal(harness.registeredScripts.size, 0);
});

test('a source cannot be switched on without its permission, and registers nothing', async () => {
	const harness = sourcesHarness({refusePermissions: true});
	const result = await switchOnYoutube(harness);
	assert.equal(result.ok, false);
	assert.match(result.error ?? '', /did not grant access to www\.youtube\.com/);
	assert.equal(harness.registeredScripts.size, 0);
	const sources = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.equal(sources.ok && sources.sources[0]?.enabled, false);
});

test('switching a source on registers its script for that site only and reaches open tabs', async () => {
	const harness = sourcesHarness();
	const result = await switchOnYoutube(harness);
	assert.equal(result.ok, true, result.error);
	assert.deepEqual(structuredClone([...harness.registeredScripts.values()]), [
		{
			id: 'tablodge-source-youtube',
			matches: YOUTUBE_ORIGINS,
			js: ['site-source.js'],
			runAt: 'document_idle',
			persistAcrossSessions: true,
		},
	]);
	assert.deepEqual(
		structuredClone(
			harness.executeScriptCalls.map((call) => [call.target.tabId, call.files]),
		),
		[[5, ['site-source.js']]],
	);

	const off = await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'youtube',
		enabled: false,
	});
	assert.equal(off.ok, true, off.error);
	assert.equal(harness.registeredScripts.size, 0);
});

test('revoking the permission in the browser turns the source off and says so', async () => {
	const harness = sourcesHarness();
	await switchOnYoutube(harness);
	await harness.revokeOrigins(YOUTUBE_ORIGINS);
	assert.equal(harness.registeredScripts.size, 0);
	const result = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.deepEqual(result.ok && structuredClone(result.sources[0]), {
		id: 'youtube',
		enabled: false,
		wanted: true,
		notice: 'revoked',
	});
});

test('a site on in another browser shows as on but not here, and runs once this browser grants its access', async () => {
	const harness = sourcesHarness({
		storage: {
			'tablodge.sources': {version: 1, sources: {}, choices: {youtube: {}}},
		},
	});
	harness.listeners.onStartup();
	await settle();
	const before = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.deepEqual(before.ok && structuredClone(before.sources[0]), {
		id: 'youtube',
		enabled: false,
		wanted: true,
	});
	assert.equal(harness.registeredScripts.size, 0);

	await harness.sendMessage({
		type: 'SITE_SOURCES_POINTED',
		sources: ['youtube', 'nope'],
	});
	const pointed = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.equal(pointed.ok && pointed.sources[0]?.pointed, true);

	const on = await switchOnYoutube(harness);
	assert.deepEqual(on.ok && structuredClone(on.sources[0]), {
		id: 'youtube',
		enabled: true,
		wanted: true,
	});
	assert.equal(harness.registeredScripts.size, 1);
});

test('a Remove while startup checks the other sites keeps the site removed', async () => {
	const {promise: until, resolve: release} = Promise.withResolvers<void>();
	const redditOrigins = [
		'https://www.reddit.com/*',
		'https://old.reddit.com/*',
	];
	const harness = sourcesHarness({
		grantedOrigins: [...YOUTUBE_ORIGINS, ...redditOrigins],
		holdPermissionCheck: {origins: redditOrigins, until},
		storage: {
			'tablodge.sources': {
				version: 1,
				sources: {},
				choices: {youtube: {}, reddit: {}},
			},
		},
	});
	harness.listeners.onStartup();
	await settle();
	const removed = await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'youtube',
		enabled: false,
	});
	assert.equal(removed.ok, true, removed.error);
	release();
	await settle();
	const result = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.deepEqual(result.ok && structuredClone(result.sources[0]), {
		id: 'youtube',
		enabled: false,
		wanted: false,
	});
	assert.deepEqual(
		[...harness.registeredScripts.keys()],
		['tablodge-source-reddit'],
	);
});

test('access revoked while startup checks the other sites keeps the site off', async () => {
	const {promise: until, resolve: release} = Promise.withResolvers<void>();
	const redditOrigins = [
		'https://www.reddit.com/*',
		'https://old.reddit.com/*',
	];
	const harness = sourcesHarness({
		grantedOrigins: [...YOUTUBE_ORIGINS, ...redditOrigins],
		holdPermissionCheck: {origins: redditOrigins, until},
		storage: {
			'tablodge.sources': {
				version: 1,
				sources: {},
				choices: {youtube: {}, reddit: {}},
			},
		},
	});
	harness.listeners.onStartup();
	await settle();
	await harness.revokeOrigins(YOUTUBE_ORIGINS);
	release();
	await settle();
	const result = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	const status = (id: string) =>
		result.ok
			? structuredClone(result.sources.find((entry) => entry.id === id))
			: undefined;
	assert.deepEqual(status('youtube'), {
		id: 'youtube',
		enabled: false,
		wanted: true,
		notice: 'revoked',
	});
	assert.equal(status('reddit')?.enabled, true);
	assert.deepEqual(
		[...harness.registeredScripts.keys()],
		['tablodge-source-reddit'],
	);
});

test('a site chosen in another browser runs at startup without a click when this browser already grants its access', async () => {
	const harness = sourcesHarness({
		grantedOrigins: YOUTUBE_ORIGINS,
		storage: {
			'tablodge.sources': {
				version: 1,
				sources: {},
				choices: {youtube: {columnId: 'kept'}},
			},
		},
	});
	harness.listeners.onStartup();
	await settle();
	const result = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.deepEqual(result.ok && structuredClone(result.sources[0]), {
		id: 'youtube',
		enabled: true,
		wanted: true,
		columnId: 'kept',
	});
	assert.equal(harness.registeredScripts.size, 1);
});

test("Remove drops the site's choices, gives back its access, and keeps the choices of sites this version does not know", async () => {
	const harness = sourcesHarness({
		storage: {
			'tablodge.sources': {
				version: 1,
				sources: {},
				choices: {youtube: {columnId: 'c', later: 1}, mastodon: {x: 1}},
			},
		},
	});
	await switchOnYoutube(harness);
	const stored = () =>
		(harness.extraStorage['tablodge.sources'] as {choices: unknown}).choices;
	assert.deepEqual(structuredClone(stored()), {
		youtube: {columnId: 'c', later: 1},
		mastodon: {x: 1},
	});
	await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'youtube',
		enabled: false,
	});
	assert.deepEqual(structuredClone(stored()), {mastodon: {x: 1}});
	assert.equal(harness.registeredScripts.size, 0);
	const again = await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'youtube',
		enabled: true,
	});
	assert.equal(again.ok, false);
});

test('a permission revoked while the worker was stopped is caught at startup', async () => {
	const harness = sourcesHarness();
	await switchOnYoutube(harness);
	await harness.revokeOrigins(YOUTUBE_ORIGINS, {fire: false});
	harness.listeners.onStartup();
	await settle();
	assert.equal(harness.registeredScripts.size, 0);
	const result = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.equal(result.ok && result.sources[0]?.notice, 'revoked');
});

test('a save on YouTube goes to a new YouTube column, and Undo takes it back', async () => {
	const harness = sourcesHarness();
	await switchOnYoutube(harness);
	const saved = await harness.sendMessage(watchLater(), fromYoutube);
	assert.equal(saved.ok, true, saved.error);
	assert.equal(saved.outcome, 'saved');
	assert.equal(saved.column, 'YouTube');
	const column = harness.state.bookmarkColumns.find(
		(entry) => entry.name === 'YouTube',
	);
	assert.ok(column);
	assert.deepEqual(
		[column.id, column.icon, column.color, column.domains],
		['source-youtube', 'video', '#ff0000', ['youtube.com', 'youtu.be']],
	);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => [
			bookmark.url,
			bookmark.title,
			bookmark.columnId,
		]),
		[
			[
				'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				'Never Gonna Give You Up',
				column.id,
			],
		],
	);

	await harness.sendMessage(
		watchLater('https://www.youtube.com/watch?v=jNQXAC9IVRw'),
		fromYoutube,
	);
	assert.equal(
		harness.state.bookmarkColumns.filter((entry) => entry.name === 'YouTube')
			.length,
		1,
	);
	assert.equal(harness.state.bookmarks.length, 2);

	const undone = await harness.sendMessage(
		{type: 'SITE_SOURCE_UNDO', id: String(saved.undoId)},
		fromYoutube,
	);
	assert.equal(undone.ok, false, 'a later save changed the library since');
	const last = await harness.sendMessage(
		watchLater('https://www.youtube.com/watch?v=9bZkp7q19f0'),
		fromYoutube,
	);
	const undoLast = await harness.sendMessage(
		{type: 'SITE_SOURCE_UNDO', id: String(last.undoId)},
		fromYoutube,
	);
	assert.equal(undoLast.ok, true, undoLast.error);
	assert.equal(harness.state.bookmarks.length, 2);
});

test('a source save skips an address already in the library or in the trash', async () => {
	const harness = sourcesHarness();
	await switchOnYoutube(harness);
	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'},
	});
	assert.equal(added.ok, true, added.error);
	const exists = await harness.sendMessage(watchLater(), fromYoutube);
	assert.equal(exists.ok && exists.outcome, 'exists');
	assert.equal(exists.ok && exists.undoId, undefined);

	if (added.ok) {
		await harness.sendMessage({
			type: 'DELETE_BOOKMARK',
			bookmarkId: added.bookmark.id,
		});
	}

	const trashed = await harness.sendMessage(watchLater(), fromYoutube);
	assert.equal(trashed.ok && trashed.outcome, 'trashed');
	assert.equal(harness.state.bookmarks.length, 0);
	assert.equal(
		harness.state.bookmarkColumns.some((entry) => entry.name === 'YouTube'),
		false,
	);
});

test('a source that is off, or a page on another site, saves nothing', async () => {
	const harness = sourcesHarness();
	const off = await harness.sendMessage(watchLater(), fromYoutube);
	assert.equal(off.ok && off.outcome, 'off');

	await switchOnYoutube(harness);
	const elsewhere = await harness.sendMessage(watchLater(), {
		tab: {id: 1, windowId: 10, url: 'https://current.example/'},
		url: 'https://current.example/',
	});
	assert.equal(elsewhere.ok, false);
	const notAVideo = await harness.sendMessage(
		watchLater('https://www.youtube.com/playlist?list=WL'),
		fromYoutube,
	);
	assert.equal(notAVideo.ok, false);
	assert.equal(harness.state.bookmarks.length, 0);
});

test('X saves from twitter.com and x.com land once, in a new X column, and Instagram in its own', async () => {
	const harness = sourcesHarness();
	harness.grantOrigins(['https://x.com/*', 'https://twitter.com/*']);
	harness.grantOrigins(['https://www.instagram.com/*']);
	for (const source of ['x', 'instagram'] as const) {
		const on = await harness.sendMessage({
			type: 'SET_SITE_SOURCE',
			source,
			enabled: true,
		});
		assert.equal(on.ok, true, on.error);
	}

	assert.deepEqual(
		[...harness.registeredScripts.values()].map((script) => [
			script.id,
			script.matches,
		]),
		[
			['tablodge-source-x', ['https://x.com/*', 'https://twitter.com/*']],
			['tablodge-source-instagram', ['https://www.instagram.com/*']],
		],
	);
	const page = (url: string) => ({tab: {...youtubeTab, url}, url});
	const post = {
		type: 'SITE_SOURCE_SAVE',
		source: 'x',
		url: 'https://x.com/alice/status/1850000000000000001',
		title: 'Local first software',
	} as const;
	const first = await harness.sendMessage(
		post,
		page('https://twitter.com/home'),
	);
	assert.equal(first.ok && first.outcome, 'saved');
	assert.equal(first.ok && first.column, 'X');
	const again = await harness.sendMessage(
		{...post, url: 'https://twitter.com/alice/status/1850000000000000001'},
		page('https://x.com/home'),
	);
	assert.equal(again.ok && again.outcome, 'exists');

	const wrongSite = await harness.sendMessage(
		{...post, source: 'instagram'},
		page('https://x.com/home'),
	);
	assert.equal(wrongSite.ok, false);

	const reel = await harness.sendMessage(
		{
			type: 'SITE_SOURCE_SAVE',
			source: 'instagram',
			url: 'https://www.instagram.com/p/C9x8Y7w6V5u/',
			title: 'Instagram reel',
		},
		page('https://www.instagram.com/'),
	);
	assert.equal(reel.ok && reel.column, 'Instagram');
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => [
			harness.state.bookmarkColumns.find(
				(column) => column.id === bookmark.columnId,
			)?.name,
			bookmark.url,
		]),
		[
			['X', 'https://x.com/alice/status/1850000000000000001'],
			['Instagram', 'https://www.instagram.com/p/C9x8Y7w6V5u/'],
		],
	);
});

test('Hacker News and Lobsters saves keep the discussion in the note, and only a discussion on that site', async () => {
	const harness = sourcesHarness();
	harness.grantOrigins(['https://news.ycombinator.com/*']);
	harness.grantOrigins(['https://lobste.rs/*']);
	harness.grantOrigins(['https://github.com/*']);
	for (const source of ['hackernews', 'lobsters', 'github'] as const) {
		const on = await harness.sendMessage({
			type: 'SET_SITE_SOURCE',
			source,
			enabled: true,
		});
		assert.equal(on.ok, true, on.error);
	}

	const page = (url: string) => ({tab: {...youtubeTab, url}, url});
	const hn = page('https://news.ycombinator.com/item?id=41000001');
	const story = {
		type: 'SITE_SOURCE_SAVE',
		source: 'hackernews',
		url: 'https://example.com/local-first',
		title: 'Local-first software',
		discussion: 'https://news.ycombinator.com/item?id=41000001',
	} as const;
	const saved = await harness.sendMessage(story, hn);
	assert.equal(saved.ok && saved.column, 'Hacker News');
	await harness.sendMessage(
		{
			...story,
			url: 'item?id=41000002',
			title: 'Ask HN: What are you working on?',
			discussion: 'item?id=41000002',
		},
		hn,
	);
	await harness.sendMessage(
		{
			...story,
			url: 'https://example.com/other',
			discussion: 'https://evil.example/item?id=1',
		},
		hn,
	);
	const again = await harness.sendMessage(
		{...story, discussion: 'https://news.ycombinator.com/item?id=41000009'},
		hn,
	);
	assert.equal(again.ok && again.outcome, 'exists');
	await harness.sendMessage(
		{
			type: 'SITE_SOURCE_SAVE',
			source: 'lobsters',
			url: 'https://example.org/rust',
			title: 'Rust in production',
			discussion: '/s/abc123/rust_in_production',
		},
		page('https://lobste.rs/'),
	);
	await harness.sendMessage(
		{
			type: 'SITE_SOURCE_SAVE',
			source: 'github',
			url: '/sindresorhus/ky/tree/main',
			title: 'sindresorhus/ky: Tiny and elegant HTTP client',
		},
		page('https://github.com/trending'),
	);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => [
			harness.state.bookmarkColumns.find(
				(column) => column.id === bookmark.columnId,
			)?.name,
			bookmark.title,
			bookmark.url,
			bookmark.notes,
		]),
		[
			[
				'Hacker News',
				'Local-first software',
				'https://example.com/local-first',
				'Hacker News discussion: https://news.ycombinator.com/item?id=41000001',
			],
			[
				'Hacker News',
				'Ask HN: What are you working on?',
				'https://news.ycombinator.com/item?id=41000002',
				undefined,
			],
			[
				'Hacker News',
				'Local-first software',
				'https://example.com/other',
				undefined,
			],
			[
				'Lobsters',
				'Rust in production',
				'https://example.org/rust',
				'Lobsters discussion: https://lobste.rs/s/abc123/rust_in_production',
			],
			[
				'GitHub',
				'sindresorhus/ky: Tiny and elegant HTTP client',
				'https://github.com/sindresorhus/ky',
				undefined,
			],
		],
	);
});

test('the next page in a tab takes the result of a save that loaded it, once, and only for that site', async () => {
	const harness = sourcesHarness();
	harness.grantOrigins(['https://news.ycombinator.com/*']);
	await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'hackernews',
		enabled: true,
	});
	const hn = (id: number) => ({
		tab: {...youtubeTab, id, url: 'https://news.ycombinator.com/item?id=1'},
		url: 'https://news.ycombinator.com/item?id=1',
	});
	const pending = {type: 'SITE_SOURCE_PENDING', source: 'hackernews'} as const;
	assert.deepEqual(structuredClone(await harness.sendMessage(pending, hn(7))), {
		ok: true,
	});
	const saved = await harness.sendMessage(
		{
			type: 'SITE_SOURCE_SAVE',
			source: 'hackernews',
			url: 'https://example.com/story',
			title: 'A story',
			discussion: 'https://news.ycombinator.com/item?id=1',
		},
		hn(7),
	);
	assert.ok(saved.ok);
	assert.ok(saved.undoId);
	assert.deepEqual(
		structuredClone(await harness.sendMessage(pending, hn(8))),
		{ok: true},
		'another tab',
	);
	assert.deepEqual(
		structuredClone(
			await harness.sendMessage(
				{...pending, source: 'youtube'},
				{tab: {...youtubeTab, id: 7}, url: youtubeTab.url},
			),
		),
		{ok: true},
		'another site in the same tab',
	);
	assert.deepEqual(structuredClone(await harness.sendMessage(pending, hn(7))), {
		ok: true,
		saved: {outcome: 'saved', column: 'Hacker News', undoId: saved.undoId},
	});
	assert.deepEqual(structuredClone(await harness.sendMessage(pending, hn(7))), {
		ok: true,
	});

	harness.grantOrigins(['https://github.com/*']);
	await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'github',
		enabled: true,
	});
	const github = {
		tab: {...youtubeTab, id: 9, url: 'https://github.com/trending'},
		url: 'https://github.com/trending',
	};
	const starred = await harness.sendMessage(
		{type: 'SITE_SOURCE_SAVE', source: 'github', url: '/denoland/deno'},
		github,
	);
	assert.equal(starred.ok && starred.outcome, 'saved');
	assert.deepEqual(
		structuredClone(
			await harness.sendMessage(
				{type: 'SITE_SOURCE_PENDING', source: 'github'},
				github,
			),
		),
		{ok: true},
	);
});

test('a web page reaches only the source actions, never the rest of the worker', async () => {
	const harness = sourcesHarness();
	await switchOnYoutube(harness);
	for (const message of [
		{type: 'GET_STATE'},
		{type: 'ERASE_DATA', scope: 'all'},
		{type: 'GET_FULL_BACKUP'},
		{type: 'SET_SITE_SOURCE', source: 'reddit', enabled: true},
	] as const) {
		const result = await harness.sendMessage(message, fromYoutube);
		assert.equal(result.ok, false, message.type);
	}

	const added = await harness.sendMessage({
		type: 'ADD_BOOKMARKS',
		bookmarks: [{url: 'https://other.example/'}],
		undoable: true,
	});
	assert.ok(added.ok);
	assert.ok(added.undoId);
	const undo = await harness.sendMessage(
		{type: 'SITE_SOURCE_UNDO', id: String(added.ok && added.undoId)},
		fromYoutube,
	);
	assert.equal(undo.ok, false);
	assert.equal(harness.state.bookmarks.length, 1);
});

test('an unreadable save is reported to Settings and cleared by the next good save', async () => {
	const harness = sourcesHarness();
	const quiet = await harness.sendMessage(
		{type: 'SITE_SOURCE_UNREADABLE', source: 'youtube'},
		fromYoutube,
	);
	assert.equal(quiet.ok && quiet.reported, false, 'off: nothing to report');

	await switchOnYoutube(harness);
	const reported = await harness.sendMessage(
		{type: 'SITE_SOURCE_UNREADABLE', source: 'youtube'},
		fromYoutube,
	);
	assert.equal(reported.ok && reported.reported, true);
	let sources = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.equal(sources.ok && sources.sources[0]?.notice, 'unreadable');
	assert.equal(harness.state.bookmarks.length, 0);

	await harness.sendMessage(watchLater(), fromYoutube);
	sources = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.deepEqual(sources.ok && structuredClone(sources.sources[0]), {
		id: 'youtube',
		enabled: true,
		wanted: true,
	});
});

test('a private window saves only when private windows use the regular library', async () => {
	const on = {
		'tablodge.sources': {version: 1, sources: {youtube: {enabled: true}}},
	};
	const separate = sourcesHarness({
		incognitoContext: true,
		storage: {
			...on,
			'tablodge.private.config': {mode: 'saved', configured: true},
		},
	});
	const skipped = await separate.sendMessage(watchLater(), fromYoutube);
	assert.equal(skipped.ok && skipped.outcome, 'off');
	assert.equal(
		Object.keys(separate.extraStorage).some((key) =>
			key.startsWith('tablodge.private.state'),
		),
		false,
	);

	const unconfigured = sourcesHarness({incognitoContext: true, storage: on});
	const notSetUp = await unconfigured.sendMessage(watchLater(), fromYoutube);
	assert.equal(notSetUp.ok && notSetUp.outcome, 'off');
	assert.equal(unconfigured.state.bookmarks.length, 0);

	const shared = sourcesHarness({
		incognitoContext: true,
		storage: {
			...on,
			'tablodge.private.config': {mode: 'shared', configured: true},
		},
	});
	const saved = await shared.sendMessage(watchLater(), fromYoutube);
	assert.equal(saved.ok && saved.outcome, 'saved');
	assert.equal(shared.state.bookmarks.length, 1);
});

test('a source column keeps the icon and color the user gives it, and saves keep going there', async () => {
	const harness = sourcesHarness();
	await switchOnYoutube(harness);
	await harness.sendMessage(watchLater(), fromYoutube);
	const column = harness.state.bookmarkColumns.find(
		(entry) => entry.name === 'YouTube',
	);
	assert.ok(column);
	const edited = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK_COLUMN',
		columnId: String(column.id),
		name: 'YouTube',
		icon: 'film',
		color: 'violet',
	});
	assert.equal(edited.ok, true, edited.error);

	const next = await harness.sendMessage(
		watchLater('https://www.youtube.com/watch?v=jNQXAC9IVRw'),
		fromYoutube,
	);
	assert.equal(next.ok && next.column, 'YouTube');
	assert.deepEqual(
		harness.state.bookmarkColumns
			.filter((entry) => entry.name === 'YouTube')
			.map((entry) => [entry.id, entry.icon, entry.color]),
		[[column.id, 'film', 'violet']],
	);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => bookmark.columnId),
		[column.id, column.id],
	);
});

test('a full backup and its restore keep the source column id', async () => {
	const harness = sourcesHarness();
	await switchOnYoutube(harness);
	await harness.sendMessage(watchLater(), fromYoutube);
	const backup = await harness.sendMessage({type: 'GET_FULL_BACKUP'});
	assert.equal(backup.ok, true, backup.error);

	const fresh = createWorkerHarness(stateWithSession());
	const restored = await fresh.sendMessage({
		type: 'RESTORE_FULL_BACKUP',
		format: 'tablodge-full-backup',
		version: 1,
		state: backup.state,
		trash: backup.trash,
		copies: [],
	});
	assert.equal(restored.ok, true, restored.error);
	assert.deepEqual(
		fresh.state.bookmarks.map((bookmark) => bookmark.columnId),
		['source-youtube'],
	);
	assert.ok(
		fresh.state.bookmarkColumns.some(
			(column) => column.id === 'source-youtube',
		),
	);
});

test('a column the user named after the site is not its source column', async () => {
	const harness = sourcesHarness();
	await switchOnYoutube(harness);
	const created = await harness.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'YouTube',
	});
	assert.ok(created.ok);
	await harness.sendMessage(watchLater(), fromYoutube);
	assert.deepEqual(
		harness.state.bookmarkColumns
			.filter((entry) => entry.name === 'YouTube')
			.map((entry) => entry.id),
		[created.ok && created.column.id, 'source-youtube'],
	);
	assert.equal(harness.state.bookmarks[0]?.columnId, 'source-youtube');
});

test('a deleted source column comes back with the same id on the next save', async () => {
	const harness = sourcesHarness();
	await switchOnYoutube(harness);
	await harness.sendMessage(watchLater(), fromYoutube);
	const deleted = await harness.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'source-youtube',
		discardBookmarks: true,
	});
	assert.equal(deleted.ok, true, deleted.error);
	assert.ok(
		harness.state.bookmarkColumns.every(
			(entry) => entry.id !== 'source-youtube',
		),
	);

	const again = await harness.sendMessage(
		watchLater('https://www.youtube.com/watch?v=jNQXAC9IVRw'),
		fromYoutube,
	);
	assert.equal(again.ok && again.outcome, 'saved');
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => bookmark.columnId),
		['source-youtube'],
	);

	const restored = await harness.sendMessage({
		type: 'RESTORE_TRASH',
		id: String(deleted.ok && deleted.trashId),
	});
	assert.equal(restored.ok, true, restored.error);
	assert.deepEqual(
		harness.state.bookmarkColumns
			.map((column) => String(column.id))
			.filter((id) => id.startsWith('source-')),
		['source-youtube'],
	);
	assert.deepEqual(
		harness.state.bookmarks.map((bookmark) => bookmark.columnId),
		['source-youtube', 'source-youtube'],
	);
});

test('a source saves to the column chosen in Settings, and to its own column once that one is deleted', async () => {
	const harness = sourcesHarness();
	await switchOnYoutube(harness);
	const created = await harness.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'Later',
	});
	assert.ok(created.ok);
	const laterId = created.ok ? created.column.id : '';
	const missing = await harness.sendMessage({
		type: 'SET_SITE_SOURCE_COLUMN',
		source: 'youtube',
		columnId: 'no-such-column',
	});
	assert.equal(missing.ok, false);
	const chosen = await harness.sendMessage({
		type: 'SET_SITE_SOURCE_COLUMN',
		source: 'youtube',
		columnId: laterId,
	});
	assert.equal(chosen.ok && chosen.sources[0]?.columnId, laterId);

	const saved = await harness.sendMessage(watchLater(), fromYoutube);
	assert.equal(saved.ok && saved.column, 'Later');
	assert.equal(harness.state.bookmarks[0]?.columnId, laterId);

	await switchOnYoutube(harness);
	const sources = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.equal(sources.ok && sources.sources[0]?.columnId, laterId);

	await harness.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: laterId,
		discardBookmarks: true,
	});
	const fallback = await harness.sendMessage(
		watchLater('https://www.youtube.com/watch?v=jNQXAC9IVRw'),
		fromYoutube,
	);
	assert.equal(fallback.ok && fallback.column, 'YouTube');

	const cleared = await harness.sendMessage({
		type: 'SET_SITE_SOURCE_COLUMN',
		source: 'youtube',
		columnId: null,
	});
	assert.deepEqual(cleared.ok && structuredClone(cleared.sources[0]), {
		id: 'youtube',
		enabled: true,
		wanted: true,
	});
});

const redditSaved = {
	tab: {...youtubeTab, url: 'https://www.reddit.com/user/someone/saved/'},
	url: 'https://www.reddit.com/user/someone/saved/',
};
const savedPost = (id: string, title = `Post ${id}`) => ({
	url: `/r/typescript/comments/${id}/post_${id}/`,
	title,
});

const counted = async (
	answer: Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> => ({...(await answer)});

async function switchOnReddit(harness: ReturnType<typeof sourcesHarness>) {
	harness.grantOrigins([
		'https://www.reddit.com/*',
		'https://old.reddit.com/*',
	]);
	return harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'reddit',
		enabled: true,
	});
}

test('a saved page counts what the library lacks and adds exactly that, in its order, as one Undo step', async () => {
	const harness = sourcesHarness({
		storage: {'tablodge.device': {name: 'Desk'}},
	});
	await switchOnReddit(harness);
	await harness.sendMessage(
		{type: 'SITE_SOURCE_SAVE', source: 'reddit', ...savedPost('aaa111')},
		redditSaved,
	);
	await harness.sendMessage(
		{type: 'SITE_SOURCE_SAVE', source: 'reddit', ...savedPost('ttt000')},
		redditSaved,
	);
	const trashed = harness.state.bookmarks.find((bookmark) =>
		bookmark.url?.includes('ttt000'),
	)!;
	await harness.sendMessage({type: 'DELETE_BOOKMARK', bookmarkId: trashed.id!});
	const links = [
		savedPost('ccc333'),
		savedPost('aaa111'),
		savedPost('ttt000'),
		savedPost('bbb222'),
		savedPost('ccc333'),
		{url: 'https://evil.example/r/a/comments/x/y/', title: 'Not Reddit'},
		{title: 'No address'},
	];

	assert.deepEqual(
		await counted(
			harness.sendMessage(
				{type: 'SITE_SOURCE_CATCH_UP', source: 'reddit', links},
				redditSaved,
			),
		),
		{ok: true, missing: 2, ask: true, mode: 'add'},
	);

	const added = await harness.sendMessage(
		{type: 'SITE_SOURCE_CATCH_UP_ADD', source: 'reddit', links},
		redditSaved,
	);
	assert.equal(added.ok && added.added, 2);
	assert.equal(added.ok && added.column, 'Reddit');
	assert.equal(
		harness.state.bookmarks.find((bookmark) => bookmark.url?.includes('bbb222'))
			?.deviceName,
		'Desk',
		'a catch-up add carries this device',
	);
	const inColumn = () =>
		harness.state.bookmarks
			.filter((bookmark) => bookmark.columnId === 'source-reddit')
			.map((bookmark) => [bookmark.url, bookmark.title]);
	assert.deepEqual(inColumn(), [
		[
			'https://www.reddit.com/r/typescript/comments/aaa111/post_aaa111/',
			'Post aaa111',
		],
		[
			'https://www.reddit.com/r/typescript/comments/ccc333/post_ccc333/',
			'Post ccc333',
		],
		[
			'https://www.reddit.com/r/typescript/comments/bbb222/post_bbb222/',
			'Post bbb222',
		],
	]);

	assert.deepEqual(
		await counted(
			harness.sendMessage(
				{type: 'SITE_SOURCE_CATCH_UP', source: 'reddit', links},
				redditSaved,
			),
		),
		{ok: true, missing: 0, ask: false, mode: 'add'},
	);
	const again = await harness.sendMessage(
		{type: 'SITE_SOURCE_CATCH_UP_ADD', source: 'reddit', links},
		redditSaved,
	);
	assert.equal(again.ok && again.added, 0);

	const undone = await harness.sendMessage(
		{type: 'SITE_SOURCE_UNDO', id: (added.ok && added.undoId) || ''},
		redditSaved,
	);
	assert.equal(undone.ok, true, undone.ok ? '' : undone.error);
	assert.equal(inColumn().length, 1);
});

test('Not now keeps the saved page quiet until a new missing item appears', async () => {
	const harness = sourcesHarness();
	await switchOnReddit(harness);
	const ask = async (links: unknown[]) =>
		counted(
			harness.sendMessage(
				{type: 'SITE_SOURCE_CATCH_UP', source: 'reddit', links},
				redditSaved,
			),
		);
	const first = [savedPost('aaa111'), savedPost('bbb222')];
	await harness.sendMessage(
		{type: 'SITE_SOURCE_CATCH_UP_DISMISS', source: 'reddit', links: first},
		redditSaved,
	);
	assert.deepEqual(await ask(first), {
		ok: true,
		missing: 2,
		ask: false,
		mode: 'add',
	});
	assert.deepEqual(await ask([savedPost('new999'), ...first]), {
		ok: true,
		missing: 3,
		ask: true,
		mode: 'add',
	});
	assert.equal(harness.state.bookmarks.length, 0, 'nothing was added');

	await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'reddit',
		enabled: false,
	});
	await switchOnReddit(harness);
	assert.deepEqual(await ask(first), {
		ok: true,
		missing: 2,
		ask: true,
		mode: 'add',
	});

	await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'reddit',
		enabled: false,
	});
	await harness.sendMessage(
		{type: 'SITE_SOURCE_CATCH_UP_DISMISS', source: 'reddit', links: first},
		redditSaved,
	);
	await switchOnReddit(harness);
	assert.deepEqual(await ask(first), {
		ok: true,
		missing: 2,
		ask: true,
		mode: 'add',
	});
});

test('Add them automatically adds the new items, skips the ones answered Not now, and Undo removes exactly those', async () => {
	const harness = sourcesHarness();
	await switchOnReddit(harness);
	const dismissed = [savedPost('aaa111')];
	await harness.sendMessage(
		{type: 'SITE_SOURCE_CATCH_UP_DISMISS', source: 'reddit', links: dismissed},
		redditSaved,
	);
	const links = [...dismissed, savedPost('bbb222')];
	assert.deepEqual(
		await counted(
			harness.sendMessage(
				{type: 'SITE_SOURCE_CATCH_UP', source: 'reddit', links},
				redditSaved,
			),
		),
		{ok: true, missing: 2, ask: true, mode: 'add'},
	);

	const inColumn = () =>
		harness.state.bookmarks
			.filter((bookmark) => bookmark.columnId === 'source-reddit')
			.map((bookmark) => bookmark.url);
	const added = await harness.sendMessage(
		{
			type: 'SITE_SOURCE_CATCH_UP_ADD',
			source: 'reddit',
			links,
			automatic: true,
		},
		redditSaved,
	);
	assert.equal(added.ok && added.added, 1);
	assert.deepEqual(inColumn(), [
		'https://www.reddit.com/r/typescript/comments/bbb222/post_bbb222/',
	]);

	const undone = await harness.sendMessage(
		{type: 'SITE_SOURCE_UNDO', id: (added.ok && added.undoId) || ''},
		redditSaved,
	);
	assert.equal(undone.ok, true, undone.ok ? '' : undone.error);
	assert.deepEqual(inColumn(), []);
	assert.equal(harness.state.bookmarks.length, 0);
});

test('Ask first is kept from the setting and adds only when Add them is answered', async () => {
	const harness = sourcesHarness();
	await switchOnReddit(harness);
	await harness.sendMessage({
		type: 'UPDATE_SETTINGS',
		settings: {sourceCatchUp: 'ask'},
	});
	const links = [savedPost('aaa111')];
	assert.deepEqual(
		await counted(
			harness.sendMessage(
				{type: 'SITE_SOURCE_CATCH_UP', source: 'reddit', links},
				redditSaved,
			),
		),
		{ok: true, missing: 1, ask: true, mode: 'ask'},
	);
	assert.equal(
		harness.state.bookmarks.length,
		0,
		'nothing was added without a click',
	);

	const added = await harness.sendMessage(
		{type: 'SITE_SOURCE_CATCH_UP_ADD', source: 'reddit', links},
		redditSaved,
	);
	assert.equal(added.ok && added.added, 1);
});

test('a saved page of a site that is off, or another site, gets no count and adds nothing', async () => {
	const harness = sourcesHarness();
	const links = [savedPost('aaa111')];
	assert.deepEqual(
		await counted(
			harness.sendMessage(
				{type: 'SITE_SOURCE_CATCH_UP', source: 'reddit', links},
				redditSaved,
			),
		),
		{ok: true, missing: 0, ask: false},
	);
	const off = await harness.sendMessage(
		{type: 'SITE_SOURCE_CATCH_UP_ADD', source: 'reddit', links},
		redditSaved,
	);
	assert.equal(off.ok, false);
	await switchOnReddit(harness);
	const elsewhere = await harness.sendMessage(
		{type: 'SITE_SOURCE_CATCH_UP_ADD', source: 'reddit', links},
		fromYoutube,
	);
	assert.equal(elsewhere.ok, false);
	assert.equal(harness.state.bookmarks.length, 0);
});

test('the saved pages of YouTube, X, Instagram, and GitHub add their missing items to their own columns', async () => {
	const pages = [
		{
			id: 'youtube',
			origins: ['https://www.youtube.com/*'],
			url: 'https://www.youtube.com/playlist?list=WL',
			link: '/watch?v=dQw4w9WgXcQ&list=WL&index=1&pp=iAQB',
			stored: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		},
		{
			id: 'x',
			origins: ['https://x.com/*', 'https://twitter.com/*'],
			url: 'https://x.com/i/history',
			link: '/alice/status/1900000000000000001',
			stored: 'https://x.com/alice/status/1900000000000000001',
		},
		{
			id: 'instagram',
			origins: ['https://www.instagram.com/*'],
			url: 'https://www.instagram.com/someone/saved/all-posts/',
			link: '/p/DfAAAAAAAAA/',
			stored: 'https://www.instagram.com/p/DfAAAAAAAAA/',
		},
		{
			id: 'github',
			origins: ['https://github.com/*'],
			url: 'https://github.com/octo-me?tab=stars',
			link: '/nodejs/node',
			stored: 'https://github.com/nodejs/node',
		},
	];
	for (const page of pages) {
		const harness = sourcesHarness();
		harness.grantOrigins(page.origins);
		await harness.sendMessage({
			type: 'SET_SITE_SOURCE',
			source: page.id,
			enabled: true,
		});
		const from = {tab: {...youtubeTab, url: page.url}, url: page.url};
		const links = [{url: page.link, title: 'Saved'}];
		assert.deepEqual(
			await counted(
				harness.sendMessage(
					{type: 'SITE_SOURCE_CATCH_UP', source: page.id, links},
					from,
				),
			),
			{ok: true, missing: 1, ask: true, mode: 'add'},
			page.id,
		);
		const added = await harness.sendMessage(
			{type: 'SITE_SOURCE_CATCH_UP_ADD', source: page.id, links},
			from,
		);
		assert.equal(added.ok && added.added, 1, page.id);
		assert.deepEqual(
			harness.state.bookmarks.map((bookmark) => [
				bookmark.url,
				bookmark.columnId,
			]),
			[[page.stored, `source-${page.id}`]],
		);

		const elsewhere = await harness.sendMessage(
			{type: 'SITE_SOURCE_CATCH_UP_ADD', source: page.id, links},
			page.id === 'github' ? fromYoutube : redditSaved,
		);
		assert.equal(elsewhere.ok, false, page.id);
	}
});

test('Save to TabLodge only is a choice per site that supports it, reported to its page, and reset by Remove', async () => {
	const harness = sourcesHarness();
	const xTab = {id: 3, windowId: 10, url: 'https://x.com/home'};
	const fromX = {tab: xTab, url: xTab.url};
	const mode = async (sender = fromX) => {
		const result = await harness.sendMessage(
			{type: 'SITE_SOURCE_MODE', source: 'x'},
			sender,
		);
		assert.ok(result.ok);
		return result.keepOffSite;
	};

	const keepOff = (source: string, keepOffSite: boolean) =>
		harness.sendMessage({
			type: 'SET_SITE_SOURCE_KEEP_OFF',
			source,
			keepOffSite,
		});
	const status = async () => {
		const result = await harness.sendMessage({type: 'GET_SITE_SOURCES'});
		return result.ok
			? structuredClone(result.sources.find((entry) => entry.id === 'x'))
			: undefined;
	};

	assert.equal((await keepOff('x', true)).ok, true);
	assert.deepEqual(await status(), {id: 'x', enabled: false, wanted: false});
	await switchOnYoutube(harness);
	assert.equal((await keepOff('youtube', true)).ok, true);
	harness.grantOrigins(['https://medium.com/*', 'https://*.medium.com/*']);
	await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'medium',
		enabled: true,
	});
	assert.equal((await keepOff('medium', true)).ok, false);

	harness.grantOrigins(['https://x.com/*', 'https://twitter.com/*']);
	await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'x',
		enabled: true,
	});
	assert.equal(await mode(), false, 'the default saves on the site too');
	assert.equal((await keepOff('x', true)).ok, true);
	assert.deepEqual(await status(), {
		id: 'x',
		enabled: true,
		wanted: true,
		keepOffSite: true,
	});
	assert.equal(await mode(), true);
	assert.equal(await mode(fromYoutube), false);
	const fromPage = await harness.sendMessage(
		{type: 'SET_SITE_SOURCE_KEEP_OFF', source: 'x', keepOffSite: false},
		fromX,
	);
	assert.equal(fromPage.ok, false);
	assert.equal(await mode(), true);

	assert.equal((await keepOff('x', false)).ok, true);
	assert.equal(await mode(), false);
	await keepOff('x', true);
	await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'x',
		enabled: false,
	});
	assert.equal(await mode(), false);
	harness.grantOrigins(['https://x.com/*', 'https://twitter.com/*']);
	await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'x',
		enabled: true,
	});
	assert.deepEqual(await status(), {id: 'x', enabled: true, wanted: true});
});

test('a private window keeps saves off the site only when its saves are added', async () => {
	const on = {
		'tablodge.sources': {
			version: 1,
			sources: {x: {enabled: true, keepOffSite: true}},
		},
	};
	const fromX = {
		tab: {id: 3, windowId: 10, url: 'https://x.com/home'},
		url: 'https://x.com/home',
	};
	for (const [mode, expected] of [
		['saved', false],
		['shared', true],
	] as const) {
		const harness = sourcesHarness({
			incognitoContext: true,
			storage: {...on, 'tablodge.private.config': {mode, configured: true}},
		});
		const result = await harness.sendMessage(
			{type: 'SITE_SOURCE_MODE', source: 'x'},
			fromX,
		);
		assert.equal(result.ok && result.keepOffSite, expected, mode);
	}
});

test('a reel saved from its own page is not missing from the Instagram saved page, which lists it at /p/', async () => {
	const harness = sourcesHarness();
	harness.grantOrigins(['https://www.instagram.com/*']);
	await harness.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'instagram',
		enabled: true,
	});
	const reelPage = 'https://www.instagram.com/reel/DfAAAAAAAAA/';
	await harness.sendMessage(
		{
			type: 'SITE_SOURCE_SAVE',
			source: 'instagram',
			url: reelPage,
			title: 'A reel',
		},
		{tab: {...youtubeTab, url: reelPage}, url: reelPage},
	);
	const saved = 'https://www.instagram.com/someone/saved/all-posts/';
	assert.deepEqual(
		await counted(
			harness.sendMessage(
				{
					type: 'SITE_SOURCE_CATCH_UP',
					source: 'instagram',
					links: [{url: '/p/DfAAAAAAAAA/', title: 'A reel'}],
				},
				{tab: {...youtubeTab, url: saved}, url: saved},
			),
		),
		{ok: true, missing: 0, ask: false, mode: 'add'},
	);
});

const INBOX_KEY = 'tablodge.sendprivate.key';
const INBOX_ENTRY = 'tablodge.sendprivate.entry.';
const SENT_URL = 'https://saved.example/article';
const inboxEntries = (storage: Record<string, unknown>) =>
	Object.keys(storage).filter((key) => key.startsWith(INBOX_ENTRY));
const sendSavedTab = (harness: ReturnType<typeof createWorkerHarness>) =>
	harness.sendMessage({
		type: 'SEND_TO_PRIVATE',
		targets: [{kind: 'tab', sessionId: 'session-1', tabId: 'saved-tab-1'}],
	});

async function lockedPrivateLibrary({storage, ...extra}: HarnessOptions = {}) {
	const privateWorker = await plainPrivateLibrary(extra, storage);
	assert.equal((await enableLock(privateWorker)).ok, true);
	await eventually(() => privateWorker.extraStorage[INBOX_KEY] !== undefined);
	assert.equal(typeof privateWorker.extraStorage[INBOX_KEY], 'string');
	return privateWorker;
}

function regularBeside(
	privateWorker: ReturnType<typeof createWorkerHarness>,
	extra: HarnessOptions = {},
	state: StoredState = stateWithSession(),
) {
	const shared = structuredClone(privateWorker.extraStorage);
	for (const key of Object.keys(shared)) {
		if (
			key.startsWith('tablodge.') &&
			!key.startsWith(PRIVATE_PREFIX) &&
			key !== INBOX_KEY
		) {
			Reflect.deleteProperty(shared, key);
		}
	}

	return createWorkerHarness(state, undefined, {
		...extra,
		storage: {...shared, ...extra.storage},
	});
}

test('Send to private storage is offered only when private windows use a separate saved library', async () => {
	for (const config of [
		undefined,
		{mode: 'shared', configured: true},
		{mode: 'temporary', configured: true},
		{mode: 'saved', configured: false},
	]) {
		const regular = createWorkerHarness(stateWithSession(), undefined, {
			storage: config ? {'tablodge.private.config': config} : {},
		});
		const state = await regular.sendMessage({type: 'SEND_TO_PRIVATE_STATE'});
		assert.equal(state.state, 'hidden', JSON.stringify(config));
		assert.equal((await sendSavedTab(regular)).ok, false);
		assert.equal(regular.state.groups[0]?.tabs.length, 1);
	}

	const notYet = createWorkerHarness(stateWithSession(), undefined, {
		storage: {'tablodge.private.config': {mode: 'saved', configured: true}},
	});
	assert.equal(
		(await notYet.sendMessage({type: 'SEND_TO_PRIVATE_STATE'})).state,
		'needs-private-window',
	);
	const refused = await sendSavedTab(notYet);
	assert.equal(refused.ok, false);
	assert.match(String(refused.error), /private window/);
	assert.equal(notYet.state.groups[0]?.tabs.length, 1);

	const privateWorker = await lockedPrivateLibrary();
	assert.equal(
		(await privateWorker.sendMessage({type: 'SEND_TO_PRIVATE_STATE'})).state,
		'hidden',
	);
	assert.equal(
		(
			await regularBeside(privateWorker).sendMessage({
				type: 'SEND_TO_PRIVATE_STATE',
			})
		).state,
		'ready',
	);
});

test('a link sent from a regular window leaves no readable copy behind and arrives when the private library unlocks', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	const sent = await sendSavedTab(regular);
	assert.equal(sent.ok, true, sent.error);
	assert.equal(sent.count, 1);
	assert.ok(sent.undoId);
	assert.equal(regular.state.groups.length, 0, 'the emptied session went');
	assert.equal(trashOf(regular).length, 0, 'the trash syncs, so it is skipped');
	assert.equal(inboxEntries(regular.extraStorage).length, 1);

	assert.equal(
		(await regular.sendMessage({type: 'DROP_UNDO', id: String(sent.undoId)}))
			.ok,
		true,
	);
	assert.equal(regular.extraStorage['tablodge.undo'], undefined);
	const stored = JSON.stringify(regular.extraStorage);
	assert.equal(stored.includes('saved.example'), false);
	assert.equal(stored.includes('Saved page'), false);
	assert.equal(
		(await regular.sendMessage({type: 'UNDO', id: String(sent.undoId)})).ok,
		false,
	);

	const locked = restartPrivate(
		{...privateWorker, extraStorage: regular.extraStorage},
		{browserRestart: true},
	);
	await settle();
	assert.equal((await locked.sendMessage({type: 'GET_STATE'})).locked, true);
	assert.equal(inboxEntries(locked.extraStorage).length, 1);

	const unlocked = await locked.sendMessage({
		type: 'UNLOCK_PRIVATE',
		credential: lockPassword,
	});
	assert.equal(unlocked.ok, true, unlocked.error);
	assert.equal(inboxEntries(locked.extraStorage).length, 0);
	const library = await locked.sendMessage({type: 'GET_STATE'});
	const column = library.bookmarkColumns?.find(
		(entry) => entry.id === 'sent-from-regular-windows',
	);
	assert.equal(column?.name, 'Sent from regular windows');
	assert.deepEqual(
		structuredClone(
			library.bookmarks
				?.filter((bookmark) => bookmark.columnId === column?.id)
				.map((bookmark) => [bookmark.title, bookmark.url]),
		),
		[['Saved page', SENT_URL]],
	);
	const privateStored = JSON.stringify(
		privateDataKeys(locked.extraStorage).map((key) => locked.extraStorage[key]),
	);
	assert.ok(privateStored.length > 0);
	assert.equal(
		privateStored.includes('saved.example'),
		false,
		'the private library holds it sealed',
	);
});

test('closing the send toast also drops older Undo records, which still hold the link', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	const added = await regular.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'Other', url: 'https://other.example/'},
	});
	assert.ok(added.undoId, 'adding a bookmark keeps an Undo record');
	const sent = await sendSavedTab(regular);
	assert.equal(sent.ok, true, sent.error);
	await regular.sendMessage({type: 'DROP_UNDO', id: String(sent.undoId)});
	assert.equal(regular.extraStorage['tablodge.undo'], undefined);
	assert.equal(
		JSON.stringify(regular.extraStorage).includes('saved.example'),
		false,
	);
});

test('Undo of a send brings the link back and withdraws the sealed entry', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	const sent = await sendSavedTab(regular);
	assert.equal(sent.ok, true, sent.error);
	const undone = await regular.sendMessage({
		type: 'UNDO',
		id: String(sent.undoId),
	});
	assert.equal(undone.ok, true, undone.error);
	assert.equal(regular.state.groups[0]?.tabs[0]?.url, SENT_URL);
	assert.equal(inboxEntries(regular.extraStorage).length, 0);
});

test('an unlocked private library waits for the Undo toast before taking a sent link in', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	const sent = await sendSavedTab(regular);
	assert.equal(sent.ok, true, sent.error);
	const [entry] = inboxEntries(regular.extraStorage);
	const live = restartPrivate({
		...privateWorker,
		extraStorage: {
			...privateWorker.extraStorage,
			[entry]: regular.extraStorage[entry],
		},
	});
	const wakes = () =>
		live.alarmCalls.some((call) =>
			call.startsWith('create:tablodge-send-to-private'),
		);
	await eventually(wakes);
	assert.ok(wakes(), 'a held entry schedules a wake for when its hold ends');
	assert.equal(
		inboxEntries(live.extraStorage).length,
		1,
		'still held for Undo',
	);

	await regular.sendMessage({type: 'DROP_UNDO', id: String(sent.undoId)});
	const released = restartPrivate({
		...live,
		extraStorage: {...live.extraStorage, [entry]: regular.extraStorage[entry]},
	});
	await eventually(() => inboxEntries(released.extraStorage).length === 0);
	assert.equal(inboxEntries(released.extraStorage).length, 0);
	const library = await released.sendMessage({type: 'GET_STATE'});
	assert.ok(library.bookmarks?.some((bookmark) => bookmark.url === SENT_URL));
});

test('the wake takes a held entry in once its hold has passed, without the toast closing', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	assert.equal((await sendSavedTab(regular)).ok, true);
	const [entry] = inboxEntries(regular.extraStorage);
	const live = restartPrivate({
		...privateWorker,
		extraStorage: {
			...privateWorker.extraStorage,
			[entry]: regular.extraStorage[entry],
		},
	});
	const wakes = () =>
		live.alarmCalls.some((call) =>
			call.startsWith('create:tablodge-send-to-private'),
		);
	await eventually(wakes);
	assert.ok(wakes());
	assert.equal(inboxEntries(live.extraStorage).length, 1, 'still held');
	(live.extraStorage[entry] as {holdUntil: number}).holdUntil = Date.now() - 1;
	await live.fire('alarm', {name: 'tablodge-send-to-private'});
	await eventually(() => inboxEntries(live.extraStorage).length === 0);
	assert.equal(inboxEntries(live.extraStorage).length, 0);
	const library = await live.sendMessage({type: 'GET_STATE'});
	assert.ok(library.bookmarks?.some((bookmark) => bookmark.url === SENT_URL));
});

test('a sent link reaches the regular server only as a delete and the private server only sealed', async () => {
	const server = syncServer();
	const privateWorker = await lockedPrivateLibrary({
		fetch: server.fetch,
		storage: regularSync,
	});
	const privateOn = await privateWorker.sendMessage({
		type: 'PRIVATE_SYNC_ENABLE',
		credential: lockPassword,
	});
	assert.equal(privateOn.ok, true, privateOn.error);

	let recording = false;
	const uploads: string[] = [];
	const regular = regularBeside(privateWorker, {
		async fetch(url, init) {
			if (recording && init.method === 'POST') {
				uploads.push(String(init.body));
			}

			return server.fetch(url, init);
		},
		storage: regularSync,
	});
	assert.equal((await regular.sendMessage({type: 'SYNC_NOW'})).ok, true);
	const pushedBefore = server.log.cursor;
	recording = true;
	const sent = await sendSavedTab(regular);
	assert.equal(sent.ok, true, sent.error);
	await regular.sendMessage({type: 'DROP_UNDO', id: String(sent.undoId)});
	assert.equal((await regular.sendMessage({type: 'SYNC_NOW'})).ok, true);
	recording = false;
	assert.ok(uploads.length > 0, 'the send went to the regular server');
	assert.ok(uploads.some((body) => body.includes('"deleted":true')));
	assert.equal(
		uploads.some((body) => body.includes('saved.example')),
		false,
		'no upload after the send carries the link',
	);
	const page = server.log.pull(pushedBefore, 1000);
	const after = page.resync ? [] : page.changes;
	assert.ok(after.some((change) => change.deleted));
	const history = server.log.pull(0, 1000);
	assert.equal(history.resync, false);
	assert.equal(
		JSON.stringify(history.resync ? [] : history.changes).includes(
			'saved.example',
		),
		false,
		'the regular sync history keeps only the delete',
	);

	const [entry] = inboxEntries(regular.extraStorage);
	const receiving = restartPrivate(
		{
			...privateWorker,
			extraStorage: {
				...privateWorker.extraStorage,
				[entry]: regular.extraStorage[entry],
			},
		},
		{browserRestart: true},
		{fetch: server.fetch},
	);
	const unlocked = await receiving.sendMessage({
		type: 'UNLOCK_PRIVATE',
		credential: lockPassword,
	});
	assert.equal(unlocked.ok, true, unlocked.error);
	await receiving.sendMessage({type: 'PRIVATE_SYNC_NOW'});
	const privateValuesNow = privateValues(server.privateLog);
	assert.ok(privateValuesNow.length > 0);
	assert.ok(privateValuesNow.every((value) => isSealedValue(value)));
	assert.equal(
		JSON.stringify(privateValuesNow).includes('saved.example'),
		false,
	);

	const other = createWorkerHarness({}, undefined, {
		incognitoContext: true,
		fetch: server.fetch,
		storage: {
			'tablodge.private.config': {mode: 'saved', configured: true},
			...regularSync,
		},
	});
	assert.equal((await enableLock(other)).ok, true);
	assert.equal(
		(
			await other.sendMessage({
				type: 'PRIVATE_SYNC_ENABLE',
				credential: lockPassword,
			})
		).ok,
		true,
	);
	const otherLibrary = await other.sendMessage({type: 'GET_STATE'});
	assert.ok(
		otherLibrary.bookmarks?.some(
			(bookmark) =>
				bookmark.url === SENT_URL &&
				bookmark.columnId === 'sent-from-regular-windows',
		),
	);

	const deleted = await receiving.sendMessage({
		type: 'DELETE_BOOKMARK_COLUMN',
		columnId: 'sent-from-regular-windows',
		discardBookmarks: true,
	});
	assert.equal(deleted.ok, true, deleted.error);
	await receiving.sendMessage({type: 'PRIVATE_SYNC_NOW'});
	await other.sendMessage({type: 'PRIVATE_SYNC_NOW'});
	assert.equal(
		(await other.sendMessage({type: 'GET_STATE'})).bookmarkColumns?.some(
			(column) => column.id === 'sent-from-regular-windows',
		),
		false,
	);

	const regularAgain = regularBeside(receiving, {
		fetch: server.fetch,
		storage: regularSync,
	});
	const again = await regularAgain.sendMessage({
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'Later', url: 'https://later.example/'},
	});
	assert.equal(again.ok, true, again.error);
	const later = regularAgain.state.bookmarks.find(
		(bookmark) => bookmark.url === 'https://later.example/',
	);
	const sentAgain = await regularAgain.sendMessage({
		type: 'SEND_TO_PRIVATE',
		targets: [{kind: 'bookmark', bookmarkId: String(later?.id)}],
	});
	assert.equal(sentAgain.ok, true, sentAgain.error);
	await regularAgain.sendMessage({
		type: 'DROP_UNDO',
		id: String(sentAgain.undoId),
	});
	const [laterEntry] = inboxEntries(regularAgain.extraStorage);
	receiving.extraStorage[laterEntry] = regularAgain.extraStorage[laterEntry];
	assert.equal((await receiving.sendMessage({type: 'LOCK_PRIVATE'})).ok, true);
	assert.equal(
		(
			await receiving.sendMessage({
				type: 'UNLOCK_PRIVATE',
				credential: lockPassword,
			})
		).ok,
		true,
	);
	await receiving.sendMessage({type: 'PRIVATE_SYNC_NOW'});
	await other.sendMessage({type: 'PRIVATE_SYNC_NOW'});
	const otherAgain = await other.sendMessage({type: 'GET_STATE'});
	assert.ok(
		otherAgain.bookmarkColumns?.some(
			(column) => column.id === 'sent-from-regular-windows',
		),
		'a column deleted earlier comes back on the other device',
	);
	assert.ok(
		otherAgain.bookmarks?.some(
			(bookmark) =>
				bookmark.url === 'https://later.example/' &&
				bookmark.columnId === 'sent-from-regular-windows',
		),
	);
});

const columnLibrary = (extra: Partial<StoredState> = {}): StoredState => {
	const base = stateWithSession();
	return {
		...base,
		bookmarkColumns: [
			...base.bookmarkColumns,
			{
				id: 'work',
				name: 'Work',
				icon: 'star',
				color: '#336699',
				createdAt: 5,
				isDefault: false,
			},
			{
				id: 'source-youtube',
				name: 'YouTube',
				createdAt: 6,
				isDefault: false,
			},
		],
		bookmarks: [
			{
				id: 'w1',
				title: 'First',
				url: 'https://first.example/',
				columnId: 'work',
				notes: 'a note',
				tags: ['alpha'],
				createdAt: 11,
				updatedAt: 11,
			},
			{
				id: 'o1',
				title: 'Other',
				url: 'https://other.example/',
				columnId: 'bookmark-default',
				createdAt: 12,
				updatedAt: 12,
			},
			{
				id: 'w2',
				title: 'Second',
				url: 'https://second.example/',
				columnId: 'work',
				createdAt: 13,
				updatedAt: 13,
			},
			{
				id: 'y1',
				title: 'Video',
				url: 'https://youtube.example/watch',
				columnId: 'source-youtube',
				createdAt: 14,
				updatedAt: 14,
			},
		],
		...extra,
	};
};

const sendColumn = (
	harness: ReturnType<typeof createWorkerHarness>,
	columnId: string,
) =>
	harness.sendMessage({
		type: 'SEND_TO_PRIVATE',
		targets: [{kind: 'column', columnId}],
	});

test('a sent column arrives in private storage with its look, bookmarks, order, notes and tags, and leaves the regular library', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker, {}, columnLibrary());
	const sent = await sendColumn(regular, 'work');
	assert.equal(sent.ok, true, sent.error);
	assert.equal(sent.count, 2);
	assert.equal(sent.keptColumn, undefined);
	assert.ok(sent.undoId);
	assert.deepEqual(
		regular.state.bookmarkColumns.map((column) => column.id),
		['bookmark-default', 'source-youtube'],
	);
	assert.deepEqual(
		regular.state.bookmarks.map((bookmark) => bookmark.id),
		['o1', 'y1'],
	);
	assert.equal(trashOf(regular).length, 0);
	assert.equal(inboxEntries(regular.extraStorage).length, 1);
	await regular.sendMessage({type: 'DROP_UNDO', id: String(sent.undoId)});
	const stored = JSON.stringify(regular.extraStorage);
	assert.equal(stored.includes('first.example'), false);
	assert.equal(stored.includes('a note'), false);

	const unlocked = restartPrivate(
		{...privateWorker, extraStorage: regular.extraStorage},
		{browserRestart: true},
	);
	const opened = await unlocked.sendMessage({
		type: 'UNLOCK_PRIVATE',
		credential: lockPassword,
	});
	assert.equal(opened.ok, true, opened.error);
	const library = await unlocked.sendMessage({type: 'GET_STATE'});
	const column = library.bookmarkColumns?.find(
		(entry) => entry.name === 'Work',
	);
	assert.equal(column?.icon, 'star');
	assert.equal(column?.color, '#336699');
	assert.deepEqual(
		structuredClone(
			library.bookmarks
				?.filter((bookmark) => bookmark.columnId === column?.id)
				.map((bookmark) => [bookmark.title, bookmark.notes, bookmark.tags]),
		),
		[
			['First', 'a note', ['alpha']],
			['Second', undefined, undefined],
		],
	);
});

test('a sent column joins a private column of the same name', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const created = await privateWorker.sendMessage({
		type: 'CREATE_BOOKMARK_COLUMN',
		name: 'work',
	});
	assert.ok(created.ok);
	const regular = regularBeside(privateWorker, {}, columnLibrary());
	assert.equal((await sendColumn(regular, 'work')).ok, true);
	const [entry] = inboxEntries(regular.extraStorage);
	const live = restartPrivate({
		...privateWorker,
		extraStorage: {
			...privateWorker.extraStorage,
			[entry]: {
				...(regular.extraStorage[entry] as object),
				holdUntil: 0,
			},
		},
	});
	await eventually(() => inboxEntries(live.extraStorage).length === 0);
	const library = await live.sendMessage({type: 'GET_STATE'});
	assert.equal(
		library.bookmarkColumns?.filter(
			(column) => column.name.toLowerCase() === 'work',
		).length,
		1,
	);
	const joined = library.bookmarkColumns?.find(
		(column) => column.name.toLowerCase() === 'work',
	);
	assert.deepEqual(
		structuredClone(
			library.bookmarks
				?.filter((bookmark) => bookmark.columnId === joined?.id)
				.map((bookmark) => bookmark.title),
		),
		['First', 'Second'],
	);
});

test('a column with a site source sends its bookmarks and stays with its source on, and the result says so', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker, {}, columnLibrary());
	regular.grantOrigins([
		'https://www.youtube.com/*',
		'https://m.youtube.com/*',
		'https://youtube.com/*',
	]);
	const on = await regular.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'youtube',
		enabled: true,
	});
	assert.equal(on.ok, true, on.error);
	const sent = await sendColumn(regular, 'source-youtube');
	assert.equal(sent.ok, true, sent.error);
	assert.equal(sent.count, 1);
	assert.equal(sent.keptColumn, 'YouTube');
	assert.ok(
		regular.state.bookmarkColumns.some(
			(column) => column.id === 'source-youtube',
		),
	);
	assert.equal(
		regular.state.bookmarks.some(
			(bookmark) => bookmark.columnId === 'source-youtube',
		),
		false,
	);
	const status = await regular.sendMessage({type: 'GET_SITE_SOURCES'});
	assert.equal(
		status.ok && status.sources.find((item) => item.id === 'youtube')?.wanted,
		true,
	);
});

test('a column that Settings points a site at stays after its bookmarks are sent', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker, {}, columnLibrary());
	regular.grantOrigins([
		'https://www.youtube.com/*',
		'https://m.youtube.com/*',
		'https://youtube.com/*',
	]);
	await regular.sendMessage({
		type: 'SET_SITE_SOURCE',
		source: 'youtube',
		enabled: true,
	});
	const chosen = await regular.sendMessage({
		type: 'SET_SITE_SOURCE_COLUMN',
		source: 'youtube',
		columnId: 'work',
	});
	assert.equal(chosen.ok, true, chosen.error);
	const sent = await sendColumn(regular, 'work');
	assert.equal(sent.ok, true, sent.error);
	assert.equal(sent.keptColumn, 'Work');
	assert.ok(
		regular.state.bookmarkColumns.some((column) => column.id === 'work'),
	);
});

test('one Undo brings the whole column back exactly and withdraws the entry', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const library = columnLibrary();
	const regular = regularBeside(privateWorker, {}, library);
	const before = structuredClone({
		columns: regular.state.bookmarkColumns,
		bookmarks: regular.state.bookmarks,
	});
	const sent = await sendColumn(regular, 'work');
	assert.equal(sent.ok, true, sent.error);
	const undone = await regular.sendMessage({
		type: 'UNDO',
		id: String(sent.undoId),
	});
	assert.equal(undone.ok, true, undone.error);
	assert.deepEqual(
		structuredClone({
			columns: regular.state.bookmarkColumns,
			bookmarks: regular.state.bookmarks,
		}),
		before,
	);
	assert.equal(inboxEntries(regular.extraStorage).length, 0);
});

test('a column of 1,000 bookmarks and a session of 1,000 links each send as one action with one Undo', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const base = columnLibrary();
	const big = {
		...base,
		groups: [
			{
				...base.groups[0],
				id: 'big-session',
				tabs: Array.from({length: 1000}, (_, index) => ({
					id: `t${index}`,
					title: `Tab ${index}`,
					url: `https://tab-${index}.example/`,
					pinned: false,
					originalIndex: index,
				})),
			},
		],
		bookmarks: Array.from({length: 1000}, (_, index) => ({
			id: `b${index}`,
			title: `Link ${index}`,
			url: `https://link-${index}.example/`,
			columnId: 'work',
			createdAt: index + 1,
			updatedAt: index + 1,
		})),
	} as StoredState;
	const regular = regularBeside(privateWorker, {}, big);
	const column = await sendColumn(regular, 'work');
	assert.equal(column.ok, true, column.error);
	assert.equal(column.count, 1000);
	assert.equal(inboxEntries(regular.extraStorage).length, 1);
	const session = await regular.sendMessage({
		type: 'SEND_TO_PRIVATE',
		targets: [{kind: 'session', sessionId: 'big-session'}],
	});
	assert.equal(session.ok, true, session.error);
	assert.equal(session.count, 1000);
	assert.equal(inboxEntries(regular.extraStorage).length, 2);
	assert.equal(regular.state.groups.length, 0);
	assert.equal(regular.state.bookmarks.length, 0);
	const undone = await regular.sendMessage({
		type: 'UNDO',
		id: String(session.undoId),
	});
	assert.equal(undone.ok, true, undone.error);
	assert.equal(regular.state.groups[0]?.tabs.length, 1000);
});

test('a sent session keeps its name, link order and saved date, and arrives outside any folder', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const base = stateWithSession();
	const library = {
		...base,
		folders: [
			...base.folders,
			{id: 'trips', name: 'Trips', createdAt: 1, isDefault: false},
		],
		groups: [
			{
				...base.groups[0],
				id: 'trip',
				name: 'Lisbon',
				folderId: 'trips',
				createdAt: 1_600_000_000_000,
				updatedAt: 1_650_000_000_000,
				tabs: ['c', 'a', 'b'].map((name, index) => ({
					id: `t-${name}`,
					title: `Page ${name}`,
					url: `https://${name}.example/`,
					notes: name === 'a' ? 'keep me' : '',
					pinned: false,
					originalIndex: index,
				})),
			},
		],
	} as StoredState;
	const regular = regularBeside(privateWorker, {}, library);
	const sent = await regular.sendMessage({
		type: 'SEND_TO_PRIVATE',
		targets: [{kind: 'session', sessionId: 'trip'}],
	});
	assert.equal(sent.ok, true, sent.error);
	assert.equal(sent.count, 3);
	assert.equal(regular.state.groups.length, 0);
	await regular.sendMessage({type: 'DROP_UNDO', id: String(sent.undoId)});
	const live = restartPrivate(
		{...privateWorker, extraStorage: regular.extraStorage},
		{browserRestart: true},
	);
	const opened = await live.sendMessage({
		type: 'UNLOCK_PRIVATE',
		credential: lockPassword,
	});
	assert.equal(opened.ok, true, opened.error);
	const state = await live.sendMessage({type: 'GET_STATE'});
	const session = state.groups?.find((group) => group.name === 'Lisbon');
	assert.equal(session?.createdAt, 1_600_000_000_000);
	assert.equal(session?.folderId, 'unfiled');
	assert.deepEqual(
		structuredClone(session?.tabs.map((tab) => [tab.url, tab.notes])),
		[
			['https://c.example/', ''],
			['https://a.example/', 'keep me'],
			['https://b.example/', ''],
		],
	);
});

test('sending an empty column or a missing session changes nothing and says so', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const library = columnLibrary();
	library.bookmarks = [];
	const regular = regularBeside(privateWorker, {}, library);
	const empty = await sendColumn(regular, 'work');
	assert.equal(empty.ok, false);
	assert.match(String(empty.error), /no bookmarks/);
	const gone = await regular.sendMessage({
		type: 'SEND_TO_PRIVATE',
		targets: [{kind: 'session', sessionId: 'nope'}],
	});
	assert.equal(gone.ok, false);
	assert.equal(inboxEntries(regular.extraStorage).length, 0);
	assert.ok(
		regular.state.bookmarkColumns.some((column) => column.id === 'work'),
	);
});

test('erasing the private library removes its public key and every sealed entry', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	assert.equal((await sendSavedTab(regular)).ok, true);
	const [entry] = inboxEntries(regular.extraStorage);
	const erasing = restartPrivate({
		...privateWorker,
		extraStorage: {
			...privateWorker.extraStorage,
			[entry]: regular.extraStorage[entry],
		},
	});
	const erased = await erasing.sendMessage({type: 'RESET_PRIVATE_LIBRARY'});
	assert.equal(erased.ok, true, erased.error);
	assert.equal(erasing.extraStorage[INBOX_KEY], undefined);
	assert.equal(inboxEntries(erasing.extraStorage).length, 0);
});

test('a send whose toast never reports closing leaves no readable copy once its Undo expires', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	assert.equal((await sendSavedTab(regular)).ok, true);
	const undo = regular.extraStorage['tablodge.undo'] as {
		records: Array<{createdAt: number}>;
	};
	undo.records[0].createdAt -= 10 * 60_000;
	await regular.fire('alarm', {name: 'tablodge-undo'});
	await settle();
	assert.equal(regular.extraStorage['tablodge.undo'], undefined);
	assert.equal(
		JSON.stringify(regular.extraStorage).includes('saved.example'),
		false,
	);
});

test('an entry the private library cannot open stays until the library is erased', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const unreadable = `${INBOX_ENTRY}foreign`;
	const locked = restartPrivate(
		{
			...privateWorker,
			extraStorage: {
				...privateWorker.extraStorage,
				[unreadable]: {v: 1, epk: 'AAAA', iv: 'AAAA', ct: 'AAAA'},
			},
		},
		{browserRestart: true},
	);
	assert.equal(
		(
			await locked.sendMessage({
				type: 'UNLOCK_PRIVATE',
				credential: lockPassword,
			})
		).ok,
		true,
	);
	assert.ok(locked.extraStorage[unreadable]);
	assert.equal(
		(await locked.sendMessage({type: 'RESET_PRIVATE_LIBRARY'})).ok,
		true,
	);
	assert.equal(locked.extraStorage[unreadable], undefined);
});

function stateForEdits(): StoredState {
	const state = bookmarksState(4);
	state.bookmarkColumns.push({
		id: 'col-third',
		name: 'Third',
		createdAt: 2,
		isDefault: false,
	});
	state.groups.push({
		id: 'session-b',
		name: 'Second',
		folderId: 'unfiled',
		createdAt: 5,
		tabs: [
			{id: 'tb1', title: 'B1', url: 'https://b1.example/'},
			{id: 'tb2', title: 'B2', url: 'https://b2.example/'},
		],
	});
	return state;
}

const editsToUndo: Array<{message: TabLodgeMessage; name: string}> = [
	{
		name: 'moving a column',
		message: {
			type: 'REORDER_BOOKMARK_COLUMN',
			columnId: 'col-third',
			targetColumnId: 'bookmark-default',
			position: 'before',
		},
	},
	{
		name: 'moving a bookmark inside a column',
		message: {
			type: 'REORDER_BOOKMARK',
			bookmarkId: 'bm-0',
			targetColumnId: 'bookmark-default',
			targetBookmarkId: 'bm-1',
			position: 'after',
		},
	},
	{
		name: 'moving a bookmark to another column',
		message: {
			type: 'REORDER_BOOKMARK',
			bookmarkId: 'bm-0',
			targetColumnId: 'col-news',
			targetBookmarkId: 'bm-2',
			position: 'before',
		},
	},
	{
		name: 'moving several bookmarks at once',
		message: {
			type: 'REORDER_BOOKMARK',
			bookmarkId: 'bm-0',
			bookmarkIds: ['bm-0', 'bm-1', 'bm-2'],
			targetColumnId: 'col-third',
		},
	},
	{
		name: 'creating a column',
		message: {type: 'CREATE_BOOKMARK_COLUMN', name: 'Fresh'},
	},
	{
		name: 'renaming a column',
		message: {
			type: 'UPDATE_BOOKMARK_COLUMN',
			columnId: 'col-news',
			name: 'Renamed',
			color: '#ff0000',
		},
	},
	{
		name: 'adding a bookmark',
		message: {
			type: 'ADD_BOOKMARK',
			bookmark: {title: 'New', url: 'https://new.example/'},
		},
	},
	{
		name: 'editing a bookmark',
		message: {
			type: 'UPDATE_BOOKMARK',
			bookmarkId: 'bm-1',
			fields: {title: 'Changed', columnId: 'col-news', tags: ['a']},
		},
	},
	{
		name: 'reordering sessions',
		message: {type: 'SET_GROUP_ORDER', order: ['session-b', 'session-1']},
	},
	{
		name: 'editing a session',
		message: {
			type: 'UPDATE_GROUP',
			groupId: 'session-b',
			fields: {name: 'Renamed', description: 'Notes'},
		},
	},
	{
		name: 'archiving a session',
		message: {type: 'ARCHIVE_GROUP', groupId: 'session-b'},
	},
	{
		name: 'creating a folder',
		message: {type: 'CREATE_FOLDER', name: 'Projects'},
	},
	{
		name: 'moving a link to another session',
		message: {
			type: 'MOVE_TAB',
			fromGroupId: 'session-b',
			tabId: 'tb1',
			toGroupId: 'session-1',
		},
	},
	{
		name: 'editing a link',
		message: {
			type: 'UPDATE_TAB',
			groupId: 'session-b',
			tabId: 'tb2',
			fields: {title: 'Changed', notes: 'n'},
		},
	},
];

for (const {name, message} of editsToUndo) {
	test(`Undo restores the exact library after ${name}`, async () => {
		const harness = createWorkerHarness(stateForEdits());
		const before = structuredClone(harness.state);
		const result = (await harness.sendMessage(message)) as {
			ok: boolean;
			error?: string;
			undoId?: string;
		};
		assert.equal(result.ok, true, result.error);
		assert.ok(result.undoId, `${message.type} offers an undoId`);
		assert.notDeepEqual(harness.state, before);
		const undone = await harness.sendMessage({
			type: 'UNDO',
			id: result.undoId,
		});
		assert.equal(undone.ok, true, undone.error);
		assert.deepEqual(harness.state, before);
	});
}

test('two edits in a row are undone newest first, and the older one is refused until then', async () => {
	const harness = createWorkerHarness(stateForEdits());
	const original = structuredClone(harness.state);
	const first = await harness.sendMessage({
		type: 'REORDER_BOOKMARK_COLUMN',
		columnId: 'col-third',
		targetColumnId: 'bookmark-default',
		position: 'before',
	});
	const afterFirst = structuredClone(harness.state);
	const second = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK_COLUMN',
		columnId: 'col-news',
		name: 'Renamed',
	});
	const early = await harness.sendMessage({type: 'UNDO', id: first.undoId!});
	assert.equal(early.ok, false);
	assert.equal(
		(await harness.sendMessage({type: 'UNDO', id: second.undoId!})).ok,
		true,
	);
	assert.deepEqual(harness.state, afterFirst);
	assert.equal(
		(await harness.sendMessage({type: 'UNDO', id: first.undoId!})).ok,
		true,
	);
	assert.deepEqual(harness.state, original);
});

test('cleanup still runs when another action rewrote the Undo list before the alarm', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	assert.equal((await sendSavedTab(regular)).ok, true);
	Reflect.deleteProperty(regular.extraStorage, 'tablodge.undo');
	assert.ok(regular.extraStorage['tablodge.sendprivate.cleanup']);
	await regular.fire('alarm', {name: 'tablodge-undo'});
	await settle();
	assert.equal(regular.extraStorage['tablodge.sendprivate.cleanup'], undefined);
	assert.equal(
		JSON.stringify(regular.extraStorage).includes('saved.example'),
		false,
	);
});

test('removing the private password takes waiting links in and retires the inbox key first', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	assert.equal((await sendSavedTab(regular)).ok, true);
	const [entry] = inboxEntries(regular.extraStorage);
	const owner = restartPrivate({
		...privateWorker,
		extraStorage: {
			...privateWorker.extraStorage,
			[entry]: regular.extraStorage[entry],
		},
	});
	const removed = await owner.sendMessage({
		type: 'REMOVE_PRIVATE_LOCK',
		credential: lockPassword,
	});
	assert.equal(removed.ok, true, removed.error);
	assert.equal(inboxEntries(owner.extraStorage).length, 0);
	assert.equal(owner.extraStorage[INBOX_KEY], undefined);
	assert.equal(
		owner.extraStorage['tablodge.private.sendprivate.key'],
		undefined,
	);
	const library = await owner.sendMessage({type: 'GET_STATE'});
	assert.ok(library.bookmarks?.some((bookmark) => bookmark.url === SENT_URL));
	const after = createWorkerHarness(stateWithSession(), undefined, {
		storage: structuredClone(owner.extraStorage),
	});
	assert.equal(
		(await after.sendMessage({type: 'SEND_TO_PRIVATE_STATE'})).state,
		'needs-private-window',
	);
});

test('a selection over 500 links is refused with the limit', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	const refused = await regular.sendMessage({
		type: 'SEND_TO_PRIVATE',
		targets: Array.from({length: 501}, (_, index) => ({
			kind: 'bookmark',
			bookmarkId: `b${index}`,
		})),
	});
	assert.equal(refused.ok, false);
	assert.match(String(refused.error), /at most 500/);
});

test('a wrong password leaves waiting links and the inbox key alone', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	assert.equal((await sendSavedTab(regular)).ok, true);
	const [entry] = inboxEntries(regular.extraStorage);
	const owner = restartPrivate({
		...privateWorker,
		extraStorage: {
			...privateWorker.extraStorage,
			[entry]: regular.extraStorage[entry],
		},
	});
	const refused = await owner.sendMessage({
		type: 'REMOVE_PRIVATE_LOCK',
		credential: 'not the password',
	});
	assert.equal(refused.ok, false);
	assert.equal(inboxEntries(owner.extraStorage).length, 1);
	assert.ok(owner.extraStorage[INBOX_KEY]);
});

test('a failed take-in stops password removal and keeps the inbox key and the entry', async () => {
	const privateWorker = await lockedPrivateLibrary();
	const regular = regularBeside(privateWorker);
	assert.equal((await sendSavedTab(regular)).ok, true);
	const [entry] = inboxEntries(regular.extraStorage);
	const owner = restartPrivate({
		...privateWorker,
		extraStorage: {
			...privateWorker.extraStorage,
			[entry]: regular.extraStorage[entry],
		},
	});
	owner.setStorageFailure(
		new Error('disk full'),
		'tablodge.private.tablodge.state',
	);
	const removed = await owner.sendMessage({
		type: 'REMOVE_PRIVATE_LOCK',
		credential: lockPassword,
	});
	owner.clearStorageFailure();
	assert.equal(removed.ok, false);
	assert.equal(inboxEntries(owner.extraStorage).length, 1);
	assert.ok(owner.extraStorage[INBOX_KEY]);
	assert.ok(
		isSealedValue(owner.extraStorage['tablodge.private.sendprivate.key']),
	);
});

const scopedEditState = (): StoredState => {
	const state = stateWithSession();
	const [first] = state.groups;
	return {
		...state,
		groups: [first, {...structuredClone(first), id: 'session-2'}],
		bookmarks: Array.from({length: 150}, (_, index) => ({
			id: `bookmark-${index}`,
			title: `Bookmark ${index}`,
			url: `https://bookmark.example/${index}`,
			columnId: 'bookmark-default',
			createdAt: 1_700_000_000_000,
			updatedAt: 1_700_000_000_000,
		})),
	};
};

const scopedEdits: TabLodgeMessage[] = [
	{type: 'UPDATE_GROUP', groupId: 'session-1', fields: {name: 'Renamed'}},
	{type: 'ARCHIVE_GROUP', groupId: 'session-1'},
	{
		type: 'UPDATE_BOOKMARK',
		bookmarkId: 'bookmark-120',
		fields: {title: 'Renamed'},
	},
	{type: 'ADD_BOOKMARK', bookmark: {url: 'https://added.example/'}},
	{type: 'DELETE_BOOKMARK', bookmarkId: 'bookmark-3'},
	{
		type: 'REORDER_BOOKMARK',
		bookmarkId: 'bookmark-140',
		bookmarkIds: ['bookmark-140'],
		targetColumnId: 'bookmark-default',
		targetBookmarkId: 'bookmark-1',
	},
	{type: 'CREATE_BOOKMARK_COLUMN', name: 'Later'},
	{type: 'CREATE_FOLDER', name: 'Work'},
];

test('an open page follows each scoped edit from its change and matches a fresh load', async () => {
	const harness = createWorkerHarness(scopedEditState());
	await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-2',
		fields: {name: 'Warm'},
	});
	let held = await harness.sendMessage({type: 'GET_STATE'});
	for (const edit of scopedEdits) {
		const result = await harness.sendMessage(edit);
		assert.equal(result.ok, true, `${edit.type} ${result.error}`);
		const {changes} = await harness.sendMessage({
			type: 'GET_STATE_CHANGES',
			since: held.revision!,
		});
		assert.ok(changes, `${edit.type} sends its change`);
		held = applyStateChanges(held, changes)!;
		assert.deepEqual(
			structuredClone(held),
			structuredClone(await harness.sendMessage({type: 'GET_STATE'})),
			edit.type,
		);
	}
});

test('a page reloads when the change is unknown or came from a whole write', async () => {
	const harness = createWorkerHarness(scopedEditState());
	await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-2',
		fields: {name: 'Warm'},
	});
	const {revision} = await harness.sendMessage({type: 'GET_STATE'});
	const unknown = await harness.sendMessage({
		type: 'GET_STATE_CHANGES',
		since: '1:1',
	});
	assert.equal(unknown.changes, undefined);
	await harness.sendMessage({
		type: 'UPDATE_TAB',
		groupId: 'session-1',
		tabId: 'saved-tab-1',
		fields: {title: 'Whole write'},
	});
	const after = await harness.sendMessage({
		type: 'GET_STATE_CHANGES',
		since: revision!,
	});
	assert.equal(after.ok, true);
	assert.equal(after.changes, undefined);
});

test('a session rename and a bookmark edit never read the other records', async () => {
	const harness = createWorkerHarness(scopedEditState());
	await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-2',
		fields: {name: 'Warm'},
	});
	await harness.sendMessage({
		type: 'UPDATE_BOOKMARK',
		bookmarkId: 'bookmark-120',
		fields: {notes: 'Warm'},
	});
	const unreadable = Object.keys(harness.extraStorage).filter(
		(key) =>
			key.startsWith('tablodge.session.session-2.') ||
			key.startsWith('tablodge.bmchunk.0.'),
	);
	assert.ok(unreadable.length >= 2);
	for (const key of unreadable) {
		harness.extraStorage[key] = {items: []};
	}

	const renamed = await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-1',
		fields: {name: 'Renamed'},
	});
	assert.equal(renamed.ok, true, renamed.error);
	const edited = await harness.sendMessage({
		type: 'UPDATE_BOOKMARK',
		bookmarkId: 'bookmark-120',
		fields: {notes: 'Kept'},
	});
	assert.equal(edited.ok, true, edited.error);
	const full = await harness.sendMessage({type: 'GET_STATE'});
	assert.equal(full.ok, false, 'a whole read does trip over those records');
});

test('Undo restores the library after scoped edits', async () => {
	const harness = createWorkerHarness(scopedEditState());
	await harness.sendMessage({
		type: 'UPDATE_GROUP',
		groupId: 'session-2',
		fields: {name: 'Warm'},
	});
	for (const edit of scopedEdits) {
		if (edit.type === 'DELETE_BOOKMARK') {
			continue;
		}

		const {
			updatedAt: _before,
			revision: _from,
			...before
		} = await harness.sendMessage({type: 'GET_STATE'});
		const result = await harness.sendMessage(edit);
		const {undoId} = result as {undoId?: string};
		assert.equal(
			(await harness.sendMessage({type: 'UNDO', id: undoId!})).ok,
			true,
			edit.type,
		);
		const {
			updatedAt: _after,
			revision: _to,
			...after
		} = await harness.sendMessage({type: 'GET_STATE'});
		assert.deepEqual(
			structuredClone(after),
			structuredClone(before),
			edit.type,
		);
	}
});
