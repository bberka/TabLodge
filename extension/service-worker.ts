// Types come from the shared model via import() type queries rather than an import statement: the
// stripped output must stay a classic script (an `import type` would leave an `export {}` behind).
type ActionFailure = import('../src/app/types').ActionFailure;
type TabLodgeMessageType = import('../src/app/types').TabLodgeMessageType;
type ActionResult<K extends TabLodgeMessageType = TabLodgeMessageType> =
	import('../src/app/types').ActionResult<K>;
type Bookmark = import('../src/app/types').Bookmark;
type BookmarkColumn = import('../src/app/types').BookmarkColumn;
type BookmarkFields = import('../src/app/types').BookmarkFields;
type DuplicateMode = import('../src/app/types').DuplicateMode;
type EraseScope = import('../src/app/types').EraseScope;
type Folder = import('../src/app/types').Folder;
type ImportOptions = import('../src/app/types').ImportOptions;
type InsertPosition = import('../src/app/types').InsertPosition;
type LinkEntry = import('../src/app/types').LinkEntry;
type NativeGroup = import('../src/app/types').NativeGroup;
type RestoreFailure = import('../src/app/types').RestoreFailure;
type RestoreOptions = import('../src/app/types').RestoreOptions;
type RestoreTarget = import('../src/app/types').RestoreTarget;
type SavedTab = import('../src/app/types').SavedTab;
type SaveScope = import('../src/app/types').SaveScope;
type Session = import('../src/app/types').Session;
type SessionFields = import('../src/app/types').SessionFields;
type SplitInfo = import('../src/app/types').SplitInfo;
type Settings = import('../src/app/types').Settings;
type Store = import('../src/app/types').Store;
type TabFields = import('../src/app/types').TabFields;
type TabGroupColor = import('../src/app/types').TabGroupColor;
type TabLodgeMessage = import('../src/app/types').TabLodgeMessage;
type TabLodgeMessages = import('../src/app/types').TabLodgeMessages;
type TitlePolicy = import('../src/app/types').TitlePolicy;

/**
Untrusted object (stored state or import file): every field is checked before use.
*/
type Raw = Record<string, unknown>;
/**
Settings as stored or patched; unknown values are normalized.
*/
type RawSettings = {[K in keyof Settings]?: unknown} & {
	duplicateHandling?: unknown;
	sidePanelEnabled?: unknown;
};
type Result<T extends object = {}> = ({ok: true} & T) | ActionFailure;
/**
 A browser window fetched with `populate: true`: it always has an id and its tabs. `title` is not part
 of the Chrome API but is read when a browser provides it.
 */
type PopulatedWindow = chrome.windows.Window & {
	id: number;
	tabs: chrome.tabs.Tab[];
	title?: string;
};
/**
CaptureTabs reports duplicates it skipped on the session it creates (or on an empty placeholder).
*/
type CaptureResult =
	| (Session & {skipped?: number})
	| {id: null; tabs: SavedTab[]; skipped: number};
type RestoreRecordsResult = {
	opened: Array<{saved: SavedTab; tabId: number | undefined}>;
	skipped: number;
	failures: RestoreFailure[];
	windowId?: number | null;
	splits: number;
	splitsSeparated: number;
};
type BookmarkMergeResult = {
	columnsAdded: number;
	columnsReordered: boolean;
	bookmarksAdded: number;
	bookmarksSkipped: number;
	bookmarksUpdated: number;
};
type ImportInput = Raw | null | undefined;
/**
`contextMenus.onShown`/`refresh` exist only in some Chromium-based browsers and are feature-detected.
*/
/**
The callback forms of `removeAll` and `update` return nothing in Chrome's types, but some browsers return a promise as well.
*/
type CallbackMenuApi = {
	removeAll(callback: () => void): unknown;
	update(
		id: string,
		properties: {checked?: boolean; enabled?: boolean},
		callback: () => void,
	): unknown;
};
type ContextMenusWithOnShown = typeof chrome.contextMenus & {
	onShown?: chrome.events.Event<
		(
			info: {contextType?: string; contexts?: string[]},
			tab?: chrome.tabs.Tab,
		) => void
	>;
	refresh?: () => void;
};

const isRecord = (value: unknown): value is Raw =>
	Boolean(value) && typeof value === 'object';
/**
`Array.isArray` narrows to `any[]`; this keeps the elements `unknown`.
*/
const arrayOf = (value: unknown): unknown[] =>
	Array.isArray(value) ? (value as unknown[]) : [];
/**
The string `id` of a record, or "" for anything else.
*/
const recordId = (value: unknown) =>
	isRecord(value) && typeof value.id === 'string' ? value.id : '';
const isInteger = (value: unknown): value is number =>
	Number.isSafeInteger(value);
function isOneOf<T extends string>(
	values: readonly T[],
	value: unknown,
): value is T {
	return (values as readonly unknown[]).includes(value);
}

const errorMessage = (error: unknown) =>
	isRecord(error) && typeof error.message === 'string'
		? error.message
		: undefined;

/**
Display name for menus and messages; the manifest's short_name is the one place it is set.
*/
const APP_NAME =
	chrome.runtime.getManifest().short_name ?? chrome.runtime.getManifest().name;
// Persistent identifiers (storage keys, export formats, menu ids) use the "tablodge" prefix and are
// independent of the display name: changing one would orphan saved data.
const STORAGE_KEY = 'tablodge.state';
const SCHEMA_VERSION = 7;
const DEFAULT_FOLDER_ID = 'unfiled';
const DEFAULT_FOLDER = Object.freeze<Folder>({
	id: DEFAULT_FOLDER_ID,
	name: 'Unfiled',
	createdAt: 0,
	isDefault: true,
});
const DEFAULT_BOOKMARK_COLUMN_ID = 'bookmark-default';
const BOOKMARK_UNFILED_ID = 'bookmark-unfiled';
const DEFAULT_BOOKMARK_COLUMN = Object.freeze<BookmarkColumn>({
	id: DEFAULT_BOOKMARK_COLUMN_ID,
	name: 'Bookmarks',
	createdAt: 0,
	isDefault: true,
});
const DEFAULT_SETTINGS = Object.freeze<Settings>({
	closeOnSave: true,
	includePinnedTabs: false,
	openDashboardAfterSave: false,
	openDashboardOnStartup: false,
	startupBehavior: 'dashboard',
	newTabEnabled: true,
	autoFocusSearchOnNewTab: false,
	actionMode: 'popup',
	sessionsEnabled: true,
	bookmarksEnabled: true,
	toolbarOpens: 'popup',
	excludedOrigins: [],
	saveDuplicateHandling: 'allow',
	saveDuplicateTitle: 'existing',
	restoreDuplicateHandling: 'skip',
	restoreTarget: 'new-window-unless-only-tab',
	restoreMode: 'keep',
	singleTabBehavior: 'stay',
	unloadRestoredTabs: false,
	unloadRestoredTabsThreshold: 5,
	restoreSplitTabs: 'split',
	saveSplitTabs: 'both',
	sessionSort: 'newest',
	sessionLayout: 'list',
	expandSessionsByDefault: true,
	stretchBookmarkColumns: true,
	bookmarkClickAction: 'current',
	sessionLinkClickAction: 'new',
	showBookmarkQuickActions: false,
	sessionsOnTop: false,
	keepLodgePinned: false,
	copyFormat: 'markdown',
	dashboardBehavior: 'switch',
	urlDisplayMode: 'full',
	groupTitleAction: 'edit',
	contextMenusEnabled: true,
	contextMenuLinksEnabled: true,
	contextMenuPageEnabled: true,
	contextMenuSelectionEnabled: true,
	contextMenuActionEnabled: true,
});
// Mirrors src/app/icon-ids.ts (the worker cannot import); a test keeps both lists identical.
const ICON_IDS = new Set<unknown>([
	'bookmark',
	'folder',
	'star',
	'heart',
	'pin',
	'flag',
	'tag',
	'bell',
	'clock',
	'calendar',
	'lightbulb',
	'zap',
	'sparkles',
	'archive',
	'inbox',
	'link',
	'globe',
	'search',
	'rocket',
	'target',
	'briefcase',
	'building',
	'mail',
	'clipboard',
	'check-square',
	'presentation',
	'chart',
	'trending-up',
	'users',
	'phone',
	'file-text',
	'kanban',
	'code',
	'terminal',
	'git-branch',
	'git-merge',
	'database',
	'server',
	'cloud',
	'cpu',
	'bug',
	'package',
	'wrench',
	'settings',
	'shield',
	'lock',
	'key',
	'music',
	'video',
	'film',
	'image',
	'camera',
	'headphones',
	'mic',
	'tv',
	'palette',
	'book-open',
	'book',
	'newspaper',
	'library',
	'rss',
	'bookmark-check',
	'shopping-cart',
	'shopping-bag',
	'gift',
	'store',
	'credit-card',
	'receipt',
	'plane',
	'map',
	'map-pin',
	'compass',
	'car',
	'tent',
	'luggage',
	'wallet',
	'banknote',
	'piggy-bank',
	'landmark',
	'coins',
	'calculator',
	'message-circle',
	'message-square',
	'share',
	'thumbs-up',
	'user',
	'megaphone',
	'home',
	'sofa',
	'bed',
	'wifi',
	'activity',
	'dumbbell',
	'stethoscope',
	'pill',
	'brain',
	'graduation-cap',
	'school',
	'pencil',
	'notebook',
	'languages',
	'flask',
	'gamepad',
	'dices',
	'trophy',
	'utensils',
	'coffee',
	'pizza',
	'cooking-pot',
	'leaf',
	'trees',
	'sun',
	'moon',
	'flower',
	'mountain',
	'cat',
	'dog',
]);
const GROUP_COLORS = new Set<unknown>([
	'grey',
	'blue',
	'red',
	'yellow',
	'green',
	'pink',
	'purple',
	'cyan',
	'orange',
]);
const isGroupColor = (value: unknown): value is TabGroupColor =>
	GROUP_COLORS.has(value);
const DASHBOARD_URL = chrome.runtime.getURL('newtab.html');

let mutationQueue: Promise<unknown> = Promise.resolve();

