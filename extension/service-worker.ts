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
CaptureTabs reports duplicates it skipped on the session it creates (or on an empty placeholder), with the ids of
the open tabs they came from so a save can offer to add them anyway.
*/
type CaptureResult =
	| (Session & {skipped?: number; rejectedTabIds?: number[]; more?: Session[]})
	| {
			id: null;
			tabs: SavedTab[];
			skipped: number;
			rejectedTabIds?: number[];
			error?: string;
	  };
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
/**
`contextMenus.onShown`/`refresh` exist only in some Chromium-based browsers and are feature-detected.
*/
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
/**
The number when it is finite and above zero (a usable timestamp), otherwise `fallback`.
*/
const positiveOr = (value: unknown, fallback: number) => {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : fallback;
};

/**
A web address as typed, when it is a valid http(s) URL; otherwise an empty string.
*/
function httpUrlOrEmpty(value: unknown): string {
	if (typeof value !== 'string') {
		return '';
	}

	const text = value.trim().slice(0, 2048);
	try {
		const url = new URL(text);
		return url.protocol === 'http:' || url.protocol === 'https:' ? text : '';
	} catch {
		return '';
	}
}

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
const SCHEMA_VERSION = 8;
const DEFAULT_FOLDER_ID = 'unfiled';
const ARCHIVED_FOLDER_ID = 'archived-sessions';
const ARCHIVED_FOLDER_NAME = 'Archived';
// Loading keeps at most this many sessions and links per session, so every write path has to stay inside the same limits.
const MAX_SESSIONS = 1000;
const MAX_TABS_PER_SESSION = 1000;
const MAX_EXCLUDED_ORIGINS = 500;
const sessionLimitError = () =>
	`TabLodge keeps up to ${MAX_SESSIONS} sessions. Delete or merge some sessions first.`;
const sessionFullError = () =>
	`A session holds up to ${MAX_TABS_PER_SESSION} links. Use another session.`;
const chunkCount = (length: number) =>
	Math.max(1, Math.ceil(length / MAX_TABS_PER_SESSION));
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
	emptyWindowAfterSave: 'new-tab',
	includePinnedTabs: false,
	ignoreTabGroups: false,
	openDashboardAfterSave: false,
	openDashboardOnStartup: false,
	startupBehavior: 'dashboard',
	newTabEnabled: true,
	newTabFallback: 'browser',
	newTabFallbackUrl: '',
	autoFocusSearchOnNewTab: false,
	actionMode: 'popup',
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
	expandSessionsByDefault: false,
	stretchBookmarkColumns: true,
	limitBookmarksPerColumn: false,
	bookmarkColumnPageSize: 10,
	pasteLinkToBookmark: true,
	cleanTitles: true,
	bookmarkClickAction: 'current',
	sessionLinkClickAction: 'new',
	showBookmarkQuickActions: false,
	bookmarkQuickAction: 'open-new',
	sessionsOnTop: false,
	showSaveWindowButton: true,
	showTrashBinButton: true,
	keepLodgePinned: false,
	browserBookmarkAction: 'off',
	browserBookmarkColumn: '',
	copyFormat: 'markdown',
	dashboardBehavior: 'switch',
	urlDisplayMode: 'full',
	dashboardWidth: 'default',
	removeTrackingParameters: false,
	simplifyUrls: true,
	markInsecureLinks: true,
	markLocalLinks: false,
	groupTitleAction: 'toggle',
	contextMenusEnabled: true,
	contextMenuLinksEnabled: true,
	contextMenuPageEnabled: true,
	contextMenuSelectionEnabled: true,
	contextMenuActionEnabled: true,
	snapshotsEnabled: true,
	snapshotIntervalMinutes: 15,
	snapshotKeep: 25,
	autoBackup: 'off',
	autoBackupKeep: 7,
	autoBackupToDownloads: false,
	trashRetentionDays: 30,
	autoArchiveDays: 0,
	sessionNameStyle: 'date-title',
	sessionNameTemplate: '{date} · {title}',
	sessionNameFallback: 'date-title',
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

// Notification counters and unread markers sites put in front of their titles: "(1) YouTube", "(12+) Feed",
// "[3] Inbox", "● Untitled", "* Draft". Only a leading run is removed, so titles that merely contain "(2)" stay.
const TITLE_JUNK = /^(?:\s*(?:\(\d{1,5}\+?\)|\[\d{1,5}\+?\]|[*•●✱]))+\s+/u;

/**
A tab's title as TabLodge stores it: cleaned like any text, and with leading notification counters removed unless
"Clean page titles" is off. A title that is nothing but a counter is kept as it was.
*/
function pageTitle(
	value: unknown,
	fallback: unknown,
	clean: boolean,
	max = 500,
): string {
	const text = cleanText(value, fallback, max);
	return clean ? text.replace(TITLE_JUNK, '').trim() || text : text;
}

const SESSION_NAME_TEMPLATE_MAX = 200;
const SESSION_NAME_FALLBACKS: Array<Settings['sessionNameFallback']> = [
	'title',
	'datetime',
	'date-title',
	'custom',
];
const SESSION_NAME_STYLES: Array<Settings['sessionNameStyle']> = [
	...SESSION_NAME_FALLBACKS,
	'ask',
];

/**
The style that builds the name: `ask` falls back to its fallback style whenever the worker has to name a session
without asking (or the answer was left empty).
*/
function builtNameStyle(settings: {
	sessionNameStyle: Settings['sessionNameStyle'];
	sessionNameFallback: Settings['sessionNameFallback'];
}): Settings['sessionNameFallback'] {
	return settings.sessionNameStyle === 'ask'
		? settings.sessionNameFallback
		: settings.sessionNameStyle;
}

const SESSION_NAME_STYLE_TEMPLATES: Record<string, string> = {
	title: '{title}',
	datetime: '{date} · {time}',
	'date-title': '{date} · {title}',
};

type SessionNameParts = {
	style: Settings['sessionNameFallback'];
	template: string;
	/**
	Title and address of the first saved tab.
	*/
	title: string;
	url: string;
	count: number;
	/**
	1-based window number when saving all windows; 0 or omitted otherwise.
	*/
	windowNumber?: number;
	now: Date;
	locale: string;
};

/**
The name for a new session. `{date}` is "Sat, Oct 25" (no year: a new session is always named for today),
`{time}` the locale's short time, `{weekday}` a short weekday. Unknown `{...}` tokens stay as typed.
*/
function formatSessionName(parts: SessionNameParts): string {
	const format = (options: Intl.DateTimeFormatOptions) => {
		try {
			return new Intl.DateTimeFormat(parts.locale, options).format(parts.now);
		} catch {
			return new Intl.DateTimeFormat('en-US', options).format(parts.now);
		}
	};

	let host = '';
	try {
		host = new URL(parts.url).hostname.replace(/^www\./i, '');
	} catch {
		/*
		A page without a usable address has no domain.
		*/
	}

	const values: Record<string, () => string> = {
		date: () => format({weekday: 'short', month: 'short', day: 'numeric'}),
		time: () => format({timeStyle: 'short'}),
		weekday: () => format({weekday: 'short'}),
		title: () => cleanText(parts.title, host, 500),
		domain: () => host,
		count: () => String(parts.count),
		window: () => (parts.windowNumber ? String(parts.windowNumber) : ''),
	};
	const template =
		parts.style === 'custom'
			? cleanText(
					parts.template,
					DEFAULT_SETTINGS.sessionNameTemplate,
					SESSION_NAME_TEMPLATE_MAX,
				)
			: (SESSION_NAME_STYLE_TEMPLATES[parts.style] ??
				SESSION_NAME_STYLE_TEMPLATES['date-title']);
	return cleanText(
		template
			.replaceAll(/\{(\w+)\}/g, (token, key: string) =>
				Object.hasOwn(values, key) ? values[key]() : token,
			)
			// Narrow no-break spaces from the time format, and gaps left by an empty placeholder
			.replaceAll(/\s+/g, ' '),
		'Saved session',
		120,
	);
}

const browserLocale = () =>
	typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US';

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

// Mirrors src/app/tracking-parameters.ts; the classic worker cannot import the page helper.
const TRACKING_PARAMETER_NAMES = new Set([
	'_ga',
	'_gl',
	'_hsenc',
	'_hsmi',
	'__hsfp',
	'__hssc',
	'__hstc',
	'dclid',
	'epik',
	'fb_action_ids',
	'fb_action_types',
	'fb_ref',
	'fb_source',
	'fbclid',
	'gad_source',
	'gclsrc',
	'gclid',
	'gbraid',
	'hsctatracking',
	'igsh',
	'igshid',
	'li_fat_id',
	'mc_cid',
	'mc_eid',
	'mkt_tok',
	'msclkid',
	'rb_clickid',
	's_cid',
	'srsltid',
	'ttclid',
	'twclid',
	'vero_conv',
	'vero_id',
	'wbraid',
	'yclid',
]);

/**
Parameters that are only trackers on certain sites. `s` and `t` are generic names, so they are removed on X status links and nowhere else.
*/
const SITE_TRACKING_RULES: ReadonlyArray<{
	hosts: readonly string[];
	path?: RegExp;
	names: ReadonlySet<string>;
}> = [
	{
		hosts: ['x.com', 'twitter.com'],
		path: /\/status(?:es)?\/\d/,
		names: new Set(['s', 't']),
	},
	{
		hosts: ['x.com', 'twitter.com'],
		names: new Set(['ref_src', 'ref_url', 'cxt']),
	},
	{
		hosts: ['youtube.com', 'youtu.be', 'open.spotify.com'],
		names: new Set(['si']),
	},
];