function makeId() {
	return (
		globalThis.crypto?.randomUUID?.() ||
		`${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
	);
}

function cleanText(value: unknown, fallback: unknown = '', max = 240) {
	const text = String(value ?? '')
		.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
		.trim()
		.slice(0, max);
	return text || String(fallback).slice(0, max);
}

function normalizeUrl(value: unknown): string | null {
	if (typeof value !== 'string' || value.length > 16_384) {
		return null;
	}

	try {
		const url = new URL(value);
		return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

function normalizeFavicon(value: unknown) {
	return typeof value === 'string' ? value.slice(0, 4096) : '';
}

function normalizeNativeGroup(
	value: unknown,
	fallbackKey: unknown = '',
): NativeGroup | null {
	if (!isRecord(value)) {
		return null;
	}

	return {
		key: cleanText(value.key ?? value.id ?? fallbackKey, '', 100),
		title: cleanText(value.title, '', 100),
		color: isGroupColor(value.color) ? value.color : 'grey',
		collapsed: Boolean(value.collapsed),
	};
}

function normalizeTab(
	raw: unknown,
	groupTimestamp: number,
	index = 0,
): SavedTab | null {
	if (!isRecord(raw)) {
		return null;
	}

	const url = normalizeUrl(raw.url ?? raw.href);
	if (!url) {
		return null;
	}

	const timestamp = Number(raw.timestamp ?? raw.savedAt);
	const originalIndex = Number(raw.originalIndex ?? raw.index);
	return {
		id: cleanText(raw.id, makeId(), 100),
		title: cleanText(raw.title ?? raw.name, url, 500),
		url,
		faviconUrl: normalizeFavicon(raw.faviconUrl ?? raw.favIconUrl),
		notes: normalizeNotes(raw.notes),
		archived: raw.archived === true,
		pinned: Boolean(raw.pinned),
		nativeGroup: normalizeNativeGroup(
			raw.nativeGroup ?? raw.group,
			raw.groupKey,
		),
		savedAt:
			Number.isFinite(timestamp) && timestamp > 0 ? timestamp : groupTimestamp,
		originalIndex:
			Number.isFinite(originalIndex) && originalIndex >= 0
				? originalIndex
				: index,
		...splitField(normalizeSplit(raw.split)),
	};
}

/**
Shape check only; whether the pair is complete is decided per session by pairSplits.
*/
function normalizeSplit(value: unknown): SplitInfo | undefined {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		(value.position !== 0 && value.position !== 1)
	) {
		return undefined;
	}

	const id = cleanText(value.id, '', 100);
	return id ? {id, position: value.position} : undefined;
}

// Spread into a tab so a missing split leaves no `split: undefined` key behind.
const splitField = (split: SplitInfo | undefined): {split?: SplitInfo} =>
	split ? {split} : {};
const groupKeyOf = (tab: SavedTab) =>
	tab.nativeGroup
		? tab.nativeGroup.key || tab.nativeGroup.title || 'default'
		: null;

/**
 Keeps split info only on complete pairs: two neighboring tabs with the same pair key, one at each position,
 and matching pinned and tab-group state (the browser's own split constraints). The left tab (position 0) is
 moved first if the two were stored the other way around. Orphans (a deleted, skipped, or filtered partner),
 reused keys, and mismatched pairs lose their split info; the tabs themselves are kept.
 */
function pairSplits(tabs: SavedTab[]): SavedTab[] {
	const usedKeys = new Set<string>();
	for (let index = 0; index < tabs.length; index += 1) {
		const tab = tabs[index];
		if (!tab.split) {
			continue;
		}

		const next = tabs[index + 1];
		const valid =
			next?.split &&
			next.split.id === tab.split.id &&
			next.split.position !== tab.split.position &&
			!usedKeys.has(tab.split.id) &&
			tab.pinned === next.pinned &&
			groupKeyOf(tab) === groupKeyOf(next);
		if (!valid) {
			delete tab.split;
			continue;
		}

		usedKeys.add(tab.split.id);
		if (tab.split.position === 1) {
			[tabs[index], tabs[index + 1]] = [next, tab];
		}

		index += 1;
	}

	return tabs;
}

/**
The `icon` property for a stored column or folder: only a registry id is kept, anything else is dropped.
*/
function iconField(value: unknown): {icon?: string} {
	return typeof value === 'string' && ICON_IDS.has(value) ? {icon: value} : {};
}

function normalizeFolder(raw: unknown): Folder | null {
	if (!isRecord(raw)) {
		return null;
	}

	const id = cleanText(raw.id, makeId(), 100);
	if (id === 'all') {
		return null;
	}

	return {
		id,
		name: cleanText(raw.name, 'New folder', 60),
		...iconField(raw.icon),
		createdAt: Number.isFinite(Number(raw.createdAt))
			? Number(raw.createdAt)
			: Date.now(),
		isDefault: id === DEFAULT_FOLDER_ID,
	};
}

function normalizeFolders(rawFolders: unknown): Folder[] {
	const seenIds = new Set(['all']);
	const folders: Folder[] = [];
	for (const raw of Array.isArray(rawFolders) ? rawFolders.slice(0, 200) : []) {
		const folder = normalizeFolder(raw);
		if (!folder) {
			continue;
		}

		if (seenIds.has(folder.id)) {
			if (folder.id === DEFAULT_FOLDER_ID) {
				continue;
			}

			folder.id = makeId();
		}

		seenIds.add(folder.id);
		folders.push(folder);
	}

	if (seenIds.has(DEFAULT_FOLDER_ID)) {
		const index = folders.findIndex(
			(folder) => folder.id === DEFAULT_FOLDER_ID,
		);
		if (index !== -1) {
			folders[index] = {...DEFAULT_FOLDER, createdAt: folders[index].createdAt};
		}
	} else {
		folders.unshift({...DEFAULT_FOLDER});
	}

	return folders;
}

function normalizeNotes(value: unknown) {
	return typeof value === 'string'
		? value.replaceAll('\u0000', '').slice(0, 10_000)
		: '';
}

function normalizeBookmarkColumn(raw: unknown): BookmarkColumn | null {
	if (!isRecord(raw)) {
		return null;
	}

	const id = cleanText(raw.id, makeId(), 100);
	if (id === 'all') {
		return null;
	}

	return {
		id,
		name: cleanText(raw.name, 'New column', 60),
		...iconField(raw.icon),
		createdAt: Number.isFinite(Number(raw.createdAt))
			? Number(raw.createdAt)
			: Date.now(),
		isDefault: id === DEFAULT_BOOKMARK_COLUMN_ID,
	};
}

function normalizeBookmarkColumns(rawColumns: unknown): BookmarkColumn[] {
	const seenIds = new Set(['all', BOOKMARK_UNFILED_ID]);
	const columns: BookmarkColumn[] = [];
	const source = Array.isArray(rawColumns)
		? rawColumns
		: [DEFAULT_BOOKMARK_COLUMN];
	for (const raw of source) {
		const column = normalizeBookmarkColumn(raw);
		if (!column) {
			continue;
		}

		if (seenIds.has(column.id)) {
			column.id = makeId();
		}

		seenIds.add(column.id);
		columns.push(column);
	}

	return columns;
}

function fallbackBookmarkTitle(url: string) {
	try {
		const parsed = new URL(url);
		const path =
			parsed.pathname === '/' ? '' : decodeURIComponent(parsed.pathname);
		return (
			`${parsed.host.replace(/^www\./i, '')}${path}`.replace(/\/$/, '') ||
			parsed.hostname.replace(/^www\./i, '')
		);
	} catch {
		return (
			String(url)
				.replace(/^https?:\/\//i, '')
				.replace(/^www\./i, '')
				.split(/[#?]/, 1)[0] || 'Saved bookmark'
		);
	}
}

function bookmarkTitleIsUrl(value: unknown, url: string) {
	const title = cleanText(value, '', 500)
		.replace(/^url:\s*/i, '')
		.trim();
	return (
		!title ||
		normalizeUrl(title) === url ||
		title === fallbackBookmarkTitle(url)
	);
}

function cleanBookmarkTitle(value: unknown, url: string) {
	return bookmarkTitleIsUrl(value, url)
		? fallbackBookmarkTitle(url)
		: cleanText(value, '', 500)
				.replace(/^url:\s*/i, '')
				.trim();
}

async function openBookmarkTitleMap() {
	const titles = new Map<string, string>();
	try {
		const tabs = await chrome.tabs.query({});
		for (const tab of tabs) {
			const url = normalizeUrl(tab.url);
			if (url && !titles.has(url) && !bookmarkTitleIsUrl(tab.title, url)) {
				titles.set(url, cleanText(tab.title, fallbackBookmarkTitle(url), 500));
			}
		}
	} catch {
		/*
		Page titles are optional; use readable URL labels if tab metadata is unavailable.
		*/
	}

	return titles;
}

function importedBookmarkTitle(
	value: unknown,
	url: string,
	openTitles: Map<string, string>,
) {
	return bookmarkTitleIsUrl(value, url)
		? openTitles.get(url) || fallbackBookmarkTitle(url)
		: cleanText(value, fallbackBookmarkTitle(url), 500);
}

async function bestBookmarkTitle(value: unknown, url: string) {
	if (!bookmarkTitleIsUrl(value, url)) {
		return cleanText(value, fallbackBookmarkTitle(url), 500);
	}

	const openTitles = await openBookmarkTitleMap();
	return importedBookmarkTitle(value, url, openTitles);
}

function normalizeBookmark(
	raw: unknown,
	columnIds: Set<string>,
	fallbackTimestamp = Date.now(),
): Bookmark | null {
	if (!isRecord(raw)) {
		return null;
	}

	const url = normalizeUrl(raw.url ?? raw.href);
	if (!url) {
		return null;
	}

	const createdAt = Number(raw.createdAt ?? raw.savedAt);
	const updatedAt = Number(raw.updatedAt);
	const requestedColumnId = cleanText(
		raw.columnId,
		DEFAULT_BOOKMARK_COLUMN_ID,
		100,
	);
	const fallbackColumnId = columnIds.has(DEFAULT_BOOKMARK_COLUMN_ID)
		? DEFAULT_BOOKMARK_COLUMN_ID
		: columnIds.values().next().value || BOOKMARK_UNFILED_ID;
	return {
		id: cleanText(raw.id, makeId(), 100),
		title: cleanBookmarkTitle(raw.title ?? raw.name, url),
		url,
		columnId:
			requestedColumnId === BOOKMARK_UNFILED_ID
				? BOOKMARK_UNFILED_ID
				: columnIds.has(requestedColumnId)
					? requestedColumnId
					: fallbackColumnId,
		createdAt:
			Number.isFinite(createdAt) && createdAt > 0
				? createdAt
				: fallbackTimestamp,
		updatedAt:
			Number.isFinite(updatedAt) && updatedAt > 0
				? updatedAt
				: Number.isFinite(createdAt) && createdAt > 0
					? createdAt
					: fallbackTimestamp,
	};
}

function normalizeGroup(
	raw: unknown,
	fallbackTimestamp = Date.now(),
	includePinnedTabs = false,
): Session | null {
	if (!isRecord(raw)) {
		return null;
	}

	const tabsRaw = Array.isArray(raw.tabs) ? raw.tabs : [];
	const timestamp = Number(raw.createdAt ?? raw.timestamp);
	const createdAt =
		Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallbackTimestamp;
	const seenTabIds = new Set<string>();
	const tabs = tabsRaw
		.slice(0, 1000)
		.map((tab: unknown, index: number) => {
			const normalized = normalizeTab(tab, createdAt, index);
			if (!normalized || (normalized.pinned && !includePinnedTabs)) {
				return null;
			}

			if (seenTabIds.has(normalized.id)) {
				normalized.id = makeId();
			}

			seenTabIds.add(normalized.id);
			return normalized;
		})
		.filter((tab): tab is SavedTab => Boolean(tab));
	if (tabs.length === 0) {
		return null;
	}

	pairSplits(tabs);
	const updated = Number(raw.updatedAt);
	return {
		id: cleanText(raw.id, makeId(), 100),
		name: cleanText(raw.name ?? raw.title, 'Saved session', 120),
		folderId: cleanText(raw.folderId, DEFAULT_FOLDER_ID, 100),
		description: cleanText(raw.description, '', 500),
		notes: normalizeNotes(raw.notes),
		archived: Boolean(raw.archived),
		archivedAt: raw.archived
			? Number.isFinite(Number(raw.archivedAt)) && Number(raw.archivedAt) > 0
				? Number(raw.archivedAt)
				: createdAt
			: null,
		locked: Boolean(raw.locked),
		createdAt,
		updatedAt: Number.isFinite(updated) && updated > 0 ? updated : createdAt,
		sourceWindowName: cleanText(raw.sourceWindowName, '', 180),
		sourceWindowId: isInteger(raw.sourceWindowId) ? raw.sourceWindowId : null,
		tabs,
	};
}

function normalizeSettings(input: RawSettings | null = {}): Settings {
	// A missing, null or non-object stored value means "no saved preferences": every field falls back to its default.
	const raw: RawSettings = isRecord(input) ? input : {};
	const settings: Settings = {
		...DEFAULT_SETTINGS,
		closeOnSave: raw.closeOnSave !== false,
		includePinnedTabs: raw.includePinnedTabs === true,
		openDashboardAfterSave: raw.openDashboardAfterSave === true,
		openDashboardOnStartup: Boolean(raw.openDashboardOnStartup),
		startupBehavior:
			raw.startupBehavior === 'last-session' ? 'last-session' : 'dashboard',
		newTabEnabled: raw.newTabEnabled !== false,
		autoFocusSearchOnNewTab: raw.autoFocusSearchOnNewTab === true,
		actionMode: isOneOf(
			[
				'current-group',
				'current-window',
				'full-window',
				'all-windows',
				'current-tab',
				'current-tab-to-group',
			],
			raw.actionMode,
		)
			? raw.actionMode
			: 'popup',
		sessionsEnabled: raw.sessionsEnabled !== false,
		bookmarksEnabled: raw.bookmarksEnabled !== false,
		// `sidePanelEnabled` is the pre-toolbarOpens boolean; honour it for data saved by older builds.
		toolbarOpens:
			raw.toolbarOpens === 'sidepanel' ||
			(raw.toolbarOpens === undefined && raw.sidePanelEnabled === true)
				? 'sidepanel'
				: 'popup',
		excludedOrigins: normalizeExcludedOrigins(raw.excludedOrigins),
		saveDuplicateHandling:
			raw.saveDuplicateHandling === 'reject' ? 'reject' : 'allow',
		saveDuplicateTitle:
			raw.saveDuplicateTitle === 'latest' ? 'latest' : 'existing',
		restoreDuplicateHandling:
			(raw.restoreDuplicateHandling ?? raw.duplicateHandling) === 'open'
				? 'open'
				: 'skip',
		restoreTarget: isOneOf(
			['current-window', 'new-window-unless-only-tab', 'always-new-window'],
			raw.restoreTarget,
		)
			? raw.restoreTarget
			: 'new-window-unless-only-tab',
		restoreMode: isOneOf(['keep', 'remove', 'archive'], raw.restoreMode)
			? raw.restoreMode
			: 'keep',
		singleTabBehavior: raw.singleTabBehavior === 'switch' ? 'switch' : 'stay',
		unloadRestoredTabs: Boolean(raw.unloadRestoredTabs),
		unloadRestoredTabsThreshold: clampInteger(
			raw.unloadRestoredTabsThreshold,
			1,
			500,
			5,
		),
		restoreSplitTabs:
			raw.restoreSplitTabs === 'separate' ? 'separate' : 'split',
		saveSplitTabs: raw.saveSplitTabs === 'focused' ? 'focused' : 'both',
		sessionSort: isOneOf(
			['newest', 'oldest', 'name', 'tabs', 'custom'],
			raw.sessionSort,
		)
			? raw.sessionSort
			: 'newest',
		sessionLayout: raw.sessionLayout === 'grid' ? 'grid' : 'list',
		expandSessionsByDefault: raw.expandSessionsByDefault !== false,
		stretchBookmarkColumns: raw.stretchBookmarkColumns !== false,
		bookmarkClickAction: isOneOf(
			['none', 'current', 'new'],
			raw.bookmarkClickAction,
		)
			? raw.bookmarkClickAction
			: 'current',
		sessionLinkClickAction: isOneOf(
			['none', 'current', 'new'],
			raw.sessionLinkClickAction,
		)
			? raw.sessionLinkClickAction
			: 'new',
		showBookmarkQuickActions: raw.showBookmarkQuickActions === true,
		sessionsOnTop: raw.sessionsOnTop === true,
		keepLodgePinned: raw.keepLodgePinned === true,
		copyFormat: isOneOf(
			['rich', 'title-url', 'url-title', 'url', 'markdown'],
			raw.copyFormat,
		)
			? raw.copyFormat
			: raw.copyFormat === 'html'
				? 'rich'
				: raw.copyFormat === 'plain'
					? 'title-url'
					: 'markdown',
		dashboardBehavior: raw.dashboardBehavior === 'move' ? 'move' : 'switch',
		urlDisplayMode: isOneOf(['domain', 'full', 'none'], raw.urlDisplayMode)
			? raw.urlDisplayMode
			: 'full',
		groupTitleAction: raw.groupTitleAction === 'restore' ? 'restore' : 'edit',
		contextMenusEnabled: raw.contextMenusEnabled !== false,
		contextMenuLinksEnabled: raw.contextMenuLinksEnabled !== false,
		contextMenuPageEnabled: raw.contextMenuPageEnabled !== false,
		contextMenuSelectionEnabled: raw.contextMenuSelectionEnabled !== false,
		contextMenuActionEnabled: raw.contextMenuActionEnabled !== false,
	};
	if (!settings.sessionsEnabled && !settings.bookmarksEnabled) {
		settings.sessionsEnabled = true;
	}

	return settings;
}

/**
A whole number within [min, max]; fractions are truncated, anything that is not a number gives the fallback.
*/
function clampInteger(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	const number_ = typeof value === 'string' ? Number(value) : value;
	return typeof number_ !== 'number' || !Number.isFinite(number_)
		? fallback
		: Math.min(max, Math.max(min, Math.trunc(number_)));
}

/**
An excluded-site entry as a bare lower-case host name, or null when it is not a usable web host. Accepts
"google.com", "*.google.com", "https://google.com:8080/path" and old stored origins; a leading "www." is dropped.
Entries cover the host and all its subdomains. (Duplicated in src/app/excluded-sites.ts for the pages.)
*/
function normalizeExcludedHost(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const text = value.trim().replace(/^([a-z][\d+\-.a-z]*:\/\/)?\*\./i, '$1');
	if (!text || text.length > 2048) {
		return null;
	}

	try {
		const url = new URL(
			/^[a-z][\d+\-.a-z]*:\/\//i.test(text) ? text : `https://${text}`,
		);
		if (!['http:', 'https:'].includes(url.protocol)) {
			return null;
		}

		let host = url.hostname.toLowerCase().replace(/\.$/, '');
		if (host.startsWith('www.') && host.includes('.', 4)) {
			host = host.slice(4);
		}

		return !host.includes('.') && host !== 'localhost' && !host.startsWith('[')
			? null
			: host;
	} catch {
		return null;
	}
}

/**
True when `host` is an entry or one of its subdomains ("mail.google.com" for "google.com", not "notgoogle.com").
*/
function hostIsExcluded(host: string, entries: readonly string[]): boolean {
	return entries.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
Normalizes the stored list: hosts only, duplicates removed. A child such as "mail.google.com" next to "google.com"
is kept, since it is harmless and shows what the user added.
*/
function normalizeExcludedOrigins(raw: unknown): string[] {
	const hosts: string[] = [];
	for (const value of Array.isArray(raw) ? raw.slice(0, 500) : []) {
		const host = normalizeExcludedHost(value);
		if (host && !hosts.includes(host)) {
			hosts.push(host);
		}
	}

	return hosts;
}

function normalizeStore(raw: Raw | null | undefined): Store {
	// NormalizeSettings treats a missing, null or non-object `settings` value as defaults.
	const settings = normalizeSettings(
		raw?.settings as RawSettings | null | undefined,
	);
	const sourceGroups = Array.isArray(raw?.groups) ? raw.groups : [];
	const seenIds = new Set<string>();
	// Pinned tabs that were deliberately saved stay stored even if the save preference is later switched off.
	const groups = sourceGroups
		.slice(0, 1000)
		.map((entry: unknown) => normalizeGroup(entry, Date.now(), true))
		.filter((group): group is Session => {
			if (!group) {
				return false;
			}

			if (seenIds.has(group.id)) {
				group.id = makeId();
			}

			seenIds.add(group.id);
			return true;
		});
	const folders = normalizeFolders(raw?.folders);
	const knownFolderIds = new Set(folders.map((folder) => folder.id));
	for (const group of groups) {
		if (!knownFolderIds.has(group.folderId)) {
			group.folderId = DEFAULT_FOLDER_ID;
		}
	}

	const bookmarkColumns = normalizeBookmarkColumns(raw?.bookmarkColumns);
	const bookmarkColumnIds = new Set(bookmarkColumns.map((column) => column.id));
	const bookmarkIds = new Set<string>();
	const bookmarks = (Array.isArray(raw?.bookmarks) ? raw.bookmarks : [])
		.map((entry: unknown) => normalizeBookmark(entry, bookmarkColumnIds))
		.filter((bookmark): bookmark is Bookmark => {
			if (!bookmark) {
				return false;
			}

			if (bookmarkIds.has(bookmark.id)) {
				bookmark.id = makeId();
			}

			bookmarkIds.add(bookmark.id);
			return true;
		});
	return {
		schemaVersion: SCHEMA_VERSION,
		groups,
		folders,
		bookmarkColumns,
		bookmarks,
		settings,
		updatedAt: Number.isFinite(Number(raw?.updatedAt))
			? Number(raw?.updatedAt)
			: Date.now(),
	};
}

async function getStore(): Promise<Store> {
	// Stored values are untrusted; only property reads happen before normalization.
	const saved = await chrome.storage.local.get<
		Record<string, Raw | null | undefined>
	>([STORAGE_KEY]);
	const exists = saved[STORAGE_KEY] && typeof saved[STORAGE_KEY] === 'object';
	const storedVersion = Number(saved[STORAGE_KEY]?.schemaVersion) || 0;
	if (exists && storedVersion > SCHEMA_VERSION) {
		throw new Error(
			`This ${APP_NAME} data was saved by a newer version. Update ${APP_NAME} before opening it here.`,
		);
	}

	const store = normalizeStore(exists ? saved[STORAGE_KEY] : null);
	if (!exists || saved[STORAGE_KEY]?.schemaVersion !== SCHEMA_VERSION) {
		await chrome.storage.local.set({[STORAGE_KEY]: store});
	}

	return store;
}

async function writeStore(store: Store): Promise<Store> {
	// Removing or skipping one tab of a pair (delete, restore-and-remove, import duplicates) orphans its partner.
	for (const group of store.groups) {
		pairSplits(group.tabs);
	}

	const next = {
		schemaVersion: SCHEMA_VERSION,
		groups: store.groups,
		folders: normalizeFolders(store.folders),
		bookmarkColumns: normalizeBookmarkColumns(store.bookmarkColumns),
		bookmarks: store.bookmarks,
		settings: normalizeSettings(store.settings),
		updatedAt: Date.now(),
	};
	await chrome.storage.local.set({[STORAGE_KEY]: next});
	return next;
}

function mutate<T>(operation: () => Promise<T>): Promise<T> {
	const result = mutationQueue.then(operation, operation);
	mutationQueue = result.catch(() => undefined);
	return result;
}

async function currentWindowId(
	senderTab?: chrome.tabs.Tab,
): Promise<number | null | undefined> {
	if (senderTab && isInteger(senderTab.windowId)) {
		try {
			const win = await chrome.windows.get(senderTab.windowId, {
				populate: false,
			});
			if (win.type === 'normal') {
				return win.id;
			}
		} catch {
			/*
			The sender window may have closed.
			*/
		}
	}

	try {
		const focused = await chrome.windows.getLastFocused({populate: false});
		if (focused.type === 'normal' && isInteger(focused.id)) {
			return focused.id;
		}
	} catch {
		/*
		Fall back to the first normal window.
		*/
	}

	const windows = await chrome.windows.getAll({
		populate: false,
		windowTypes: ['normal'],
	});
	return windows[0]?.id ?? null;
}

/**
The browser's split view id for a tab, or null when it is not split (-1, or a browser without Split View).
*/
function splitViewOf(tab: chrome.tabs.Tab | undefined): number | null {
	const id = tab?.splitViewId;
	return isInteger(id) && id >= 0 ? id : null;
}

// One tab-strip slot per split view: Chromium can report both halves of the active split as highlighted,
// which on its own is not a multi-tab selection.
function selectionSlots(tabs: chrome.tabs.Tab[]) {
	return new Set(
		tabs.map((tab) => {
			const split = splitViewOf(tab);
			return split === null ? `tab:${tab.id}` : `split:${split}`;
		}),
	).size;
}

function isCapturable(
	tab: chrome.tabs.Tab | undefined,
	settings: Settings | null = null,
) {
	const url = normalizeUrl(tab?.url);
	if (!url) {
		return false;
	}

	if (!settings) {
		return true;
	}

	try {
		return !hostIsExcluded(
			new URL(url).hostname.toLowerCase(),
			settings.excludedOrigins,
		);
	} catch {
		return false;
	}
}

async function getWindowGroups(
	windowId: number | undefined,
): Promise<Map<number, NativeGroup>> {
	try {
		const groups = await chrome.tabGroups.query({windowId});
		return new Map(
			groups.map((group) => [
				group.id,
				{
					key: String(group.id),
					title: cleanText(group.title, '', 100),
					color: isGroupColor(group.color) ? group.color : 'grey',
					collapsed: Boolean(group.collapsed),
				},
			]),
		);
	} catch {
		return new Map();
	}
}

async function captureTabs(
	tabs: chrome.tabs.Tab[],
	window: PopulatedWindow,
	settings: Settings,
	store: Store,
	folderId = DEFAULT_FOLDER_ID,
	useNativeGroupTitle = false,
	requestedName = '',
): Promise<CaptureResult | null> {
	const timestamp = Date.now();
	const nativeGroups = await getWindowGroups(window.id);
	const captureEntries = tabs
		.filter(
			(tab) =>
				(!tab.pinned || settings.includePinnedTabs) &&
				isCapturable(tab, settings),
		)
		.map((tab, index) => ({
			sourceTabId: tab.id,
			splitViewId: splitViewOf(tab),
			saved: {
				id: makeId(),
				title: cleanText(tab.title, normalizeUrl(tab.url), 500),
				url: normalizeUrl(tab.url),
				faviconUrl: normalizeFavicon(tab.favIconUrl),
				notes: '',
				pinned: Boolean(tab.pinned),
				nativeGroup:
					tab.groupId >= 0
						? normalizeNativeGroup(
								nativeGroups.get(tab.groupId),
								String(tab.groupId),
							)
						: null,
				savedAt: timestamp,
				originalIndex: isInteger(tab.index) ? tab.index : index,
				// IsCapturable guarantees a web URL; `archived` is filled in by the next normalization.
			} as SavedTab,
		}));
	if (captureEntries.length === 0) {
		return null;
	}

	// Rejected duplicates are not stored again, but their tabs still count as saved for close-after-save.
	// Allowed duplicates share notes (and, by policy, the title) with the copies already saved.
	let skipped = 0;
	let titlesUpdated = false;
	let newEntries = captureEntries;
	const known = new Map<string, SavedTab>();
	for (const existingGroup of store.groups) {
		for (const existingTab of existingGroup.tabs) {
			if (!known.has(existingTab.url)) {
				known.set(existingTab.url, existingTab);
			}
		}
	}

	const applyLatestTitle = (url: string, title: string) => {
		for (const existingGroup of store.groups) {
			for (const existingTab of existingGroup.tabs) {
				if (existingTab.url !== url || existingTab.title === title) {
					continue;
				}

				existingTab.title = title;
				titlesUpdated = true;
			}
		}
	};

	newEntries = [];
	for (const entry of captureEntries) {
		const existing = known.get(entry.saved.url);
		if (!existing) {
			known.set(entry.saved.url, entry.saved);
			newEntries.push(entry);
			continue;
		}

		if (settings.saveDuplicateHandling === 'reject') {
			skipped += 1;
			if (settings.saveDuplicateTitle === 'latest') {
				applyLatestTitle(entry.saved.url, entry.saved.title);
			}

			continue;
		}

		entry.saved.notes = existing.notes || '';
		if (settings.saveDuplicateTitle === 'latest') {
			applyLatestTitle(entry.saved.url, entry.saved.title);
		} else {
			entry.saved.title = existing.title;
		}

		newEntries.push(entry);
	}

	// Split info is assigned only after exclusions, pinned filtering, and duplicate rejection, so a pair whose
	// partner was dropped is stored as a plain tab.
	const splitMembers = new Map<number, typeof newEntries>();
	for (const entry of newEntries) {
		if (entry.splitViewId === null) {
			continue;
		}

		splitMembers.set(entry.splitViewId, [
			...(splitMembers.get(entry.splitViewId) || []),
			entry,
		]);
	}

	for (const members of splitMembers.values()) {
		if (members.length !== 2) {
			continue;
		}

		const pairKey = makeId();
		for (const [position, entry] of members
			.toSorted((a, b) => a.saved.originalIndex - b.saved.originalIndex)
			.entries()) {
			entry.saved.split = {
				id: pairKey,
				position: position as SplitInfo['position'],
			};
		}
	}

	const captured = pairSplits(newEntries.map(({saved}) => saved));

	const group: CaptureResult =
		captured.length > 0
			? {
					id: makeId(),
					name: cleanText(
						requestedName ||
							(useNativeGroupTitle
								? captured.find((tab) => tab.nativeGroup?.title)?.nativeGroup
										?.title
								: captured[0].title),
						'Saved session',
						120,
					),
					folderId: store.folders.some((folder) => folder.id === folderId)
						? folderId
						: DEFAULT_FOLDER_ID,
					description: '',
					notes: '',
					archived: false,
					archivedAt: null,
					locked: false,
					createdAt: timestamp,
					updatedAt: timestamp,
					sourceWindowName: cleanText(window.title, '', 180),
					sourceWindowId: window.id,
					tabs: captured,
				}
			: {id: null, tabs: [], skipped};
	// A non-empty capture always produced the Session branch above.
	if (captured.length > 0) {
		store.groups.unshift(group as Session);
	}

	group.skipped = skipped;
	if (captured.length > 0 || titlesUpdated) {
		await writeStore(store);
	}

	const closeCandidates = new Map(
		captureEntries
			.filter(
				({sourceTabId, saved}) =>
					isInteger(sourceTabId) &&
					(!saved.pinned || settings.includePinnedTabs),
			)
			.map(
				({sourceTabId, saved}) =>
					[sourceTabId, {url: saved.url, pinned: saved.pinned}] as const,
			),
	);

	if (
		captured.length > 0 &&
		settings.openDashboardAfterSave &&
		window.id === (await currentWindowId())
	) {
		await openDashboard(
			window.id,
			`?group=${encodeURIComponent(group.id!)}`,
			settings.dashboardBehavior,
		);
	}

	if (settings.closeOnSave && closeCandidates.size > 0) {
		const remaining = await chrome.tabs.query({windowId: window.id});
		const closeIds = remaining
			.filter((tab) => {
				const saved = closeCandidates.get(tab.id);
				return Boolean(
					saved &&
					normalizeUrl(tab.url) === saved.url &&
					Boolean(tab.pinned) === saved.pinned &&
					(!tab.pinned || settings.includePinnedTabs),
				);
			})
			.map((tab) => tab.id);
		const remainingIds = remaining.filter((tab) => !closeIds.includes(tab.id));
		if (closeIds.length > 0 && remainingIds.length === 0) {
			const isFocusedWindow = window.id === (await currentWindowId());
			const useDashboard =
				captured.length > 0 &&
				settings.openDashboardAfterSave &&
				isFocusedWindow;
			await chrome.tabs.create({
				windowId: window.id,
				url: useDashboard
					? `${DASHBOARD_URL}?group=${encodeURIComponent(group.id!)}`
					: 'chrome://newtab/',
				active: useDashboard,
			});
		}

		if (closeIds.length > 0) {
			// Only close candidates (integer tab ids) match, so every id is defined.
			try {
				await chrome.tabs.remove(closeIds as number[]);
			} catch {
				/*
				A tab can close while the save is being completed.
				*/
			}
		}
	}

	return group;
}

async function saveTabs(
	scope: SaveScope,
	senderTab?: chrome.tabs.Tab,
	requestedFolderId: string = DEFAULT_FOLDER_ID,
	options: {
		tabIds?: number[];
		groupName?: string;
		includePinned?: boolean;
	} = {},
): Promise<ActionResult<'SAVE_TABS'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const windowId = await currentWindowId(senderTab);
		if (!isInteger(windowId)) {
			return {ok: false, error: 'Open a browser window before saving tabs.'};
		}

		const selectedWindow = await chrome.windows.get(windowId, {
			populate: false,
		});
		// The quick popup may allow pinned tabs for one save without changing the stored preference.
		const captureSettings =
			options.includePinned === true
				? {...store.settings, includePinnedTabs: true}
				: store.settings;
		let windows: PopulatedWindow[];
		if (scope === 'all-windows') {
			windows = (await chrome.windows.getAll({
				populate: true,
				windowTypes: ['normal'],
			})) as PopulatedWindow[];
		} else {
			windows = [
				(await chrome.windows.get(windowId, {
					populate: true,
				})) as PopulatedWindow,
			];
		}

		const savedGroups: Session[] = [];
		let skippedDuplicates = 0;
		for (const win of windows) {
			const activeTab = win.tabs.find((tab) => tab.active);
			let inScope = win.tabs;
			const senderInWindow = win.tabs.find((tab) => tab.id === senderTab?.id);
			const referenceTab = senderInWindow || activeTab;
			if (scope === 'selected') {
				inScope = win.tabs.filter((tab) => tab.highlighted);
			}

			if (scope === 'selected-or-window') {
				const highlighted = win.tabs.filter((tab) => tab.highlighted);
				inScope = selectionSlots(highlighted) > 1 ? highlighted : win.tabs;
			}

			if (scope === 'current-tab') {
				inScope = activeTab ? [activeTab] : [];
			}

			if (scope === 'this-tab') {
				inScope = referenceTab ? [referenceTab] : [];
			}

			if (scope === 'except-this-tab') {
				inScope = win.tabs.filter(
					(tab) => !referenceTab || tab.id !== referenceTab.id,
				);
			}

			if (scope === 'left-of-tab') {
				inScope = win.tabs.filter(
					(tab) => referenceTab && tab.index < referenceTab.index,
				);
			}

			if (scope === 'right-of-tab') {
				inScope = win.tabs.filter(
					(tab) => referenceTab && tab.index > referenceTab.index,
				);
			}

			if (Array.isArray(options.tabIds)) {
				const requestedTabIds = new Set<number | undefined>(
					options.tabIds.filter(isInteger),
				);
				// Explicit picks from the quick popup override the scope, so unhighlighted tabs can be chosen.
				inScope = win.tabs.filter((tab) => requestedTabIds.has(tab.id));
			}

			// "Save only the focused tab" applies to selection saves (shortcut, menus, and the toolbar's
			// selected-or-window mode when it saves a selection). Whole-window saves always keep both halves,
			// and explicit quick-popup picks are saved as chosen.
			const selectionSave =
				!Array.isArray(options.tabIds) &&
				(scope === 'selected' ||
					(scope === 'selected-or-window' && inScope !== win.tabs));
			const activeSplit = splitViewOf(activeTab);
			if (
				selectionSave &&
				store.settings.saveSplitTabs === 'focused' &&
				activeTab &&
				activeSplit !== null
			) {
				inScope = inScope.filter(
					(tab) => tab.id === activeTab.id || splitViewOf(tab) !== activeSplit,
				);
			}

			if (scope === 'tab-group') {
				const groupTab = senderInWindow || activeTab;
				inScope =
					groupTab && groupTab.groupId >= 0
						? win.tabs.filter((tab) => tab.groupId === groupTab.groupId)
						: [];
			}

			if (scope === 'current-group' && activeTab && activeTab.groupId >= 0) {
				inScope = win.tabs.filter((tab) => tab.groupId === activeTab.groupId);
			}

			const folderId = store.folders.some(
				(folder) => folder.id === requestedFolderId,
			)
				? requestedFolderId
				: DEFAULT_FOLDER_ID;
			const group = await captureTabs(
				inScope,
				win,
				captureSettings,
				store,
				folderId,
				scope === 'current-group' &&
					Boolean(activeTab && activeTab.groupId >= 0),
				options.groupName,
			);
			// A capture with tabs is always a stored Session.
			if (group?.tabs.length) {
				savedGroups.push(group as Session);
			}

			if (group) {
				skippedDuplicates += group.skipped || 0;
			}
		}

		if (savedGroups.length === 0 && skippedDuplicates) {
			return {
				ok: true,
				count: 0,
				groups: 0,
				skipped: skippedDuplicates,
				groupId: null,
			};
		}

		if (savedGroups.length === 0) {
			const message =
				scope === 'selected'
					? 'Select one or more web tabs in the tab strip first.'
					: scope === 'tab-group'
						? 'The active tab is not in a tab group.'
						: scope === 'left-of-tab'
							? 'There are no unpinned web tabs to the left of this tab.'
							: scope === 'right-of-tab'
								? 'There are no unpinned web tabs to the right of this tab.'
								: 'There are no unpinned web tabs to save.';
			return {ok: false, error: message};
		}

		if (store.settings.openDashboardAfterSave && scope === 'all-windows') {
			await openDashboard(
				selectedWindow.id,
				`?group=${encodeURIComponent(savedGroups[0].id)}`,
				store.settings.dashboardBehavior,
			);
		}

		return {
			ok: true,
			count: savedGroups.reduce((sum, group) => sum + group.tabs.length, 0),
			groups: savedGroups.length,
			skipped: skippedDuplicates,
			groupId: savedGroups[0].id,
		};
	});
}

async function openDashboard(
	windowId: number | null | undefined,
	query = '',
	behavior: Settings['dashboardBehavior'] = 'switch',
) {
	const path = `${DASHBOARD_URL}${query}`;
	const existingTabs = await chrome.tabs.query({});
	const dashboards = existingTabs.filter((tab) => isLodgeTab(tab));
	// A pinned TabLodge tab is the window's fixed home: prefer the one in this window and never move it.
	const pinnedHere = dashboards.find(
		(tab) => tab.pinned && tab.windowId === windowId,
	);
	let existing = pinnedHere ?? dashboards[0];
	if (existing?.id) {
		if (
			behavior === 'move' &&
			!existing.pinned &&
			isInteger(windowId) &&
			existing.windowId !== windowId
		) {
			try {
				existing = await chrome.tabs.move(existing.id, {windowId, index: -1});
			} catch {
				/*
				Keep using the open dashboard if the browser cannot move it.
				*/
			}
		}

		await chrome.tabs.update(existing.id, {url: path, active: true});
		await chrome.windows.update(existing.windowId, {focused: true});
		return existing.id;
	}

	const options: chrome.tabs.CreateProperties = {url: path, active: true};
	if (isInteger(windowId)) {
		options.windowId = windowId;
	}

	const created = await chrome.tabs.create(options);
	return created.id;
}

// ---- Keep TabLodge pinned ----
// With "Keep TabLodge pinned" on, every normal window gets exactly one pinned TabLodge tab. Checks are
// debounced; if the user closes or unpins it twice within LODGE_FIGHT_WINDOW_MS the window is left alone until it
// is focused again, so the worker never fights the user.
const LODGE_CHECK_DELAY_MS = 300;
const LODGE_FIGHT_WINDOW_MS = 5000;
// When the user last removed or unpinned the tab, per window (only user-triggered repairs are recorded).
const lodgeUndoneAt = new Map<number, number>();
const lodgeUserTriggered = new Set<number>();
const lodgePaused = new Set<number>();
const lodgePending = new Set<number>();
let lodgeCheckAll = false;
let lodgeTimer: ReturnType<typeof setTimeout> | undefined;

function isLodgeTab(tab: chrome.tabs.Tab | undefined) {
	return Boolean((tab?.url || tab?.pendingUrl)?.startsWith(DASHBOARD_URL));
}

async function ensureLodgePinned(windowId: number, userTriggered = false) {
	return mutate(async () => {
		if (lodgePaused.has(windowId)) {
			return;
		}

		const store = await getStore();
		if (!store.settings.keepLodgePinned) {
			return;
		}

		const win = await chrome.windows.get(windowId, {populate: false});
		if (win.type !== 'normal' || win.incognito) {
			return;
		}

		const lodges = (await chrome.tabs.query({windowId})).filter((tab) =>
			isLodgeTab(tab),
		);
		const pinned = lodges.filter((tab) => tab.pinned);
		const extras = pinned
			.slice(1)
			.map((tab) => tab.id)
			.filter(isInteger);
		if (extras.length > 0) {
			await chrome.tabs.remove(extras);
		}

		if (pinned.length > 0) {
			return;
		}

		// Two user undos within LODGE_FIGHT_WINDOW_MS mean they want it gone: wait for the next window focus.
		if (userTriggered) {
			const undoneAt = lodgeUndoneAt.get(windowId);
			lodgeUndoneAt.set(windowId, Date.now());
			if (
				undoneAt !== undefined &&
				Date.now() - undoneAt < LODGE_FIGHT_WINDOW_MS
			) {
				lodgePaused.add(windowId);
				return;
			}
		}

		if (isInteger(lodges[0]?.id)) {
			await chrome.tabs.update(lodges[0].id, {pinned: true});
		} else {
			await chrome.tabs.create({
				windowId,
				url: DASHBOARD_URL,
				pinned: true,
				active: false,
			});
		}
	});
}

async function runLodgeChecks() {
	const all = lodgeCheckAll;
	const ids = new Set(lodgePending);
	const triggered = new Set(lodgeUserTriggered);
	lodgeCheckAll = false;
	lodgePending.clear();
	lodgeUserTriggered.clear();
	try {
		if (all) {
			for (const win of await chrome.windows.getAll({
				populate: false,
				windowTypes: ['normal'],
			})) {
				if (isInteger(win.id)) {
					ids.add(win.id);
				}
			}
		}

		for (const id of ids) {
			await ensureLodgePinned(id, triggered.has(id)).catch(() => undefined);
		}
	} catch {
		/*
		A window can close while it is being checked.
		*/
	}
}

/**
Queues a (debounced) check of one window, or of every normal window when no id is given.
*/
function scheduleLodgeCheck(windowId?: number, userTriggered = false) {
	if (isInteger(windowId)) {
		lodgePending.add(windowId);
		if (userTriggered) {
			lodgeUserTriggered.add(windowId);
		}
	} else {
		lodgeCheckAll = true;
	}

	clearTimeout(lodgeTimer);
	lodgeTimer = setTimeout(() => void runLodgeChecks(), LODGE_CHECK_DELAY_MS);
}

chrome.windows.onCreated?.addListener((win) => {
	if (win.type === 'normal') {
		scheduleLodgeCheck(win.id);
	}
});
chrome.windows.onFocusChanged?.addListener((windowId) => {
	if (windowId < 0) {
		return;
	}

	lodgePaused.delete(windowId);
	lodgeUndoneAt.delete(windowId);
	scheduleLodgeCheck(windowId);
});
chrome.tabs.onRemoved?.addListener((_tabId, info) => {
	if (!info.isWindowClosing) {
		scheduleLodgeCheck(info.windowId, true);
	}
});
chrome.tabs.onUpdated?.addListener((_tabId, change, tab) => {
	if (change.pinned === false && isLodgeTab(tab)) {
		scheduleLodgeCheck(tab.windowId, true);
	}
});
chrome.tabs.onAttached?.addListener((_tabId, info) => {
	scheduleLodgeCheck(info.newWindowId);
});
chrome.tabs.onDetached?.addListener((_tabId, info) => {
	scheduleLodgeCheck(info.oldWindowId);
});

function findGroup(store: Store, groupId: string) {
	return store.groups.find((group) => group.id === groupId) || null;
}

async function chooseRestoreWindow(
	settings: Settings,
	senderTab: chrome.tabs.Tab | undefined,
	restoreTarget: RestoreTarget = settings.restoreTarget,
): Promise<{id: number | undefined; bootstrapTabId: number | null}> {
	const id = await currentWindowId(senderTab);
	let needsNewWindow = restoreTarget === 'always-new-window';
	if (restoreTarget === 'new-window-unless-only-tab' && isInteger(id)) {
		const currentTabs = await chrome.tabs.query({windowId: id});
		needsNewWindow = currentTabs.length > 1;
	}

	if (!isInteger(id)) {
		needsNewWindow = true;
	}

	if (needsNewWindow) {
		// Windows.create only resolves without a window for incognito requests, which TabLodge never makes.
		const created = (await chrome.windows.create({
			url: 'chrome://newtab/',
			focused: true,
			type: 'normal',
		}))!;
		const tabs = await chrome.tabs.query({windowId: created.id});
		return {id: created.id, bootstrapTabId: tabs[0]?.id ?? null};
	}

	// Reached only when id is an integer; otherwise needsNewWindow was set above.
	return {id: id!, bootstrapTabId: null};
}

/**
 Pairs two adjacent restored tabs into a split view. They were created next to each other with the same
 pinned state and are already in the same tab group (grouping runs first, so the browser's "same groupId"
 rule holds). If the browser refuses, a non-adjacent pair is moved together once and retried.
 */
async function splitRestoredPair(
	left: number,
	right: number,
): Promise<boolean> {
	try {
		await chrome.tabs.createSplit([left, right]);
		return true;
	} catch {
		/*
		Retried below when only adjacency is wrong.
		*/
	}

	try {
		const [a, b] = await Promise.all([
			chrome.tabs.get(left),
			chrome.tabs.get(right),
		]);
		if (
			a.windowId !== b.windowId ||
			a.pinned !== b.pinned ||
			a.groupId !== b.groupId ||
			b.index === a.index + 1
		) {
			return false;
		}

		await chrome.tabs.move(right, {
			index: b.index > a.index ? a.index + 1 : a.index,
		});
		await chrome.tabs.createSplit([left, right]);
		return true;
	} catch {
		return false;
	}
}