function isTrackingParameter(name: string, url: URL) {
	const normalized = name.toLowerCase();
	return (
		normalized.startsWith('utm_') ||
		TRACKING_PARAMETER_NAMES.has(normalized) ||
		SITE_TRACKING_RULES.some(
			(rule) =>
				rule.names.has(normalized) &&
				rule.hosts.some(
					(host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
				) &&
				(!rule.path || rule.path.test(url.pathname)),
		)
	);
}

function stripTrackingParameters(rawUrl: string) {
	try {
		const url = new URL(rawUrl);
		if (!['http:', 'https:'].includes(url.protocol)) {
			return rawUrl;
		}

		const query = url.search.slice(1).split('&');
		const kept = query.filter((part) => {
			const separator = part.indexOf('=');
			const key = separator === -1 ? part : part.slice(0, separator);
			let name = key;
			try {
				name = decodeURIComponent(key.replaceAll('+', ' '));
			} catch {
				// Keep malformed keys unless their raw form is a known tracker.
			}

			return !isTrackingParameter(name, url);
		});
		if (kept.length === query.length) {
			return rawUrl;
		}

		url.search = kept.length > 0 ? `?${kept.join('&')}` : '';
		return url.href;
	} catch {
		return rawUrl;
	}
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

	const originalIndex = Number(raw.originalIndex ?? raw.index);
	return {
		id: cleanText(raw.id, makeId(), 100),
		title: cleanText(raw.title ?? raw.name, url, 500),
		url,
		notes: normalizeNotes(raw.notes),
		pinned: Boolean(raw.pinned),
		nativeGroup: normalizeNativeGroup(
			raw.nativeGroup ?? raw.group,
			raw.groupKey,
		),
		savedAt: positiveOr(raw.timestamp ?? raw.savedAt, groupTimestamp),
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

// Sessions used to have a short description plus separate notes; one field now holds both.
// Room for the old 500-character description, a blank line, and the old 10,000-character notes.
const SESSION_TEXT_MAX = 10_502;

function normalizeSessionText(value: unknown) {
	return typeof value === 'string'
		? value.replaceAll('\u0000', '').slice(0, SESSION_TEXT_MAX)
		: '';
}

function mergeSessionText(description: unknown, notes: unknown) {
	const first = typeof description === 'string' ? description.trim() : '';
	const second = typeof notes === 'string' ? notes.trim() : '';
	if (first && second && first !== second) {
		return normalizeSessionText(
			`${first.slice(0, 500)}\n\n${second.slice(0, 10_000)}`,
		);
	}

	return normalizeSessionText(first || second);
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

async function openBookmarkTitleMap(clean = true) {
	const titles = new Map<string, string>();
	try {
		const tabs = await chrome.tabs.query({});
		for (const tab of tabs) {
			const url = normalizeUrl(tab.url);
			if (url && !titles.has(url) && !bookmarkTitleIsUrl(tab.title, url)) {
				titles.set(
					url,
					pageTitle(tab.title, fallbackBookmarkTitle(url), clean),
				);
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

async function bestBookmarkTitle(value: unknown, url: string, clean = true) {
	if (!bookmarkTitleIsUrl(value, url)) {
		return pageTitle(value, fallbackBookmarkTitle(url), clean);
	}

	const openTitles = await openBookmarkTitleMap(clean);
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

	const createdAt = positiveOr(raw.createdAt ?? raw.savedAt, fallbackTimestamp);
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
		createdAt,
		updatedAt: positiveOr(raw.updatedAt, createdAt),
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
	const createdAt = positiveOr(
		raw.createdAt ?? raw.timestamp,
		fallbackTimestamp,
	);
	const seenTabIds = new Set<string>();
	const tabs = tabsRaw
		.slice(0, MAX_TABS_PER_SESSION)
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
	const lastOpenedAt = positiveOr(raw.lastOpenedAt, 0);
	return {
		id: cleanText(raw.id, makeId(), 100),
		name: cleanText(raw.name ?? raw.title, 'Saved session', 120),
		folderId: cleanText(raw.folderId, DEFAULT_FOLDER_ID, 100),
		description: mergeSessionText(raw.description, raw.notes),
		createdAt,
		updatedAt: positiveOr(raw.updatedAt, createdAt),
		...(lastOpenedAt > 0 && {lastOpenedAt}),
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
		emptyWindowAfterSave:
			raw.emptyWindowAfterSave === 'close-extra' ? 'close-extra' : 'new-tab',
		includePinnedTabs: raw.includePinnedTabs === true,
		ignoreTabGroups: raw.ignoreTabGroups === true,
		openDashboardAfterSave: raw.openDashboardAfterSave === true,
		openDashboardOnStartup: Boolean(raw.openDashboardOnStartup),
		startupBehavior:
			raw.startupBehavior === 'last-session' ? 'last-session' : 'dashboard',
		newTabEnabled: raw.newTabEnabled !== false,
		newTabFallback: isOneOf(['browser', 'blank', 'custom'], raw.newTabFallback)
			? raw.newTabFallback
			: 'browser',
		newTabFallbackUrl: httpUrlOrEmpty(raw.newTabFallbackUrl),
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
		restoreMode: isOneOf(['keep', 'remove'], raw.restoreMode)
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
			['newest', 'oldest', 'opened', 'name', 'tabs', 'custom'],
			raw.sessionSort,
		)
			? raw.sessionSort
			: 'newest',
		expandSessionsByDefault: raw.expandSessionsByDefault === true,
		stretchBookmarkColumns: raw.stretchBookmarkColumns !== false,
		limitBookmarksPerColumn: raw.limitBookmarksPerColumn === true,
		bookmarkColumnPageSize: clampInteger(
			raw.bookmarkColumnPageSize,
			1,
			500,
			10,
		),
		pasteLinkToBookmark: raw.pasteLinkToBookmark !== false,
		cleanTitles: raw.cleanTitles !== false,
		bookmarkClickAction: isOneOf(
			['none', 'current', 'new', 'menu'],
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
		bookmarkQuickAction: isOneOf(
			['open-current', 'open-new', 'copy', 'edit', 'delete'],
			raw.bookmarkQuickAction,
		)
			? raw.bookmarkQuickAction
			: 'open-new',
		sessionsOnTop: raw.sessionsOnTop === true,
		showSaveWindowButton: raw.showSaveWindowButton !== false,
		showTrashBinButton: raw.showTrashBinButton !== false,
		dashboardWidth: isOneOf(
			['default', 'wider', 'full', 'narrower'],
			raw.dashboardWidth,
		)
			? raw.dashboardWidth
			: 'default',
		keepLodgePinned: raw.keepLodgePinned === true,
		browserBookmarkAction: isOneOf(
			['off', 'ask', 'add'],
			raw.browserBookmarkAction,
		)
			? raw.browserBookmarkAction
			: 'off',
		browserBookmarkColumn: cleanText(raw.browserBookmarkColumn, '', 120),
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
		removeTrackingParameters: raw.removeTrackingParameters === true,
		simplifyUrls: raw.simplifyUrls !== false,
		markInsecureLinks: raw.markInsecureLinks !== false,
		markLocalLinks: raw.markLocalLinks === true,
		urlDisplayMode: isOneOf(
			['domain', 'full', 'url-only', 'none'],
			raw.urlDisplayMode,
		)
			? raw.urlDisplayMode
			: 'full',
		groupTitleAction: isOneOf(
			['toggle', 'edit', 'restore'],
			raw.groupTitleAction,
		)
			? raw.groupTitleAction
			: 'toggle',
		contextMenusEnabled: raw.contextMenusEnabled !== false,
		contextMenuLinksEnabled: raw.contextMenuLinksEnabled !== false,
		contextMenuPageEnabled: raw.contextMenuPageEnabled !== false,
		contextMenuSelectionEnabled: raw.contextMenuSelectionEnabled !== false,
		contextMenuActionEnabled: raw.contextMenuActionEnabled !== false,
		snapshotsEnabled: raw.snapshotsEnabled !== false,
		snapshotIntervalMinutes: oneOfNumbers(
			[5, 15, 30],
			raw.snapshotIntervalMinutes,
			15,
		),
		snapshotKeep: oneOfNumbers([10, 25, 50], raw.snapshotKeep, 25),
		autoBackup: isOneOf(['off', 'daily', 'weekly'], raw.autoBackup)
			? raw.autoBackup
			: 'off',
		autoBackupKeep: oneOfNumbers([7, 30], raw.autoBackupKeep, 7),
		autoBackupToDownloads: raw.autoBackupToDownloads === true,
		trashRetentionDays: oneOfNumbers([7, 30, 90], raw.trashRetentionDays, 30),
		autoArchiveDays: oneOfNumbers(
			[0, 30, 90, 180, 365],
			raw.autoArchiveDays,
			0,
		),
		sessionNameStyle: isOneOf(SESSION_NAME_STYLES, raw.sessionNameStyle)
			? raw.sessionNameStyle
			: 'date-title',
		sessionNameFallback: isOneOf(
			SESSION_NAME_FALLBACKS,
			raw.sessionNameFallback,
		)
			? raw.sessionNameFallback
			: 'date-title',
		sessionNameTemplate: cleanText(
			raw.sessionNameTemplate,
			DEFAULT_SETTINGS.sessionNameTemplate,
			SESSION_NAME_TEMPLATE_MAX,
		),
	};
	return settings;
}

/**
A number from a fixed list (numeric strings count); anything else gives the fallback.
*/
function oneOfNumbers(
	allowed: readonly number[],
	value: unknown,
	fallback: number,
): number {
	const number_ = typeof value === 'string' ? Number(value) : value;
	return typeof number_ === 'number' && allowed.includes(number_)
		? number_
		: fallback;
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
The lower-case host of a URL without a trailing dot, so "bank.com." and "bank.com" match; null when it does not parse. The one place hosts are read for comparisons.
*/
function urlHost(url: string): string | null {
	try {
		return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
	} catch {
		return null;
	}
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

		let host = urlHost(url.href) ?? '';
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
	const hosts = new Set<string>();
	for (const value of Array.isArray(raw) ? raw : []) {
		const host = normalizeExcludedHost(value);
		if (host) {
			hosts.add(host);
		}
	}

	return [...hosts].slice(0, MAX_EXCLUDED_ORIGINS);
}

/**
Finds the "Archived" folder by name or adds it. Old builds had an Archived view; sessions that were archived
without a folder land here now. The auto-archive setting uses the same folder.
*/
function findOrAddArchivedFolder(folders: Folder[]): Folder {
	let folder = folders.find((entry) => entry.name === ARCHIVED_FOLDER_NAME);
	if (!folder) {
		folder = {
			id: folders.some((entry) => entry.id === ARCHIVED_FOLDER_ID)
				? makeId()
				: ARCHIVED_FOLDER_ID,
			name: ARCHIVED_FOLDER_NAME,
			icon: 'archive',
			createdAt: Date.now(),
			isDefault: false,
		};
		folders.push(folder);
	}

	return folder;
}

function normalizeStore(raw: Raw | null | undefined): Store {
	// NormalizeSettings treats a missing, null or non-object `settings` value as defaults.
	const settings = normalizeSettings(
		raw?.settings as RawSettings | null | undefined,
	);
	const sourceGroups = Array.isArray(raw?.groups) ? raw.groups : [];
	const seenIds = new Set<string>();
	// Pinned tabs that were deliberately saved stay stored even if the save preference is later switched off.
	// Sessions archived by older builds (the Archived view is gone): they become normal sessions.
	const wasArchived = new WeakSet<Session>();
	const groups = sourceGroups
		.slice(0, MAX_SESSIONS)
		.map((entry: unknown) => {
			const group = normalizeGroup(entry, Date.now(), true);
			if (group && isRecord(entry) && entry.archived === true) {
				wasArchived.add(group);
			}

			return group;
		})
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

	// Archived sessions without a folder move into an "Archived" folder, created once and reused by name.
	const stranded = groups.filter(
		(group) => wasArchived.has(group) && group.folderId === DEFAULT_FOLDER_ID,
	);
	if (stranded.length > 0) {
		const archivedFolder = findOrAddArchivedFolder(folders);

		for (const group of stranded) {
			group.folderId = archivedFolder.id;
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

	if (exists && saved[STORAGE_KEY]?.schemaVersion === SCHEMA_VERSION) {
		// Already current: a later mutation has nothing to migrate.
		migrationChecked = true;
	}

	// Read paths never write: the schema migration is persisted once, inside `mutate` (see migrateStoreOnce).
	return normalizeStore(exists ? saved[STORAGE_KEY] : null);
}

let migrationChecked = false;
/**
Writes the normalized store back once per worker run when it is missing or saved by an older schema.
Runs inside the mutation queue, so it can never race a mutation or a concurrent read-only caller.
*/
async function migrateStoreOnce() {
	if (migrationChecked) {
		return;
	}

	try {
		const saved = await chrome.storage.local.get<
			Record<string, Raw | null | undefined>
		>([STORAGE_KEY]);
		const raw = saved[STORAGE_KEY];
		const exists = raw && typeof raw === 'object';
		if (exists && (Number(raw.schemaVersion) || 0) > SCHEMA_VERSION) {
			// Refused (and reported) by getStore; never overwritten.
			return;
		}

		if (!exists || raw.schemaVersion !== SCHEMA_VERSION) {
			await chrome.storage.local.set({
				[STORAGE_KEY]: normalizeStore(exists ? raw : null),
			});
			invalidateSettings();
		}

		migrationChecked = true;
	} catch {
		/*
		Best effort: the operation reports its own storage error, and the next mutation retries.
		*/
	}
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
	invalidateSettings();
	return next;
}

function mutate<T>(operation: () => Promise<T>): Promise<T> {
	const run = async () => {
		await migrateStoreOnce();
		return operation();
	};

	const result = mutationQueue.then(run, run);
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

	const host = urlHost(url);
	return host !== null && !hostIsExcluded(host, settings.excludedOrigins);
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
	windowNumber = 0,
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
				title: pageTitle(
					tab.title,
					normalizeUrl(tab.url),
					settings.cleanTitles,
				),
				url: normalizeUrl(tab.url),
				notes: '',
				pinned: Boolean(tab.pinned),
				nativeGroup:
					tab.groupId >= 0 && !settings.ignoreTabGroups
						? normalizeNativeGroup(
								nativeGroups.get(tab.groupId),
								String(tab.groupId),
							)
						: null,
				savedAt: timestamp,
				originalIndex: isInteger(tab.index) ? tab.index : index,
				// IsCapturable guarantees a web URL;
			} as SavedTab,
		}));
	if (captureEntries.length === 0) {
		return null;
	}

	// Rejected duplicates are not stored again and their tabs stay open, so the save can offer to add them anyway.
	// Allowed duplicates share notes (and, by policy, the title) with the copies already saved.
	let skipped = 0;
	const rejectedTabIds: number[] = [];
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
			if (isInteger(entry.sourceTabId)) {
				rejectedTabIds.push(entry.sourceTabId);
			}

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

	const parts = chunkCount(captured.length);
	if (captured.length > 0 && store.groups.length + parts > MAX_SESSIONS) {
		return {
			id: null,
			tabs: [],
			skipped,
			rejectedTabIds,
			error: sessionLimitError(),
		};
	}

	const group: CaptureResult =
		captured.length > 0
			? {
					id: makeId(),
					name: cleanText(
						requestedName ||
							(useNativeGroupTitle
								? captured.find((tab) => tab.nativeGroup?.title)?.nativeGroup
										?.title
								: '') ||
							formatSessionName({
								style: builtNameStyle(settings),
								template: settings.sessionNameTemplate,
								title: captured[0].title,
								url: captured[0].url,
								count: captured.length,
								windowNumber,
								now: new Date(timestamp),
								locale: browserLocale(),
							}),
						'Saved session',
						120,
					),
					folderId: store.folders.some((folder) => folder.id === folderId)
						? folderId
						: DEFAULT_FOLDER_ID,
					description: '',
					createdAt: timestamp,
					updatedAt: timestamp,
					sourceWindowName: cleanText(window.title, '', 180),
					sourceWindowId: window.id,
					tabs: captured,
				}
			: {id: null, tabs: [], skipped, rejectedTabIds};
	// A non-empty capture always produced the Session branch above.
	if (captured.length > 0) {
		const first = group as Session;
		if (parts > 1) {
			// A session holds at most 1000 links, so a huge capture becomes several numbered sessions.
			const baseName = first.name.slice(0, 100);
			const sessions = Array.from({length: parts}, (_, part) => ({
				...structuredClone({...first, tabs: []}),
				id: part === 0 ? first.id : makeId(),
				name: `${baseName} (${part + 1}/${parts})`,
				tabs: pairSplits(
					captured.slice(
						part * MAX_TABS_PER_SESSION,
						(part + 1) * MAX_TABS_PER_SESSION,
					),
				),
			}));
			first.name = sessions[0].name;
			first.tabs = sessions[0].tabs;
			(group as CaptureResult & {more?: Session[]}).more = sessions.slice(1);
			store.groups.unshift(...sessions);
		} else {
			store.groups.unshift(first);
		}
	}

	group.skipped = skipped;
	group.rejectedTabIds = rejectedTabIds;
	if (captured.length > 0 || titlesUpdated) {
		await writeStore(store);
	}

	const closeCandidates = new Map(
		newEntries
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
		if (
			closeIds.length > 0 &&
			remainingIds.length === 0 &&
			!(await closeEmptiedWindow(window.id, settings))
		) {
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

/**
Closes a window that a save is about to empty, when the setting asks for it and another normal window of the same incognito state is open; that window is focused first. Returns whether the window was closed, so the caller knows to keep it with a new tab otherwise.
*/
async function closeEmptiedWindow(
	windowId: number | null | undefined,
	settings: Settings,
): Promise<boolean> {
	if (settings.emptyWindowAfterSave !== 'close-extra' || !isInteger(windowId)) {
		return false;
	}

	try {
		const current = await chrome.windows.get(windowId, {populate: false});
		const others = (
			await chrome.windows.getAll({populate: false, windowTypes: ['normal']})
		).filter(
			(other) =>
				other.id !== windowId &&
				Boolean(other.incognito) === Boolean(current.incognito),
		);
		if (others.length === 0) {
			return false;
		}

		const lastFocused = await chrome.windows
			.getLastFocused({populate: false})
			.catch(() => undefined);
		const target =
			others.find((other) => other.id === lastFocused?.id) ?? others[0];
		await chrome.windows.update(target.id!, {focused: true});
		await chrome.windows.remove(windowId);
		return true;
	} catch {
		/*
		The window can close on its own meanwhile; fall back to keeping it open.
		*/
		return false;
	}
}

async function saveTabs(
	scope: SaveScope,
	senderTab?: chrome.tabs.Tab,
	requestedFolderId: string = DEFAULT_FOLDER_ID,
	options: {
		tabIds?: number[];
		groupName?: string;
		includePinned?: boolean;
		/**
		Stores tabs even when their address is already saved, whatever the duplicate setting says (the "Force add" button).
		*/
		allowDuplicates?: boolean;
		/**
		The save has no page that could ask for a name (shortcut, right-click menu, toolbar button): with the
		`ask` style, save with the fallback name first, then open the small name prompt window.
		*/
		promptName?: boolean;
		/**
		A workspace switch saves the window but closes the tabs itself once the other session is open, so this
		save leaves them open and does not open the dashboard.
		*/
		keepTabsOpen?: boolean;
	} = {},
): Promise<ActionResult<'SAVE_TABS'>> {
	return mutate(async () => {
		const store = await getStore();
		const windowId = await currentWindowId(senderTab);
		if (!isInteger(windowId)) {
			return {ok: false, error: 'Open a browser window before saving tabs.'};
		}

		const selectedWindow = await chrome.windows.get(windowId, {
			populate: false,
		});
		// The quick popup may allow pinned tabs for one save without changing the stored preference.
		const captureSettings = {
			...store.settings,
			...(options.includePinned === true && {includePinnedTabs: true}),
			...(options.allowDuplicates === true && {
				saveDuplicateHandling: 'allow' as const,
			}),
			...(options.keepTabsOpen === true && {
				closeOnSave: false,
				openDashboardAfterSave: false,
			}),
		};
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
		const rejectedTabIds: number[] = [];
		let limitError = '';
		for (const [windowIndex, win] of windows.entries()) {
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
				// A typed name for a save across several windows is numbered per window: "Name (1/3)".
				options.groupName && scope === 'all-windows' && windows.length > 1
					? `${cleanText(options.groupName, '', 100)} (${windowIndex + 1}/${windows.length})`
					: options.groupName,
				scope === 'all-windows' ? windowIndex + 1 : 0,
			);
			// A capture with tabs is always a stored Session.
			if (group && 'error' in group && group.error) {
				limitError = group.error;
				break;
			}

			if (group?.tabs.length) {
				savedGroups.push(
					group as Session,
					...((group as Session & {more?: Session[]}).more ?? []),
				);
			}

			if (!group) {
				continue;
			}

			skippedDuplicates += group.skipped || 0;
			rejectedTabIds.push(...(group.rejectedTabIds ?? []));
		}

		if (savedGroups.length === 0 && limitError) {
			return {ok: false, error: limitError};
		}

		if (savedGroups.length === 0 && skippedDuplicates) {
			return {
				ok: true,
				count: 0,
				groups: 0,
				skipped: skippedDuplicates,
				rejectedTabIds,
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

		// A titled native tab group keeps its own title, so there is nothing to ask.
		if (
			options.promptName &&
			!options.groupName &&
			store.settings.sessionNameStyle === 'ask' &&
			!(
				scope === 'current-group' &&
				savedGroups[0].tabs.some((tab) => tab.nativeGroup?.title)
			)
		) {
			await openNamePrompt(
				savedGroups.map((group) => group.id),
				selectedWindow.id,
			);
		}

		return {
			ok: true,
			count: savedGroups.reduce((sum, group) => sum + group.tabs.length, 0),
			groups: savedGroups.length,
			skipped: skippedDuplicates,
			rejectedTabIds,
			groupId: savedGroups[0].id,
		};
	});
}

const NAME_PROMPT_WIDTH = 440;
const NAME_PROMPT_HEIGHT = 280;

/**
Opens the small "Name this session" window for sessions that were just saved with the fallback name.
Cancelling or closing it keeps that name; a failure to open it never fails the save.
*/
async function openNamePrompt(
	groupIds: string[],
	anchorWindowId: number | undefined,
) {
	try {
		const url = `${chrome.runtime.getURL('name-session.html')}?${groupIds
			.map((id) => `groupId=${encodeURIComponent(id)}`)
			.join('&')}`;
		const options: chrome.windows.CreateData = {
			type: 'popup',
			url,
			width: NAME_PROMPT_WIDTH,
			height: NAME_PROMPT_HEIGHT,
			focused: true,
		};
		let anchor: chrome.windows.Window | null = null;
		try {
			anchor = isInteger(anchorWindowId)
				? await chrome.windows.get(anchorWindowId)
				: null;
		} catch {
			/*
			Without the window's position the browser places the prompt itself.
			*/
		}

		if (
			anchor &&
			isInteger(anchor.left) &&
			isInteger(anchor.top) &&
			isInteger(anchor.width)
		) {
			// Centered near the top of the window that was saved.
			options.left = Math.max(
				0,
				anchor.left + Math.round((anchor.width - NAME_PROMPT_WIDTH) / 2),
			);
			options.top = Math.max(0, anchor.top + 80);
		}

		await chrome.windows.create(options);
	} catch {
		/*
		The sessions are saved with the fallback name; the prompt is a convenience.
		*/
	}
}

const BOOKMARK_PROMPT_WIDTH = 440;
const BOOKMARK_PROMPT_HEIGHT = 470;

/**
The "Bookmark this page" shortcut: reads the active tab of the last-focused normal window (the prompt window takes
focus afterwards) and opens the small add-bookmark window for it. Pages that cannot be bookmarked fail
without opening anything.
*/
async function openBookmarkPrompt(
	commandTab?: chrome.tabs.Tab,
	prefill?: {title?: string; fromBrowser?: boolean},
): Promise<MenuOutcome> {
	let tab = commandTab?.url ? commandTab : undefined;
	let anchor: chrome.windows.Window | undefined;
	try {
		anchor = await chrome.windows.getLastFocused({windowTypes: ['normal']});
		if (!tab && isInteger(anchor.id)) {
			tab = (await chrome.tabs.query({active: true, windowId: anchor.id})).find(
				(candidate) => candidate.active,
			);
		}
	} catch {
		/*
		Without the window the browser places the prompt itself.
		*/
	}

	const url = normalizeUrl(tab?.url);
	if (!url) {
		return {
			ok: false,
			error: 'Only regular http and https pages can be bookmarked.',
		};
	}

	const title = cleanText(
		prefill?.title || tab?.title,
		cleanText(tab?.title, linkHost(url), 500),
		500,
	);
	const options: chrome.windows.CreateData = {
		type: 'popup',
		url: `${chrome.runtime.getURL('add-bookmark.html')}?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}${prefill?.fromBrowser ? '&source=browser' : ''}`,
		width: BOOKMARK_PROMPT_WIDTH,
		height: BOOKMARK_PROMPT_HEIGHT,
		focused: true,
	};
	if (
		anchor &&
		isInteger(anchor.left) &&
		isInteger(anchor.top) &&
		isInteger(anchor.width)
	) {
		options.left = Math.max(
			0,
			anchor.left + Math.round((anchor.width - BOOKMARK_PROMPT_WIDTH) / 2),
		);
		options.top = Math.max(0, anchor.top + 80);
	}

	await chrome.windows.create(options);
	return {ok: true};
}

/**
The name the next save would get, for the Settings preview: the same formatter, the given (unsaved) style and
template, and the tabs of the sender's (or last-focused) window.
*/
async function previewSessionName(
	request: {
		style?: unknown;
		fallback?: unknown;
		template?: unknown;
		scope?: unknown;
		tabIds?: unknown;
	},
	senderTab?: chrome.tabs.Tab,
): Promise<ActionResult<'PREVIEW_SESSION_NAME'>> {
	const settings = await readSettings();
	const style = isOneOf(SESSION_NAME_STYLES, request.style)
		? request.style
		: settings.sessionNameStyle;
	const fallback = isOneOf(SESSION_NAME_FALLBACKS, request.fallback)
		? request.fallback
		: settings.sessionNameFallback;
	const template =
		typeof request.template === 'string'
			? request.template
			: settings.sessionNameTemplate;
	const windowId = await currentWindowId(senderTab);
	let tabs = isInteger(windowId) ? await chrome.tabs.query({windowId}) : [];
	// The tabs the save would capture: explicit picks, a selection, or the active tab, else the whole window.
	if (Array.isArray(request.tabIds)) {
		const picked = new Set<unknown>(request.tabIds);
		tabs = tabs.filter((tab) => picked.has(tab.id));
	} else {
		switch (request.scope) {
			case 'selected': {
				tabs = tabs.filter((tab) => tab.highlighted);
				break;
			}

			case 'selected-or-window': {
				const highlighted = tabs.filter((tab) => tab.highlighted);
				tabs = selectionSlots(highlighted) > 1 ? highlighted : tabs;
				break;
			}

			case 'current-tab': {
				tabs = tabs.filter((tab) => tab.active);
				break;
			}

			default:
		}
	}

	const saveable = tabs.filter(
		(tab) =>
			(!tab.pinned || settings.includePinnedTabs) &&
			isCapturable(tab, settings),
	);
	const first = saveable[0];
	return {
		ok: true,
		asks: style === 'ask',
		name: formatSessionName({
			style: builtNameStyle({
				sessionNameStyle: style,
				sessionNameFallback: fallback,
			}),
			template,
			title: first
				? pageTitle(first.title, normalizeUrl(first.url), settings.cleanTitles)
				: 'Example page',
			url: first ? (normalizeUrl(first.url) ?? '') : 'https://example.com/',
			count: Math.max(saveable.length, 1),
			now: new Date(),
			locale: browserLocale(),
		}),
	};
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

/**
A new window for a restore; its starting new-tab page is the bootstrap tab, removed once the restored tabs are open.
*/
async function createRestoreWindow(): Promise<{
	id: number | undefined;
	bootstrapTabId: number | null;
}> {
	// Windows.create only resolves without a window for incognito requests, which TabLodge never makes.
	const created = (await chrome.windows.create({
		url: 'chrome://newtab/',
		focused: true,
		type: 'normal',
	}))!;
	const tabs = await chrome.tabs.query({windowId: created.id});
	return {id: created.id, bootstrapTabId: tabs[0]?.id ?? null};
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

	// Without a new window, id is an integer: otherwise needsNewWindow was set above.
	return needsNewWindow
		? createRestoreWindow()
		: {id: id!, bootstrapTabId: null};
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

const UNLOAD_WAIT_MS = 60_000;

/**
Discards background tabs once each has committed its address. A tab discarded while its first navigation is still
pending loses the address and reopens blank, so tabs that are not there yet are discarded when `tabs.onUpdated`
reports their URL (for up to a minute). Already committed tabs are discarded before this resolves.
*/
async function unloadWhenCommitted(
	tabIds: number[],
	knownTabs: chrome.tabs.Tab[] = [],
): Promise<void> {
	const pending = new Set(tabIds);
	const committed = (tab: chrome.tabs.Tab | undefined) =>
		Boolean(tab?.url && /^https?:/i.test(tab.url));
	const discard = async (tabId: number) => {
		pending.delete(tabId);
		try {
			await chrome.tabs.discard(tabId);
		} catch {
			/*
			Chromium may refuse, for example for a tab that just became active.
			*/
		}
	};

	const byId = new Map(knownTabs.map((tab) => [tab.id, tab]));
	for (const tabId of tabIds) {
		const tab = byId.get(tabId);
		if (tab?.active || tab?.discarded) {
			pending.delete(tabId);
		} else if (committed(tab)) {
			await discard(tabId);
		}
	}

	if (pending.size === 0 || !chrome.tabs.onUpdated?.addListener) {
		return;
	}

	const onUpdated = (
		tabId: number,
		changeInfo: chrome.tabs.OnUpdatedInfo,
		tab: chrome.tabs.Tab,
	) => {
		if (!pending.has(tabId) || !(changeInfo.url || changeInfo.status)) {
			return;
		}

		if (tab.active) {
			pending.delete(tabId);
		} else if (committed(tab)) {
			void discard(tabId);
		}

		if (pending.size === 0) {
			stop();
		}
	};

	const onRemoved = (tabId: number) => {
		pending.delete(tabId);
		if (pending.size === 0) {
			stop();
		}
	};

	const timer = setTimeout(() => stop(), UNLOAD_WAIT_MS);
	function stop() {
		clearTimeout(timer);
		chrome.tabs.onUpdated.removeListener(onUpdated);
		chrome.tabs.onRemoved?.removeListener?.(onRemoved);
	}

	chrome.tabs.onUpdated.addListener(onUpdated);
	chrome.tabs.onRemoved?.addListener?.(onRemoved);
}

async function restoreRecords(
	records: SavedTab[],
	settings: Settings,
	senderTab: chrome.tabs.Tab | undefined,
	options: {
		restoreTarget?: RestoreTarget;
		activate?: boolean;
		/**
		Restore into this (new) window instead of choosing one.
		*/
		target?: {id: number | undefined; bootstrapTabId: number | null};
		/**
		The saved tab to make active (default: the first one that opened).
		*/
		activeSavedId?: string;
	} = {},
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

	const target =
		options.target ??
		(await chooseRestoreWindow(
			settings,
			senderTab,
			options.restoreTarget || settings.restoreTarget,
		));
	const targetTabs = await chrome.tabs.query({windowId: target.id});
	const existing = new Set(
		targetTabs
			.filter(
				(tab) =>
					(!tab.pinned || settings.includePinnedTabs) &&
					isCapturable(tab, settings),
			)
			.map((tab) => {
				const url = normalizeUrl(tab.url);
				return settings.removeTrackingParameters && url
					? stripTrackingParameters(url)
					: url;
			}),
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
		const url = settings.removeTrackingParameters
			? stripTrackingParameters(saved.url)
			: saved.url;
		if (shouldSkip && existing.has(url)) {
			skipped += 1;
			continue;
		}

		try {
			const created = await chrome.tabs.create({
				windowId: target.id,
				url,
				active: false,
				pinned: saved.pinned,
			});
			opened.push({saved, tabId: created.id});
			// Tabs.create always resolves with a tab that has an id.
			openedIds.set(saved, created.id!);
			existing.add(url);
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

	const activeEntry =
		opened.find((entry) => entry.saved.id === options.activeSavedId) ??
		opened[0];
	if (options.activate !== false && activeEntry?.tabId) {
		try {
			await chrome.tabs.update(activeEntry.tabId, {active: true});
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
		// Split tabs stay loaded: either half can be on screen next to the active tab, and discarding one
		// would leave a blank pane in the split view.
		const unload = opened
			.filter(
				(entry) =>
					entry.tabId !== undefined &&
					!entry.saved.pinned &&
					entry.tabId !== activeId &&
					!splitTabIds.has(entry.tabId),
			)
			.map((entry) => entry.tabId!);
		await unloadWhenCommitted(unload, currentTabs);
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

		const mode = isOneOf(['keep', 'remove'], options.restoreMode)
			? options.restoreMode
			: store.settings.restoreMode;
		let removed = false;
		let trashId: string | undefined;
		if (mode === 'remove') {
			const groupIndex = store.groups.indexOf(group);
			const tabIndex = group.tabs.findIndex((entry) => entry.id === tabId);
			group.tabs = group.tabs.filter((entry) => entry.id !== tabId);
			if (group.tabs.length === 0) {
				store.groups = store.groups.filter((entry) => entry.id !== groupId);
				removed = true;
			}

			trashId = await trashAdd(
				store.settings,
				trashTabsEntry(group, [{tab, index: tabIndex}], removed, groupIndex),
			);
			await writeStore(store);
		}

		return {
			ok: true,
			count: 1,
			skipped: result.skipped,
			failed: result.failures.length,
			failures: result.failures,
			removed,
			splits: 0,
			splitsSeparated: 0,
			...(trashId && {trashId}),
		};
	});
}

async function restoreGroup(
	groupId: string,
	senderTab: chrome.tabs.Tab | undefined,
	forceRemove = false,
	options: RestoreOptions & {
		/**
		Open every tab even when the window already shows its address, and restore into this window.
		*/
		intoWindowId?: number;
	} = {},
): Promise<ActionResult<'RESTORE_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		const group = findGroup(store, groupId);
		if (!group) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		const restoreTarget = options.restoreTarget || store.settings.restoreTarget;
		const intoWindow = isInteger(options.intoWindowId);
		const result = await restoreRecords(
			group.tabs,
			intoWindow
				? {...store.settings, restoreDuplicateHandling: 'open'}
				: store.settings,
			senderTab,
			{
				restoreTarget,
				activate: options.activate !== false,
				...(intoWindow && {
					target: {id: options.intoWindowId, bootstrapTabId: null},
				}),
			},
		);
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
			: isOneOf(['keep', 'remove'], options.restoreMode)
				? options.restoreMode
				: store.settings.restoreMode;
		const remove = mode === 'remove';
		let removed = false;
		let trashId: string | undefined;
		group.lastOpenedAt = Date.now();
		if (remove) {
			const restoredIds = new Set(result.opened.map(({saved}) => saved.id));
			const groupIndex = store.groups.indexOf(group);
			const gone = group.tabs
				.map((tab, index) => ({tab, index}))
				.filter(({tab}) => restoredIds.has(tab.id));
			group.tabs = group.tabs.filter((tab) => !restoredIds.has(tab.id));
			if (group.tabs.length === 0) {
				store.groups = store.groups.filter((entry) => entry.id !== groupId);
				removed = true;
			}

			if (gone.length > 0) {
				trashId = await trashAdd(
					store.settings,
					trashTabsEntry(group, gone, removed, groupIndex),
				);
			}
		}

		await writeStore(store);

		return {
			ok: true,
			count: result.opened.length,
			skipped: result.skipped,
			failed: result.failures.length,
			failures: result.failures,
			removed,
			splits: result.splits,
			splitsSeparated: result.splitsSeparated,
			...(trashId && {trashId}),
		};
	});
}

/**
Workspace switch: saves the window's web tabs as a new session, opens another session in the same window, and then
closes the tabs that were saved. The old tabs stay open until the other session is open, so a failed restore never
leaves the window empty. Pinned tabs, excluded sites, and pages that are not web pages stay where they are.
*/
async function switchWorkspace(
	groupId: string,
	senderTab: chrome.tabs.Tab | undefined,
): Promise<ActionResult<'SWITCH_WORKSPACE'>> {
	const store = await getStore();
	if (!findGroup(store, groupId)) {
		return {ok: false, error: 'That saved session no longer exists.'};
	}

	const windowId = await currentWindowId(senderTab);
	if (!isInteger(windowId)) {
		return {ok: false, error: 'Open a browser window before switching.'};
	}

	const outgoing = new Map(
		(await chrome.tabs.query({windowId}))
			.filter(
				(tab) =>
					isInteger(tab.id) &&
					isCapturable(tab, store.settings) &&
					(!tab.pinned || store.settings.includePinnedTabs),
			)
			.map((tab) => [tab.id!, normalizeUrl(tab.url)] as const),
	);
	let saved = 0;
	let savedGroupId: string | null = null;
	if (outgoing.size > 0) {
		const save = await saveTabs('window', senderTab, DEFAULT_FOLDER_ID, {
			tabIds: [...outgoing.keys()],
			keepTabsOpen: true,
		});
		if (!save.ok) {
			return save;
		}

		saved = save.count;
		savedGroupId = save.groupId;
	}

	const restore = await restoreGroup(groupId, senderTab, false, {
		restoreTarget: 'current-window',
		intoWindowId: windowId,
	});
	if (!restore.ok) {
		return {
			ok: false,
			error: saved
				? `Saved the current tabs, but ${restore.error.charAt(0).toLowerCase()}${restore.error.slice(1)} They stay open.`
				: restore.error,
		};
	}

	let closed = 0;
	if (outgoing.size > 0) {
		const closeIds = (await chrome.tabs.query({windowId}))
			.filter(
				(tab) =>
					isInteger(tab.id) &&
					outgoing.get(tab.id) === normalizeUrl(tab.url) &&
					(!tab.pinned || store.settings.includePinnedTabs),
			)
			.map((tab) => tab.id!);
		try {
			await chrome.tabs.remove(closeIds);
			closed = closeIds.length;
		} catch {
			/*
			A tab can close while the switch is being completed.
			*/
		}
	}

	return {...restore, saved, savedGroupId, closed};
}

async function deleteGroup(
	groupId: string,
): Promise<ActionResult<'DELETE_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		const index = store.groups.findIndex((group) => group.id === groupId);
		if (index === -1) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		const [removed] = store.groups.splice(index, 1);
		const trashId = await trashAdd(store.settings, {
			kind: 'session',
			label: removed.name,
			origin: store.folders.find((f) => f.id === removed.folderId)?.name ?? '',
			count: removed.tabs.length,
			data: trashSessionData(removed, index),
		});
		await writeStore(store);
		return {ok: true, trashId};
	});
}

async function updateGroup(
	groupId: string,
	fields: SessionFields,
): Promise<ActionResult<'UPDATE_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
		const group = findGroup(store, groupId);
		if (!group) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		if (typeof fields.name === 'string') {
			const name = cleanText(fields.name, 'Saved session', 120);
			group.name = name;
		}

		if (typeof fields.description === 'string') {
			group.description = normalizeSessionText(fields.description);
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

/**
Moves sessions that were not opened (or saved or edited) in the last `autoArchiveDays` days into the "Archived" folder. Nothing is deleted.
*/
function archiveStaleSessions(): Promise<void> {
	return mutate(async () => {
		const store = await getStore();
		const {autoArchiveDays} = store.settings;
		if (autoArchiveDays === 0) {
			return;
		}

		const cutoff = Date.now() - autoArchiveDays * 86_400_000;
		const archivedId = store.folders.find(
			(folder) => folder.name === ARCHIVED_FOLDER_NAME,
		)?.id;
		const stale = store.groups.filter(
			(group) =>
				group.folderId !== archivedId &&
				Math.max(group.lastOpenedAt ?? 0, group.updatedAt, group.createdAt) <
					cutoff,
		);
		if (stale.length === 0 || (!archivedId && store.folders.length >= 200)) {
			return;
		}

		const archived = findOrAddArchivedFolder(store.folders);
		for (const group of stale) {
			group.folderId = archived.id;
		}

		await writeStore(store);
	});
}

async function setGroupOrder(
	order: string[],
): Promise<ActionResult<'SET_GROUP_ORDER'>> {
	return mutate(async () => {
		const store = await getStore();
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

/**
Deletes a session folder; its sessions move to Unfiled. A folder holds no data of its own, so it does not go to the
trash bin: the short-lived Undo puts the folder and its sessions back.
*/
async function deleteFolder(
	folderId: string,
): Promise<ActionResult<'DELETE_FOLDER'>> {
	return mutate(() =>
		withUndo('Delete folder', [STORAGE_KEY], async () => {
			const store = await getStore();
			const folder = store.folders.find((entry) => entry.id === folderId);
			if (!folder) {
				return {ok: false, error: 'That folder no longer exists.'};
			}

			if (folder.isDefault) {
				return {ok: false, error: 'The Unfiled folder cannot be deleted.'};
			}

			const groupIds: string[] = [];
			for (const group of store.groups) {
				if (group.folderId !== folderId) {
					continue;
				}

				group.folderId = DEFAULT_FOLDER_ID;
				groupIds.push(group.id);
			}

			store.folders = store.folders.filter((entry) => entry.id !== folderId);
			await writeStore(store);
			return {ok: true, moved: groupIds.length};
		}),
	);
}

async function deleteTab(
	groupId: string,
	tabId: string,
): Promise<ActionResult<'DELETE_TAB'>> {
	return mutate(async () => {
		const store = await getStore();
		const group = findGroup(store, groupId);
		if (!group) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		const tabIndex = group.tabs.findIndex((tab) => tab.id === tabId);
		if (tabIndex === -1) {
			return {ok: false, error: 'That saved tab no longer exists.'};
		}

		const groupIndex = store.groups.indexOf(group);
		const [removedTab] = group.tabs.splice(tabIndex, 1);
		const groupRemoved = group.tabs.length === 0;
		const trashId = await trashAdd(
			store.settings,
			trashTabsEntry(
				group,
				[{tab: removedTab, index: tabIndex}],
				groupRemoved,
				groupIndex,
			),
		);
		if (!groupRemoved) {
			group.updatedAt = Date.now();
		}

		store.groups = store.groups.filter(
			(entry) => entry.id !== groupId || entry.tabs.length > 0,
		);
		await writeStore(store);
		return {ok: true, trashId};
	});
}

/**
Merges one session into another: the target keeps its name, folder and order, the source's links are added at its
end except addresses it already holds (their notes fill empty notes on the kept copy), the source's description is
added below the target's, and the source session is removed. Undo restores both.
*/
async function mergeGroups(
	sourceGroupId: string,
	targetGroupId: string,
): Promise<ActionResult<'MERGE_GROUPS'>> {
	return mutate(() =>
		withUndo('Merge sessions', [STORAGE_KEY], async () => {
			const store = await getStore();
			const source = findGroup(store, sourceGroupId);
			const target = findGroup(store, targetGroupId);
			if (!source || !target || source === target) {
				return {ok: false, error: 'That saved session no longer exists.'};
			}

			const kept = new Map(target.tabs.map((tab) => [tab.url, tab]));
			const added: SavedTab[] = [];
			let skipped = 0;
			for (const tab of source.tabs) {
				const existing = kept.get(tab.url);
				if (existing) {
					skipped += 1;
					if (!existing.notes && tab.notes) {
						existing.notes = tab.notes;
					}

					continue;
				}

				kept.set(tab.url, tab);
				added.push(tab);
			}

			if (target.tabs.length + added.length > MAX_TABS_PER_SESSION) {
				return {ok: false, error: sessionFullError()};
			}

			target.tabs.push(...added);
			const description = source.description.trim();
			if (description && !target.description.includes(description)) {
				target.description = [target.description.trim(), description]
					.filter(Boolean)
					.join('\n\n')
					.slice(0, SESSION_TEXT_MAX);
			}

			target.updatedAt = Date.now();
			store.groups = store.groups.filter((group) => group !== source);
			await writeStore(store);
			return {ok: true, added: added.length, skipped};
		}),
	);
}

/**
Adds dropped links to a session, before or after `targetTabId` (or at its end). Addresses the session already holds
are skipped. Undo removes the added links again.
*/
async function addLinksToSession(
	groupId: string,
	entries: LinkEntry[] = [],
	targetTabId: string | null = null,
	position: InsertPosition = 'after',
): Promise<ActionResult<'ADD_LINKS_TO_SESSION'>> {
	return mutate(() =>
		withUndo('Add links to session', [STORAGE_KEY], async () => {
			const store = await getStore();
			const group = findGroup(store, groupId);
			if (!group) {
				return {ok: false, error: 'That saved session no longer exists.'};
			}

			const known = new Set(group.tabs.map((tab) => tab.url));
			const now = Date.now();
			const added: SavedTab[] = [];
			let skipped = 0;
			for (const entry of (Array.isArray(entries) ? entries : []).slice(
				0,
				500,
			)) {
				const url = normalizeUrl(entry?.url);
				if (!url) {
					continue;
				}

				if (known.has(url)) {
					skipped += 1;
					continue;
				}

				known.add(url);
				added.push({
					id: makeId(),
					title: await bestBookmarkTitle(
						entry?.title,
						url,
						store.settings.cleanTitles,
					),
					url,
					notes: '',
					pinned: false,
					nativeGroup: null,
					savedAt: now,
					originalIndex: group.tabs.length + added.length,
				});
			}

			if (added.length === 0) {
				const error =
					skipped > 0
						? 'Those links are already in this session.'
						: 'Only regular http and https pages can be saved.';
				return {ok: false, error};
			}

			if (group.tabs.length + added.length > MAX_TABS_PER_SESSION) {
				return {ok: false, error: sessionFullError()};
			}

			const index = targetTabId
				? group.tabs.findIndex((tab) => tab.id === targetTabId)
				: -1;
			group.tabs.splice(
				index === -1
					? group.tabs.length
					: index + (position === 'before' ? 0 : 1),
				0,
				...added,
			);
			group.updatedAt = now;
			await writeStore(store);
			return {ok: true, added: added.length, skipped};
		}),
	);
}

async function moveTab(
	fromGroupId: string,
	tabId: string,
	toGroupId: string,
	targetTabId: string | null = null,
	position: InsertPosition = 'after',
	copy = false,
	restoreTrashId: string | null = null,
): Promise<ActionResult<'MOVE_TAB'>> {
	return mutate(async () => {
		const store = await getStore();
		const source = findGroup(store, fromGroupId);
		const target = findGroup(store, toGroupId);
		const tab = source?.tabs.find((entry) => entry.id === tabId);
		if (!source || !tab) {
			return {ok: false, error: 'That saved tab no longer exists.'};
		}

		// Undoing a move that emptied its source: the source session is in the trash, so bring it back (it holds the link) and take the link out of where it went.
		if (!target && restoreTrashId && !copy) {
			const entry = (await readTrash()).find(
				(item) => item.id === restoreTrashId,
			);
			if (entry?.kind !== 'tabs' || entry.data.groupId !== toGroupId) {
				return {ok: false, error: 'That saved session no longer exists.'};
			}

			source.tabs = source.tabs.filter((item) => item.id !== tabId);
			const outcome = applyTrashRestore(store, entry);
			if (!outcome.ok) {
				return outcome;
			}

			store.groups = store.groups.filter((item) => item.tabs.length > 0);
			await writeStore(store);
			await trashMutate(async () => {
				await writeTrash(
					(await readTrash()).filter((item) => item.id !== restoreTrashId),
				);
			});
			return {ok: true};
		}

		if (!target) {
			return {ok: false, error: 'That saved session no longer exists.'};
		}

		if (targetTabId === tabId && source === target) {
			return {ok: true};
		}

		if (source !== target && target.tabs.length >= MAX_TABS_PER_SESSION) {
			return {ok: false, error: sessionFullError()};
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

		const sourceIndex = source.tabs.indexOf(tab);
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

		// An emptied source goes to the trash (with its name, notes and folder) instead of vanishing.
		let trashId: string | undefined;
		if (!copy && source !== target && source.tabs.length === 0) {
			trashId = await trashAdd(
				store.settings,
				trashTabsEntry(
					source,
					[{tab, index: sourceIndex}],
					true,
					store.groups.indexOf(source),
				),
			);
		}

		store.groups = store.groups.filter((entry) => entry.tabs.length > 0);
		await writeStore(store);
		return trashId ? {ok: true, trashId} : {ok: true};
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
		const group = findGroup(store, groupId);
		const tab = group?.tabs.find((entry) => entry.id === tabId);
		if (!group || !tab) {
			return {ok: false, error: 'That saved tab no longer exists.'};
		}

		// A new address belongs to this one saved link only; titles and notes are shared across copies of the same page.
		// Excluded sites only filter what is captured from open tabs, so, like imports and bookmarks, a typed address is not checked against them.
		if (typeof fields.url === 'string' && fields.url !== tab.url) {
			const url = normalizeUrl(fields.url.trim());
			if (!url) {
				return {
					ok: false,
					error: 'Enter a web address that starts with http:// or https://.',
				};
			}

			if (url !== tab.url) {
				if (typeof fields.title === 'string') {
					tab.title = cleanText(fields.title, url, 500);
				}

				if (typeof fields.notes === 'string') {
					tab.notes = normalizeNotes(fields.notes);
				}

				tab.url = url;
				group.updatedAt = Date.now();
				await writeStore(store);
				return {ok: true, shared: 0};
			}
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
			title: await bestBookmarkTitle(
				fields.title,
				url,
				store.settings.cleanTitles,
			),
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
	undoable = false,
): Promise<ActionResult<'ADD_BOOKMARKS'>> {
	const run = async (): Promise<ActionResult<'ADD_BOOKMARKS'>> => {
		const store = await getStore();
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
		const known = new Set(
			store.bookmarks
				.filter((bookmark) => bookmark.columnId === targetColumnId)
				.map((bookmark) => bookmark.url),
		);
		let skipped = 0;
		for (const entry of (Array.isArray(entries) ? entries : []).slice(0, 500)) {
			const url = normalizeUrl(entry?.url);
			if (!url) {
				continue;
			}

			if (known.has(url)) {
				skipped += 1;
				continue;
			}

			known.add(url);

			added.push({
				id: makeId(),
				title: await bestBookmarkTitle(
					entry?.title,
					url,
					store.settings.cleanTitles,
				),
				url,
				columnId: targetColumnId,
				createdAt: now,
				updatedAt: now,
			});
		}

		if (added.length === 0) {
			const error =
				skipped > 0
					? 'Already bookmarked in this column.'
					: 'Only regular http and https pages can be bookmarked.';
			return {ok: false, error};
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
		return {ok: true, count: added.length, skipped, bookmarks: added};
	};

	return mutate(() =>
		undoable ? withUndo('Add bookmarks', [STORAGE_KEY], run) : run(),
	);
}

async function importBrowserBookmarks(
	duplicateMode: DuplicateMode = 'skip',
	titlePolicy: TitlePolicy = 'existing',
	requestedColumnId: string | null = null,
): Promise<ActionResult<'IMPORT_BROWSER_BOOKMARKS'>> {
	if (!chrome.bookmarks?.getTree) {
		return {ok: false, error: 'This browser does not provide bookmark access.'};
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

	return mutate(() =>
		withUndo('Import', [STORAGE_KEY], async () => {
			const store = await getStore();
			const treeLinks = (nodes: chrome.bookmarks.BookmarkTreeNode[]): number =>
				nodes.reduce(
					(sum, node) =>
						sum + (node.url ? 1 : 0) + treeLinks(node.children ?? []),
					0,
				);
			if (treeLinks(Array.isArray(tree) ? tree : []) > LARGE_IMPORT_THRESHOLD) {
				await safetyBackup(store, 'Before importing browser bookmarks');
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
		}),
	);
}

async function addExcludedOrigins(
	origins: string[],
): Promise<ActionResult<'ADD_EXCLUDED_ORIGINS'>> {
	return mutate(async () => {
		const store = await getStore();
		const hosts = normalizeExcludedOrigins(origins);
		if (hosts.length === 0) {
			return {ok: false, error: 'Enter a valid website, such as example.com.'};
		}

		const fresh = hosts.filter(
			(host) => !store.settings.excludedOrigins.includes(host),
		);
		const room = Math.max(
			0,
			MAX_EXCLUDED_ORIGINS - store.settings.excludedOrigins.length,
		);
		if (fresh.length > 0 && room === 0) {
			return {
				ok: false,
				error: `The list is full (${MAX_EXCLUDED_ORIGINS} sites). Remove some sites first.`,
			};
		}

		const added = fresh.slice(0, room);
		if (added.length > 0) {
			store.settings.excludedOrigins = normalizeExcludedOrigins([
				...store.settings.excludedOrigins,
				...added,
			]);
			await writeStore(store);
		}

		return {
			ok: true,
			added: added.length,
			notAdded: fresh.length - added.length,
			settings: store.settings,
		};
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
		const index = store.bookmarks.findIndex(
			(bookmark) => bookmark.id === bookmarkId,
		);
		if (index === -1) {
			return {ok: false, error: 'That bookmark no longer exists.'};
		}

		const [removed] = store.bookmarks.splice(index, 1);
		const sameColumn = (bookmark: Bookmark | undefined) =>
			bookmark?.columnId === removed.columnId ? bookmark.id : null;
		const trashId = await trashAdd(store.settings, {
			kind: 'bookmark',
			label: removed.title || removed.url,
			origin:
				store.bookmarkColumns.find((column) => column.id === removed.columnId)
					?.name ?? 'Unfiled',
			count: 1,
			data: {
				bookmark: removed,
				columnId: removed.columnId,
				index,
				prevId: sameColumn(store.bookmarks[index - 1]),
				nextId: sameColumn(store.bookmarks[index]),
			},
		});
		await writeStore(store);
		return {ok: true, trashId};
	});
}

async function createBookmarkColumn(
	name: string,
	icon?: unknown,
): Promise<ActionResult<'CREATE_BOOKMARK_COLUMN'>> {
	return mutate(async () => {
		const store = await getStore();
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
		if (store.bookmarkColumns.every((entry) => entry.id !== columnId)) {
			return {ok: false, error: 'That bookmark column no longer exists.'};
		}

		const remaining = store.bookmarkColumns.filter(
			(entry) => entry.id !== columnId,
		);
		const affected = store.bookmarks.filter(
			(bookmark) => bookmark.columnId === columnId,
		);
		const columnEntry = store.bookmarkColumns.find(
			(entry) => entry.id === columnId,
		)!;
		const columnIndex = store.bookmarkColumns.indexOf(columnEntry);
		if (discardBookmarks) {
			if (
				affected.length >= BULK_DELETE_THRESHOLD &&
				!(await safetyBackup(store, 'Before deleting a bookmark column'))
			) {
				return {
					ok: false,
					error: 'Could not take a safety backup first. Nothing was changed.',
				};
			}

			const trashId = await trashAdd(store.settings, {
				kind: 'column',
				label: columnEntry.name,
				origin: '',
				count: affected.length,
				data: {
					column: columnEntry,
					index: columnIndex,
					bookmarks: affected,
					movedIds: [],
					movedTo: null,
				},
			});
			store.bookmarks = store.bookmarks.filter(
				(bookmark) => bookmark.columnId !== columnId,
			);
			store.bookmarkColumns = remaining;
			await writeStore(store);
			return {
				ok: true,
				moved: 0,
				unfiled: 0,
				deleted: affected.length,
				trashId,
			};
		}

		if (
			affected.length > 0 &&
			remaining.length > 0 &&
			remaining.every((entry) => entry.id !== targetColumnId) &&
			targetColumnId !== BOOKMARK_UNFILED_ID
		) {
			return {
				ok: false,
				error: 'Choose a remaining bookmark column to move these links into.',
			};
		}

		// With remaining columns, the check above guarantees targetColumnId is one of them or Unfiled.
		const movedTo =
			remaining.length > 0 ? targetColumnId! : BOOKMARK_UNFILED_ID;
		const trashId = await trashAdd(store.settings, {
			kind: 'column',
			label: columnEntry.name,
			origin: '',
			count: 0,
			data: {
				column: columnEntry,
				index: columnIndex,
				bookmarks: [],
				movedIds: affected.map((bookmark) => bookmark.id),
				movedTo,
			},
		});
		// Moved bookmarks keep their order and go after the target column's own bookmarks.
		for (const bookmark of affected) {
			bookmark.columnId = movedTo;
		}

		const movedIds = new Set(affected.map((bookmark) => bookmark.id));
		store.bookmarks = [
			...store.bookmarks.filter((bookmark) => !movedIds.has(bookmark.id)),
			...affected,
		];
		store.bookmarkColumns = remaining;
		await writeStore(store);
		return {
			ok: true,
			moved: affected.length,
			unfiled: movedTo === BOOKMARK_UNFILED_ID ? affected.length : 0,
			deleted: 0,
			trashId,
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
	return mutate(() =>
		withUndo('Import', [STORAGE_KEY], async () => {
			const store = await getStore();
			const candidates =
				importMode === 'bookmarks' ? [] : importCandidates(input).slice(0, 500);
			const hasBookmarkData =
				importMode !== 'sessions' &&
				(Array.isArray(input?.bookmarks) ||
					Array.isArray(input?.bookmarkColumns));
			if (candidates.length === 0 && !hasBookmarkData) {
				return {
					ok: false,
					error: `Choose a ${APP_NAME} export or a JSON array of tabs.`,
				};
			}

			const incomingItems =
				candidates.reduce<number>(
					(sum, candidate) =>
						sum +
						(isRecord(candidate) && Array.isArray(candidate.tabs)
							? candidate.tabs.length
							: 0),
					0,
				) +
				(hasBookmarkData && Array.isArray(input?.bookmarks)
					? input.bookmarks.length
					: 0);
			if (incomingItems > LARGE_IMPORT_THRESHOLD) {
				await safetyBackup(store, 'Before a large import');
			}

			const folderMap =
				candidates.length > 0
					? mergeImportedFolders(store, input, candidates)
					: new Map<string, string>();
			const existingUrls = new Set<string>();
			const existingRecords = new Map<
				string,
				{group: Session; tab: SavedTab}
			>();
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
			// A TabLodge export ({groups}) keeps its pinned tabs, as backup restore does; the setting only filters other shapes of tab lists.
			const keepPinned =
				store.settings.includePinnedTabs ||
				(isRecord(input) && Array.isArray(input.groups));
			// A session holds at most 1000 links, so a bigger imported one becomes several numbered sessions.
			const parts = candidates.flatMap((candidate) => {
				if (
					!isRecord(candidate) ||
					!Array.isArray(candidate.tabs) ||
					candidate.tabs.length <= MAX_TABS_PER_SESSION
				) {
					return [candidate];
				}

				const count = chunkCount(candidate.tabs.length);
				const base = cleanText(
					candidate.name ?? candidate.title,
					'Saved session',
					100,
				);
				return Array.from({length: count}, (_, part) => ({
					...candidate,
					name: `${base} (${part + 1}/${count})`,
					tabs: (candidate.tabs as unknown[]).slice(
						part * MAX_TABS_PER_SESSION,
						(part + 1) * MAX_TABS_PER_SESSION,
					),
				}));
			});
			for (const candidate of parts) {
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
					keepPinned,
				);
				if (!group) {
					continue;
				}

				// Exports from older builds may carry archived sessions: same rule as the stored-data migration.
				if (
					candidate.archived === true &&
					group.folderId === DEFAULT_FOLDER_ID
				) {
					group.folderId = findOrAddArchivedFolder(store.folders).id;
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
				importMode === 'sessions'
					? ({
							columnsAdded: 0,
							columnsReordered: false,
							bookmarksAdded: 0,
							bookmarksSkipped: 0,
							bookmarksUpdated: 0,
						} satisfies BookmarkMergeResult)
					: await mergeImportedBookmarks(store, input, options);
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

			if (store.groups.length > MAX_SESSIONS) {
				return {ok: false, error: sessionLimitError()};
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
		}),
	);
}

async function updateSettings(
	patch: Partial<Settings>,
): Promise<ActionResult<'UPDATE_SETTINGS'>> {
	return mutate(async () => {
		const store = await getStore();
		const previousSettings = store.settings;
		const requested = {...store.settings, ...patch};
		store.settings = normalizeSettings(requested);
		await writeStore(store);
		if (
			previousSettings.actionMode !== store.settings.actionMode ||
			previousSettings.toolbarOpens !== store.settings.toolbarOpens
		) {
			await syncToolbarAction(store.settings);
		}

		if (
			previousSettings.snapshotsEnabled !== store.settings.snapshotsEnabled ||
			previousSettings.snapshotIntervalMinutes !==
				store.settings.snapshotIntervalMinutes ||
			previousSettings.autoBackup !== store.settings.autoBackup ||
			previousSettings.autoArchiveDays !== store.settings.autoArchiveDays
		) {
			await syncRecoveryAlarms(store.settings);
			if (
				store.settings.snapshotsEnabled &&
				!previousSettings.snapshotsEnabled
			) {
				scheduleSnapshot();
			}
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
	return mutate(() =>
		withUndo('Restore default settings', [STORAGE_KEY], async () => {
			const store = await getStore();
			store.settings = normalizeSettings({...DEFAULT_SETTINGS});
			await writeStore(store);
			await syncRecoveryAlarms(store.settings);
			await syncToolbarAction(store.settings);
			await rebuildContextMenus(store);
			return {ok: true, settings: store.settings};
		}),
	);
}

async function eraseData(
	scope: EraseScope,
): Promise<ActionResult<'ERASE_DATA'>> {
	if (!isOneOf(['sessions', 'bookmarks', 'all'], scope)) {
		return {ok: false, error: `Choose which ${APP_NAME} data to erase.`};
	}

	return mutate(() =>
		withUndo('Erase data', [STORAGE_KEY], async () => {
			const store = await getStore();
			const fresh = normalizeStore(null);
			const eraseSessions = scope !== 'bookmarks';
			const eraseBookmarks = scope !== 'sessions';
			const sessions = eraseSessions ? store.groups.length : 0;
			const bookmarks = eraseBookmarks ? store.bookmarks.length : 0;
			if (
				sessions + bookmarks > 0 &&
				!(await safetyBackup(store, 'Before erasing data'))
			) {
				return {
					ok: false,
					error: 'Could not take a safety backup first. Nothing was erased.',
				};
			}

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
		}),
	);
}

// New tab hand-off: with "Use TabLodge for new tabs" off the override page cannot be uninstalled, so tabs the
// browser opens as new tabs are sent straight on to the browser's own page (or a blank / custom page).
const NEW_TAB_URL = /^(?:chrome|brave|edge):\/\/(?:newtab|new-tab-page)\/?$/;
const CLAIMS_KEY = 'newTabClaims';

async function readClaims(): Promise<Record<string, number>> {
	try {
		const stored = await chrome.storage.session?.get(CLAIMS_KEY);
		return (stored?.[CLAIMS_KEY] as Record<string, number> | undefined) ?? {};
	} catch {
		return {};
	}
}

async function writeClaims(claims: Record<string, number>): Promise<void> {
	try {
		await chrome.storage.session?.set({[CLAIMS_KEY]: claims});
	} catch {}
}

/**
Where a new tab goes while TabLodge's new tab is off. After one failed attempt (the browser sent the tab back
to TabLodge) it falls back to a blank page, so a tab can never loop.
*/
function newTabTarget(
	settings: Pick<Settings, 'newTabFallback' | 'newTabFallbackUrl'>,
	attempt: number,
	brave: boolean,
): string {
	if (attempt > 1 || settings.newTabFallback === 'blank') {
		return 'about:blank';
	}

	if (settings.newTabFallback === 'custom' && settings.newTabFallbackUrl) {
		return settings.newTabFallbackUrl;
	}

	return brave ? 'brave://newtab/' : 'chrome://new-tab-page/';
}

const looksLikeBrave = () => {
	const brands = (
		globalThis as {
			navigator?: {userAgentData?: {brands?: Array<{brand: string}>}};
		}
	).navigator?.userAgentData?.brands;
	return Boolean(brands?.some((entry) => /brave/i.test(entry.brand)));
};

async function handOffNewTab(
	tabId: number,
	brave: boolean,
	claim: boolean,
): Promise<boolean> {
	const settings = await readSettings();
	if (settings.newTabEnabled) {
		return false;
	}

	// `claims` counts the redirects already made for a tab; a tab the browser sends back gets a blank page.
	const claims = await readClaims();
	const done = claims[tabId];
	if ((done === undefined && !claim) || (done ?? 0) >= 3) {
		return false;
	}

	claims[tabId] = (done ?? 0) + 1;
	await writeClaims(claims);
	try {
		await chrome.tabs.update(tabId, {
			url: newTabTarget(settings, done ?? 0, brave || looksLikeBrave()),
		});
		return true;
	} catch {
		return false;
	}
}

chrome.tabs.onCreated?.addListener((tab) => {
	if (isInteger(tab.id) && NEW_TAB_URL.test(tab.pendingUrl || tab.url || '')) {
		void handOffNewTab(tab.id, false, true);
	}
});
chrome.tabs.onRemoved?.addListener((tabId) => {
	void readClaims().then((claims) => {
		const {[String(tabId)]: gone, ...rest} = claims;
		return gone === undefined ? undefined : writeClaims(rest);
	});
});

// Recovery: crash snapshots, automatic and safety backups, trash. Everything stays in chrome.storage.local.
// Storage keys (all separate from `tablodge.state`, so the big state is never rewritten for them):
//   tablodge.snapshots       { version, history: Snapshot[] }  rotated at the interval, newest first
//   tablodge.snapshots.live  Snapshot                          the latest capture, rewritten on (debounced) tab events
//   tablodge.snapshots.meta  { sessionOpen, liveAt, liveSig, closing, recovery }  the small crash-detection flags
//   tablodge.backups         { auto, safety, downloadError, lastAutoCheckAt } full JSON exports (auto/manual ring, safety ring)
//   tablodge.trash           { items }                         deleted sessions, links, bookmarks, columns, folders
const SNAPSHOTS_KEY = 'tablodge.snapshots';
const SNAPSHOT_LIVE_KEY = 'tablodge.snapshots.live';
const SNAPSHOT_META_KEY = 'tablodge.snapshots.meta';
const BACKUPS_KEY = 'tablodge.backups';
const TRASH_KEY = 'tablodge.trash';
const SNAPSHOT_DEBOUNCE_MS = 5000;
const SNAPSHOT_MAX_WAIT_MS = 30_000;
// Serialized characters across the whole history; the oldest snapshots go first.
const SNAPSHOT_MAX_CHARS = 24_000_000;
const MIN_RECOVERY_TABS = 2;
// If the browser already reopened this share of the snapshot's tabs, there is nothing left to recover.
const ALREADY_OPEN_RATIO = 0.8;
const ALARM_SNAPSHOT = 'tablodge-snapshot';
const ALARM_BACKUP = 'tablodge-backup';
const ALARM_TRASH = 'tablodge-trash';
const ALARM_ARCHIVE = 'tablodge-archive';
// Mirrors BACKUP_FORMAT_ID and BACKUP_VERSION in src/app/backup-format.ts (the worker cannot import).
const BACKUP_FORMAT_ID = 'tablodge-backup';
const BACKUP_VERSION = 1;
const SAFETY_BACKUP_KEEP = 5;
const BACKUP_MAX_CHARS = 40_000_000;
// Chrome refuses URLs longer than 2 MB, which also limits data: URLs handed to downloads.download.
const DOWNLOAD_MAX_URL_CHARS = 2_000_000;
const TRASH_MAX_ITEMS = 500;
// The whole trash is one storage value rewritten on every delete, so it also has a size cap (serialized characters of the item data).
const TRASH_MAX_CHARS = 8_000_000;
const BULK_DELETE_THRESHOLD = 10;
const LARGE_IMPORT_THRESHOLD = 50;
const DAY_MS = 86_400_000;

type SnapshotTab = import('../src/app/types').SnapshotTab;
type SnapshotGroup = import('../src/app/types').SnapshotGroup;
type SnapshotWindow = import('../src/app/types').SnapshotWindow;
type SnapshotReason = import('../src/app/types').SnapshotReason;
type Snapshot = import('../src/app/types').Snapshot;
type SnapshotSummary = import('../src/app/types').SnapshotSummary;
type RecoveryInfo = import('../src/app/types').RecoveryInfo;
type BackupKind = import('../src/app/types').BackupKind;
type BackupSummary = import('../src/app/types').BackupSummary;
type TrashKind = import('../src/app/types').TrashKind;
type TrashSummary = import('../src/app/types').TrashSummary;
type StorageUsage = import('../src/app/types').StorageUsage;

/**
A small FIFO runner: each operation starts after the previous one settled, so read-modify-write cycles on one storage key never interleave.
*/
function serialQueue() {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(operation: () => Promise<T>): Promise<T> => {
		const result = tail.then(operation, operation);
		tail = result.catch(() => undefined);
		return result;
	};
}

const snapshotMutate = serialQueue();
const backupMutate = serialQueue();
const trashMutate = serialQueue();

/**
A short non-cryptographic hash (cyrb53) used to spot a snapshot or backup identical to the previous one.
*/
/* eslint-disable no-bitwise -- a hash is bit arithmetic */
function hashText(text: string): string {
	let h1 = 0xde_ad_be_ef ^ text.length;
	let h2 = 0x41_c6_ce_57 ^ text.length;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.codePointAt(index)!;
		h1 = Math.imul(h1 ^ code, 2_654_435_761);
		h2 = Math.imul(h2 ^ code, 1_597_334_677);
	}

	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
	return (
		(4_294_967_296 * (2_097_151 & h2) + (h1 >>> 0)).toString(36) +
		text.length.toString(36)
	);
}

/* eslint-enable no-bitwise */

const pad2 = (value: number) => String(value).padStart(2, '0');
const localDate = (time: number) => {
	const date = new Date(time);
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const localDateTime = (time: number) => {
	const date = new Date(time);
	return `${localDate(time)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

async function readKey<T>(key: string): Promise<T | undefined> {
	const saved = await chrome.storage.local.get<Record<string, T | undefined>>([
		key,
	]);
	return saved[key];
}

/**
In-memory copy of the normalized settings. Safe to lose (a worker restart just re-reads) and dropped on every
change of `tablodge.state`, whoever wrote it. Callers must treat the result as read-only.
*/
let settingsCache: Settings | undefined;
let settingsGeneration = 0;
function invalidateSettings() {
	settingsCache = undefined;
	settingsGeneration += 1;
}

chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
	if (areaName === 'local' && changes[STORAGE_KEY] !== undefined) {
		invalidateSettings();
	}
});

/**
Settings without touching the big state (no normalization of sessions, no writes).
*/
async function readSettings(): Promise<Settings> {
	if (settingsCache) {
		return settingsCache;
	}

	const generation = settingsGeneration;
	const saved = await chrome.storage.local.get<Record<string, Raw | undefined>>(
		[STORAGE_KEY],
	);
	if (saved[STORAGE_KEY]?.schemaVersion === SCHEMA_VERSION) {
		migrationChecked = true;
	}

	const settings = normalizeSettings(
		saved[STORAGE_KEY]?.settings as RawSettings | undefined,
	);
	// A change that landed while this read was in flight makes its result possibly stale: use it once, do not keep it.
	if (generation === settingsGeneration) {
		settingsCache = settings;
	}

	return settings;
}

type SnapshotMeta = {
	/**
	True from the first capture of a run until the last window closes; still true at startup means no clean exit.
	*/
	sessionOpen: boolean;
	liveAt: number;
	/**
	Content hash of the stored live snapshot, so a capture can tell whether it changed without reading that (large) record. Empty when unknown.
	*/
	liveSig: string;
	/**
	The latest window close and how many normal windows were left, to recognize a shutdown in progress.
	*/
	closing: {at: number; remaining: number} | null;
	recovery: {snapshotId: string; detectedAt: number} | null;
};

const isSnapshot = (value: unknown): value is Snapshot =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	Array.isArray(value.windows) &&
	Number.isFinite(Number(value.at));

async function readSnapshotHistory(): Promise<Snapshot[]> {
	const raw = await readKey<Raw>(SNAPSHOTS_KEY);
	return Array.isArray(raw?.history) ? raw.history.filter(isSnapshot) : [];
}

async function writeSnapshotHistory(history: Snapshot[]) {
	await chrome.storage.local.set({[SNAPSHOTS_KEY]: {version: 1, history}});
}

async function readSnapshotMeta(): Promise<SnapshotMeta> {
	const raw = await readKey<Raw>(SNAPSHOT_META_KEY);
	const closing = isRecord(raw?.closing) ? raw.closing : null;
	const recovery = isRecord(raw?.recovery) ? raw.recovery : null;
	return {
		sessionOpen: raw?.sessionOpen === true,
		liveAt: Number(raw?.liveAt) || 0,
		liveSig: typeof raw?.liveSig === 'string' ? raw.liveSig : '',
		closing: closing
			? {at: Number(closing.at) || 0, remaining: Number(closing.remaining) || 0}
			: null,
		recovery:
			recovery && typeof recovery.snapshotId === 'string'
				? {
						snapshotId: recovery.snapshotId,
						detectedAt: Number(recovery.detectedAt) || 0,
					}
				: null,
	};
}

async function writeSnapshotMeta(meta: SnapshotMeta) {
	await chrome.storage.local.set({[SNAPSHOT_META_KEY]: meta});
}

async function readLiveSnapshot(): Promise<Snapshot | null> {
	const raw = await readKey<unknown>(SNAPSHOT_LIVE_KEY);
	return isSnapshot(raw) ? raw : null;
}

/**
The open normal windows as a snapshot: web tabs only (TabLodge's own pages and browser pages are left out),
honoring excluded sites, with pinned state, tab groups, split view pairs, the active tab and the focused window.
*/
async function captureSnapshotWindows(
	settings: Settings,
): Promise<SnapshotWindow[]> {
	let windows: chrome.windows.Window[];
	try {
		windows = await chrome.windows.getAll({
			populate: true,
			windowTypes: ['normal'],
		});
	} catch {
		return [];
	}

	const groupInfo = new Map<number, SnapshotGroup>();
	try {
		for (const group of await chrome.tabGroups.query({})) {
			groupInfo.set(group.id, {
				title: cleanText(group.title, '', 100),
				color: isGroupColor(group.color) ? group.color : 'grey',
				collapsed: Boolean(group.collapsed),
			});
		}
	} catch {
		/*
		Tab groups are optional.
		*/
	}

	const result: SnapshotWindow[] = [];
	for (const win of windows) {
		if (win.incognito || !Array.isArray(win.tabs)) {
			continue;
		}

		const groups: SnapshotGroup[] = [];
		const groupIndex = new Map<number, number>();
		const splitSlots = new Map<number, number[]>();
		const tabs: SnapshotTab[] = [];
		for (const tab of win.tabs.toSorted((a, b) => a.index - b.index)) {
			const url = normalizeUrl(tab.url || tab.pendingUrl);
			if (!url || !isCapturable({url} as chrome.tabs.Tab, settings)) {
				continue;
			}

			const entry: SnapshotTab = {
				url,
				title: pageTitle(tab.title, url, settings.cleanTitles, 200),
			};
			if (tab.pinned) {
				entry.pinned = true;
			}

			if (tab.active) {
				entry.active = true;
			}

			if (
				!settings.ignoreTabGroups &&
				!tab.pinned &&
				isInteger(tab.groupId) &&
				tab.groupId >= 0
			) {
				let index = groupIndex.get(tab.groupId);
				const info = groupInfo.get(tab.groupId);
				if (index === undefined && info) {
					groups.push(info);
					index = groups.length - 1;
					groupIndex.set(tab.groupId, index);
				}

				if (index !== undefined) {
					entry.group = index;
				}
			}

			const splitView = splitViewOf(tab);
			if (splitView !== null) {
				splitSlots.set(splitView, [
					...(splitSlots.get(splitView) ?? []),
					tabs.length,
				]);
			}

			tabs.push(entry);
		}

		// A split pair is kept only when both halves made it into the snapshot, side by side.
		for (const [splitView, slots] of splitSlots) {
			if (!(slots.length === 2 && slots[1] === slots[0] + 1)) {
				continue;
			}

			tabs[slots[0]].split = {id: String(splitView), position: 0};
			tabs[slots[1]].split = {id: String(splitView), position: 1};
		}

		if (tabs.length > 0) {
			result.push({
				focused: Boolean(win.focused),
				state: typeof win.state === 'string' ? win.state : 'normal',
				groups,
				tabs,
			});
		}
	}

	return result;
}

const countTabs = (windows: readonly SnapshotWindow[]) =>
	windows.reduce((sum, win) => sum + win.tabs.length, 0);

function summarizeSnapshot(snapshot: Snapshot): SnapshotSummary {
	return {
		id: snapshot.id,
		at: Number(snapshot.at),
		reason: snapshot.reason,
		tabs: countTabs(snapshot.windows),
		windows: snapshot.windows.map((win) => ({
			tabs: win.tabs.length,
			pinned: win.tabs.filter((tab) => tab.pinned).length,
			groups: win.groups.length,
			focused: Boolean(win.focused),
			titles: win.tabs.slice(0, 3).map((tab) => tab.title),
		})),
	};
}

function newSnapshot(
	windows: SnapshotWindow[],
	reason: SnapshotReason,
): Snapshot {
	const text = JSON.stringify(windows);
	return {
		id: makeId(),
		at: Date.now(),
		reason,
		sig: hashText(text),
		size: text.length,
		windows,
	};
}

/**
Newest first, at most `keep` entries, and no more than SNAPSHOT_MAX_CHARS in total (the newest always stays).
*/
function trimHistory(history: Snapshot[], keep: number): Snapshot[] {
	const result: Snapshot[] = [];
	let total = 0;
	for (const snapshot of history.slice(0, keep)) {
		total += Number(snapshot.size) || 0;
		if (result.length > 0 && total > SNAPSHOT_MAX_CHARS) {
			break;
		}

		result.push(snapshot);
	}

	return result;
}

/**
Captures the open windows. The result replaces the live snapshot when it changed; with `rotate` it also joins
the history (unless identical to the newest entry there). Never overwrites a snapshot with an empty one.
*/
function takeSnapshot(
	reason: SnapshotReason,
	rotate: boolean,
	force = false,
): Promise<Snapshot | null> {
	return snapshotMutate(async () => {
		const settings = await readSettings();
		if (!settings.snapshotsEnabled && !force) {
			return null;
		}

		const windows = await captureSnapshotWindows(settings);
		if (windows.length === 0) {
			return null;
		}

		const snapshot = newSnapshot(windows, reason);
		const meta = await readSnapshotMeta();
		// Metas written before liveSig existed fall back to reading the live record once.
		const liveSig = meta.liveSig || (await readLiveSnapshot())?.sig;
		if (liveSig !== snapshot.sig) {
			await chrome.storage.local.set({[SNAPSHOT_LIVE_KEY]: snapshot});
		}

		meta.liveSig = snapshot.sig;
		meta.sessionOpen = true;
		meta.liveAt = Date.now();
		meta.closing = null;
		await writeSnapshotMeta(meta);
		if (rotate) {
			const history = await readSnapshotHistory();
			if (history[0]?.sig !== snapshot.sig) {
				await writeSnapshotHistory(
					trimHistory([snapshot, ...history], settings.snapshotKeep),
				);
			}
		}

		return snapshot;
	});
}

let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
let snapshotFirstEventAt = 0;
/**
Debounced capture for tab and window events: waits SNAPSHOT_DEBOUNCE_MS after the last event, but never longer than SNAPSHOT_MAX_WAIT_MS after the first.
*/
function scheduleSnapshot() {
	// Snapshots off (as far as the cached settings know): skip the timer; turning them on schedules one itself.
	if (settingsCache && !settingsCache.snapshotsEnabled) {
		return;
	}

	const now = Date.now();
	if (snapshotTimer === undefined) {
		snapshotFirstEventAt = now;
	} else {
		clearTimeout(snapshotTimer);
	}

	const delay = Math.max(
		0,
		Math.min(
			SNAPSHOT_DEBOUNCE_MS,
			snapshotFirstEventAt + SNAPSHOT_MAX_WAIT_MS - now,
		),
	);
	snapshotTimer = setTimeout(() => {
		snapshotTimer = undefined;
		void takeSnapshot('interval', false).catch(() => undefined);
	}, delay);
}

/**
Adds the live snapshot to the history (unless it is already there) under the given reason.
*/
async function rotateLiveIntoHistory(
	reason: SnapshotReason,
	keep: number,
): Promise<Snapshot | null> {
	const live = await readLiveSnapshot();
	if (!live) {
		return null;
	}

	const history = await readSnapshotHistory();
	if (history[0]?.sig === live.sig) {
		if (reason === 'crash' && history[0].reason !== 'crash') {
			history[0] = {...history[0], reason};
			await writeSnapshotHistory(history);
		}

		return history[0];
	}

	const entry: Snapshot = {...live, id: makeId(), reason};
	await writeSnapshotHistory(trimHistory([entry, ...history], keep));
	return entry;
}

/**
Crash detection, run once per browser start. MV3 has no shutdown event, so a clean exit is inferred:
the previous run counts as ended cleanly when the last normal window was closed (windows.onRemoved saw it), or
when windows were being closed down to one and nothing was captured after that. Anything else, a run that was
still "open", is treated as a crash or a forced quit. The previous run's final snapshot moves into the history
and, with at least MIN_RECOVERY_TABS tabs, becomes the pending recovery offered on the dashboard.
*/
function evaluateStartup(): Promise<void> {
	return snapshotMutate(async () => {
		const settings = await readSettings();
		if (!settings.snapshotsEnabled) {
			return;
		}

		const meta = await readSnapshotMeta();
		const live = await readLiveSnapshot();
		const shuttingDown = Boolean(
			meta.closing &&
			meta.closing.at >= meta.liveAt &&
			meta.closing.remaining <= 1,
		);
		const crashed = meta.sessionOpen && !shuttingDown;
		if (live) {
			const entry = await rotateLiveIntoHistory(
				crashed ? 'crash' : 'exit',
				settings.snapshotKeep,
			);
			meta.recovery =
				crashed && entry && countTabs(entry.windows) >= MIN_RECOVERY_TABS
					? {snapshotId: entry.id, detectedAt: Date.now()}
					: null;
		} else {
			meta.recovery = null;
		}

		// A run that starts without a window (background mode) is not "open" yet: the first snapshot taken once a window appears marks it.
		let hasWindow = true;
		try {
			hasWindow = (await chrome.windows.getAll({windowTypes: ['normal']})).some(
				(win) => !win.incognito,
			);
		} catch {
			/*
			Without window info, assume one exists (the old behavior).
			*/
		}

		meta.sessionOpen = hasWindow;
		meta.closing = null;
		await writeSnapshotMeta(meta);
	});
}

/**
The last normal window closed: that is the clean-exit signal. The live snapshot (the state before closing) joins the history.
*/
function handleWindowRemoved() {
	return snapshotMutate(async () => {
		const settings = await readSettings();
		if (!settings.snapshotsEnabled) {
			return;
		}

		let remaining: number;
		try {
			remaining = (
				await chrome.windows.getAll({windowTypes: ['normal']})
			).filter((win) => !win.incognito).length;
		} catch {
			return;
		}

		const meta = await readSnapshotMeta();
		if (remaining > 0) {
			meta.closing = {at: Date.now(), remaining};
			await writeSnapshotMeta(meta);
			scheduleSnapshot();
			return;
		}

		meta.sessionOpen = false;
		meta.closing = null;
		await writeSnapshotMeta(meta);
		await rotateLiveIntoHistory('exit', settings.snapshotKeep);
	});
}

async function openUrlSet(): Promise<Set<string>> {
	const urls = new Set<string>();
	try {
		for (const tab of await chrome.tabs.query({})) {
			const url = normalizeUrl(tab.url);
			if (url) {
				urls.add(url);
			}
		}
	} catch {
		/*
		Treated as nothing open.
		*/
	}

	return urls;
}

async function getSnapshots(): Promise<ActionResult<'GET_SNAPSHOTS'>> {
	return snapshotMutate(async () => {
		const settings = await readSettings();
		const history = await readSnapshotHistory();
		const live = await readLiveSnapshot();
		const meta = await readSnapshotMeta();
		let recovery: RecoveryInfo | null = null;
		const pending = meta.recovery
			? history.find((entry) => entry.id === meta.recovery!.snapshotId)
			: undefined;
		if (meta.recovery && !pending) {
			meta.recovery = null;
			await writeSnapshotMeta(meta);
		}

		if (meta.recovery && pending) {
			const open = await openUrlSet();
			const urls = pending.windows.flatMap((win) =>
				win.tabs.map((tab) => tab.url),
			);
			const already = urls.filter((url) => open.has(url)).length;
			if (urls.length > 0 && already / urls.length >= ALREADY_OPEN_RATIO) {
				// The browser reopened the session itself.
				meta.recovery = null;
				await writeSnapshotMeta(meta);
			} else {
				recovery = {
					snapshotId: pending.id,
					at: Number(pending.at),
					windows: pending.windows.length,
					tabs: countTabs(pending.windows),
				};
			}
		}

		return {
			ok: true,
			enabled: settings.snapshotsEnabled,
			snapshots: history.map((entry) => summarizeSnapshot(entry)),
			live: live ? summarizeSnapshot(live) : null,
			recovery,
		};
	});
}

/**
A snapshot window as saved-tab records, so the regular restore code (groups, pinned, split view) can reopen it.
*/
function snapshotRecords(win: SnapshotWindow, stamp: number): SavedTab[] {
	return win.tabs.map((tab, index) => {
		const group =
			tab.group === undefined || tab.pinned ? undefined : win.groups[tab.group];
		return {
			id: makeId(),
			title: tab.title,
			url: tab.url,
			notes: '',
			pinned: Boolean(tab.pinned),
			nativeGroup: group
				? {
						key: `snapshot-${tab.group}`,
						title: group.title,
						color: group.color,
						collapsed: group.collapsed,
					}
				: null,
			savedAt: stamp,
			originalIndex: index,
			...(tab.split && {split: {...tab.split}}),
		};
	});
}

function pickSnapshotWindows(
	snapshot: Snapshot,
	windowIndex: number | undefined,
): SnapshotWindow[] | null {
	if (windowIndex === undefined) {
		return snapshot.windows;
	}

	const win = isInteger(windowIndex)
		? snapshot.windows[windowIndex]
		: undefined;
	return win ? [win] : null;
}

async function findSnapshot(id: string): Promise<Snapshot | null> {
	return id === 'live'
		? readLiveSnapshot()
		: ((await readSnapshotHistory()).find((entry) => entry.id === id) ?? null);
}

async function restoreSnapshot(
	id: string,
	windowIndex?: number,
): Promise<ActionResult<'RESTORE_SNAPSHOT'>> {
	const store = await getStore();
	const snapshot = await findSnapshot(id);
	if (!snapshot) {
		return {ok: false, error: 'That snapshot no longer exists.'};
	}

	const windows = pickSnapshotWindows(snapshot, windowIndex);
	if (!windows) {
		return {ok: false, error: 'That window is not in the snapshot.'};
	}

	// Snapshot windows may repeat a URL, so duplicates open; restores always go to new windows.
	const settings: Settings = {
		...store.settings,
		restoreDuplicateHandling: 'open',
	};
	let count = 0;
	let failed = 0;
	let restoredWindows = 0;
	let focusId: number | null = null;
	const tabIds: number[] = [];
	for (const win of windows) {
		const records = snapshotRecords(win, Date.now());
		const activeIndex = win.tabs.findIndex((tab) => tab.active);
		const target = await createRestoreWindow();
		const result = await restoreRecords(records, settings, undefined, {
			target,
			activeSavedId: records[Math.max(0, activeIndex)]?.id,
		});
		count += result.opened.length;
		failed += result.failures.length;
		for (const {tabId} of result.opened) {
			if (isInteger(tabId)) {
				tabIds.push(tabId);
			}
		}

		if (result.opened.length === 0) {
			// Nothing opened: drop the empty window that was created for it.
			if (isInteger(target.id)) {
				await chrome.windows.remove?.(target.id).catch(() => undefined);
			}

			continue;
		}

		restoredWindows += 1;
		if (win.state === 'maximized' && isInteger(target.id)) {
			await chrome.windows
				.update(target.id, {state: 'maximized'})
				.catch(() => undefined);
		}

		if (win.focused || focusId === null) {
			focusId = target.id ?? focusId;
		}
	}

	if (restoredWindows === 0) {
		return {ok: false, error: 'No tabs in that snapshot could be opened.'};
	}

	if (focusId !== null) {
		await chrome.windows
			.update(focusId, {focused: true})
			.catch(() => undefined);
	}

	if (windowIndex === undefined) {
		await snapshotMutate(async () => {
			const meta = await readSnapshotMeta();
			if (meta.recovery?.snapshotId !== id) {
				return;
			}

			meta.recovery = null;
			await writeSnapshotMeta(meta);
		});
	}

	return {ok: true, windows: restoredWindows, count, failed, tabIds};
}

async function saveSnapshotAsSession(
	id: string,
	windowIndex?: number,
): Promise<ActionResult<'SAVE_SNAPSHOT_AS_SESSION'>> {
	return mutate(async () => {
		const store = await getStore();
		const snapshot = await findSnapshot(id);
		if (!snapshot) {
			return {ok: false, error: 'That snapshot no longer exists.'};
		}

		const windows = pickSnapshotWindows(snapshot, windowIndex);
		if (!windows) {
			return {ok: false, error: 'That window is not in the snapshot.'};
		}

		const stamp = Date.now();
		const created: Session[] = [];
		for (const [offset, win] of windows.entries()) {
			const number_ = (windowIndex ?? offset) + 1;
			const records = snapshotRecords(win, stamp);
			// A stored session holds at most 1000 tabs, so a huge window becomes several sessions.
			for (
				let start = 0;
				start < records.length;
				start += MAX_TABS_PER_SESSION
			) {
				const part = Math.floor(start / MAX_TABS_PER_SESSION) + 1;
				const parts = chunkCount(records.length);
				const group = normalizeGroup(
					{
						id: makeId(),
						name: `Snapshot ${localDateTime(Number(snapshot.at))} · window ${number_}${parts > 1 ? ` (${part}/${parts})` : ''}`,
						folderId: DEFAULT_FOLDER_ID,
						createdAt: stamp,
						updatedAt: stamp,
						tabs: records.slice(start, start + MAX_TABS_PER_SESSION),
					},
					stamp,
					true,
				);
				if (group) {
					created.push(group);
				}
			}
		}

		if (created.length === 0) {
			return {ok: false, error: 'That snapshot has no tabs to save.'};
		}

		if (store.groups.length + created.length > MAX_SESSIONS) {
			return {ok: false, error: sessionLimitError()};
		}

		store.groups = [...created, ...store.groups];
		await writeStore(store);
		return {
			ok: true,
			groups: created.length,
			count: created.reduce((sum, group) => sum + group.tabs.length, 0),
		};
	});
}

function deleteSnapshot(id: string): Promise<ActionResult<'DELETE_SNAPSHOT'>> {
	return snapshotMutate(() =>
		withUndo('Delete snapshot', [SNAPSHOTS_KEY], async () => {
			const history = await readSnapshotHistory();
			const next = history.filter((entry) => entry.id !== id);
			if (next.length === history.length) {
				return {ok: false, error: 'That snapshot no longer exists.'};
			}

			await writeSnapshotHistory(next);
			const meta = await readSnapshotMeta();
			if (meta.recovery?.snapshotId === id) {
				meta.recovery = null;
				await writeSnapshotMeta(meta);
			}

			return {ok: true};
		}),
	);
}

function clearSnapshots(): Promise<ActionResult<'CLEAR_SNAPSHOTS'>> {
	return snapshotMutate(() =>
		withUndo('Clear snapshots', [SNAPSHOTS_KEY], async () => {
			const history = await readSnapshotHistory();
			await writeSnapshotHistory([]);
			await chrome.storage.local.remove?.(SNAPSHOT_LIVE_KEY);
			const meta = await readSnapshotMeta();
			meta.liveSig = '';
			meta.recovery = null;
			await writeSnapshotMeta(meta);
			return {ok: true, count: history.length};
		}),
	);
}

function dismissRecovery(): Promise<ActionResult<'DISMISS_RECOVERY'>> {
	return snapshotMutate(async () => {
		const meta = await readSnapshotMeta();
		if (meta.recovery) {
			meta.recovery = null;
			await writeSnapshotMeta(meta);
		}

		return {ok: true};
	});
}

type BackupRecord = BackupSummary & {sig: string; json: string};
type BackupStore = {
	auto: BackupRecord[];
	safety: BackupRecord[];
	downloadError: string;
	/**
	When the last scheduled backup ran, including runs that skipped unchanged data, so a quiet profile is not "due" on every start.
	*/
	lastAutoCheckAt: number;
};
// Manual ("Back up now") backups have their own cap, so they never push scheduled ones out of the list.
const MANUAL_BACKUP_KEEP = 10;

const isBackupRecord = (value: unknown): value is BackupRecord =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.json === 'string';

async function readBackups(): Promise<BackupStore> {
	const raw = await readKey<Raw>(BACKUPS_KEY);
	return {
		auto: Array.isArray(raw?.auto) ? raw.auto.filter(isBackupRecord) : [],
		safety: Array.isArray(raw?.safety) ? raw.safety.filter(isBackupRecord) : [],
		downloadError:
			typeof raw?.downloadError === 'string' ? raw.downloadError : '',
		lastAutoCheckAt: isInteger(raw?.lastAutoCheckAt) ? raw.lastAutoCheckAt : 0,
	};
}

async function writeBackups(backups: BackupStore) {
	await chrome.storage.local.set({[BACKUPS_KEY]: {version: 1, ...backups}});
}

const summarizeBackup = (record: BackupRecord): BackupSummary => ({
	id: record.id,
	at: Number(record.at),
	kind: record.kind,
	reason: record.reason,
	sessions: record.sessions,
	tabs: record.tabs,
	bookmarks: record.bookmarks,
	bytes: record.bytes,
});

/**
The regular JSON export (same shape as the Back up dialog, so Import reads it), with sessions, bookmarks and settings in one file.
*/
function backupJson(store: Store, at: number): string {
	return JSON.stringify({
		format: BACKUP_FORMAT_ID,
		version: BACKUP_VERSION,
		exportedAt: new Date(at).toISOString(),
		folders: store.folders,
		groups: store.groups,
		bookmarkColumns: store.bookmarkColumns,
		bookmarks: store.bookmarks,
		settings: store.settings,
	});
}

const dataSignature = (store: Store) =>
	hashText(
		JSON.stringify([
			store.groups,
			store.folders,
			store.bookmarkColumns,
			store.bookmarks,
		]),
	);

const storeIsEmpty = (store: Store) =>
	store.groups.length === 0 && store.bookmarks.length === 0;

function trimBackups(records: BackupRecord[], keep: number): BackupRecord[] {
	const result: BackupRecord[] = [];
	let total = 0;
	for (const record of records.slice(0, keep)) {
		total += record.bytes;
		if (result.length > 0 && total > BACKUP_MAX_CHARS) {
			break;
		}

		result.push(record);
	}

	return result;
}

function makeBackupRecord(
	store: Store,
	kind: BackupKind,
	reason: string,
): BackupRecord {
	const at = Date.now();
	const json = backupJson(store, at);
	return {
		id: makeId(),
		at,
		kind,
		reason,
		sessions: store.groups.length,
		tabs: store.groups.reduce((sum, group) => sum + group.tabs.length, 0),
		bookmarks: store.bookmarks.length,
		bytes: json.length,
		sig: dataSignature(store),
		json,
	};
}

function utf8Base64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (let index = 0; index < bytes.length; index += 0x80_00) {
		binary += String.fromCodePoint(...bytes.subarray(index, index + 0x80_00));
	}

	// eslint-disable-next-line no-restricted-globals -- Uint8Array.prototype.toBase64 is not available in Chromium yet
	return btoa(binary);
}

/**
Writes a backup to Downloads/TabLodge (a data: URL, since a service worker has no Blob URLs). Returns an error text, or '' on success.
*/
async function downloadBackupCopy(record: BackupRecord): Promise<string> {
	try {
		const granted = await chrome.permissions?.contains?.({
			permissions: ['downloads'],
		});
		if (!granted || !chrome.downloads?.download) {
			return 'The Downloads permission was not granted.';
		}

		const url = `data:application/json;base64,${utf8Base64(record.json)}`;
		if (url.length > DOWNLOAD_MAX_URL_CHARS) {
			return 'This backup is too large for a Downloads copy. Use Download in the backup list instead.';
		}

		await chrome.downloads.download({
			url,
			filename: `${APP_NAME}/${backupFileName(record.at)}`,
			conflictAction: 'uniquify',
			saveAs: false,
		});
		return '';
	} catch (error) {
		return cleanText(errorMessage(error), 'The download failed.', 200);
	}
}

const backupFileName = (at: number) =>
	`${APP_NAME.toLowerCase().replaceAll(/[^0-9a-z]+/g, '-')}-backup-${localDate(at)}.json`;

/**
Stores an automatic or manual backup of `store` and, when enabled, a Downloads copy. Automatic runs skip data identical to the newest backup.
*/
function addBackup(
	store: Store,
	kind: 'auto' | 'manual',
	force: boolean,
): Promise<BackupRecord | null> {
	return backupMutate(async () => {
		const backups = await readBackups();
		if (kind === 'auto') {
			backups.lastAutoCheckAt = Date.now();
		}

		if (
			!force &&
			(storeIsEmpty(store) || backups.auto[0]?.sig === dataSignature(store))
		) {
			if (kind === 'auto') {
				await writeBackups(backups);
			}

			return null;
		}

		const record = makeBackupRecord(store, kind, '');
		const scheduled = trimBackups(
			[record, ...backups.auto].filter((item) => item.kind === 'auto'),
			store.settings.autoBackupKeep,
		);
		const manual = trimBackups(
			[record, ...backups.auto].filter((item) => item.kind !== 'auto'),
			MANUAL_BACKUP_KEEP,
		);
		backups.auto = [...scheduled, ...manual].toSorted(
			(a, b) => Number(b.at) - Number(a.at),
		);
		// The record is stored first, so a failed or slow Downloads copy cannot lose it.
		await writeBackups(backups);
		if (store.settings.autoBackupToDownloads) {
			backups.downloadError = await downloadBackupCopy(record);
			await writeBackups(backups);
		}

		return record;
	});
}

/**
A backup taken just before something destructive (erase, large import, bulk delete); a small separate ring of SAFETY_BACKUP_KEEP.
Returns false when it could not be written, so the caller can stop before losing data.
*/
async function safetyBackup(store: Store, reason: string): Promise<boolean> {
	if (storeIsEmpty(store)) {
		return true;
	}

	try {
		await backupMutate(async () => {
			const backups = await readBackups();
			backups.safety = trimBackups(
				[makeBackupRecord(store, 'safety', reason), ...backups.safety],
				SAFETY_BACKUP_KEEP,
			);
			await writeBackups(backups);
		});
		return true;
	} catch {
		return false;
	}
}

async function getBackups(): Promise<ActionResult<'GET_BACKUPS'>> {
	const backups = await readBackups();
	return {
		ok: true,
		auto: backups.auto.map((record) => summarizeBackup(record)),
		safety: backups.safety.map((record) => summarizeBackup(record)),
		downloadError: backups.downloadError,
	};
}

function backupNow(): Promise<ActionResult<'BACKUP_NOW'>> {
	return mutate(async () => {
		const store = await getStore();
		const record = await addBackup(store, 'manual', true);
		return {ok: true, backup: summarizeBackup(record!)};
	});
}

/**
The alarm (or a startup catch-up): back up unless nothing changed since the last backup.
*/
function runScheduledBackup(): Promise<void> {
	return mutate(async () => {
		const store = await getStore();
		if (store.settings.autoBackup !== 'off') {
			await addBackup(store, 'auto', false);
		}
	});
}

const BACKUP_PERIOD_MINUTES: Record<'daily' | 'weekly', number> = {
	daily: 1440,
	weekly: 10_080,
};

async function backupDue(settings: Settings): Promise<boolean> {
	if (settings.autoBackup === 'off') {
		return false;
	}

	const backups = await readBackups();
	const newest = backups.auto.find((record) => record.kind === 'auto');
	const last = Math.max(Number(newest?.at ?? 0), backups.lastAutoCheckAt);
	return (
		last === 0 ||
		Date.now() - last >= BACKUP_PERIOD_MINUTES[settings.autoBackup] * 60_000
	);
}

async function findBackup(id: string): Promise<BackupRecord | null> {
	const backups = await readBackups();
	return (
		[...backups.auto, ...backups.safety].find((record) => record.id === id) ??
		null
	);
}

function restoreBackup(id: string): Promise<ActionResult<'RESTORE_BACKUP'>> {
	return mutate(() =>
		withUndo('Restore backup', [STORAGE_KEY], async () => {
			const record = await findBackup(id);
			if (!record) {
				return {ok: false, error: 'That backup no longer exists.'};
			}

			let parsed: unknown;
			try {
				parsed = JSON.parse(record.json);
			} catch {
				return {ok: false, error: 'That backup could not be read.'};
			}

			const store = await getStore();
			// Settings stay as they are; the backup brings back sessions, folders, bookmarks and columns.
			const restored = normalizeStore({
				...(isRecord(parsed) && parsed),
				settings: store.settings,
			});
			if (!(await safetyBackup(store, 'Before restoring a backup'))) {
				return {
					ok: false,
					error: 'Could not take a safety backup first. Nothing was changed.',
				};
			}

			await writeStore(restored);
			return {
				ok: true,
				sessions: restored.groups.length,
				bookmarks: restored.bookmarks.length,
			};
		}),
	);
}

function deleteBackup(id: string): Promise<ActionResult<'DELETE_BACKUP'>> {
	return backupMutate(() =>
		withUndo('Delete backup', [BACKUPS_KEY], async () => {
			const backups = await readBackups();
			const auto = backups.auto.filter((record) => record.id !== id);
			const safety = backups.safety.filter((record) => record.id !== id);
			if (
				auto.length === backups.auto.length &&
				safety.length === backups.safety.length
			) {
				return {ok: false, error: 'That backup no longer exists.'};
			}

			await writeBackups({...backups, auto, safety});
			return {ok: true};
		}),
	);
}

async function getBackupData(
	id: string,
): Promise<ActionResult<'GET_BACKUP_DATA'>> {
	const record = await findBackup(id);
	return record
		? {ok: true, filename: backupFileName(Number(record.at)), json: record.json}
		: {ok: false, error: 'That backup no longer exists.'};
}

// Full backup (ZIP): the page builds and reads the archive; the worker supplies and replaces the stored values.
// Mirrors FULL_BACKUP_FORMAT_ID and FULL_BACKUP_VERSION in src/app/backup-format.ts (the worker cannot import).
const FULL_BACKUP_FORMAT_ID = 'tablodge-full-backup';
const FULL_BACKUP_VERSION = 1;
// The page theme and accent color, kept in storage by the pages (src/shared/theme.tsx); the only preferences outside the state.
const UI_THEME_KEY = 'uiTheme';
const UI_ACCENT_KEY = 'uiAccent';
// Mirrors ACCENTS and the custom hex rule in src/shared/accents.ts.
const ACCENT_IDS = new Set([
	'default',
	'system',
	'red',
	'orange',
	'amber',
	'green',
	'teal',
	'cyan',
	'blue',
	'violet',
	'pink',
	'rose',
	'slate',
]);
const SNAPSHOT_REASONS = new Set([
	'interval',
	'startup',
	'crash',
	'exit',
	'manual',
]);
const TRASH_KINDS = new Set([
	'session',
	'tabs',
	'bookmark',
	'column',
	'folder',
]);
const MAX_SNAPSHOT_WINDOWS = 50;
const MAX_SNAPSHOT_TABS = 10_000;

const asTheme = (value: unknown) =>
	value === 'light' || value === 'dark' ? value : 'system';

const asAccent = (value: unknown) =>
	typeof value === 'string' &&
	(ACCENT_IDS.has(value) || /^#[\da-f]{6}$/.test(value))
		? value
		: 'default';

async function getFullBackup(): Promise<ActionResult<'GET_FULL_BACKUP'>> {
	const store = await getStore();
	return {
		ok: true,
		state: store,
		preferences: {
			[UI_THEME_KEY]: asTheme(await readKey(UI_THEME_KEY)),
			[UI_ACCENT_KEY]: asAccent(await readKey(UI_ACCENT_KEY)),
		},
		snapshots: {version: 1, history: await readSnapshotHistory()},
		trash: {version: 1, items: await readTrash()},
	};
}

/**
Rebuilds an imported crash snapshot from known fields only, or null when it has no usable tab.
*/
function normalizeImportedSnapshot(entry: unknown): Snapshot | null {
	if (!isRecord(entry) || !Array.isArray(entry.windows)) {
		return null;
	}

	let tabCount = 0;
	const windows: SnapshotWindow[] = [];
	for (const rawWindow of entry.windows.slice(0, MAX_SNAPSHOT_WINDOWS)) {
		if (!isRecord(rawWindow) || !Array.isArray(rawWindow.tabs)) {
			continue;
		}

		const groups: SnapshotGroup[] = (
			Array.isArray(rawWindow.groups) ? rawWindow.groups : []
		)
			.slice(0, 500)
			.map((group: unknown) => {
				const raw = isRecord(group) ? group : {};
				return {
					title: cleanText(raw.title, '', 100),
					color: isGroupColor(raw.color) ? raw.color : 'grey',
					collapsed: Boolean(raw.collapsed),
				};
			});
		const tabs: SnapshotTab[] = [];
		for (const rawTab of rawWindow.tabs) {
			if (tabCount >= MAX_SNAPSHOT_TABS) {
				break;
			}

			const url = isRecord(rawTab) ? normalizeUrl(rawTab.url) : null;
			if (!isRecord(rawTab) || !url) {
				continue;
			}

			const tab: SnapshotTab = {url, title: cleanText(rawTab.title, url, 200)};
			if (rawTab.pinned === true) {
				tab.pinned = true;
			}

			if (rawTab.active === true) {
				tab.active = true;
			}

			if (
				isInteger(rawTab.group) &&
				rawTab.group >= 0 &&
				rawTab.group < groups.length
			) {
				tab.group = rawTab.group;
			}

			const split = normalizeSplit(rawTab.split);
			if (split) {
				tab.split = split;
			}

			tabs.push(tab);
			tabCount += 1;
		}

		if (tabs.length > 0) {
			windows.push({
				focused: rawWindow.focused === true,
				state: cleanText(rawWindow.state, 'normal', 20),
				groups,
				tabs,
			});
		}
	}

	const at = Number(entry.at);
	if (windows.length === 0 || !Number.isFinite(at)) {
		return null;
	}

	const text = JSON.stringify(windows);
	return {
		id: cleanText(entry.id, makeId(), 100),
		at,
		reason: SNAPSHOT_REASONS.has(String(entry.reason))
			? (entry.reason as SnapshotReason)
			: 'manual',
		sig: hashText(text),
		size: text.length,
		windows,
	};
}

function normalizeImportedTrash(entry: unknown): TrashEntry | null {
	if (!isTrashEntry(entry) || !TRASH_KINDS.has(entry.kind)) {
		return null;
	}

	return {
		id: cleanText(entry.id, makeId(), 100),
		kind: entry.kind,
		deletedAt: Number.isFinite(Number(entry.deletedAt))
			? Number(entry.deletedAt)
			: Date.now(),
		label: cleanText(entry.label, 'Deleted item', 200),
		origin: cleanText(entry.origin, '', 200),
		count: Math.max(0, Math.floor(Number(entry.count)) || 0),
		data: entry.data,
	};
}

async function applyFullBackup(
	input: Raw,
): Promise<ActionResult<'RESTORE_FULL_BACKUP'>> {
	if (input.format !== FULL_BACKUP_FORMAT_ID) {
		return {
			ok: false,
			error: `This is not a ${APP_NAME} full backup.`,
		};
	}

	const version = Number(input.version);
	if (!Number.isSafeInteger(version) || version < 1) {
		return {ok: false, error: 'This backup has no valid version.'};
	}

	if (version > FULL_BACKUP_VERSION) {
		return {
			ok: false,
			error: 'This backup is from a newer TabLodge version.',
		};
	}

	const data = input.state;
	if (!isRecord(data)) {
		return {ok: false, error: 'This backup has no data.'};
	}

	if (Number(data.schemaVersion) > SCHEMA_VERSION) {
		return {
			ok: false,
			error: 'This backup is from a newer TabLodge version.',
		};
	}

	const restored = normalizeStore(data);
	const current = await getStore();
	if (!(await safetyBackup(current, 'Before importing a full backup'))) {
		return {
			ok: false,
			error: 'Could not take a safety backup first. Nothing was changed.',
		};
	}

	const rawHistory =
		isRecord(input.snapshots) && Array.isArray(input.snapshots.history)
			? input.snapshots.history
			: [];
	const history = trimHistory(
		rawHistory
			.slice(0, 200)
			.map((entry: unknown) => normalizeImportedSnapshot(entry))
			.filter((entry): entry is Snapshot => entry !== null)
			.toSorted((a, b) => b.at - a.at),
		restored.settings.snapshotKeep,
	);
	const rawItems =
		isRecord(input.trash) && Array.isArray(input.trash.items)
			? input.trash.items
			: [];
	const items = capTrashSize(
		rawItems
			.slice(0, TRASH_MAX_ITEMS)
			.map((entry: unknown) => normalizeImportedTrash(entry))
			.filter((entry): entry is TrashEntry => entry !== null),
	);

	await writeStore(restored);
	await writeSnapshotHistory(history);
	await writeTrash(items);
	if (isRecord(input.preferences)) {
		await chrome.storage.local.set({
			[UI_THEME_KEY]: asTheme(input.preferences[UI_THEME_KEY]),
			[UI_ACCENT_KEY]: asAccent(input.preferences[UI_ACCENT_KEY]),
		});
	}

	return {
		ok: true,
		sessions: restored.groups.length,
		bookmarks: restored.bookmarks.length,
		snapshots: history.length,
		trash: items.length,
	};
}

function restoreFullBackup(
	input: Raw,
): Promise<ActionResult<'RESTORE_FULL_BACKUP'>> {
	// Same nesting as UNDO for these keys, so the queues never wait on each other.
	return mutate(() =>
		snapshotMutate(() =>
			trashMutate(() =>
				withUndo<'RESTORE_FULL_BACKUP'>(
					'Import full backup',
					[STORAGE_KEY, SNAPSHOTS_KEY, TRASH_KEY, UI_THEME_KEY, UI_ACCENT_KEY],
					() => applyFullBackup(input),
				),
			),
		),
	).then(async (result) => {
		if (result.ok) {
			// Settings may differ from what the alarms, toolbar, and menus were set up for.
			const store = await getStore();
			await syncRecoveryAlarms(store.settings);
			await syncToolbarAction(store.settings);
			await rebuildContextMenus(store);
		}

		return result;
	});
}

type TrashEntry = {
	id: string;
	kind: TrashKind;
	deletedAt: number;
	label: string;
	origin: string;
	count: number;
	data: Raw;
	/**
	Serialized length of `data`, cached so the size cap never re-serializes stored items.
	*/
	size?: number;
};

const isTrashEntry = (value: unknown): value is TrashEntry =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.kind === 'string' &&
	isRecord(value.data);

async function readTrash(): Promise<TrashEntry[]> {
	const raw = await readKey<Raw>(TRASH_KEY);
	return Array.isArray(raw?.items) ? raw.items.filter(isTrashEntry) : [];
}

async function writeTrash(items: TrashEntry[]) {
	await chrome.storage.local.set({[TRASH_KEY]: {version: 1, items}});
}

const trashSize = (entry: TrashEntry) => {
	entry.size ??= JSON.stringify(entry.data).length;
	return entry.size;
};

/**
Newest first: keeps items while their total size fits TRASH_MAX_CHARS (the newest item always stays), dropping the oldest.
*/
function capTrashSize(items: TrashEntry[]): TrashEntry[] {
	let total = 0;
	let kept = 0;
	for (const item of items) {
		total += trashSize(item);
		if (kept > 0 && total > TRASH_MAX_CHARS) {
			break;
		}

		kept += 1;
	}

	return kept === items.length ? items : items.slice(0, kept);
}

function pruneTrash(items: TrashEntry[], retentionDays: number): TrashEntry[] {
	const cutoff = Date.now() - retentionDays * DAY_MS;
	return capTrashSize(
		items
			.filter((item) => Number(item.deletedAt) > cutoff)
			.slice(0, TRASH_MAX_ITEMS),
	);
}

/**
Moves a deleted item into the trash and returns its id. Called before the main state is written, so a crash in between duplicates rather than loses data.
*/
function trashAdd(
	settings: Settings,
	item: Omit<TrashEntry, 'id' | 'deletedAt'>,
): Promise<string> {
	return trashMutate(async () => {
		const entry: TrashEntry = {...item, id: makeId(), deletedAt: Date.now()};
		trashSize(entry);
		await writeTrash(
			pruneTrash([entry, ...(await readTrash())], settings.trashRetentionDays),
		);
		return entry.id;
	});
}

function purgeTrash(): Promise<void> {
	return trashMutate(async () => {
		const settings = await readSettings();
		const items = await readTrash();
		const unsized = items.some((item) => item.size === undefined);
		const kept = pruneTrash(items, settings.trashRetentionDays);
		// Entries stored before sizes were tracked get theirs written once.
		if (kept.length !== items.length || unsized) {
			await writeTrash(kept);
		}
	});
}

const trashSessionData = (session: Session, index: number): Raw => ({
	session,
	index,
});

/**
A tab removal (delete, or restore-and-remove) with where each link sat; a session that disappeared with its last link is kept as `groupMeta`.
*/
function trashTabsEntry(
	group: Session,
	removed: Array<{tab: SavedTab; index: number}>,
	groupRemoved: boolean,
	index: number,
): Omit<TrashEntry, 'id' | 'deletedAt'> {
	const first = removed[0]?.tab;
	return {
		kind: 'tabs',
		label:
			removed.length === 1
				? first.title || first.url
				: `${removed.length} saved links`,
		origin: group.name,
		count: removed.length,
		data: {
			groupId: group.id,
			groupName: group.name,
			groupIndex: index,
			groupMeta: groupRemoved ? {...group, tabs: []} : null,
			items: removed,
		},
	};
}

function describeTrash(entry: TrashEntry): TrashSummary {
	return {
		id: entry.id,
		kind: entry.kind,
		deletedAt: Number(entry.deletedAt),
		label: entry.label,
		origin: entry.origin,
		count: entry.count,
	};
}

async function getTrash(): Promise<ActionResult<'GET_TRASH'>> {
	const settings = await readSettings();
	const items = pruneTrash(await readTrash(), settings.trashRetentionDays);
	return {ok: true, items: items.map((entry) => describeTrash(entry))};
}

const clampIndex = (value: unknown, length: number) =>
	Math.max(0, Math.min(length, isInteger(value) ? value : length));

function uniqueName(name: string, taken: (candidate: string) => boolean) {
	if (!taken(name)) {
		return name;
	}

	for (let n = 1; ; n += 1) {
		const candidate = `${name} (restored${n > 1 ? ` ${n}` : ''})`;
		if (!taken(candidate)) {
			return candidate;
		}
	}
}

/**
Puts a trash item back into `store` (not yet written). Returns where it landed.
*/
function applyTrashRestore(
	store: Store,
	entry: TrashEntry,
): ActionFailure | {ok: true; placed: string} {
	const {data} = entry;
	if (entry.kind === 'session') {
		const session = normalizeGroup(data.session, Date.now(), true);
		if (!session) {
			return {ok: false, error: 'That session could not be restored.'};
		}

		if (store.groups.length >= MAX_SESSIONS) {
			return {ok: false, error: sessionLimitError()};
		}

		if (store.groups.some((group) => group.id === session.id)) {
			session.id = makeId();
		}

		const folder = store.folders.find((item) => item.id === session.folderId);
		if (!folder) {
			session.folderId = DEFAULT_FOLDER_ID;
		}

		store.groups.splice(
			clampIndex(data.index, store.groups.length),
			0,
			session,
		);
		return {
			ok: true,
			placed: folder?.name ?? DEFAULT_FOLDER.name,
		};
	}

	if (entry.kind === 'tabs') {
		const items = (Array.isArray(data.items) ? data.items : [])
			.filter(isRecord)
			.map((item) => ({
				tab: normalizeTab(item.tab, Date.now(), 0),
				index: Number(item.index),
			}))
			.filter(
				(item): item is {tab: SavedTab; index: number} => item.tab !== null,
			)
			.toSorted((a, b) => a.index - b.index);
		if (items.length === 0) {
			return {ok: false, error: 'Those links could not be restored.'};
		}

		const group = store.groups.find((item) => item.id === data.groupId);
		if (group && group.tabs.length + items.length > MAX_TABS_PER_SESSION) {
			return {ok: false, error: sessionFullError()};
		}

		if (!group && store.groups.length >= MAX_SESSIONS) {
			return {ok: false, error: sessionLimitError()};
		}

		if (!group) {
			const meta = isRecord(data.groupMeta) ? data.groupMeta : {};
			const created = normalizeGroup(
				{
					...meta,
					id: meta.id ?? makeId(),
					name: meta.name ?? data.groupName ?? 'Restored links',
					tabs: items.map((item) => item.tab),
				},
				Date.now(),
				true,
			);
			if (!created) {
				return {ok: false, error: 'Those links could not be restored.'};
			}

			if (store.groups.some((item) => item.id === created.id)) {
				created.id = makeId();
			}

			if (store.folders.every((item) => item.id !== created.folderId)) {
				created.folderId = DEFAULT_FOLDER_ID;
			}

			store.groups.splice(
				clampIndex(data.groupIndex, store.groups.length),
				0,
				created,
			);
			return {ok: true, placed: created.name};
		}

		const known = new Set(group.tabs.map((tab) => tab.id));
		for (const {tab, index} of items) {
			if (known.has(tab.id)) {
				tab.id = makeId();
			}

			known.add(tab.id);
			group.tabs.splice(clampIndex(index, group.tabs.length), 0, tab);
		}

		group.updatedAt = Date.now();
		return {ok: true, placed: group.name};
	}

	if (entry.kind === 'bookmark') {
		const bookmark = normalizeBookmark(
			data.bookmark,
			new Set([
				...store.bookmarkColumns.map((column) => column.id),
				BOOKMARK_UNFILED_ID,
			]),
		);
		if (!bookmark) {
			return {ok: false, error: 'That bookmark could not be restored.'};
		}

		const column = store.bookmarkColumns.find(
			(item) => item.id === data.columnId,
		);
		bookmark.columnId =
			column?.id ?? store.bookmarkColumns[0]?.id ?? BOOKMARK_UNFILED_ID;
		if (store.bookmarks.some((item) => item.id === bookmark.id)) {
			bookmark.id = makeId();
		}

		const previous = store.bookmarks.findIndex(
			(item) => item.id === data.prevId,
		);
		const next = store.bookmarks.findIndex((item) => item.id === data.nextId);
		if (column && previous !== -1) {
			store.bookmarks.splice(previous + 1, 0, bookmark);
		} else if (column && next !== -1) {
			store.bookmarks.splice(next, 0, bookmark);
		} else {
			store.bookmarks.push(bookmark);
		}

		return {
			ok: true,
			placed:
				column?.name ??
				store.bookmarkColumns.find((item) => item.id === bookmark.columnId)
					?.name ??
				'Unfiled',
		};
	}

	if (entry.kind === 'column') {
		const column = normalizeBookmarkColumn(data.column);
		if (!column) {
			return {ok: false, error: 'That column could not be restored.'};
		}

		if (store.bookmarkColumns.some((item) => item.id === column.id)) {
			column.id = makeId();
		}

		column.name = uniqueName(column.name, (candidate) =>
			bookmarkColumnNameExists(store, candidate),
		);
		column.isDefault = column.id === DEFAULT_BOOKMARK_COLUMN_ID;
		store.bookmarkColumns.splice(
			clampIndex(data.index, store.bookmarkColumns.length),
			0,
			column,
		);
		const columnIds = new Set([
			...store.bookmarkColumns.map((item) => item.id),
			BOOKMARK_UNFILED_ID,
		]);
		const knownBookmarks = new Set(store.bookmarks.map((item) => item.id));
		// Links deleted together with the column come back into it.
		for (const raw of Array.isArray(data.bookmarks) ? data.bookmarks : []) {
			const bookmark = normalizeBookmark(raw, columnIds);
			if (!bookmark || knownBookmarks.has(bookmark.id)) {
				continue;
			}

			bookmark.columnId = column.id;
			store.bookmarks.push(bookmark);
		}

		// Links that were moved elsewhere when the column was deleted go back if they are still where they were put.
		const moved = new Set(
			Array.isArray(data.movedIds) ? (data.movedIds as unknown[]) : [],
		);
		for (const bookmark of store.bookmarks) {
			if (moved.has(bookmark.id) && bookmark.columnId === data.movedTo) {
				bookmark.columnId = column.id;
			}
		}

		return {ok: true, placed: column.name};
	}

	const folder = normalizeFolder(data.folder);
	if (!folder) {
		return {ok: false, error: 'That folder could not be restored.'};
	}

	if (store.folders.some((item) => item.id === folder.id)) {
		folder.id = makeId();
	}

	folder.name = uniqueName(folder.name, (candidate) =>
		folderNameExists(store, candidate),
	);
	folder.isDefault = false;
	store.folders.splice(clampIndex(data.index, store.folders.length), 0, folder);
	// Sessions that were moved to Unfiled when the folder was deleted return to it.
	const wasIn = new Set(
		Array.isArray(data.groupIds) ? (data.groupIds as unknown[]) : [],
	);
	for (const group of store.groups) {
		if (wasIn.has(group.id) && group.folderId === DEFAULT_FOLDER_ID) {
			group.folderId = folder.id;
		}
	}

	return {ok: true, placed: folder.name};
}

function restoreTrash(id: string): Promise<ActionResult<'RESTORE_TRASH'>> {
	return mutate(async () => {
		const entry = (await readTrash()).find((item) => item.id === id);
		if (!entry) {
			return {ok: false, error: 'That item is no longer in the trash bin.'};
		}

		const store = await getStore();
		const outcome = applyTrashRestore(store, entry);
		if (!outcome.ok) {
			return outcome;
		}

		await writeStore(store);
		await trashMutate(async () => {
			await writeTrash((await readTrash()).filter((item) => item.id !== id));
		});
		return {ok: true, placed: outcome.placed};
	});
}

function deleteTrash(id: string): Promise<ActionResult<'DELETE_TRASH'>> {
	return trashMutate(() =>
		withUndo('Delete from trash bin', [TRASH_KEY], async () => {
			const items = await readTrash();
			const next = items.filter((item) => item.id !== id);
			if (next.length === items.length) {
				return {ok: false, error: 'That item is no longer in the trash bin.'};
			}

			await writeTrash(next);
			return {ok: true};
		}),
	);
}

function emptyTrash(): Promise<ActionResult<'EMPTY_TRASH'>> {
	return trashMutate(() =>
		withUndo('Empty trash bin', [TRASH_KEY], async () => {
			const items = await readTrash();
			await writeTrash([]);
			return {ok: true, count: items.length};
		}),
	);
}

// Undo: for actions the trash cannot hold (erase, empty trash, clear snapshots, restore a backup, imports),
// the affected storage keys are copied before the action and put back by UNDO, but only briefly and only while
// nothing else has changed those keys since.
const UNDO_KEY = 'tablodge.undo';
const ALARM_UNDO = 'tablodge-undo';
const UNDO_WINDOW_MS = 120_000;
const UNDO_KEEP = 3;
const undoMutate = serialQueue();

type UndoRecord = {
	id: string;
	label: string;
	createdAt: number;
	keys: string[];
	// The keys' values before the action; a key missing here did not exist.
	before: Raw;
	// A hash of each key's value right after the action, to notice later changes.
	after: Record<string, string>;
};

const isUndoRecord = (value: unknown): value is UndoRecord =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	Array.isArray(value.keys) &&
	isRecord(value.before) &&
	isRecord(value.after);

const undoHash = (value: unknown) =>
	value === undefined ? 'none' : hashText(JSON.stringify(value));

async function readUndo(): Promise<UndoRecord[]> {
	const raw = await readKey<Raw>(UNDO_KEY);
	const cutoff = Date.now() - UNDO_WINDOW_MS;
	return Array.isArray(raw?.records)
		? raw.records.filter(
				(record): record is UndoRecord =>
					isUndoRecord(record) && Number(record.createdAt) > cutoff,
			)
		: [];
}

async function writeUndo(records: UndoRecord[]) {
	await (records.length === 0
		? chrome.storage.local.remove(UNDO_KEY)
		: chrome.storage.local.set({[UNDO_KEY]: {version: 1, records}}));
}

/**
Runs `run` and, when it succeeds and changed `keys`, stores what they held before and returns an `undoId`. Call it inside the queue that guards those keys.
*/
async function withUndo<K extends TabLodgeMessageType>(
	label: string,
	keys: string[],
	run: () => Promise<ActionResult<K>>,
): Promise<ActionResult<K>> {
	const before = await chrome.storage.local.get<Raw>(keys);
	const result = await run();
	if (!result.ok) {
		return result;
	}

	try {
		const now = await chrome.storage.local.get<Raw>(keys);
		const after = Object.fromEntries(
			keys.map((key) => [key, undoHash(now[key])]),
		);
		if (keys.every((key) => after[key] === undoHash(before[key]))) {
			return result;
		}

		const record: UndoRecord = {
			id: makeId(),
			label,
			createdAt: Date.now(),
			keys,
			before,
			after,
		};
		await undoMutate(async () => {
			await writeUndo([record, ...(await readUndo())].slice(0, UNDO_KEEP));
		});
		// The copy holds user data, so it is dropped soon after the window closes.
		await chrome.alarms?.create?.(ALARM_UNDO, {delayInMinutes: 3});
		return {...result, undoId: record.id};
	} catch {
		// Undo is a convenience; the action itself succeeded.
		return result;
	}
}

function purgeUndo(): Promise<void> {
	return undoMutate(async () => {
		const records = await readUndo();
		const stored = await readKey<Raw>(UNDO_KEY);
		if (
			stored &&
			(!Array.isArray(stored.records) ||
				stored.records.length !== records.length)
		) {
			await writeUndo(records);
		}
	});
}

function undoAction(id: string): Promise<ActionResult<'UNDO'>> {
	const run = (keys: string[], apply: () => Promise<ActionResult<'UNDO'>>) => {
		let step = apply;
		if (keys.includes(TRASH_KEY)) {
			const inner = step;
			step = () => trashMutate(inner);
		}

		if (keys.includes(BACKUPS_KEY)) {
			const inner = step;
			step = () => backupMutate(inner);
		}

		if (keys.includes(SNAPSHOTS_KEY)) {
			const inner = step;
			step = () => snapshotMutate(inner);
		}

		return mutate(step);
	};

	return undoMutate(() => readUndo()).then((records) => {
		const record = records.find((entry) => entry.id === id);
		if (!record) {
			return {
				ok: false,
				error: "Can't undo: it was too long ago.",
			};
		}

		return run(record.keys, async () => {
			const current = await chrome.storage.local.get<Raw>(record.keys);
			if (
				record.keys.some((key) => undoHash(current[key]) !== record.after[key])
			) {
				await undoMutate(async () => {
					await writeUndo(
						(await readUndo()).filter((entry) => entry.id !== id),
					);
				});
				return {ok: false, error: "Can't undo: your data changed since."};
			}

			const restore: Raw = {};
			const drop: string[] = [];
			for (const key of record.keys) {
				if (record.before[key] === undefined) {
					drop.push(key);
				} else {
					restore[key] = record.before[key];
				}
			}

			await chrome.storage.local.set(restore);
			if (drop.length > 0) {
				await chrome.storage.local.remove(drop);
			}

			invalidateSettings();

			await undoMutate(async () => {
				await writeUndo((await readUndo()).filter((entry) => entry.id !== id));
			});
			if (record.keys.includes(STORAGE_KEY)) {
				// Settings may differ from what the alarms, toolbar, and menus were last set up for.
				const store = await getStore();
				await syncRecoveryAlarms(store.settings);
				await syncToolbarAction(store.settings);
				await rebuildContextMenus(store);
			}

			return {ok: true, label: record.label};
		});
	});
}

async function getStorageUsage(): Promise<ActionResult<'GET_STORAGE_USAGE'>> {
	const bytes = async (keys: string[]) => {
		try {
			return (await chrome.storage.local.getBytesInUse?.(keys)) ?? 0;
		} catch {
			return 0;
		}
	};

	const usage: StorageUsage = {
		snapshots: await bytes([
			SNAPSHOTS_KEY,
			SNAPSHOT_LIVE_KEY,
			SNAPSHOT_META_KEY,
		]),
		backups: await bytes([BACKUPS_KEY]),
		trash: await bytes([TRASH_KEY]),
		state: await bytes([STORAGE_KEY]),
	};
	return {ok: true, usage};
}

async function ensureAlarm(
	name: string,
	periodInMinutes: number | null,
	delayInMinutes?: number,
) {
	if (!chrome.alarms) {
		return;
	}

	try {
		const existing = await chrome.alarms.get(name);
		if (periodInMinutes === null) {
			if (existing) {
				await chrome.alarms.clear(name);
			}

			return;
		}

		if (existing?.periodInMinutes === periodInMinutes) {
			return;
		}

		await chrome.alarms.create(name, {
			periodInMinutes,
			delayInMinutes: delayInMinutes ?? periodInMinutes,
		});
	} catch {
		/*
		Alarms are an optimization; events still capture snapshots.
		*/
	}
}

/**
Creates, changes or clears the repeating alarms that match the settings (alarms may not survive a browser restart, so this runs on every start too).
*/
async function syncRecoveryAlarms(settings: Settings) {
	await ensureAlarm(
		ALARM_SNAPSHOT,
		settings.snapshotsEnabled ? settings.snapshotIntervalMinutes : null,
	);
	await ensureAlarm(
		ALARM_BACKUP,
		settings.autoBackup === 'off'
			? null
			: BACKUP_PERIOD_MINUTES[settings.autoBackup],
		1,
	);
	await ensureAlarm(ALARM_TRASH, 1440, 5);
	await ensureAlarm(
		ALARM_ARCHIVE,
		settings.autoArchiveDays === 0 ? null : 1440,
		5,
	);
}

/**
Everything the recovery features do when the browser starts: judge the previous run, catch up a missed backup, purge old trash.
*/
async function runStartupRecovery() {
	try {
		await evaluateStartup();
		const settings = await readSettings();
		await syncRecoveryAlarms(settings);
		await purgeTrash();
		await purgeUndo();
		await archiveStaleSessions();
		if (await backupDue(settings)) {
			await runScheduledBackup();
		}

		if (settings.snapshotsEnabled) {
			scheduleSnapshot();
		}
	} catch {
		/*
		Recovery is best effort and must never block startup.
		*/
	}
}

chrome.alarms?.onAlarm?.addListener?.((alarm) => {
	const work =
		alarm.name === ALARM_SNAPSHOT
			? takeSnapshot('interval', true)
			: alarm.name === ALARM_BACKUP
				? runScheduledBackup()
				: alarm.name === ALARM_TRASH
					? purgeTrash()
					: alarm.name === ALARM_UNDO
						? purgeUndo()
						: alarm.name === ALARM_ARCHIVE
							? archiveStaleSessions()
							: undefined;
	void work?.catch(() => undefined);
});

// Tab and window changes schedule a debounced capture. Title-only updates are ignored (they are frequent and unimportant).
const scheduleSnapshotSoon = () => scheduleSnapshot();
chrome.tabs?.onCreated?.addListener?.(scheduleSnapshotSoon);
chrome.tabs?.onMoved?.addListener?.(scheduleSnapshotSoon);
chrome.tabs?.onActivated?.addListener?.(scheduleSnapshotSoon);
chrome.tabs?.onAttached?.addListener?.(scheduleSnapshotSoon);
chrome.tabs?.onDetached?.addListener?.(scheduleSnapshotSoon);
chrome.tabs?.onRemoved?.addListener?.((_tabId, info) => {
	// A closing window is handled by windows.onRemoved.
	if (!info?.isWindowClosing) {
		scheduleSnapshot();
	}
});
chrome.tabs?.onUpdated?.addListener?.((_tabId, change) => {
	if (
		change.url !== undefined ||
		change.pinned !== undefined ||
		change.groupId !== undefined ||
		change.status === 'complete'
	) {
		scheduleSnapshot();
	}
});
chrome.tabGroups?.onCreated?.addListener?.(scheduleSnapshotSoon);
chrome.tabGroups?.onUpdated?.addListener?.(scheduleSnapshotSoon);
chrome.tabGroups?.onRemoved?.addListener?.(scheduleSnapshotSoon);
chrome.windows?.onCreated?.addListener?.(scheduleSnapshotSoon);
chrome.windows?.onFocusChanged?.addListener?.(scheduleSnapshotSoon);
chrome.windows?.onRemoved?.addListener?.(() => {
	void handleWindowRemoved().catch(() => undefined);
});

// Alarms can be lost when the browser restarts and the worker may wake without onStartup, so re-check on every start.
void readSettings()
	.then((settings) => syncRecoveryAlarms(settings))
	.catch(() => undefined);

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
					allowDuplicates: message.allowDuplicates === true,
				},
			);
		}

		case 'PREVIEW_SESSION_NAME': {
			return previewSessionName(message, sender.tab);
		}

		case 'SAVE_CURRENT_TAB_TO_GROUP': {
			return saveCurrentTabToFirstGroup(sender.tab);
		}

		case 'RESTORE_TAB': {
			const result = await restoreTab(
				message.groupId,
				message.tabId,
				sender.tab,
				{
					restoreMode: message.restoreMode,
					restoreTarget: message.restoreTarget,
					activate: message.activate,
				},
			);
			return result;
		}

		case 'RESTORE_GROUP': {
			const result = await restoreGroup(
				message.groupId,
				sender.tab,
				Boolean(message.forceRemove),
				{
					restoreMode: message.restoreMode,
					restoreTarget: message.restoreTarget,
					activate: message.activate,
				},
			);
			return result;
		}

		case 'SWITCH_WORKSPACE': {
			return switchWorkspace(message.groupId, sender.tab);
		}

		case 'DELETE_GROUP': {
			return deleteGroup(message.groupId);
		}

		case 'UPDATE_GROUP': {
			return updateGroup(message.groupId, message.fields || {});
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

		case 'DELETE_TAB': {
			return deleteTab(message.groupId, message.tabId);
		}

		case 'MERGE_GROUPS': {
			return mergeGroups(
				String(message.sourceGroupId),
				String(message.targetGroupId),
			);
		}

		case 'ADD_LINKS_TO_SESSION': {
			return addLinksToSession(
				String(message.groupId),
				message.links,
				message.targetTabId || null,
				message.position,
			);
		}

		case 'MOVE_TAB': {
			return moveTab(
				message.fromGroupId,
				message.tabId,
				message.toGroupId,
				message.targetTabId || null,
				message.position,
				message.copy === true,
				message.restoreTrashId || null,
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
				message.undoable === true,
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

		case 'GET_SNAPSHOTS': {
			return getSnapshots();
		}

		case 'RESTORE_SNAPSHOT': {
			return restoreSnapshot(message.id, message.windowIndex);
		}

		case 'SAVE_SNAPSHOT_AS_SESSION': {
			return saveSnapshotAsSession(message.id, message.windowIndex);
		}

		case 'DELETE_SNAPSHOT': {
			return deleteSnapshot(message.id);
		}

		case 'CLEAR_SNAPSHOTS': {
			return clearSnapshots();
		}

		case 'DISMISS_RECOVERY': {
			return dismissRecovery();
		}

		case 'GET_BACKUPS': {
			return getBackups();
		}

		case 'BACKUP_NOW': {
			return backupNow();
		}

		case 'RESTORE_BACKUP': {
			return restoreBackup(message.id);
		}

		case 'DELETE_BACKUP': {
			return deleteBackup(message.id);
		}

		case 'GET_BACKUP_DATA': {
			return getBackupData(message.id);
		}

		case 'GET_FULL_BACKUP': {
			return getFullBackup();
		}

		case 'RESTORE_FULL_BACKUP': {
			return restoreFullBackup(message);
		}

		case 'GET_TRASH': {
			return getTrash();
		}

		case 'RESTORE_TRASH': {
			return restoreTrash(message.id);
		}

		case 'DELETE_TRASH': {
			return deleteTrash(message.id);
		}

		case 'EMPTY_TRASH': {
			return emptyTrash();
		}

		case 'UNDO': {
			return undoAction(message.id);
		}

		case 'GET_STORAGE_USAGE': {
			return getStorageUsage();
		}

		case 'HANDOFF_NEW_TAB': {
			const tabId = sender.tab?.id;
			return {
				ok: true,
				handedOff:
					isInteger(tabId) &&
					(await handOffNewTab(tabId, message.brave === true, false)),
			};
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
		void saveTabs('selected-or-window', tab, DEFAULT_FOLDER_ID, {
			promptName: true,
		});
	}

	if (command === 'bookmark-page') {
		runMenuAction(tab, `${APP_NAME} could not bookmark this page.`, () =>
			openBookmarkPrompt(tab),
		);
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
			: settings.actionMode === 'popup'
				? 'popup.html'
				: '',
	});
}

async function saveCurrentTabToFirstGroup(
	senderTab?: chrome.tabs.Tab,
): Promise<ActionResult<'SAVE_CURRENT_TAB_TO_GROUP'>> {
	return mutate(async () => {
		const store = await getStore();
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

		const group = store.groups[0];
		if (!group) {
			return {
				ok: false,
				error: 'Create a session before sending this tab to a session.',
			};
		}

		if (group.tabs.length >= MAX_TABS_PER_SESSION) {
			return {ok: false, error: sessionFullError()};
		}

		const nativeGroups = await getWindowGroups(window.id);
		const now = Date.now();
		// IsCapturable above guarantees a web URL.
		const tabUrl = normalizeUrl(tab.url)!;
		const title = pageTitle(tab.title, tabUrl, store.settings.cleanTitles);
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
				notes: copies[0]?.notes || '',
				pinned: Boolean(tab.pinned),
				nativeGroup:
					tab.groupId >= 0 && !store.settings.ignoreTabGroups
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
				if (
					remaining.length === 1 &&
					!(await closeEmptiedWindow(windowId, store.settings))
				) {
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
	const settings = await readSettings();
	if (settings.actionMode === 'current-tab-to-group') {
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
	const scope = scopeByMode[settings.actionMode];
	if (!scope) {
		return;
	}

	const result = await saveTabs(scope, tab, DEFAULT_FOLDER_ID, {
		promptName: true,
	});
	if (!result?.ok) {
		console.warn(
			result?.error ||
				`${APP_NAME} could not save tabs from the toolbar action.`,
		);
	}
}

async function openDashboardForTab(tab?: chrome.tabs.Tab) {
	const settings = await readSettings();
	const windowId = await currentWindowId(tab);
	await openDashboard(windowId, '', settings.dashboardBehavior);
}

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
	[MENU.actionSaveWindow]: 'selected-or-window',
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

		// Unfiled is not offered: it only holds bookmarks left over from a deleted column.
		if (columns.length > 0) {
			items.push({
				id: `${parentId}-separator`,
				type: 'separator',
				parentId,
				contexts,
				...extra,
			});
		}

		items.push({
			id: newId,
			title: 'New column',
			parentId,
			contexts,
			...extra,
		});
	};

	if (settings.contextMenuLinksEnabled) {
		const link = {
			contexts: ['link'],
			targetUrlPatterns: WEB_URL_PATTERNS,
		} satisfies Partial<MenuItemProperties>;
		items.push(
			{id: MENU.linkRoot, title: APP_NAME, ...link},
			{
				id: MENU.linkBookmark,
				title: 'Bookmark link to',
				parentId: MENU.linkRoot,
				...link,
			},
		);
		columnSubmenu(
			MENU.linkBookmark,
			LINK_COLUMN_PREFIX,
			MENU.linkBookmarkNew,
			link.contexts,
			{targetUrlPatterns: WEB_URL_PATTERNS},
		);

		items.push({
			id: MENU.linkSave,
			title: 'Save link for later',
			parentId: MENU.linkRoot,
			...link,
		});
	}

	if (settings.contextMenuPageEnabled) {
		const page = {
			contexts: ['page', 'frame'],
			documentUrlPatterns: WEB_URL_PATTERNS,
		} satisfies Partial<MenuItemProperties>;
		items.push(
			{id: MENU.pageRoot, title: APP_NAME, ...page},
			{
				id: MENU.pageBookmark,
				title: 'Bookmark this page to',
				parentId: MENU.pageRoot,
				...page,
			},
		);
		columnSubmenu(
			MENU.pageBookmark,
			PAGE_COLUMN_PREFIX,
			MENU.pageBookmarkNew,
			page.contexts,
			{documentUrlPatterns: WEB_URL_PATTERNS},
		);

		items.push({
			id: 'tablodge-page-separator',
			type: 'separator',
			parentId: MENU.pageRoot,
			...page,
		});

		// The tab-group item stays enabled: Chrome has no contextMenus.onShown to toggle it per tab, and a
		// click outside a tab group just logs "The active tab is not in a tab group." Browsers with onShown refine it.
		for (const [id, title] of PAGE_SAVE_ITEMS) {
			items.push({id, title, parentId: MENU.pageRoot, ...page});
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
	properties: {checked?: boolean; enabled?: boolean; title?: string},
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
		return url ? urlHost(url) : null;
	} catch {
		return null;
	}
}

/**
"Save this window", or "Save 3 selected tabs" while tabs are Ctrl/Shift-selected in the focused window (the
toolbar item saves with "selected-or-window", so the title says what a click will save).
*/
async function saveWindowMenuTitle(settings: Settings) {
	const highlighted = await chrome.tabs.query({
		lastFocusedWindow: true,
		highlighted: true,
	});
	if (selectionSlots(highlighted) <= 1) {
		return 'Save this window';
	}

	const count = selectionSlots(
		highlighted.filter(
			(tab) =>
				isCapturable(tab, settings) &&
				(settings.includePinnedTabs || !tab.pinned),
		),
	);
	return `Save ${count} selected ${count === 1 ? 'tab' : 'tabs'}`;
}

async function excludeMenuState(settings: Settings, tab?: chrome.tabs.Tab) {
	const origin = await menuTabOrigin(tab);
	return {
		checked: Boolean(
			origin && hostIsExcluded(origin, settings.excludedOrigins),
		),
		// A single-label host such as http://wiki/ cannot be an excluded-site entry, so the item stays off for it.
		enabled: Boolean(origin && normalizeExcludedHost(origin)),
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
			menuGeneration += 1;
			syncedMenuState = '';
			await removeAllMenus();
			for (const item of plan) {
				chrome.contextMenus.create(
					item,
					menuCallback(`create the menu item "${item.title || item.id}"`),
				);
			}

			menuGeneration += 1;
			syncedMenuState = '';
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
What the two dynamic toolbar items were last set to; cleared whenever the menus are rebuilt (new items start from defaults).
*/
let syncedMenuState = '';
let menuGeneration = 0;

/**
Keeps the toolbar menu's "Exclude this site" checkbox in step with the active tab.
*/
async function syncExcludeMenuItem(tab?: chrome.tabs.Tab) {
	if (!chrome.contextMenus?.update) {
		return;
	}

	try {
		const settings = await readSettings();
		if (!settings.contextMenusEnabled || !settings.contextMenuActionEnabled) {
			return;
		}

		const generation = menuGeneration;
		const exclude = await excludeMenuState(settings, tab);
		const title = await saveWindowMenuTitle(settings);
		// Most activations leave both items as they are: skip the two updateMenu calls then.
		const state = `${exclude.checked}|${exclude.enabled}|${title}`;
		if (state === syncedMenuState && generation === menuGeneration) {
			return;
		}

		await updateMenu(MENU.actionExclude, exclude);
		await updateMenu(MENU.actionSaveWindow, {title});
		if (generation === menuGeneration) {
			syncedMenuState = state;
		}
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
chrome.tabs?.onHighlighted?.addListener?.(() => {
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

			void readSettings()
				.then(async (settings) => {
					if (
						!settings.contextMenusEnabled ||
						!settings.contextMenuPageEnabled
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

	const settings = await readSettings();
	// BookmarkColumn=new asks the dialog to start a new column; pages that do not support it ignore the parameter.
	const query = new URLSearchParams({
		bookmarkUrl: url,
		bookmarkTitle: cleanText(title, linkHost(url), 500),
		bookmarkColumn: 'new',
	});
	await openDashboard(
		await currentWindowId(tab),
		`?${query}`,
		settings.dashboardBehavior,
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
		const name = SAVED_LINKS_SESSION.toLocaleLowerCase();
		let group = store.groups.find(
			(entry) => entry.name.toLocaleLowerCase() === name,
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

		if (group && group.tabs.length >= MAX_TABS_PER_SESSION) {
			return {ok: false, error: sessionFullError()};
		}

		if (!group && store.groups.length >= MAX_SESSIONS) {
			return {ok: false, error: sessionLimitError()};
		}

		const now = Date.now();
		if (!group) {
			group = {
				id: makeId(),
				name: SAVED_LINKS_SESSION,
				folderId: DEFAULT_FOLDER_ID,
				description: '',
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
			notes: copies[0]?.notes || '',
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
	const settings = await readSettings();
	await openDashboard(
		await currentWindowId(tab),
		dashboardSearchQuery(text),
		settings.dashboardBehavior,
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

	if (!normalizeExcludedHost(origin)) {
		return {
			ok: false,
			error: 'This site cannot be added to the excluded list.',
		};
	}

	// An excluded host (directly or through a parent domain) is un-excluded by removing every entry that covers it.
	const settings = await readSettings();
	const covering = settings.excludedOrigins.filter(
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
			saveTabs(scope, tab, DEFAULT_FOLDER_ID, {promptName: true}),
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

				const title = pageTitle(
					tab?.title,
					linkHost(url),
					(await readSettings()).cleanTitles,
				);
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
	// Persists a pending schema migration once, through the mutation queue.
	await mutate(async () => undefined);
	if (openDashboardAtStartup) {
		// The browser just started: judge how the previous run ended before anything is captured.
		await runStartupRecovery();
	}

	const store = await getStore();
	await syncRecoveryAlarms(store.settings);
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

/*
Offer to add pages bookmarked with the browser's own bookmark feature (star button, Ctrl/Cmd+D). Extensions cannot
hook the star, so this watches bookmarks.onCreated and acts only when exactly one bookmark appears within a short
window and it is for the page the user is on, which filters out sync, imports, pastes and other devices.
*/
const BROWSER_BOOKMARK_QUIET_MS = 1500;
const BROWSER_IMPORT_KEY = 'browserBookmarkImporting';
let browserBookmarkImporting = false;
let browserBookmarkBurst: chrome.bookmarks.BookmarkTreeNode[] = [];
let browserBookmarkTimer: ReturnType<typeof setTimeout> | undefined;

async function handleBrowserBookmark(node: chrome.bookmarks.BookmarkTreeNode) {
	const url = normalizeUrl(node.url);
	if (!url) {
		return;
	}

	const stored = await chrome.storage.session?.get(BROWSER_IMPORT_KEY);
	if (stored?.[BROWSER_IMPORT_KEY] === true) {
		return;
	}

	const store = await getStore();
	const {settings} = store;
	if (
		settings.browserBookmarkAction === 'off' ||
		store.bookmarks.some((bookmark) => bookmark.url === url)
	) {
		return;
	}

	let active: chrome.tabs.Tab | undefined;
	try {
		const focused = await chrome.windows.getLastFocused({
			windowTypes: ['normal'],
		});
		if (isInteger(focused.id)) {
			active = (
				await chrome.tabs.query({active: true, windowId: focused.id})
			).find((tab) => tab.active);
		}
	} catch {
		return;
	}

	if (!active || normalizeUrl(active.url) !== url) {
		return;
	}

	if (settings.browserBookmarkAction === 'ask') {
		await openBookmarkPrompt(active, {title: node.title, fromBrowser: true});
		return;
	}

	const columnId = store.bookmarkColumns.some(
		(column) => column.id === settings.browserBookmarkColumn,
	)
		? settings.browserBookmarkColumn
		: store.bookmarkColumns[0]?.id;
	const result = await addBookmark({title: node.title, url, columnId});
	flashBadge(active, result.ok);
}

function flushBrowserBookmarks() {
	browserBookmarkTimer = undefined;
	const burst = browserBookmarkBurst;
	browserBookmarkBurst = [];
	if (burst.length !== 1) {
		return;
	}

	void handleBrowserBookmark(burst[0]).catch((error: unknown) => {
		console.warn(errorMessage(error));
	});
}

chrome.bookmarks?.onImportBegan?.addListener(() => {
	browserBookmarkImporting = true;
	void chrome.storage.session?.set({[BROWSER_IMPORT_KEY]: true});
});

chrome.bookmarks?.onImportEnded?.addListener(() => {
	browserBookmarkImporting = false;
	void chrome.storage.session?.remove(BROWSER_IMPORT_KEY);
});

chrome.bookmarks?.onCreated?.addListener((_id, node) => {
	if (browserBookmarkImporting) {
		return;
	}

	// Folders count towards a burst (a pasted folder arrives as folder plus children) but are never offered.
	browserBookmarkBurst.push(node);
	clearTimeout(browserBookmarkTimer);
	browserBookmarkTimer = setTimeout(
		flushBrowserBookmarks,
		BROWSER_BOOKMARK_QUIET_MS,
	);
});

chrome.runtime.onInstalled.addListener((details) => {
	void initializeExtension();
	if (details.reason === 'install') {
		void chrome.tabs.create({
			url: chrome.runtime.getURL('newtab.html'),
			active: true,
		});
	}
});

chrome.runtime.onStartup.addListener(() => {
	void initializeExtension(true);
});