async function restoreRecords(
	records: SavedTab[],
	settings: Settings,
	senderTab: chrome.tabs.Tab | undefined,
	options: {restoreTarget?: RestoreTarget; activate?: boolean} = {},
): Promise<RestoreRecordsResult> {
	// Restoring a single tab of a pair passes one record, so pairSplits leaves it a plain tab.
	const valid = pairSplits(
		records
			.map((tab, index) => normalizeTab(tab, Date.now(), index))
			.filter((tab): tab is SavedTab => Boolean(tab)),
	);
	if (valid.length === 0) {
		return {
			opened: [],
			skipped: 0,
			failures: [],
			splits: 0,
			splitsSeparated: 0,
		};
	}

	const target = await chooseRestoreWindow(
		settings,
		senderTab,
		options.restoreTarget || settings.restoreTarget,
	);
	const targetTabs = await chrome.tabs.query({windowId: target.id});
	const existing = new Set(
		targetTabs
			.filter(
				(tab) =>
					(!tab.pinned || settings.includePinnedTabs) &&
					isCapturable(tab, settings),
			)
			.map((tab) => normalizeUrl(tab.url)),
	);
	const shouldSkip = settings.restoreDuplicateHandling === 'skip';
	const opened: RestoreRecordsResult['opened'] = [];
	const openedIds = new Map<SavedTab, number>();
	const failures: RestoreFailure[] = [];
	const groupTabs = new Map<
		string,
		{tabIds: number[]; metadata: NativeGroup; groupId?: number}
	>();
	let skipped = 0;

	// Tabs open in saved order, so the two halves of a pair are created next to each other.
	for (const saved of valid) {
		if (shouldSkip && existing.has(saved.url)) {
			skipped += 1;
			continue;
		}

		try {
			const created = await chrome.tabs.create({
				windowId: target.id,
				url: saved.url,
				active: false,
				pinned: saved.pinned,
			});
			opened.push({saved, tabId: created.id});
			// Tabs.create always resolves with a tab that has an id.
			openedIds.set(saved, created.id!);
			existing.add(saved.url);
			if (saved.nativeGroup && !saved.pinned) {
				const key =
					saved.nativeGroup.key || saved.nativeGroup.title || 'default';
				const entry = groupTabs.get(key) || {
					tabIds: [],
					metadata: saved.nativeGroup,
				};
				entry.tabIds.push(created.id!);
				groupTabs.set(key, entry);
			}
		} catch (error) {
			failures.push({
				title: saved.title,
				url: saved.url,
				error: cleanText(
					errorMessage(error),
					'The browser refused to open this tab.',
					240,
				),
			});
		}
	}

	// Grouping comes before splitting: createSplit needs both tabs in the same group, and both halves of a
	// pair are listed next to each other in the group's tabIds, so tabs.group keeps them adjacent.
	for (const entry of groupTabs.values()) {
		try {
			// Every grouped entry was created with at least one tab id.
			entry.groupId = await chrome.tabs.group({
				tabIds: entry.tabIds as [number, ...number[]],
				createProperties: {windowId: target.id},
			});
		} catch {
			/*
			Tab grouping is optional on Chromium builds that lack it.
			*/
		}
	}

	// Only pairs whose two tabs both opened are split; a skipped or failed partner leaves a plain tab.
	const splitTabIds = new Set<number>();
	let splits = 0;
	let splitsSeparated = 0;
	if (
		settings.restoreSplitTabs === 'split' &&
		typeof chrome.tabs.createSplit === 'function'
	) {
		for (let index = 0; index < valid.length - 1; index += 1) {
			const left = valid[index];
			const right = valid[index + 1];
			if (!left.split || right.split?.id !== left.split.id) {
				continue;
			}

			index += 1;
			const leftId = openedIds.get(left);
			const rightId = openedIds.get(right);
			if (leftId === undefined || rightId === undefined) {
				continue;
			}

			if (await splitRestoredPair(leftId, rightId)) {
				splits += 1;
				splitTabIds.add(leftId).add(rightId);
			} else {
				splitsSeparated += 1;
			}
		}
	}

	// Titles, colors, and collapsing are applied after splitting so a pair is never split inside a collapsed group.
	for (const entry of groupTabs.values()) {
		if (entry.groupId === undefined) {
			continue;
		}

		try {
			await chrome.tabGroups.update(entry.groupId, {
				title: entry.metadata.title,
				color: entry.metadata.color,
				collapsed: entry.metadata.collapsed,
			});
		} catch {
			/*
			Group metadata is best effort.
			*/
		}
	}

	if (options.activate !== false && opened[0]?.tabId) {
		try {
			await chrome.tabs.update(opened[0].tabId, {active: true});
		} catch {
			/*
			The tab may have been closed.
			*/
		}
	}

	if (
		target.bootstrapTabId &&
		opened.length > 0 &&
		options.activate !== false
	) {
		try {
			await chrome.tabs.remove(target.bootstrapTabId);
		} catch {
			/*
			The bootstrap tab may already be gone.
			*/
		}
	}

	if (
		settings.unloadRestoredTabs &&
		opened.length > settings.unloadRestoredTabsThreshold &&
		typeof chrome.tabs.discard === 'function'
	) {
		const currentTabs = await chrome.tabs.query({windowId: target.id});
		const activeId = currentTabs.find((tab) => tab.active)?.id;
		for (const entry of opened) {
			// Split tabs stay loaded: either half can be on screen next to the active tab, and discarding one
			// would leave a blank pane in the split view.
			if (
				entry.saved.pinned ||
				entry.tabId === activeId ||
				(entry.tabId !== undefined && splitTabIds.has(entry.tabId))
			) {
				continue;
			}

			try {
				await chrome.tabs.discard(entry.tabId);
			} catch {
				/*
				Chromium may refuse to discard a recently activated tab.
				*/
			}
		}
	}

	return {
		opened,
		skipped,
		failures,
		windowId: target.id,
		splits,
		splitsSeparated,
	};
}

function restoreFailureMessage(
	result: {failures?: RestoreFailure[]},
	fallback: string,
) {
	const firstFailure = result.failures?.[0];
	return firstFailure
		? `${firstFailure.title || firstFailure.url}: ${firstFailure.error}`
		: fallback;
}

async function restoreTab(
	groupId: string,
	tabId: string,
	senderTab: chrome.tabs.Tab | undefined,
	options: RestoreOptions = {},
): Promise<ActionResult<'RESTORE_TAB'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const group = findGroup(store, groupId);
		const tab = group?.tabs.find((entry) => entry.id === tabId);
		if (!group || !tab) {
			return {ok: false, error: 'That saved tab no longer exists.'};
		}

		const result = await restoreRecords([tab], store.settings, senderTab, {
			restoreTarget: options.restoreTarget || store.settings.restoreTarget,
			activate:
				typeof options.activate === 'boolean'
					? options.activate
					: store.settings.singleTabBehavior === 'switch',
		});
		if (result.opened.length === 0) {
			return {
				ok: false,
				error: result.skipped
					? 'That URL is already open.'
					: restoreFailureMessage(result, 'The saved tab could not be opened.'),
			};
		}

		const mode = isOneOf(['keep', 'remove', 'archive'], options.restoreMode)
			? options.restoreMode
			: store.settings.restoreMode;
		let removed = false;
		if (mode === 'remove' && !group.locked) {
			group.tabs = group.tabs.filter((entry) => entry.id !== tabId);
			if (group.tabs.length === 0) {
				store.groups = store.groups.filter((entry) => entry.id !== groupId);
				removed = true;
			}

			await writeStore(store);
		} else if (mode === 'archive') {
			// Archiving one restored tab dims that tab; the rest of the session stays active.
			tab.archived = true;
			group.updatedAt = Date.now();
			await writeStore(store);
		}

		return {
			ok: true,
			count: 1,
			skipped: result.skipped,
			failed: result.failures.length,
			failures: result.failures,
			removed,
			archived: mode === 'archive',
			splits: 0,
			splitsSeparated: 0,
		};
	});
}

async function restoreGroup(
	groupId: string,
	senderTab: chrome.tabs.Tab | undefined,
	forceRemove = false,
	options: RestoreOptions = {},
): Promise<ActionResult<'RESTORE_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const group = findGroup(store, groupId);
		if (!group) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		const restoreTarget = options.restoreTarget || store.settings.restoreTarget;
		const result = await restoreRecords(group.tabs, store.settings, senderTab, {
			restoreTarget,
			activate: options.activate !== false,
		});
		if (result.opened.length === 0) {
			return {
				ok: false,
				error: result.skipped
					? 'All tabs in this session are already open.'
					: restoreFailureMessage(
							result,
							'No tabs in this session could be opened.',
						),
			};
		}

		const mode = forceRemove
			? 'remove'
			: isOneOf(['keep', 'remove', 'archive'], options.restoreMode)
				? options.restoreMode
				: store.settings.restoreMode;
		const remove = mode === 'remove' && !group.locked;
		let removed = false;
		if (remove) {
			const restoredIds = new Set(result.opened.map(({saved}) => saved.id));
			group.tabs = group.tabs.filter((tab) => !restoredIds.has(tab.id));
			if (group.tabs.length === 0) {
				store.groups = store.groups.filter((entry) => entry.id !== groupId);
				removed = true;
			}

			await writeStore(store);
		} else if (mode === 'archive') {
			group.archived = true;
			group.archivedAt ||= Date.now();
			group.updatedAt = Date.now();
			await writeStore(store);
		}

		return {
			ok: true,
			count: result.opened.length,
			skipped: result.skipped,
			failed: result.failures.length,
			failures: result.failures,
			removed,
			archived: mode === 'archive',
			splits: result.splits,
			splitsSeparated: result.splitsSeparated,
		};
	});
}

async function deleteGroup(
	groupId: string,
): Promise<ActionResult<'DELETE_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const before = store.groups.length;
		store.groups = store.groups.filter((group) => group.id !== groupId);
		if (before === store.groups.length) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		await writeStore(store);
		return {ok: true};
	});
}

async function updateGroup(
	groupId: string,
	fields: SessionFields,
): Promise<ActionResult<'UPDATE_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const group = findGroup(store, groupId);
		if (!group) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		if (typeof fields.name === 'string') {
			const name = cleanText(fields.name, 'Saved session', 120);
			group.name = name;
		}

		if (typeof fields.description === 'string') {
			group.description = fields.description
				.replaceAll('\u0000', '')
				.slice(0, 500);
		}

		if (typeof fields.notes === 'string') {
			group.notes = normalizeNotes(fields.notes);
		}

		if (typeof fields.archived === 'boolean') {
			group.archived = fields.archived;
			group.archivedAt = fields.archived
				? group.archivedAt || Date.now()
				: null;
		}

		if (typeof fields.locked === 'boolean') {
			group.locked = fields.locked;
		}

		if (typeof fields.folderId === 'string') {
			if (store.folders.every((folder) => folder.id !== fields.folderId)) {
				return {ok: false, error: 'Choose an existing folder.'};
			}

			group.folderId = fields.folderId;
		}

		group.updatedAt = Date.now();
		await writeStore(store);
		return {ok: true, group};
	});
}

async function reorderGroup(
	groupId: string,
	direction: TabLodgeMessages['REORDER_GROUP']['direction'],
	folderId = 'all',
): Promise<ActionResult<'REORDER_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const index = store.groups.findIndex((group) => group.id === groupId);
		if (index === -1) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		const scope =
			folderId === 'all'
				? store.groups
				: store.groups.filter((group) => group.folderId === folderId);
		const scopeIndex = scope.findIndex((group) => group.id === groupId);
		const nextScopeIndex = direction === 'up' ? scopeIndex - 1 : scopeIndex + 1;
		if (
			scopeIndex === -1 ||
			nextScopeIndex < 0 ||
			nextScopeIndex >= scope.length
		) {
			return {ok: true};
		}

		const nextIndex = store.groups.findIndex(
			(group) => group.id === scope[nextScopeIndex].id,
		);
		[store.groups[index], store.groups[nextIndex]] = [
			store.groups[nextIndex],
			store.groups[index],
		];
		await writeStore(store);
		return {ok: true};
	});
}

async function setGroupOrder(
	order: string[],
): Promise<ActionResult<'SET_GROUP_ORDER'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const byId = new Map(store.groups.map((group) => [group.id, group]));
		const ids = [
			...new Set(
				(Array.isArray(order) ? order : []).filter(
					(id): id is string => typeof id === 'string' && byId.has(id),
				),
			),
		];
		// The listed sessions are re-dealt into the stored positions they already occupied.
		const slots = store.groups
			.map((group, index) => (ids.includes(group.id) ? index : -1))
			.filter((index) => index !== -1);
		for (const [position, slot] of slots.entries()) {
			store.groups[slot] = byId.get(ids[position])!;
		}

		store.settings = normalizeSettings({
			...store.settings,
			sessionSort: 'custom',
		});
		await writeStore(store);
		return {ok: true};
	});
}

function normalizeFolderName(value: unknown) {
	return typeof value === 'string'
		? value
				.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
				.trim()
				.slice(0, 60)
		: '';
}

function folderNameExists(
	store: Store,
	name: string,
	exceptId: string | null = null,
) {
	const normalizedName = name.toLocaleLowerCase();
	return store.folders.some(
		(folder) =>
			folder.id !== exceptId &&
			folder.name.toLocaleLowerCase() === normalizedName,
	);
}

async function createFolder(
	name: string,
	icon?: unknown,
): Promise<ActionResult<'CREATE_FOLDER'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const folderName = normalizeFolderName(name);
		if (!folderName || folderName.toLocaleLowerCase() === 'all sessions') {
			return {ok: false, error: 'Choose a different folder name.'};
		}

		if (store.folders.length >= 200) {
			return {ok: false, error: `${APP_NAME} can store up to 200 folders.`};
		}

		if (folderNameExists(store, folderName)) {
			return {ok: false, error: 'A folder with that name already exists.'};
		}

		const folder = {
			id: makeId(),
			name: folderName,
			...iconField(icon),
			createdAt: Date.now(),
			isDefault: false,
		};
		store.folders.push(folder);
		await writeStore(store);
		return {ok: true, folder};
	});
}

async function updateFolder(
	folderId: string,
	name: string,
	icon?: unknown,
): Promise<ActionResult<'UPDATE_FOLDER'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const folder = store.folders.find((entry) => entry.id === folderId);
		if (!folder) {
			return {ok: false, error: 'That folder no longer exists.'};
		}

		if (folder.isDefault) {
			return {ok: false, error: 'The Unfiled folder cannot be renamed.'};
		}

		const folderName = normalizeFolderName(name);
		if (!folderName || folderName.toLocaleLowerCase() === 'all sessions') {
			return {ok: false, error: 'Choose a different folder name.'};
		}

		if (folderNameExists(store, folderName, folderId)) {
			return {ok: false, error: 'A folder with that name already exists.'};
		}

		folder.name = folderName;
		// `icon` omitted keeps the current icon; "" or an unknown id resets it to the default.
		if (icon !== undefined) {
			const {icon: nextIcon} = iconField(icon);
			if (nextIcon) {
				folder.icon = nextIcon;
			} else {
				delete folder.icon;
			}
		}

		await writeStore(store);
		return {ok: true, folder};
	});
}

async function deleteFolder(
	folderId: string,
): Promise<ActionResult<'DELETE_FOLDER'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const folder = store.folders.find((entry) => entry.id === folderId);
		if (!folder) {
			return {ok: false, error: 'That folder no longer exists.'};
		}

		if (folder.isDefault) {
			return {ok: false, error: 'The Unfiled folder cannot be deleted.'};
		}

		for (const group of store.groups) {
			if (group.folderId === folderId) {
				group.folderId = DEFAULT_FOLDER_ID;
			}
		}

		store.folders = store.folders.filter((entry) => entry.id !== folderId);
		await writeStore(store);
		return {ok: true};
	});
}

async function moveGroup(
	groupId: string,
	folderId: string,
): Promise<ActionResult<'MOVE_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const group = findGroup(store, groupId);
		if (!group) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		if (store.folders.every((folder) => folder.id !== folderId)) {
			return {ok: false, error: 'Choose an existing folder.'};
		}

		group.folderId = folderId;
		group.updatedAt = Date.now();
		await writeStore(store);
		return {ok: true};
	});
}

async function deleteTab(
	groupId: string,
	tabId: string,
): Promise<ActionResult<'DELETE_TAB'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const group = findGroup(store, groupId);
		if (!group) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		const oldLength = group.tabs.length;
		group.tabs = group.tabs.filter((tab) => tab.id !== tabId);
		if (group.tabs.length === oldLength) {
			return {ok: false, error: 'That saved tab no longer exists.'};
		}

		if (group.tabs.length > 0) {
			group.updatedAt = Date.now();
		}

		store.groups = store.groups.filter(
			(entry) => entry.id !== groupId || entry.tabs.length > 0,
		);
		await writeStore(store);
		return {ok: true};
	});
}

async function moveTab(
	fromGroupId: string,
	tabId: string,
	toGroupId: string,
	targetTabId: string | null = null,
	position: InsertPosition = 'after',
	copy = false,
): Promise<ActionResult<'MOVE_TAB'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const source = findGroup(store, fromGroupId);
		const target = findGroup(store, toGroupId);
		const tab = source?.tabs.find((entry) => entry.id === tabId);
		if (!source || !tab) {
			return {ok: false, error: 'That saved tab no longer exists.'};
		}

		if (!target) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		if (targetTabId === tabId && source === target) {
			return {ok: true};
		}

		// A moved link leaves its split view: the partner becomes a plain tab as well (a copy leaves the pair alone).
		if (!copy && tab.split) {
			const splitId = tab.split.id;
			for (const entry of source.tabs) {
				if (entry.split?.id === splitId) {
					delete entry.split;
				}
			}
		}

		const moving: SavedTab = copy
			? {...structuredClone(tab), id: makeId(), savedAt: Date.now()}
			: tab;
		delete moving.split;
		if (!copy) {
			source.tabs = source.tabs.filter((entry) => entry.id !== tabId);
		}

		const index = targetTabId
			? target.tabs.findIndex((entry) => entry.id === targetTabId)
			: -1;
		const insertAt =
			index === -1
				? target.tabs.length
				: index + (position === 'after' ? 1 : 0);
		target.tabs.splice(insertAt, 0, moving);
		const now = Date.now();
		target.updatedAt = now;
		if (!copy) {
			source.updatedAt = now;
		}

		store.groups = store.groups.filter((entry) => entry.tabs.length > 0);
		await writeStore(store);
		return {ok: true};
	});
}

// Titles and notes describe the page, so edits apply to every saved copy of the same URL.
async function updateTab(
	groupId: string,
	tabId: string,
	fields: TabFields = {},
): Promise<ActionResult<'UPDATE_TAB'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const group = findGroup(store, groupId);
		const tab = group?.tabs.find((entry) => entry.id === tabId);
		if (!group || !tab) {
			return {ok: false, error: 'That saved tab no longer exists.'};
		}

		if (typeof fields.archived === 'boolean') {
			tab.archived = fields.archived;
		}

		const shareTitle = typeof fields.title === 'string';
		const shareNotes = typeof fields.notes === 'string';
		const title = shareTitle
			? cleanText(fields.title, tab.url, 500)
			: tab.title;
		const notes = shareNotes ? normalizeNotes(fields.notes) : tab.notes;
		let shared = 0;
		const now = Date.now();
		for (const entryGroup of store.groups) {
			for (const entry of entryGroup.tabs) {
				if (entry.url !== tab.url) {
					continue;
				}

				if (shareTitle) {
					entry.title = title;
				}

				if (shareNotes) {
					entry.notes = notes;
				}

				if (entry !== tab && (shareTitle || shareNotes)) {
					shared += 1;
				}

				if (shareTitle || shareNotes || entry === tab) {
					entryGroup.updatedAt = now;
				}
			}
		}

		await writeStore(store);
		return {ok: true, shared};
	});
}

function bookmarkColumnName(value: unknown) {
	return typeof value === 'string'
		? value
				.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
				.trim()
				.slice(0, 60)
		: '';
}

function bookmarkColumnNameExists(
	store: Store,
	name: string,
	exceptId: string | null = null,
) {
	const normalized = name.toLocaleLowerCase();
	return store.bookmarkColumns.some(
		(column) =>
			column.id !== exceptId && column.name.toLocaleLowerCase() === normalized,
	);
}

function findBookmark(store: Store, bookmarkId: string) {
	return store.bookmarks.find((bookmark) => bookmark.id === bookmarkId) || null;
}

async function addBookmark(
	fields: BookmarkFields = {},
): Promise<ActionResult<'ADD_BOOKMARK'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.bookmarksEnabled) {
			return {ok: false, error: 'Bookmarks are disabled in Settings.'};
		}

		const url = normalizeUrl(fields.url);
		if (!url) {
			return {
				ok: false,
				error: 'Only regular http and https pages can be bookmarked.',
			};
		}

		const columnId = store.bookmarkColumns.some(
			(column) => column.id === fields.columnId,
		)
			? fields.columnId!
			: store.bookmarkColumns.find(
					(column) => column.id === DEFAULT_BOOKMARK_COLUMN_ID,
				)?.id ||
				store.bookmarkColumns[0]?.id ||
				BOOKMARK_UNFILED_ID;
		const now = Date.now();
		const bookmark = {
			id: makeId(),
			title: await bestBookmarkTitle(fields.title, url),
			url,
			columnId,
			createdAt: now,
			updatedAt: now,
		};
		store.bookmarks.push(bookmark);
		await writeStore(store);
		return {ok: true, bookmark};
	});
}

// Adds several links to one column in a single write, used for drops of links or whole sessions.
// They are inserted together, in order, before or after targetBookmarkId (or at the column end).
async function addBookmarks(
	entries: LinkEntry[] = [],
	columnId: string | null = null,
	targetBookmarkId: string | null = null,
	position: InsertPosition = 'after',
): Promise<ActionResult<'ADD_BOOKMARKS'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.bookmarksEnabled) {
			return {ok: false, error: 'Bookmarks are disabled in Settings.'};
		}

		const targetColumnId =
			store.bookmarkColumns.some((column) => column.id === columnId) ||
			columnId === BOOKMARK_UNFILED_ID
				? columnId!
				: store.bookmarkColumns.find(
						(column) => column.id === DEFAULT_BOOKMARK_COLUMN_ID,
					)?.id ||
					store.bookmarkColumns[0]?.id ||
					BOOKMARK_UNFILED_ID;
		const now = Date.now();
		const added: Bookmark[] = [];
		for (const entry of (Array.isArray(entries) ? entries : []).slice(0, 500)) {
			const url = normalizeUrl(entry?.url);
			if (!url) {
				continue;
			}

			added.push({
				id: makeId(),
				title: await bestBookmarkTitle(entry?.title, url),
				url,
				columnId: targetColumnId,
				createdAt: now,
				updatedAt: now,
			});
		}

		if (added.length === 0) {
			return {
				ok: false,
				error: 'Only regular http and https pages can be bookmarked.',
			};
		}

		const target = targetBookmarkId
			? store.bookmarks.findIndex(
					(entry) =>
						entry.id === targetBookmarkId && entry.columnId === targetColumnId,
				)
			: -1;
		if (target >= 0) {
			store.bookmarks.splice(
				target + (position === 'before' ? 0 : 1),
				0,
				...added,
			);
		} else {
			store.bookmarks.push(...added);
		}

		await writeStore(store);
		return {ok: true, count: added.length, bookmarks: added};
	});
}

async function importBrowserBookmarks(
	duplicateMode: DuplicateMode = 'skip',
	titlePolicy: TitlePolicy = 'existing',
	requestedColumnId: string | null = null,
): Promise<ActionResult<'IMPORT_BROWSER_BOOKMARKS'>> {
	if (!chrome.bookmarks?.getTree) {
		return {ok: false, error: 'This browser does not provide bookmark access.'};
	}

	if (!(await getStore()).settings.bookmarksEnabled) {
		return {ok: false, error: 'Bookmarks are disabled in Settings.'};
	}

	let tree: chrome.bookmarks.BookmarkTreeNode[];
	try {
		tree = await chrome.bookmarks.getTree();
	} catch (error) {
		return {
			ok: false,
			error: errorMessage(error) || 'Could not read browser bookmarks.',
		};
	}

	const openTitles = await openBookmarkTitleMap();

	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.bookmarksEnabled) {
			return {ok: false, error: 'Bookmarks are disabled in Settings.'};
		}

		const columnsByName = new Map(
			store.bookmarkColumns.map((column) => [
				column.name.toLocaleLowerCase(),
				column,
			]),
		);
		const existingUrls = new Set(
			store.bookmarks.map((bookmark) => bookmark.url),
		);
		const existingBookmarks = new Map(
			store.bookmarks.map((bookmark) => [bookmark.url, bookmark]),
		);
		const allowDuplicates = duplicateMode === 'allow';
		// With a target column, folders do not become columns: every bookmark goes into that column.
		const targetColumnId = importTargetColumn(store, requestedColumnId);
		const now = Date.now();
		let columnsAdded = 0;
		let bookmarksAdded = 0;
		let bookmarksSkipped = 0;
		let bookmarksUpdated = 0;
		const ensureColumn = (path: string[]) => {
			const name = cleanText(path.join(' / '), 'Bookmarks', 60);
			const key = name.toLocaleLowerCase();
			let column = columnsByName.get(key);
			if (!column && store.bookmarkColumns.length < 500) {
				column = {id: makeId(), name, createdAt: now, isDefault: false};
				store.bookmarkColumns.push(column);
				columnsByName.set(key, column);
				columnsAdded += 1;
			}

			return (
				column?.id ||
				store.bookmarkColumns.find(
					(entry) => entry.id === DEFAULT_BOOKMARK_COLUMN_ID,
				)?.id ||
				store.bookmarkColumns[0]?.id ||
				BOOKMARK_UNFILED_ID
			);
		};

		let processed = 0;
		const visit = (
			node: chrome.bookmarks.BookmarkTreeNode,
			folderPath: string[] = [],
		) => {
			if (!node || processed >= 10_000) {
				return;
			}

			processed += 1;
			if (typeof node.url === 'string') {
				const url = normalizeUrl(node.url);
				if (!url) {
					return;
				}

				if (existingUrls.has(url) && !allowDuplicates) {
					bookmarksSkipped += 1;
					const existing = existingBookmarks.get(url);
					const title = importedBookmarkTitle(node.title, url, openTitles);
					if (
						titlePolicy === 'latest' &&
						existing &&
						existing.title !== title
					) {
						existing.title = title;
						existing.updatedAt = now;
						bookmarksUpdated += 1;
					}

					return;
				}

				const bookmark: Bookmark = {
					id: makeId(),
					title: importedBookmarkTitle(node.title, url, openTitles),
					url,
					columnId:
						targetColumnId ||
						(folderPath.length > 0 ? ensureColumn(folderPath) : null) ||
						store.bookmarkColumns.find(
							(entry) => entry.id === DEFAULT_BOOKMARK_COLUMN_ID,
						)?.id ||
						store.bookmarkColumns[0]?.id ||
						BOOKMARK_UNFILED_ID,
					createdAt: now,
					updatedAt: now,
				};
				existingUrls.add(url);
				existingBookmarks.set(url, bookmark);
				store.bookmarks.push(bookmark);
				bookmarksAdded += 1;
				return;
			}

			if (!Array.isArray(node.children)) {
				return;
			}

			const nextPath =
				node.id === '0' || !node.title
					? folderPath
					: [...folderPath, cleanText(node.title, 'Bookmarks', 60)];
			if (nextPath.length > 0 && !targetColumnId) {
				ensureColumn(nextPath);
			}

			for (const child of node.children) {
				visit(child, nextPath);
			}
		};

		for (const root of Array.isArray(tree) ? tree : []) {
			visit(root);
		}

		if (columnsAdded || bookmarksAdded || bookmarksUpdated) {
			await writeStore(store);
		}

		return {
			ok: true,
			columnsAdded,
			bookmarksAdded,
			bookmarksSkipped,
			bookmarksUpdated,
		};
	});
}

async function addExcludedOrigins(
	origins: string[],
): Promise<ActionResult<'ADD_EXCLUDED_ORIGINS'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const hosts = normalizeExcludedOrigins(origins);
		if (hosts.length === 0) {
			return {ok: false, error: 'Enter a valid website, such as example.com.'};
		}

		const added = hosts.filter(
			(host) => !store.settings.excludedOrigins.includes(host),
		);
		if (added.length > 0) {
			store.settings.excludedOrigins = normalizeExcludedOrigins([
				...store.settings.excludedOrigins,
				...added,
			]);
			await writeStore(store);
		}

		return {ok: true, added: added.length, settings: store.settings};
	});
}

async function addExcludedOrigin(
	origin: string,
): Promise<ActionResult<'ADD_EXCLUDED_ORIGIN'>> {
	const result = await addExcludedOrigins([origin]);
	if (!result.ok) {
		return result;
	}

	return {
		ok: true,
		origin: normalizeExcludedHost(origin) ?? origin,
		settings: result.settings,
	};
}

async function removeExcludedOrigin(
	origin: string,
): Promise<ActionResult<'REMOVE_EXCLUDED_ORIGIN'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const normalized = normalizeExcludedOrigins([origin])[0];
		if (!normalized || !store.settings.excludedOrigins.includes(normalized)) {
			return {ok: false, error: 'That website is not excluded.'};
		}

		store.settings.excludedOrigins = store.settings.excludedOrigins.filter(
			(entry) => entry !== normalized,
		);
		await writeStore(store);
		return {ok: true, settings: store.settings};
	});
}

async function updateBookmark(
	bookmarkId: string,
	fields: BookmarkFields = {},
): Promise<ActionResult<'UPDATE_BOOKMARK'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.bookmarksEnabled) {
			return {ok: false, error: 'Bookmarks are disabled in Settings.'};
		}

		const bookmark = findBookmark(store, bookmarkId);
		if (!bookmark) {
			return {ok: false, error: 'That bookmark no longer exists.'};
		}

		if (typeof fields.url === 'string') {
			const url = normalizeUrl(fields.url);
			if (!url) {
				return {ok: false, error: 'Enter a valid http or https address.'};
			}

			bookmark.url = url;
		}

		if (typeof fields.title === 'string') {
			bookmark.title = await bestBookmarkTitle(fields.title, bookmark.url);
		}

		if (typeof fields.columnId === 'string') {
			if (
				fields.columnId !== BOOKMARK_UNFILED_ID &&
				store.bookmarkColumns.every((column) => column.id !== fields.columnId)
			) {
				return {ok: false, error: 'Choose an existing bookmark column.'};
			}

			bookmark.columnId = fields.columnId;
		}

		bookmark.updatedAt = Date.now();
		await writeStore(store);
		return {ok: true, bookmark};
	});
}

async function deleteBookmark(
	bookmarkId: string,
): Promise<ActionResult<'DELETE_BOOKMARK'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.bookmarksEnabled) {
			return {ok: false, error: 'Bookmarks are disabled in Settings.'};
		}

		const originalLength = store.bookmarks.length;
		store.bookmarks = store.bookmarks.filter(
			(bookmark) => bookmark.id !== bookmarkId,
		);
		if (store.bookmarks.length === originalLength) {
			return {ok: false, error: 'That bookmark no longer exists.'};
		}

		await writeStore(store);
		return {ok: true};
	});
}

async function createBookmarkColumn(
	name: string,
	icon?: unknown,
): Promise<ActionResult<'CREATE_BOOKMARK_COLUMN'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.bookmarksEnabled) {
			return {ok: false, error: 'Bookmarks are disabled in Settings.'};
		}

		const columnName = bookmarkColumnName(name);
		if (!columnName || columnName.toLocaleLowerCase() === 'all bookmarks') {
			return {ok: false, error: 'Choose a different column name.'};
		}

		if (bookmarkColumnNameExists(store, columnName)) {
			return {
				ok: false,
				error: 'A bookmark column with that name already exists.',
			};
		}

		const column = {
			id: makeId(),
			name: columnName,
			...iconField(icon),
			createdAt: Date.now(),
			isDefault: false,
		};
		store.bookmarkColumns.push(column);
		await writeStore(store);
		return {ok: true, column};
	});
}

async function updateBookmarkColumn(
	columnId: string,
	name: string,
	icon?: unknown,
): Promise<ActionResult<'UPDATE_BOOKMARK_COLUMN'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.bookmarksEnabled) {
			return {ok: false, error: 'Bookmarks are disabled in Settings.'};
		}

		const column = store.bookmarkColumns.find((entry) => entry.id === columnId);
		if (!column) {
			return {ok: false, error: 'That bookmark column no longer exists.'};
		}

		const columnName = bookmarkColumnName(name);
		if (!columnName || columnName.toLocaleLowerCase() === 'all bookmarks') {
			return {ok: false, error: 'Choose a different column name.'};
		}

		if (bookmarkColumnNameExists(store, columnName, columnId)) {
			return {
				ok: false,
				error: 'A bookmark column with that name already exists.',
			};
		}

		column.name = columnName;
		// `icon` omitted keeps the current icon; "" or an unknown id resets it to the default.
		if (icon !== undefined) {
			const {icon: nextIcon} = iconField(icon);
			if (nextIcon) {
				column.icon = nextIcon;
			} else {
				delete column.icon;
			}
		}

		await writeStore(store);
		return {ok: true, column};
	});
}

async function deleteBookmarkColumn(
	columnId: string,
	targetColumnId: string | null = null,
	discardBookmarks = false,
): Promise<ActionResult<'DELETE_BOOKMARK_COLUMN'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.bookmarksEnabled) {
			return {ok: false, error: 'Bookmarks are disabled in Settings.'};
		}

		if (store.bookmarkColumns.every((entry) => entry.id !== columnId)) {
			return {ok: false, error: 'That bookmark column no longer exists.'};
		}

		const remaining = store.bookmarkColumns.filter(
			(entry) => entry.id !== columnId,
		);
		const affected = store.bookmarks.filter(
			(bookmark) => bookmark.columnId === columnId,
		);
		if (discardBookmarks) {
			store.bookmarks = store.bookmarks.filter(
				(bookmark) => bookmark.columnId !== columnId,
			);
			store.bookmarkColumns = remaining;
			await writeStore(store);
			return {ok: true, moved: 0, unfiled: 0, deleted: affected.length};
		}

		if (
			affected.length > 0 &&
			remaining.length > 0 &&
			remaining.every((entry) => entry.id !== targetColumnId)
		) {
			return {
				ok: false,
				error: 'Choose a remaining bookmark column to move these links into.',
			};
		}

		// With remaining columns, the check above guarantees targetColumnId is one of them.
		for (const bookmark of affected) {
			bookmark.columnId =
				remaining.length > 0 ? targetColumnId! : BOOKMARK_UNFILED_ID;
		}

		store.bookmarkColumns = remaining;
		await writeStore(store);
		return {
			ok: true,
			moved: affected.length,
			unfiled: remaining.length > 0 ? 0 : affected.length,
			deleted: 0,
		};
	});
}

async function reorderBookmarkColumn(
	columnId: string,
	targetColumnId: string,
	position: InsertPosition = 'before',
): Promise<ActionResult<'REORDER_BOOKMARK_COLUMN'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.bookmarksEnabled) {
			return {ok: false, error: 'Bookmarks are disabled in Settings.'};
		}

		const sourceIndex = store.bookmarkColumns.findIndex(
			(column) => column.id === columnId,
		);
		if (sourceIndex === -1) {
			return {ok: false, error: 'That bookmark column no longer exists.'};
		}

		if (store.bookmarkColumns.every((column) => column.id !== targetColumnId)) {
			return {
				ok: false,
				error: 'That target bookmark column no longer exists.',
			};
		}

		if (columnId === targetColumnId) {
			return {ok: true};
		}

		const [column] = store.bookmarkColumns.splice(sourceIndex, 1);
		const targetIndex = store.bookmarkColumns.findIndex(
			(entry) => entry.id === targetColumnId,
		);
		const insertAt =
			targetIndex === -1
				? store.bookmarkColumns.length
				: targetIndex + (position === 'after' ? 1 : 0);
		store.bookmarkColumns.splice(insertAt, 0, column);
		await writeStore(store);
		return {ok: true};
	});
}

async function reorderBookmark(
	bookmarkId: string,
	targetColumnId: string,
	targetBookmarkId: string | null = null,
	position: InsertPosition = 'after',
): Promise<ActionResult<'REORDER_BOOKMARK'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.bookmarksEnabled) {
			return {ok: false, error: 'Bookmarks are disabled in Settings.'};
		}

		const bookmark = findBookmark(store, bookmarkId);
		if (!bookmark) {
			return {ok: false, error: 'That bookmark no longer exists.'};
		}

		const targetColumnExists = store.bookmarkColumns.some(
			(column) => column.id === targetColumnId,
		);
		if (!targetColumnExists && targetColumnId !== BOOKMARK_UNFILED_ID) {
			return {ok: false, error: 'Choose an existing bookmark column.'};
		}

		if (
			targetBookmarkId === bookmarkId &&
			bookmark.columnId === targetColumnId
		) {
			return {ok: true};
		}

		const targetItems = store.bookmarks.filter(
			(entry) => entry.columnId === targetColumnId && entry.id !== bookmarkId,
		);
		let insertAt = targetItems.length;
		const targetIndex = targetBookmarkId
			? targetItems.findIndex((entry) => entry.id === targetBookmarkId)
			: -1;
		if (targetIndex >= 0) {
			insertAt = targetIndex + (position === 'after' ? 1 : 0);
		}

		bookmark.columnId = targetColumnId;
		bookmark.updatedAt = Date.now();
		targetItems.splice(insertAt, 0, bookmark);
		const itemsByColumn = new Map<string, Bookmark[]>([
			...store.bookmarkColumns.map((column): [string, Bookmark[]] => [
				column.id,
				[],
			]),
			[BOOKMARK_UNFILED_ID, []],
		]);
		for (const entry of store.bookmarks) {
			if (entry.id === bookmarkId) {
				continue;
			}

			if (itemsByColumn.has(entry.columnId)) {
				itemsByColumn.get(entry.columnId)!.push(entry);
			}
		}

		itemsByColumn.set(targetColumnId, targetItems);
		store.bookmarks = [
			...store.bookmarkColumns.flatMap(
				(column) => itemsByColumn.get(column.id) || [],
			),
			...(itemsByColumn.get(BOOKMARK_UNFILED_ID) || []),
		];
		await writeStore(store);
		return {ok: true};
	});
}

function importCandidates(input: unknown): unknown[] {
	if (Array.isArray(input)) {
		return input.some((entry) => isRecord(entry) && Array.isArray(entry.tabs))
			? (input as unknown[])
			: [{name: 'Imported tabs', tabs: input}];
	}

	if (!isRecord(input)) {
		return [];
	}

	if (Array.isArray(input.groups)) {
		return input.groups;
	}

	if (Array.isArray(input.tabs)) {
		return [
			{
				name: input.groupName || input.listName || 'Imported tabs',
				tabs: input.tabs,
			},
		];
	}

	return [];
}

function mergeImportedFolders(
	store: Store,
	input: ImportInput,
	candidates: unknown[],
) {
	const incoming = arrayOf(input?.folders).slice(0, 200);
	const sourceById = new Map<string, Raw>(
		incoming
			.filter(
				(folder): folder is Raw & {id: string} =>
					isRecord(folder) && typeof folder.id === 'string',
			)
			.map((folder) => [folder.id, folder] as const),
	);
	const idMap = new Map<string, string>([
		[DEFAULT_FOLDER_ID, DEFAULT_FOLDER_ID],
	]);
	const folderByName = new Map(
		store.folders.map((folder) => [folder.name.toLocaleLowerCase(), folder]),
	);
	for (const source of incoming) {
		const folder = normalizeFolder(source);
		if (!folder || folder.isDefault) {
			if (recordId(source)) {
				idMap.set(recordId(source), DEFAULT_FOLDER_ID);
			}

			continue;
		}

		if (folder.name.toLocaleLowerCase() === 'all sessions') {
			if (recordId(source)) {
				idMap.set(recordId(source), DEFAULT_FOLDER_ID);
			}

			continue;
		}

		let target = folderByName.get(folder.name.toLocaleLowerCase());
		if (!target && store.folders.length < 200) {
			target = {
				...folder,
				id: makeId(),
				createdAt: Date.now(),
				isDefault: false,
			};
			store.folders.push(target);
			folderByName.set(target.name.toLocaleLowerCase(), target);
		}

		if (recordId(source)) {
			idMap.set(recordId(source), target?.id || DEFAULT_FOLDER_ID);
		}
	}

	for (const candidate of candidates) {
		if (!isRecord(candidate)) {
			continue;
		}

		const sourceId = cleanText(candidate.folderId, DEFAULT_FOLDER_ID, 100);
		if (idMap.has(sourceId)) {
			continue;
		}

		const source = sourceById.get(sourceId);
		// Sources that do not normalize (id "all") were already mapped above, so this one does.
		const name = source ? normalizeFolder(source)!.name : '';
		const target = name ? folderByName.get(name.toLocaleLowerCase()) : null;
		idMap.set(sourceId, target?.id || DEFAULT_FOLDER_ID);
	}

	return idMap;
}

/**
The existing column (or Unfiled) an import puts every bookmark into, or null to keep the file's columns.
*/
function importTargetColumn(
	store: Store,
	targetColumnId: unknown,
): string | null {
	if (typeof targetColumnId !== 'string' || !targetColumnId) {
		return null;
	}

	if (targetColumnId === BOOKMARK_UNFILED_ID) {
		return BOOKMARK_UNFILED_ID;
	}

	return store.bookmarkColumns.some((column) => column.id === targetColumnId)
		? targetColumnId
		: null;
}

async function mergeImportedBookmarks(
	store: Store,
	input: ImportInput,
	options: ImportOptions = {},
): Promise<BookmarkMergeResult> {
	// With a target column, the file's columns are ignored and every bookmark lands in that column.
	const targetColumnId = importTargetColumn(store, options.targetColumnId);
	const incomingColumns = targetColumnId ? [] : arrayOf(input?.bookmarkColumns);
	const incomingBookmarks = arrayOf(input?.bookmarks);
	const openTitles = await openBookmarkTitleMap();
	const idMap = new Map<string, string>();
	const columnsByName = new Map(
		store.bookmarkColumns.map((column) => [
			column.name.toLocaleLowerCase(),
			column,
		]),
	);
	const importedColumnOrder: BookmarkColumn[] = [];
	const importedColumnIds = new Set<string>();
	let columnsAdded = 0;

	for (const raw of incomingColumns) {
		const source = normalizeBookmarkColumn(raw);
		if (!source) {
			continue;
		}

		let target =
			source.id === DEFAULT_BOOKMARK_COLUMN_ID || source.isDefault
				? store.bookmarkColumns.find(
						(column) => column.id === DEFAULT_BOOKMARK_COLUMN_ID,
					)
				: columnsByName.get(source.name.toLocaleLowerCase());
		if (!target) {
			target = {
				...source,
				id: makeId(),
				createdAt: Date.now(),
				isDefault: false,
			};
			store.bookmarkColumns.push(target);
			columnsByName.set(target.name.toLocaleLowerCase(), target);
			columnsAdded += 1;
		}

		const rawId = isRecord(raw) ? raw.id : undefined;
		if (typeof rawId === 'string') {
			idMap.set(rawId, target.id);
		}

		if (importedColumnIds.has(target.id)) {
			continue;
		}

		importedColumnIds.add(target.id);
		importedColumnOrder.push(target);
	}

	const previousColumnOrder = store.bookmarkColumns.map((column) => column.id);
	if (importedColumnOrder.length > 0) {
		const importedIds = new Set(importedColumnOrder.map((column) => column.id));
		store.bookmarkColumns = [
			...importedColumnOrder,
			...store.bookmarkColumns.filter((column) => !importedIds.has(column.id)),
		];
	}

	const columnsReordered = previousColumnOrder.some(
		(id, index) => store.bookmarkColumns[index]?.id !== id,
	);
	const knownColumnIds = new Set(
		store.bookmarkColumns.map((column) => column.id),
	);
	const fallbackColumnId =
		store.bookmarkColumns.find(
			(column) => column.id === DEFAULT_BOOKMARK_COLUMN_ID,
		)?.id ||
		store.bookmarkColumns[0]?.id ||
		BOOKMARK_UNFILED_ID;
	const existingUrls = new Set(store.bookmarks.map((bookmark) => bookmark.url));
	const existingBookmarks = new Map(
		store.bookmarks.map((bookmark) => [bookmark.url, bookmark]),
	);
	const allowDuplicates = options.duplicateMode === 'allow';
	const importedIds = new Set(store.bookmarks.map((bookmark) => bookmark.id));
	let bookmarksAdded = 0;
	let bookmarksSkipped = 0;
	let bookmarksUpdated = 0;
	for (const raw of incomingBookmarks) {
		if (!isRecord(raw)) {
			continue;
		}

		const sourceColumnId = cleanText(
			raw.columnId,
			DEFAULT_BOOKMARK_COLUMN_ID,
			100,
		);
		const mappedColumnId =
			targetColumnId ||
			idMap.get(sourceColumnId) ||
			(knownColumnIds.has(sourceColumnId) ? sourceColumnId : fallbackColumnId);
		const url = normalizeUrl(raw.url ?? raw.href);
		if (!url) {
			continue;
		}

		const bookmark = normalizeBookmark(
			{
				...raw,
				id: makeId(),
				title: importedBookmarkTitle(raw.title ?? raw.name, url, openTitles),
				url,
				columnId: mappedColumnId,
			},
			knownColumnIds,
		);
		if (!bookmark) {
			continue;
		}

		if (existingUrls.has(bookmark.url) && !allowDuplicates) {
			bookmarksSkipped += 1;
			const existing = existingBookmarks.get(bookmark.url);
			if (
				options.titlePolicy === 'latest' &&
				existing &&
				existing.title !== bookmark.title
			) {
				existing.title = bookmark.title;
				existing.updatedAt = Date.now();
				bookmarksUpdated += 1;
			}

			continue;
		}

		while (importedIds.has(bookmark.id)) {
			bookmark.id = makeId();
		}

		importedIds.add(bookmark.id);
		existingUrls.add(bookmark.url);
		existingBookmarks.set(bookmark.url, bookmark);
		store.bookmarks.push(bookmark);
		bookmarksAdded += 1;
	}

	return {
		columnsAdded,
		columnsReordered,
		bookmarksAdded,
		bookmarksSkipped,
		bookmarksUpdated,
	};
}

async function importGroups(
	input: ImportInput,
	importMode: 'all' | 'sessions' | 'bookmarks' = 'all',
	options: ImportOptions = {},
): Promise<ActionResult<'IMPORT_GROUPS'>> {
	return mutate(async () => {
		const store = await getStore();
		const incomingCandidates =
			importMode === 'bookmarks' ? [] : importCandidates(input).slice(0, 500);
		const candidates = store.settings.sessionsEnabled ? incomingCandidates : [];
		const incomingBookmarkData =
			importMode !== 'sessions' &&
			(Array.isArray(input?.bookmarks) ||
				Array.isArray(input?.bookmarkColumns));
		const hasBookmarkData =
			store.settings.bookmarksEnabled && incomingBookmarkData;
		if (candidates.length === 0 && !hasBookmarkData) {
			if (incomingCandidates.length > 0 && !store.settings.sessionsEnabled) {
				return {ok: false, error: 'Sessions are disabled in Settings.'};
			}

			if (incomingBookmarkData && !store.settings.bookmarksEnabled) {
				return {ok: false, error: 'Bookmarks are disabled in Settings.'};
			}

			return {
				ok: false,
				error: `Choose a ${APP_NAME} export or a JSON array of tabs.`,
			};
		}

		const folderMap =
			candidates.length > 0
				? mergeImportedFolders(store, input, candidates)
				: new Map<string, string>();
		const existingUrls = new Set<string>();
		const existingRecords = new Map<string, {group: Session; tab: SavedTab}>();
		for (const group of store.groups) {
			for (const tab of group.tabs) {
				existingUrls.add(tab.url);
				existingRecords.set(tab.url, {group, tab});
			}
		}

		const imported: Session[] = [];
		const allowDuplicates = options.duplicateMode === 'allow';
		let skipped = 0;
		let updatedTitles = 0;
		for (const candidate of candidates) {
			if (!isRecord(candidate)) {
				continue;
			}

			const sourceFolderId = cleanText(
				candidate.folderId,
				DEFAULT_FOLDER_ID,
				100,
			);
			const group = normalizeGroup(
				{
					...candidate,
					id: makeId(),
					folderId: folderMap.get(sourceFolderId) || DEFAULT_FOLDER_ID,
					createdAt: candidate.createdAt ?? candidate.timestamp ?? Date.now(),
				},
				Date.now(),
				store.settings.includePinnedTabs,
			);
			if (!group) {
				continue;
			}

			if (!allowDuplicates) {
				const kept: SavedTab[] = [];
				for (const tab of group.tabs) {
					if (existingUrls.has(tab.url)) {
						skipped += 1;
						const existing = existingRecords.get(tab.url);
						if (
							options.titlePolicy === 'latest' &&
							existing &&
							tab.title !== existing.tab.title
						) {
							existing.tab.title = tab.title;
							existing.tab.faviconUrl = tab.faviconUrl;
							existing.group.updatedAt = Date.now();
							updatedTitles += 1;
						}

						continue;
					}

					existingUrls.add(tab.url);
					existingRecords.set(tab.url, {group, tab});
					kept.push(tab);
				}

				group.tabs = kept;
			}

			if (group.tabs.length > 0) {
				imported.push(group);
			}
		}

		const bookmarkResult =
			store.settings.bookmarksEnabled && importMode !== 'sessions'
				? await mergeImportedBookmarks(store, input, options)
				: ({
						columnsAdded: 0,
						columnsReordered: false,
						bookmarksAdded: 0,
						bookmarksSkipped: 0,
						bookmarksUpdated: 0,
					} satisfies BookmarkMergeResult);
		const groupCount = imported.reduce(
			(sum, group) => sum + group.tabs.length,
			0,
		);
		if (
			imported.length === 0 &&
			!bookmarkResult.bookmarksAdded &&
			!bookmarkResult.bookmarksUpdated &&
			!bookmarkResult.columnsAdded &&
			!bookmarkResult.columnsReordered &&
			!updatedTitles
		) {
			return {
				ok: false,
				error:
					skipped || bookmarkResult.bookmarksSkipped
						? 'Every imported URL is already saved.'
						: 'The file contains no valid web tabs or bookmarks.',
			};
		}

		if (imported.length > 0) {
			store.groups = [...imported, ...store.groups];
		}

		await writeStore(store);
		return {
			ok: true,
			groups: imported.length,
			count: groupCount,
			bookmarks: bookmarkResult.bookmarksAdded,
			columns: bookmarkResult.columnsAdded,
			columnsReordered: bookmarkResult.columnsReordered,
			skipped: skipped + bookmarkResult.bookmarksSkipped,
			updatedTitles: updatedTitles + bookmarkResult.bookmarksUpdated,
		};
	});
}

async function updateSettings(
	patch: Partial<Settings>,
): Promise<ActionResult<'UPDATE_SETTINGS'>> {
	return mutate(async () => {
		const store = await getStore();
		const previousSettings = store.settings;
		const requested = {...store.settings, ...patch};
		if (!requested.sessionsEnabled && !requested.bookmarksEnabled) {
			return {ok: false, error: 'Keep Sessions or Bookmarks enabled.'};
		}

		store.settings = normalizeSettings(requested);
		await writeStore(store);
		if (
			previousSettings.actionMode !== store.settings.actionMode ||
			previousSettings.sessionsEnabled !== store.settings.sessionsEnabled ||
			previousSettings.toolbarOpens !== store.settings.toolbarOpens
		) {
			await syncToolbarAction(store.settings);
		}

		if (store.settings.keepLodgePinned && !previousSettings.keepLodgePinned) {
			lodgePaused.clear();
			lodgeUndoneAt.clear();
			scheduleLodgeCheck();
		}

		if (
			contextMenuSignature(previousSettings, store.bookmarkColumns) !==
			contextMenuSignature(store.settings, store.bookmarkColumns)
		) {
			await rebuildContextMenus(store);
		}

		return {ok: true, settings: store.settings};
	});
}

async function resetSettings(): Promise<ActionResult<'RESET_SETTINGS'>> {
	return mutate(async () => {
		const store = await getStore();
		store.settings = normalizeSettings({...DEFAULT_SETTINGS});
		await writeStore(store);
		await syncToolbarAction(store.settings);
		await rebuildContextMenus(store);
		return {ok: true, settings: store.settings};
	});
}

async function eraseData(
	scope: EraseScope,
): Promise<ActionResult<'ERASE_DATA'>> {
	if (!isOneOf(['sessions', 'bookmarks', 'all'], scope)) {
		return {ok: false, error: `Choose which ${APP_NAME} data to erase.`};
	}

	return mutate(async () => {
		const store = await getStore();
		const fresh = normalizeStore(null);
		const eraseSessions = scope !== 'bookmarks';
		const eraseBookmarks = scope !== 'sessions';
		const sessions = eraseSessions ? store.groups.length : 0;
		const bookmarks = eraseBookmarks ? store.bookmarks.length : 0;
		// Erasing data keeps settings and excluded sites; only the chosen data returns to its fresh-install state.
		if (eraseSessions) {
			store.groups = fresh.groups;
			store.folders = fresh.folders;
		}

		if (eraseBookmarks) {
			store.bookmarks = fresh.bookmarks;
			store.bookmarkColumns = fresh.bookmarkColumns;
		}

		await writeStore(store);
		return {ok: true, sessions, bookmarks};
	});
}

async function openBrowserNewTab(
	senderTab?: chrome.tabs.Tab,
): Promise<ActionResult<'OPEN_DEFAULT_NEW_TAB'>> {
	try {
		if (senderTab && isInteger(senderTab.id)) {
			await chrome.tabs.update(senderTab.id, {url: 'chrome://newtab/'});
		} else {
			await chrome.tabs.create({url: 'chrome://newtab/', active: true});
		}

		return {ok: true};
	} catch {
		return {
			ok: false,
			error: `This browser could not open its default new-tab page. You can switch ${APP_NAME} off in Settings.`,
		};
	}
}

async function handleMessage(
	message: TabLodgeMessage | undefined,
	sender: chrome.runtime.MessageSender,
): Promise<ActionResult> {
	switch (message?.type) {
		case 'GET_STATE': {
			return {ok: true, ...(await getStore())};
		}

		case 'SAVE_TABS': {
			return saveTabs(
				message.scope || 'window',
				sender.tab,
				message.folderId || DEFAULT_FOLDER_ID,
				{
					tabIds: message.tabIds,
					groupName: message.groupName,
					includePinned: message.includePinned === true,
				},
			);
		}

		case 'SAVE_CURRENT_TAB_TO_GROUP': {
			return saveCurrentTabToFirstGroup(sender.tab);
		}

		case 'RESTORE_TAB': {
			return restoreTab(message.groupId, message.tabId, sender.tab, {
				restoreMode: message.restoreMode,
				restoreTarget: message.restoreTarget,
				activate: message.activate,
			});
		}

		case 'RESTORE_GROUP': {
			return restoreGroup(
				message.groupId,
				sender.tab,
				Boolean(message.forceRemove),
				{
					restoreMode: message.restoreMode,
					restoreTarget: message.restoreTarget,
					activate: message.activate,
				},
			);
		}

		case 'DELETE_GROUP': {
			return deleteGroup(message.groupId);
		}

		case 'UPDATE_GROUP': {
			return updateGroup(message.groupId, message.fields || {});
		}

		case 'REORDER_GROUP': {
			return reorderGroup(
				message.groupId,
				message.direction,
				message.folderId || 'all',
			);
		}

		case 'SET_GROUP_ORDER': {
			return setGroupOrder(message.order);
		}

		case 'CREATE_FOLDER': {
			return createFolder(message.name, message.icon);
		}

		case 'UPDATE_FOLDER': {
			return updateFolder(message.folderId, message.name, message.icon);
		}

		case 'DELETE_FOLDER': {
			return deleteFolder(message.folderId);
		}

		case 'MOVE_GROUP': {
			return moveGroup(message.groupId, message.folderId);
		}

		case 'DELETE_TAB': {
			return deleteTab(message.groupId, message.tabId);
		}

		case 'MOVE_TAB': {
			return moveTab(
				message.fromGroupId,
				message.tabId,
				message.toGroupId,
				message.targetTabId || null,
				message.position,
				message.copy === true,
			);
		}

		case 'UPDATE_TAB': {
			return updateTab(message.groupId, message.tabId, message.fields || {});
		}

		case 'ADD_BOOKMARK': {
			return addBookmark(message.bookmark || {});
		}

		case 'ADD_BOOKMARKS': {
			return addBookmarks(
				message.bookmarks,
				message.columnId || null,
				message.targetBookmarkId || null,
				message.position,
			);
		}

		case 'UPDATE_BOOKMARK': {
			return updateBookmark(message.bookmarkId, message.fields || {});
		}

		case 'DELETE_BOOKMARK': {
			return deleteBookmark(message.bookmarkId);
		}

		case 'CREATE_BOOKMARK_COLUMN': {
			return createBookmarkColumn(message.name, message.icon);
		}

		case 'UPDATE_BOOKMARK_COLUMN': {
			return updateBookmarkColumn(message.columnId, message.name, message.icon);
		}

		case 'DELETE_BOOKMARK_COLUMN': {
			return deleteBookmarkColumn(
				message.columnId,
				message.targetColumnId || null,
				message.discardBookmarks === true,
			);
		}

		case 'REORDER_BOOKMARK_COLUMN': {
			return reorderBookmarkColumn(
				message.columnId,
				message.targetColumnId,
				message.position,
			);
		}

		case 'REORDER_BOOKMARK': {
			return reorderBookmark(
				message.bookmarkId,
				message.targetColumnId,
				message.targetBookmarkId || null,
				message.position,
			);
		}

		case 'IMPORT_GROUPS': {
			return importGroups(
				message.data as ImportInput,
				'all',
				message.importOptions || {},
			);
		}

		case 'IMPORT_SESSIONS': {
			return importGroups(
				message.data as ImportInput,
				'sessions',
				message.importOptions || {},
			);
		}

		case 'IMPORT_BOOKMARKS_FILE': {
			return importGroups(
				message.data as ImportInput,
				'bookmarks',
				message.importOptions || {},
			);
		}

		case 'IMPORT_BROWSER_BOOKMARKS': {
			return importBrowserBookmarks(
				message.duplicateMode,
				message.titlePolicy,
				message.targetColumnId ?? null,
			);
		}

		case 'ADD_EXCLUDED_ORIGINS': {
			return addExcludedOrigins(
				Array.isArray(message.origins) ? message.origins.slice(0, 500) : [],
			);
		}

		case 'ADD_EXCLUDED_ORIGIN': {
			return addExcludedOrigin(message.origin);
		}

		case 'REMOVE_EXCLUDED_ORIGIN': {
			return removeExcludedOrigin(message.origin);
		}

		case 'UPDATE_SETTINGS': {
			return updateSettings(message.settings || {});
		}

		case 'RESET_SETTINGS': {
			return resetSettings();
		}

		case 'ERASE_DATA': {
			return eraseData(message.scope);
		}

		case 'OPEN_DEFAULT_NEW_TAB': {
			return openBrowserNewTab(sender.tab);
		}

		case 'OPEN_DASHBOARD': {
			const store = await getStore();
			const windowId = await currentWindowId(sender.tab);
			await openDashboard(windowId, '', store.settings.dashboardBehavior);
			return {ok: true};
		}

		default: {
			return {ok: false, error: `Unknown ${APP_NAME} action.`};
		}
	}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	Promise.resolve(handleMessage(message as TabLodgeMessage | undefined, sender))
		.then(sendResponse)
		.catch((error: unknown) => {
			sendResponse({
				ok: false,
				error:
					errorMessage(error) || `${APP_NAME} could not complete that action.`,
			});
		});
	return true;
});

chrome.action.onClicked.addListener((tab) => {
	void handleToolbarAction(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
	if (command === 'save-window') {
		void saveTabs('window', tab);
	}

	if (command === 'save-selected-tabs') {
		void saveTabs('selected', tab);
	}

	if (command === 'open-dashboard') {
		void openDashboardForTab(tab);
	}

	if (command === 'toggle-side-panel') {
		openSidePanel(tab);
	}
});

/**
Opens the side panel for the tab's window. Must run synchronously inside a user gesture
(command, menu click), so it is not awaited behind other work.
*/
function openSidePanel(tab?: chrome.tabs.Tab) {
	if (!chrome.sidePanel?.open) {
		return;
	}

	const windowId = tab?.windowId;
	const request =
		windowId === undefined
			? chrome.windows
					.getLastFocused()
					.then(async (focused) =>
						chrome.sidePanel.open({windowId: focused.id!}),
					)
			: chrome.sidePanel.open({windowId});
	void Promise.resolve(request).catch(() => {
		/*
		The panel can only open from a user gesture; ignore refusals.
		*/
	});
}

async function syncToolbarAction(settings: Settings) {
	const sidePanelEnabled = Boolean(
		settings.toolbarOpens === 'sidepanel' && chrome.sidePanel,
	);
	if (chrome.sidePanel) {
		try {
			await chrome.sidePanel.setOptions({
				enabled: true,
				path: 'sidepanel.html',
			});
			await chrome.sidePanel.setPanelBehavior({
				openPanelOnActionClick: sidePanelEnabled,
			});
		} catch {
			/*
			Side Panel may be unavailable on this Chromium build.
			*/
		}
	}

	if (!chrome.action?.setPopup) {
		return;
	}

	await chrome.action.setPopup({
		popup: sidePanelEnabled
			? ''
			: !settings.sessionsEnabled || settings.actionMode === 'popup'
				? 'popup.html'
				: '',
	});
}

async function saveCurrentTabToFirstGroup(
	senderTab?: chrome.tabs.Tab,
): Promise<ActionResult<'SAVE_CURRENT_TAB_TO_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const windowId = await currentWindowId(senderTab);
		if (!isInteger(windowId)) {
			return {ok: false, error: 'Open a browser window before saving a tab.'};
		}

		const window = (await chrome.windows.get(windowId, {
			populate: true,
		})) as PopulatedWindow;
		const tab =
			window.tabs.find((entry) => entry.id === senderTab?.id) ||
			window.tabs.find((entry) => entry.active);
		if (
			!tab ||
			!isCapturable(tab, store.settings) ||
			(tab.pinned && !store.settings.includePinnedTabs)
		) {
			return {ok: false, error: 'There is no eligible web tab to save.'};
		}

		const group = store.groups.find(
			(entry) => !entry.archived && !entry.locked,
		);
		if (!group) {
			return {
				ok: false,
				error:
					'Create or unlock a session before sending this tab to a session.',
			};
		}

		const nativeGroups = await getWindowGroups(window.id);
		const now = Date.now();
		// IsCapturable above guarantees a web URL.
		const tabUrl = normalizeUrl(tab.url)!;
		const title = cleanText(tab.title, tabUrl, 500);
		const copies = store.groups
			.flatMap((entry) => entry.tabs)
			.filter((entry) => entry.url === tabUrl);
		const duplicate =
			store.settings.saveDuplicateHandling === 'reject' ? copies[0] : null;
		if (
			copies.length > 0 &&
			store.settings.saveDuplicateTitle === 'latest' &&
			copies.some((entry) => entry.title !== title)
		) {
			for (const copy of copies) {
				copy.title = title;
			}

			await writeStore(store);
		}

		if (!duplicate) {
			group.tabs.push({
				id: makeId(),
				title:
					copies.length > 0 && store.settings.saveDuplicateTitle !== 'latest'
						? copies[0].title
						: title,
				url: tabUrl,
				faviconUrl: normalizeFavicon(tab.favIconUrl),
				notes: copies[0]?.notes || '',
				archived: false,
				pinned: Boolean(tab.pinned),
				nativeGroup:
					tab.groupId >= 0
						? normalizeNativeGroup(
								nativeGroups.get(tab.groupId),
								String(tab.groupId),
							)
						: null,
				savedAt: now,
				originalIndex: isInteger(tab.index) ? tab.index : group.tabs.length,
			});
		}

		if (!duplicate) {
			group.updatedAt = now;
			await writeStore(store);
		}

		if (store.settings.closeOnSave) {
			const remaining = await chrome.tabs.query({windowId});
			const candidate = remaining.find((entry) => entry.id === tab.id);
			if (
				candidate &&
				normalizeUrl(candidate.url) === normalizeUrl(tab.url) &&
				(!candidate.pinned || store.settings.includePinnedTabs)
			) {
				if (remaining.length === 1) {
					const isFocusedWindow = window.id === (await currentWindowId());
					const useDashboard =
						store.settings.openDashboardAfterSave && isFocusedWindow;
					await chrome.tabs.create({
						windowId,
						url: useDashboard
							? `${DASHBOARD_URL}?group=${encodeURIComponent(group.id)}`
							: 'chrome://newtab/',
						active: useDashboard,
					});
				}

				try {
					await chrome.tabs.remove(tab.id!);
				} catch {
					/*
					The source tab may close during the save.
					*/
				}
			}
		}

		return {
			ok: true,
			count: duplicate ? 0 : 1,
			skipped: duplicate ? 1 : 0,
			groupId: group.id,
		};
	});
}

async function handleToolbarAction(tab?: chrome.tabs.Tab) {
	const store = await getStore();
	if (store.settings.actionMode === 'current-tab-to-group') {
		const result = await saveCurrentTabToFirstGroup(tab);
		if (!result?.ok) {
			console.warn(
				result?.error ||
					`${APP_NAME} could not add the current tab to a session.`,
			);
		}

		return;
	}

	const scopeByMode: Partial<Record<Settings['actionMode'], SaveScope>> = {
		'current-group': 'current-group',
		'current-window': 'selected-or-window',
		'full-window': 'window',
		'all-windows': 'all-windows',
		'current-tab': 'current-tab',
	};
	const scope = scopeByMode[store.settings.actionMode];
	if (!scope) {
		return;
	}

	const result = await saveTabs(scope, tab);
	if (!result?.ok) {
		console.warn(
			result?.error ||
				`${APP_NAME} could not save tabs from the toolbar action.`,
		);
	}
}

async function openDashboardForTab(tab?: chrome.tabs.Tab) {
	const store = await getStore();
	const windowId = await currentWindowId(tab);
	await openDashboard(windowId, '', store.settings.dashboardBehavior);
}

// ---- Right-click menus ----
// One parent item per context, named after the extension, keeps the browser menu short. The toolbar
// icon's menu is already the extension's own, so its items are top level (Chrome shows at most
// ACTION_MENU_TOP_LEVEL_LIMIT = 6). Tab-strip menus are not available to extensions.
// Menu ids keep the "tablodge-" prefix (see the note at STORAGE_KEY); column items append the column id.
type MenuItemProperties = chrome.contextMenus.CreateProperties;
type MenuOutcome = ActionFailure | {ok: true};
type MenuClickData = chrome.contextMenus.OnClickData & {linkText?: string};
const MENU = {
	linkRoot: 'tablodge-link-root',
	linkBookmark: 'tablodge-link-bookmark',
	linkBookmarkNew: 'tablodge-link-bookmark-new',
	linkSave: 'tablodge-link-save',
	pageRoot: 'tablodge-page-root',
	pageBookmark: 'tablodge-page-bookmark',
	pageBookmarkNew: 'tablodge-page-bookmark-new',
	selectionRoot: 'tablodge-selection-root',
	selectionSearch: 'tablodge-selection-search',
	actionOpen: 'tablodge-action-open',
	actionSaveWindow: 'tablodge-action-save-window',
	actionExclude: 'tablodge-action-exclude',
	actionSidePanel: 'tablodge-action-side-panel',
	actionHelp: 'tablodge-action-help',
	actionSettings: 'tablodge-action-settings',
} as const;
/**
Column items are `${prefix}${columnId}`; the Unfiled pseudo-column uses BOOKMARK_UNFILED_ID.
*/
const LINK_COLUMN_PREFIX = 'tablodge-link-bookmark:';
const PAGE_COLUMN_PREFIX = 'tablodge-page-bookmark:';
/**
The page menu's save actions, reusing the SAVE_TABS scopes.
*/
const PAGE_SAVE_ITEMS: ReadonlyArray<
	readonly [id: string, title: string, scope: SaveScope]
> = [
	['tablodge-page-save-tab', 'Save this tab', 'this-tab'],
	['tablodge-page-save-window', 'Save this window', 'window'],
	['tablodge-page-save-selected', 'Save selected tabs', 'selected'],
	['tablodge-page-save-left', 'Save tabs to the left', 'left-of-tab'],
	['tablodge-page-save-right', 'Save tabs to the right', 'right-of-tab'],
	[
		'tablodge-page-save-except-tab',
		'Save all tabs except this one',
		'except-this-tab',
	],
	['tablodge-page-save-group', 'Save this tab group', 'tab-group'],
	[
		'tablodge-page-save-all-windows',
		'Save tabs from all windows',
		'all-windows',
	],
];
const MENU_SAVE_SCOPES: Record<string, SaveScope> = {
	...Object.fromEntries(PAGE_SAVE_ITEMS.map(([id, , scope]) => [id, scope])),
	[MENU.actionSaveWindow]: 'window',
};
/**
"Save link for later" collects links in this session (matched by name, case-insensitively).
*/
const SAVED_LINKS_SESSION = 'Saved links';
const WEB_URL_PATTERNS = ['http://*/*', 'https://*/*'];
const MENU_REBUILD_DELAY = 150;
const BADGE_DURATION = 1500;

let menuQueue: Promise<void> = Promise.resolve();
/**
Signature of the menus last built (or queued); storage changes that keep it skip the rebuild.
*/
let menuSignature = '';
let menuRebuildTimer: ReturnType<typeof setTimeout> | undefined;
const badgeTimers = new Map<number, ReturnType<typeof setTimeout>>();

/**
Everything the menu tree depends on: the switches, the enabled systems, and the column names and order.
*/
function contextMenuSignature(settings: Settings, columns: BookmarkColumn[]) {
	return JSON.stringify([
		settings.contextMenusEnabled,
		settings.contextMenuLinksEnabled,
		settings.contextMenuPageEnabled,
		settings.contextMenuSelectionEnabled,
		settings.contextMenuActionEnabled,
		settings.sessionsEnabled,
		settings.bookmarksEnabled,
		columns.map((column) => [column.id, column.name]),
	]);
}

/**
 The full menu tree for these settings and columns, in creation order (parents first).
 `excludeState` sets the toolbar menu's "Exclude this site" checkbox for the active tab.
 */
function contextMenuPlan(
	settings: Settings,
	columns: BookmarkColumn[],
	excludeState: {checked: boolean; enabled: boolean} = {
		checked: false,
		enabled: true,
	},
): MenuItemProperties[] {
	if (!settings.contextMenusEnabled) {
		return [];
	}

	const items: MenuItemProperties[] = [];
	const columnSubmenu = (
		parentId: string,
		prefix: string,
		newId: string,
		contexts: MenuItemProperties['contexts'],
		extra: {targetUrlPatterns?: string[]; documentUrlPatterns?: string[]},
	) => {
		for (const column of columns) {
			items.push({
				id: `${prefix}${column.id}`,
				title: column.name,
				parentId,
				contexts,
				...extra,
			});
		}

		items.push(
			{
				id: `${prefix}${BOOKMARK_UNFILED_ID}`,
				title: 'Unfiled',
				parentId,
				contexts,
				...extra,
			},
			{
				id: `${parentId}-separator`,
				type: 'separator',
				parentId,
				contexts,
				...extra,
			},
			{id: newId, title: 'New column', parentId, contexts, ...extra},
		);
	};

	if (
		settings.contextMenuLinksEnabled &&
		(settings.bookmarksEnabled || settings.sessionsEnabled)
	) {
		const link = {
			contexts: ['link'],
			targetUrlPatterns: WEB_URL_PATTERNS,
		} satisfies Partial<MenuItemProperties>;
		items.push({id: MENU.linkRoot, title: APP_NAME, ...link});
		if (settings.bookmarksEnabled) {
			items.push({
				id: MENU.linkBookmark,
				title: 'Bookmark link to',
				parentId: MENU.linkRoot,
				...link,
			});
			columnSubmenu(
				MENU.linkBookmark,
				LINK_COLUMN_PREFIX,
				MENU.linkBookmarkNew,
				link.contexts,
				{targetUrlPatterns: WEB_URL_PATTERNS},
			);
		}

		if (settings.sessionsEnabled) {
			items.push({
				id: MENU.linkSave,
				title: 'Save link for later',
				parentId: MENU.linkRoot,
				...link,
			});
		}
	}

	if (
		settings.contextMenuPageEnabled &&
		(settings.bookmarksEnabled || settings.sessionsEnabled)
	) {
		const page = {
			contexts: ['page', 'frame'],
			documentUrlPatterns: WEB_URL_PATTERNS,
		} satisfies Partial<MenuItemProperties>;
		items.push({id: MENU.pageRoot, title: APP_NAME, ...page});
		if (settings.bookmarksEnabled) {
			items.push({
				id: MENU.pageBookmark,
				title: 'Bookmark this page to',
				parentId: MENU.pageRoot,
				...page,
			});
			columnSubmenu(
				MENU.pageBookmark,
				PAGE_COLUMN_PREFIX,
				MENU.pageBookmarkNew,
				page.contexts,
				{documentUrlPatterns: WEB_URL_PATTERNS},
			);
		}

		if (settings.sessionsEnabled) {
			if (settings.bookmarksEnabled) {
				items.push({
					id: 'tablodge-page-separator',
					type: 'separator',
					parentId: MENU.pageRoot,
					...page,
				});
			}

			// The tab-group item stays enabled: Chrome has no contextMenus.onShown to toggle it per tab, and a
			// click outside a tab group just logs "The active tab is not in a tab group." Browsers with onShown refine it.
			for (const [id, title] of PAGE_SAVE_ITEMS) {
				items.push({id, title, parentId: MENU.pageRoot, ...page});
			}
		}
	}

	if (settings.contextMenuSelectionEnabled) {
		const selection = {
			contexts: ['selection'],
		} satisfies Partial<MenuItemProperties>;
		items.push(
			{id: MENU.selectionRoot, title: APP_NAME, ...selection},
			// Chrome substitutes %s with the selected text (shortened for long selections).
			{
				id: MENU.selectionSearch,
				title: 'Search saved tabs & bookmarks for “%s”',
				parentId: MENU.selectionRoot,
				...selection,
			},
		);
	}

	if (settings.contextMenuActionEnabled) {
		const action = {contexts: ['action']} satisfies Partial<MenuItemProperties>;
		items.push({id: MENU.actionOpen, title: 'Open dashboard', ...action});
		if (chrome.sidePanel) {
			items.push({
				id: MENU.actionSidePanel,
				title: 'Open side panel',
				...action,
			});
		}

		if (settings.sessionsEnabled) {
			items.push(
				{
					id: MENU.actionSaveWindow,
					title: 'Save this window',
					...action,
				},
				{
					id: MENU.actionExclude,
					title: 'Exclude this site from saves',
					type: 'checkbox',
					checked: excludeState.checked,
					enabled: excludeState.enabled,
					...action,
				},
			);
		}

		items.push(
			{id: MENU.actionHelp, title: 'Help', ...action},
			{id: MENU.actionSettings, title: 'Settings', ...action},
		);
	}

	return items;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
	isRecord(value) && typeof value.then === 'function';

/**
Logs (never throws) an error reported through a contextMenus callback.
*/
function menuCallback(label: string, done?: () => void) {
	return () => {
		const error = chrome.runtime.lastError;
		if (error) {
			console.warn(
				`${APP_NAME} could not ${label}: ${error.message || 'unknown error'}`,
			);
		}

		done?.();
	};
}

/**
RemoveAll with a callback (Chrome 116–122 return nothing), also settling when an implementation returns a promise.
*/
function removeAllMenus(): Promise<void> {
	return new Promise((resolve) => {
		try {
			const pending = (chrome.contextMenus as CallbackMenuApi).removeAll(
				menuCallback('clear its menus', resolve),
			);
			if (isThenable(pending)) {
				pending.then(
					() => resolve(),
					() => resolve(),
				);
			}
		} catch (error) {
			console.warn(
				errorMessage(error) || `${APP_NAME} could not clear its menus.`,
			);
			resolve();
		}
	});
}

function updateMenu(
	id: string,
	properties: {checked?: boolean; enabled?: boolean},
): Promise<void> {
	return new Promise((resolve) => {
		// A missing item (menus off, or mid-rebuild) is expected here, so its error is consumed silently.
		const done = () => {
			// Reading lastError marks it as handled, so Chrome does not log it as unchecked.
			Boolean(chrome.runtime.lastError);
			resolve();
		};

		try {
			const pending = (chrome.contextMenus as CallbackMenuApi).update(
				id,
				properties,
				done,
			);
			if (isThenable(pending)) {
				pending.then(done, done);
			}
		} catch {
			resolve();
		}
	});
}

/**
The exact host name of the active tab (or `tab`), or null for non-web pages.
*/
async function menuTabOrigin(tab?: chrome.tabs.Tab): Promise<string | null> {
	try {
		const target =
			tab ??
			(await chrome.tabs.query({active: true, lastFocusedWindow: true}))[0];
		const url = normalizeUrl(target?.url);
		return url ? new URL(url).hostname.toLowerCase() : null;
	} catch {
		return null;
	}
}

async function excludeMenuState(settings: Settings, tab?: chrome.tabs.Tab) {
	const origin = await menuTabOrigin(tab);
	return {
		checked: Boolean(
			origin && hostIsExcluded(origin, settings.excludedOrigins),
		),
		enabled: Boolean(origin),
	};
}

/**
 Rebuilds every menu item. Rebuilds are serialized, and each one creates its items synchronously right
 after removeAll settles, so two rebuilds can never interleave and hit duplicate ids.
 */
function rebuildContextMenus(
	source?: Pick<Store, 'settings' | 'bookmarkColumns'>,
): Promise<void> {
	if (source) {
		menuSignature = contextMenuSignature(
			source.settings,
			source.bookmarkColumns,
		);
	}

	const run = async () => {
		if (!chrome.contextMenus?.create) {
			return;
		}

		try {
			const store = source || (await getStore());
			menuSignature = contextMenuSignature(
				store.settings,
				store.bookmarkColumns,
			);
			const plan = contextMenuPlan(
				store.settings,
				store.bookmarkColumns,
				await excludeMenuState(store.settings),
			);
			await removeAllMenus();
			for (const item of plan) {
				chrome.contextMenus.create(
					item,
					menuCallback(`create the menu item "${item.title || item.id}"`),
				);
			}
		} catch (error) {
			console.warn(
				errorMessage(error) ||
					`${APP_NAME} could not build its right-click menus.`,
			);
		}
	};

	menuQueue = menuQueue.then(run, run);
	return menuQueue;
}

/**
Debounced rebuild for bursts of storage writes (column drags, imports).
*/
function scheduleContextMenuRebuild() {
	if (menuRebuildTimer !== undefined) {
		clearTimeout(menuRebuildTimer);
	}

	menuRebuildTimer = setTimeout(() => {
		menuRebuildTimer = undefined;
		void rebuildContextMenus();
	}, MENU_REBUILD_DELAY);
}

/**
Keeps the toolbar menu's "Exclude this site" checkbox in step with the active tab.
*/
async function syncExcludeMenuItem(tab?: chrome.tabs.Tab) {
	if (!chrome.contextMenus?.update) {
		return;
	}

	try {
		const store = await getStore();
		const {settings} = store;
		if (
			!settings.contextMenusEnabled ||
			!settings.contextMenuActionEnabled ||
			!settings.sessionsEnabled
		) {
			return;
		}

		await updateMenu(MENU.actionExclude, await excludeMenuState(settings, tab));
	} catch {
		/*
		The checkbox is cosmetic; a click still reads the stored exclusions.
		*/
	}
}

// Column renames, reorders, additions and deletions (from any page, import or erase) and settings
// changes all land in the stored state, so the menus follow it here.
chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
	const change = areaName === 'local' ? changes[STORAGE_KEY] : undefined;
	if (!change || !isRecord(change.newValue)) {
		return;
	}

	const previous = isRecord(change.oldValue) ? change.oldValue : {};
	const nextSettings = normalizeSettings(
		change.newValue.settings as RawSettings | undefined,
	);
	const nextSignature = contextMenuSignature(
		nextSettings,
		normalizeBookmarkColumns(change.newValue.bookmarkColumns),
	);
	const previousSignature = contextMenuSignature(
		normalizeSettings(previous.settings as RawSettings | undefined),
		normalizeBookmarkColumns(previous.bookmarkColumns),
	);
	if (nextSignature !== previousSignature && nextSignature !== menuSignature) {
		scheduleContextMenuRebuild();
	}

	const previousOrigins = isRecord(previous.settings)
		? normalizeExcludedOrigins(previous.settings.excludedOrigins)
		: [];
	if (previousOrigins.join(' ') !== nextSettings.excludedOrigins.join(' ')) {
		void syncExcludeMenuItem();
	}
});
chrome.tabs?.onActivated?.addListener?.(() => {
	void syncExcludeMenuItem();
});
chrome.tabs?.onUpdated?.addListener?.((_tabId, changeInfo, tab) => {
	if (changeInfo.url && tab.active) {
		void syncExcludeMenuItem(tab);
	}
});
chrome.windows?.onFocusChanged?.addListener?.((windowId) => {
	if (windowId !== chrome.windows.WINDOW_ID_NONE) {
		void syncExcludeMenuItem();
	}
});

function watchContextMenuShown() {
	// Feature-detected: Chrome has no contextMenus.onShown (Firefox-style browsers do), so this is a no-op there.
	const menus = chrome.contextMenus as ContextMenusWithOnShown | undefined;
	try {
		menus?.onShown?.addListener?.((info, tab) => {
			if (typeof menus.update !== 'function') {
				return;
			}

			const contexts = new Set([
				info?.contextType,
				...(Array.isArray(info?.contexts) ? info.contexts : []),
			]);
			if (contexts.has('action')) {
				void syncExcludeMenuItem(tab).then(() => menus.refresh?.());
				return;
			}

			if (!contexts.has('page')) {
				return;
			}

			void getStore()
				.then(async (store) => {
					if (
						!store.settings.sessionsEnabled ||
						!store.settings.contextMenusEnabled ||
						!store.settings.contextMenuPageEnabled
					) {
						return;
					}

					await menus.update('tablodge-page-save-group', {
						enabled: isInteger(tab?.groupId) && tab.groupId >= 0,
					});
					menus.refresh?.();
				})
				.catch(() => {
					/*
					The item may not exist while menus are rebuilt.
					*/
				});
		});
	} catch {
		/*
		An incomplete contextMenus API must not stop the worker from starting.
		*/
	}
}

watchContextMenuShown();

/**
Menu actions cannot show page toasts, so the toolbar badge flashes ✓ (or ! on failure) on the clicked tab.
*/
function flashBadge(tab: chrome.tabs.Tab | undefined, ok: boolean) {
	const {action} = chrome;
	if (!action?.setBadgeText) {
		return;
	}

	const tabId = isInteger(tab?.id) && tab.id >= 0 ? tab.id : -1;
	const target = tabId >= 0 ? {tabId} : {};
	const previous = badgeTimers.get(tabId);
	if (previous !== undefined) {
		clearTimeout(previous);
	}

	void (async () => {
		try {
			await action.setBadgeBackgroundColor?.({
				...target,
				color: ok ? '#15803d' : '#b91c1c',
			});
			await action.setBadgeText({...target, text: ok ? '✓' : '!'});
		} catch {
			return; /* The tab may have closed. */
		}

		badgeTimers.set(
			tabId,
			setTimeout(() => {
				badgeTimers.delete(tabId);
				void Promise.resolve(action.setBadgeText({...target, text: ''})).catch(
					() => undefined,
				);
			}, BADGE_DURATION),
		);
	})();
}

/**
Runs a menu action: failures are logged with console.warn (never thrown) and every outcome flashes the badge.
*/
function runMenuAction(
	tab: chrome.tabs.Tab | undefined,
	fallback: string,
	action: () => Promise<MenuOutcome | void>,
	badge = true,
) {
	void action()
		.then((result) => {
			if (result && !result.ok) {
				console.warn(result.error || fallback);
			}

			if (badge) {
				flashBadge(tab, !result || result.ok);
			}
		})
		.catch((error: unknown) => {
			console.warn(errorMessage(error) || fallback);
			if (badge) {
				flashBadge(tab, false);
			}
		});
}

/**
A readable host label for a link without text.
*/
function linkHost(url: string) {
	try {
		return new URL(url).hostname.replace(/^www\./i, '') || url;
	} catch {
		return url;
	}
}

/**
The clicked link's title: its text (info.linkText, Chromium builds that report it), a short selection, an open tab's title, then the host.
*/
async function menuLinkTitle(info: MenuClickData, url: string) {
	const linkText = cleanText(info.linkText, '', 500);
	const selection = cleanText(info.selectionText, '', 500);
	const text = linkText || (selection.length <= 300 ? selection : '');
	return text && !bookmarkTitleIsUrl(text, url)
		? text
		: (await openBookmarkTitleMap()).get(url) || linkHost(url);
}

/**
Adds a link to a bookmark column (or Unfiled); a link already in that column counts as done.
*/
async function bookmarkToColumn(
	rawUrl: unknown,
	title: string,
	columnId: string,
): Promise<MenuOutcome> {
	const url = normalizeUrl(rawUrl);
	if (!url) {
		return {
			ok: false,
			error: 'Only regular http and https pages can be bookmarked.',
		};
	}

	const store = await getStore();
	if (!store.settings.bookmarksEnabled) {
		return {ok: false, error: 'Bookmarks are disabled in Settings.'};
	}

	if (
		columnId !== BOOKMARK_UNFILED_ID &&
		store.bookmarkColumns.every((column) => column.id !== columnId)
	) {
		return {ok: false, error: 'That bookmark column no longer exists.'};
	}

	if (
		store.bookmarks.some(
			(bookmark) => bookmark.url === url && bookmark.columnId === columnId,
		)
	) {
		return {ok: true};
	}

	return addBookmarks([{url, title}], columnId);
}

/**
"New column": opens the dashboard's add-bookmark dialog prefilled with the link or page.
*/
async function openPrefilledBookmarkDialog(
	rawUrl: unknown,
	title: string,
	tab?: chrome.tabs.Tab,
): Promise<MenuOutcome> {
	const url = normalizeUrl(rawUrl);
	if (!url) {
		return {
			ok: false,
			error: 'Only regular http and https pages can be bookmarked.',
		};
	}

	const store = await getStore();
	if (!store.settings.bookmarksEnabled) {
		return {ok: false, error: 'Bookmarks are disabled in Settings.'};
	}

	// BookmarkColumn=new asks the dialog to start a new column; pages that do not support it ignore the parameter.
	const query = new URLSearchParams({
		bookmarkUrl: url,
		bookmarkTitle: cleanText(title, linkHost(url), 500),
		bookmarkColumn: 'new',
	});
	await openDashboard(
		await currentWindowId(tab),
		`?${query}`,
		store.settings.dashboardBehavior,
	);
	return {ok: true};
}

/**
Appends a link to the "Saved links" session (created when missing) without opening it.
*/
async function saveLinkForLater(
	rawUrl: unknown,
	title: string,
): Promise<Result<{added: boolean; groupId: string | null}>> {
	const url = normalizeUrl(rawUrl);
	if (!url) {
		return {ok: false, error: 'Only http and https links can be saved.'};
	}

	return mutate(async () => {
		const store = await getStore();
		if (!store.settings.sessionsEnabled) {
			return {ok: false, error: 'Sessions are disabled in Settings.'};
		}

		const name = SAVED_LINKS_SESSION.toLocaleLowerCase();
		let group = store.groups.find(
			(entry) => !entry.archived && entry.name.toLocaleLowerCase() === name,
		);
		const copies = store.groups
			.flatMap((entry) => entry.tabs)
			.filter((entry) => entry.url === url);
		// Already in "Saved links", or saved anywhere while duplicates are rejected: nothing to add.
		if (
			group?.tabs.some((entry) => entry.url === url) ||
			(copies.length > 0 && store.settings.saveDuplicateHandling === 'reject')
		) {
			return {ok: true, added: false, groupId: group?.id ?? null};
		}

		const now = Date.now();
		if (!group) {
			group = {
				id: makeId(),
				name: SAVED_LINKS_SESSION,
				folderId: DEFAULT_FOLDER_ID,
				description: '',
				notes: '',
				archived: false,
				archivedAt: null,
				locked: false,
				createdAt: now,
				updatedAt: now,
				sourceWindowName: '',
				sourceWindowId: null,
				tabs: [],
			};
			store.groups.unshift(group);
		}

		group.tabs.push({
			id: makeId(),
			title: cleanText(
				copies.length > 0 && store.settings.saveDuplicateTitle !== 'latest'
					? copies[0].title
					: title,
				linkHost(url),
				500,
			),
			url,
			faviconUrl: '',
			notes: copies[0]?.notes || '',
			archived: false,
			pinned: false,
			nativeGroup: null,
			savedAt: now,
			originalIndex: group.tabs.length,
		});
		group.updatedAt = now;
		await writeStore(store);
		return {ok: true, added: true, groupId: group.id};
	});
}

/**
The dashboard query for a selection search: `?q=` with the trimmed, single-spaced text.
*/
function dashboardSearchQuery(text: unknown) {
	const q = cleanText(
		typeof text === 'string' ? text.replaceAll(/\s+/g, ' ') : '',
		'',
		200,
	);
	return q ? `?${new URLSearchParams({q})}` : '';
}

async function searchDashboard(
	text: unknown,
	tab?: chrome.tabs.Tab,
): Promise<MenuOutcome> {
	const store = await getStore();
	await openDashboard(
		await currentWindowId(tab),
		dashboardSearchQuery(text),
		store.settings.dashboardBehavior,
	);
	return {ok: true};
}

/**
Toggles the active site in the excluded-sites list, through the same handlers as Settings.
*/
async function toggleExcludedSite(
	tab?: chrome.tabs.Tab,
): Promise<Result<{origin: string; excluded: boolean}>> {
	const origin = await menuTabOrigin(tab);
	if (!origin) {
		return {ok: false, error: 'Open a regular web page to exclude its site.'};
	}

	// An excluded host (directly or through a parent domain) is un-excluded by removing every entry that covers it.
	const store = await getStore();
	const covering = store.settings.excludedOrigins.filter(
		(entry) => origin === entry || origin.endsWith(`.${entry}`),
	);
	let result:
		| Awaited<ReturnType<typeof addExcludedOrigin>>
		| Awaited<ReturnType<typeof removeExcludedOrigin>> =
		await (covering.length > 0
			? removeExcludedOrigin(covering[0])
			: addExcludedOrigin(origin));
	for (const entry of covering.slice(1)) {
		if (result.ok) {
			result = await removeExcludedOrigin(entry);
		}
	}

	if (!result.ok) {
		return result;
	}

	const excluded = hostIsExcluded(origin, result.settings.excludedOrigins);
	await updateMenu(MENU.actionExclude, {checked: excluded, enabled: true});
	if (excluded) {
		console.info(
			`${APP_NAME} will skip ${origin} and its subdomains in future session saves.`,
		);
	}

	return {ok: true, origin, excluded};
}

async function openExtensionPage(
	page: 'help.html' | 'options.html',
): Promise<MenuOutcome> {
	if (page === 'options.html' && chrome.runtime.openOptionsPage) {
		await chrome.runtime.openOptionsPage();
	} else {
		await chrome.tabs.create({url: chrome.runtime.getURL(page)});
	}

	return {ok: true};
}

function handleContextMenuClick(info: MenuClickData, tab?: chrome.tabs.Tab) {
	const id = String(info.menuItemId);
	const scope = MENU_SAVE_SCOPES[id];
	if (scope) {
		runMenuAction(tab, `${APP_NAME} could not save these tabs.`, () =>
			saveTabs(scope, tab),
		);
		return;
	}

	if (
		id.startsWith(LINK_COLUMN_PREFIX) ||
		id === MENU.linkBookmarkNew ||
		id === MENU.linkSave
	) {
		const url = normalizeUrl(info.linkUrl);
		runMenuAction(
			tab,
			`${APP_NAME} could not save this link.`,
			async () => {
				if (!url) {
					return {ok: false, error: 'Only http and https links can be saved.'};
				}

				const title = await menuLinkTitle(info, url);
				if (id === MENU.linkSave) {
					return saveLinkForLater(url, title);
				}

				if (id === MENU.linkBookmarkNew) {
					return openPrefilledBookmarkDialog(url, title, tab);
				}

				return bookmarkToColumn(
					url,
					title,
					id.slice(LINK_COLUMN_PREFIX.length),
				);
			},
			id !== MENU.linkBookmarkNew,
		);
		return;
	}

	if (id.startsWith(PAGE_COLUMN_PREFIX) || id === MENU.pageBookmarkNew) {
		const url = normalizeUrl(tab?.url ?? info.pageUrl);
		runMenuAction(
			tab,
			`${APP_NAME} could not bookmark this page.`,
			async () => {
				if (!url) {
					return {ok: false, error: 'Open a regular web page to bookmark it.'};
				}

				const title = cleanText(tab?.title, linkHost(url), 500);
				if (id === MENU.pageBookmarkNew) {
					return openPrefilledBookmarkDialog(url, title, tab);
				}

				return bookmarkToColumn(
					url,
					title,
					id.slice(PAGE_COLUMN_PREFIX.length),
				);
			},
			id !== MENU.pageBookmarkNew,
		);
		return;
	}

	if (id === MENU.selectionSearch) {
		runMenuAction(
			tab,
			`${APP_NAME} could not open its search.`,
			() => searchDashboard(info.selectionText, tab),
			false,
		);
		return;
	}

	if (id === MENU.actionExclude) {
		runMenuAction(
			tab,
			`${APP_NAME} could not change this site's exclusion.`,
			() => toggleExcludedSite(tab),
		);
		return;
	}

	if (id === MENU.actionOpen) {
		runMenuAction(
			tab,
			`${APP_NAME} could not open its dashboard.`,
			() => openDashboardForTab(tab),
			false,
		);
		return;
	}

	if (id === MENU.actionSidePanel) {
		openSidePanel(tab);
		return;
	}

	if (id === MENU.actionHelp) {
		runMenuAction(
			tab,
			`${APP_NAME} could not open Help.`,
			() => openExtensionPage('help.html'),
			false,
		);
		return;
	}

	if (id === MENU.actionSettings) {
		runMenuAction(
			tab,
			`${APP_NAME} could not open Settings.`,
			() => openExtensionPage('options.html'),
			false,
		);
	}
}

chrome.contextMenus?.onClicked?.addListener((info, tab) =>
	handleContextMenuClick(info, tab),
);

async function initializeExtension(openDashboardAtStartup = false) {
	const store = await getStore();
	await syncToolbarAction(store.settings);
	await rebuildContextMenus(store);
	if (store.settings.keepLodgePinned) {
		scheduleLodgeCheck();
	}

	if (!openDashboardAtStartup || !store.settings.openDashboardOnStartup) {
		return;
	}

	if (
		store.settings.startupBehavior === 'last-session' &&
		store.groups.length > 0
	) {
		const latest = store.groups.toSorted(
			(a, b) => b.createdAt - a.createdAt,
		)[0];
		await restoreGroup(latest.id, undefined, false, {restoreMode: 'keep'});
	} else {
		await openDashboardForTab();
	}
}

chrome.runtime.onInstalled.addListener(() => {
	void initializeExtension();
});

chrome.runtime.onStartup.addListener(() => {
	void initializeExtension(true);
});
