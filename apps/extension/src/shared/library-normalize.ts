/*
Reads untrusted stored data (the library, an import, a message) into the shapes the app works with: every field is
checked, unknown values fall back to defaults, and limits are enforced. The service worker runs it on every read and
write; the pages and the Android app reuse its limits and field checks.
*/
import {isAccent} from './accent-colors';
import {
	BOOKMARK_UNFILED_ID,
	DEFAULT_BOOKMARK_COLUMN_ID,
} from './bookmark-rules';
import {deviceStamp, isDeviceKind, MAX_DEVICE_NAME} from './device';
import {ICON_IDS} from './icon-ids';
import {LAYOUT_VERSION} from './library-state';
import {isRecord} from './library-values';
import type {
	Bookmark,
	BookmarkColumn,
	Folder,
	NativeGroup,
	SavedTab,
	Session,
	Settings,
	SplitInfo,
	Store,
	TabGroupColor,
} from './types';

export const ARCHIVED_FOLDER_NAME = 'Archived';

// The same code runs in Chromium (a service worker) and in Firefox (an event page); the address of the extension's
// own pages tells them apart. False anywhere without extension APIs.
const isFirefox = () =>
	globalThis.chrome?.runtime?.getURL?.('')?.startsWith('moz-extension:') ??
	false;

/**
Untrusted object (stored state or import file): every field is checked before use.
*/
export type Raw = Record<string, unknown>;

/**
Settings as stored or patched; unknown values are normalized.
*/
export type RawSettings = {[K in keyof Settings]?: unknown} & {
	duplicateHandling?: unknown;
	sidePanelEnabled?: unknown;
	toolbarOpens?: unknown;
	showBookmarkQuickActions?: unknown;
	bookmarkQuickAction?: unknown;
	showSessionArchiveQuickAction?: unknown;
	showSessionDeleteQuickAction?: unknown;
};

/**
`Array.isArray` narrows to `any[]`; this keeps the elements `unknown`.
*/
export const arrayOf = (value: unknown): unknown[] =>
	Array.isArray(value) ? (value as unknown[]) : [];

export const isInteger = (value: unknown): value is number =>
	Number.isSafeInteger(value);

/**
The number when it is finite and above zero (a usable timestamp), otherwise `fallback`.
*/
export const positiveOr = (value: unknown, fallback: number) => {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : fallback;
};

/**
A web address as typed, when it is a valid http(s) URL; otherwise an empty string.
*/
export function httpUrlOrEmpty(value: unknown): string {
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

export function isOneOf<T extends string>(
	values: readonly T[],
	value: unknown,
): value is T {
	return (values as readonly unknown[]).includes(value);
}

// 10: sessions and bookmarks live in their own storage keys (src/shared/library-state.ts); the data model is unchanged from 9.
export const SCHEMA_VERSION = LAYOUT_VERSION;

export const DEFAULT_FOLDER_ID = 'unfiled';

export const ARCHIVED_FOLDER_ID = 'archived-sessions';

export const MAX_FOLDERS = 200;

export const isArchivedFolderName = (name: string) =>
	name.toLocaleLowerCase() === ARCHIVED_FOLDER_NAME.toLocaleLowerCase();

// Loading keeps at most this many sessions and links per session, so every write path has to stay inside the same limits.
export const MAX_SESSIONS = 1000;

export const MAX_TABS_PER_SESSION = 1000;

export const MAX_EXCLUDED_ORIGINS = 500;

export const DEFAULT_FOLDER = Object.freeze<Folder>({
	id: DEFAULT_FOLDER_ID,
	name: 'Unfiled',
	createdAt: 0,
	isDefault: true,
});

export const DEFAULT_BOOKMARK_COLUMN = Object.freeze<BookmarkColumn>({
	id: DEFAULT_BOOKMARK_COLUMN_ID,
	name: 'Bookmarks',
	createdAt: 0,
	isDefault: true,
});

export const DEFAULT_SETTINGS = Object.freeze<Settings>({
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
	excludedOrigins: [],
	saveDuplicateHandling: 'allow',
	saveDuplicateTitle: 'existing',
	restoreDuplicateHandling: 'skip',
	restoreTarget: 'new-window-unless-only-tab',
	restoreWindowBounds: false,
	restoreMode: 'keep',
	singleTabBehavior: 'stay',
	unloadRestoredTabs: false,
	unloadRestoredTabsThreshold: 5,
	restoreSplitTabs: 'split',
	saveSplitTabs: 'both',
	paletteLocation: 'page',
	sessionSort: 'newest',
	expandSessionsByDefault: false,
	showSessionFaviconPreviews: true,
	sessionQuickActions: ['archive'],
	stretchBookmarkColumns: true,
	bookmarkColumnWidth: 'default',
	bookmarkColumnsPerRow: 0,
	bookmarkDensity: 'comfortable',
	limitBookmarksPerColumn: true,
	bookmarkColumnPageSize: 16,
	pasteLinkToBookmark: true,
	cleanTitles: true,
	bookmarkClickAction: 'current',
	sessionLinkClickAction: 'new',
	bookmarkQuickActions: ['open-new'],
	sessionsOnTop: false,
	showSaveWindowButton: true,
	linkPreviews: false,
	showTrashBinButton: false,
	keepLodgePinned: false,
	browserBookmarkAction: 'off',
	browserBookmarkColumn: '',
	copyFormat: 'markdown',
	dashboardBehavior: 'switch',
	urlDisplayMode: 'full',
	dashboardWidth: 'default',
	bookmarkBoardView: 'board',
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
	mobileApp: {},
});

export const ICON_ID_SET = new Set<unknown>(ICON_IDS);

export const GROUP_COLORS = new Set<unknown>([
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

export const isGroupColor = (value: unknown): value is TabGroupColor =>
	GROUP_COLORS.has(value);

export function makeId() {
	return (
		globalThis.crypto?.randomUUID?.() ||
		`${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
	);
}

export function cleanText(value: unknown, fallback: unknown = '', max = 240) {
	const text = String(value ?? '')
		.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
		.trim()
		.slice(0, max);
	return text || String(fallback).slice(0, max);
}

export const SESSION_NAME_TEMPLATE_MAX = 200;

export const SESSION_NAME_FALLBACKS: Array<Settings['sessionNameFallback']> = [
	'title',
	'datetime',
	'date-title',
	'custom',
];

export const SESSION_NAME_STYLES: Array<Settings['sessionNameStyle']> = [
	...SESSION_NAME_FALLBACKS,
	'ask',
];

export function normalizeUrl(value: unknown): string | null {
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

export function normalizeNativeGroup(
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

export function normalizeTab(
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
export function normalizeSplit(value: unknown): SplitInfo | undefined {
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
export const splitField = (
	split: SplitInfo | undefined,
): {split?: SplitInfo} => (split ? {split} : {});

export const groupKeyOf = (tab: SavedTab) =>
	tab.nativeGroup
		? tab.nativeGroup.key || tab.nativeGroup.title || 'default'
		: null;

/**
 Keeps split info only on complete pairs: two neighboring tabs with the same pair key, one at each position,
 and matching pinned and tab-group state (the browser's own split constraints). The left tab (position 0) is
 moved first if the two were stored the other way around. Orphans (a deleted, skipped, or filtered partner),
 reused keys, and mismatched pairs lose their split info; the tabs themselves are kept.
 */
export function pairSplits(tabs: SavedTab[]): SavedTab[] {
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
export function iconField(value: unknown): {icon?: string} {
	return typeof value === 'string' && ICON_ID_SET.has(value)
		? {icon: value}
		: {};
}

/**
The `color` property for a stored column: a preset accent id or `#rrggbb`. "default", "system", and anything else are dropped,
so a column without a color stores no field.
*/
export function colorField(value: unknown): {color?: string} {
	return typeof value === 'string' &&
		value !== 'default' &&
		value !== 'system' &&
		isAccent(value)
		? {color: value}
		: {};
}

export function normalizeFolder(raw: unknown): Folder | null {
	if (!isRecord(raw)) {
		return null;
	}

	const id = cleanText(raw.id, makeId(), 100);
	if (id === 'all') {
		return null;
	}

	const name = cleanText(raw.name, 'New folder', 60);
	return {
		id,
		name: isArchivedFolderName(name) ? ARCHIVED_FOLDER_NAME : name,
		...iconField(raw.icon),
		createdAt: Number.isFinite(Number(raw.createdAt))
			? Number(raw.createdAt)
			: Date.now(),
		isDefault: id === DEFAULT_FOLDER_ID,
	};
}

export function isArchivedFolderEntry(entry: unknown): entry is Raw {
	return isRecord(entry) && isArchivedFolderName(cleanText(entry.name, '', 60));
}

export function archivedFolderIds(rawFolders: unknown): Set<string> {
	const entries = arrayOf(rawFolders);
	const regularIds = new Set(
		entries
			.filter(
				(folder): folder is Raw =>
					isRecord(folder) && !isArchivedFolderEntry(folder),
			)
			.map((folder) => cleanText(folder.id, '', 100))
			.filter(Boolean),
	);
	return new Set(
		entries
			.filter(isArchivedFolderEntry)
			.map((folder) => cleanText(folder.id, '', 100))
			.filter(
				(id) =>
					id && id !== 'all' && id !== DEFAULT_FOLDER_ID && !regularIds.has(id),
			),
	);
}

export function folderEntriesWithArchive(rawFolders: unknown): unknown[] {
	const entries = arrayOf(rawFolders);
	const archivedIndex = entries.findIndex((entry) =>
		isArchivedFolderEntry(entry),
	);
	const regular = entries.filter(
		(entry, index) => index !== archivedIndex && !isArchivedFolderEntry(entry),
	);
	const limited = regular.slice(0, MAX_FOLDERS);
	return archivedIndex === -1 ? limited : [...limited, entries[archivedIndex]];
}

export function normalizeFolders(rawFolders: unknown): Folder[] {
	const seenIds = new Set(['all']);
	const folders: Folder[] = [];
	for (const raw of folderEntriesWithArchive(rawFolders)) {
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

	findOrAddArchivedFolder(folders);

	return folders;
}

export function normalizeNotes(value: unknown) {
	return typeof value === 'string'
		? value.replaceAll('\u0000', '').slice(0, 10_000)
		: '';
}

// Sessions used to have a short description plus separate notes; one field now holds both.
// Room for the old 500-character description, a blank line, and the old 10,000-character notes.
export const SESSION_TEXT_MAX = 10_502;

export function normalizeSessionText(value: unknown) {
	return typeof value === 'string'
		? value.replaceAll('\u0000', '').slice(0, SESSION_TEXT_MAX)
		: '';
}

export function mergeSessionText(description: unknown, notes: unknown) {
	const first = typeof description === 'string' ? description.trim() : '';
	const second = typeof notes === 'string' ? notes.trim() : '';
	if (first && second && first !== second) {
		return normalizeSessionText(
			`${first.slice(0, 500)}\n\n${second.slice(0, 10_000)}`,
		);
	}

	return normalizeSessionText(first || second);
}

export function normalizeBookmarkColumn(raw: unknown): BookmarkColumn | null {
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
		...colorField(raw.color),
		...domainsField(raw.domains),
		createdAt: Number.isFinite(Number(raw.createdAt))
			? Number(raw.createdAt)
			: Date.now(),
		isDefault: id === DEFAULT_BOOKMARK_COLUMN_ID,
	};
}

export const MAX_COLUMN_DOMAINS = 50;

/**
A column site entry: a bare host ("github.com"), or a host with a path prefix ("github.com/bberka"). Query and fragment
are dropped and a trailing slash is ignored. Null when the host is not usable.
*/
export function normalizeColumnSite(value: unknown): string | null {
	const host = normalizeExcludedHost(value);
	if (!host || typeof value !== 'string') {
		return null;
	}

	let path = '';
	try {
		const text = value.trim().replace(/^([a-z][\d+\-.a-z]*:\/\/)?\*\./i, '$1');
		path = new URL(
			/^[a-z][\d+\-.a-z]*:\/\//i.test(text) ? text : `https://${text}`,
		).pathname.replace(/\/+$/, '');
	} catch {
		return null;
	}

	return `${host}${path}`;
}

/**
A column's sites as distinct entries, or `{}` when none remain, so a column without sites stores no field.
*/
export function domainsField(value: unknown): {domains?: string[]} {
	const sites = new Set<string>();
	for (const entry of Array.isArray(value) ? value : []) {
		const site = normalizeColumnSite(entry);
		if (site) {
			sites.add(site);
		}
	}

	return sites.size > 0
		? {domains: [...sites].slice(0, MAX_COLUMN_DOMAINS)}
		: {};
}

export function normalizeBookmarkColumns(
	rawColumns: unknown,
): BookmarkColumn[] {
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

export function fallbackBookmarkTitle(url: string) {
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

export function bookmarkTitleIsUrl(value: unknown, url: string) {
	const title = cleanText(value, '', 500)
		.replace(/^url:\s*/i, '')
		.trim();
	return (
		!title ||
		normalizeUrl(title) === url ||
		title === fallbackBookmarkTitle(url)
	);
}

export function cleanBookmarkTitle(value: unknown, url: string) {
	return bookmarkTitleIsUrl(value, url)
		? fallbackBookmarkTitle(url)
		: cleanText(value, '', 500)
				.replace(/^url:\s*/i, '')
				.trim();
}

export function normalizeBookmark(
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

export function normalizeGroup(
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
		...colorField(raw.color),
		sourceWindowName: cleanText(raw.sourceWindowName, '', 180),
		sourceWindowId: isInteger(raw.sourceWindowId) ? raw.sourceWindowId : null,
		...deviceStamp(
			cleanText(raw.deviceName, '', MAX_DEVICE_NAME),
			isDeviceKind(raw.deviceKind) ? raw.deviceKind : 'desktop',
		),
		...(isRecord(raw.windowBounds) &&
			[
				raw.windowBounds.left,
				raw.windowBounds.top,
				raw.windowBounds.width,
				raw.windowBounds.height,
			].every((value) => Number.isFinite(value)) &&
			Number(raw.windowBounds.width) > 0 &&
			Number(raw.windowBounds.height) > 0 && {
				windowBounds: {
					left: Number(raw.windowBounds.left),
					top: Number(raw.windowBounds.top),
					width: Number(raw.windowBounds.width),
					height: Number(raw.windowBounds.height),
				},
			}),
		tabs,
	};
}

export type BookmarkQuickAction = Settings['bookmarkQuickActions'][number];

export const BOOKMARK_QUICK_ACTIONS = [
	'open-current',
	'open-new',
	'copy',
	'edit',
	'delete',
	'move',
	'move-up',
	'move-down',
] as const satisfies readonly BookmarkQuickAction[];

export function normalizeBookmarkQuickActions(
	raw: RawSettings,
): BookmarkQuickAction[] {
	let candidates: unknown[];
	if (Array.isArray(raw.bookmarkQuickActions)) {
		candidates = raw.bookmarkQuickActions;
	} else if (raw.bookmarkQuickActions !== undefined) {
		candidates = ['open-new'];
	} else if (
		raw.showBookmarkQuickActions === true &&
		isOneOf(BOOKMARK_QUICK_ACTIONS, raw.bookmarkQuickAction)
	) {
		candidates = [raw.bookmarkQuickAction];
	} else {
		candidates = ['open-new'];
	}

	const selected: BookmarkQuickAction[] = [];
	for (const action of candidates) {
		if (isOneOf(BOOKMARK_QUICK_ACTIONS, action) && !selected.includes(action)) {
			selected.push(action);
		}
	}

	return selected.slice(0, 3);
}

export type SessionQuickAction = Settings['sessionQuickActions'][number];

export const SESSION_QUICK_ACTIONS = [
	'archive',
	'delete',
	'share',
	'export',
	'edit',
	'move-up',
	'move-down',
	'switch-to',
] as const satisfies readonly SessionQuickAction[];

export function normalizeSessionQuickActions(
	raw: RawSettings,
): SessionQuickAction[] {
	let candidates: unknown[];
	if (Array.isArray(raw.sessionQuickActions)) {
		candidates = raw.sessionQuickActions;
	} else if (raw.sessionQuickActions === undefined) {
		candidates = [
			...(raw.showSessionArchiveQuickAction === false ? [] : ['archive']),
			...(raw.showSessionDeleteQuickAction === true ? ['delete'] : []),
		];
	} else {
		candidates = ['archive'];
	}

	const selected: SessionQuickAction[] = [];
	for (const action of candidates) {
		if (isOneOf(SESSION_QUICK_ACTIONS, action) && !selected.includes(action)) {
			selected.push(action);
		}
	}

	return selected.slice(0, 5);
}

export const MOBILE_APP_KEYS_MAX = 20;

export const MOBILE_APP_TEXT_MAX = 40;

/**
The Android app's preferences, kept as they are so they sync between phones: a few short keys with plain values.
*/
export function normalizeMobileApp(value: unknown): Settings['mobileApp'] {
	const kept: Array<[string, string | number | boolean]> = [];
	for (const [key, item] of isRecord(value) ? Object.entries(value) : []) {
		const plain =
			typeof item === 'boolean' ||
			(typeof item === 'number' && Number.isFinite(item)) ||
			(typeof item === 'string' && item.length <= MOBILE_APP_TEXT_MAX);
		if (plain && key.length <= MOBILE_APP_TEXT_MAX) {
			kept.push([key, item]);
		}
	}

	return Object.fromEntries(kept.slice(0, MOBILE_APP_KEYS_MAX));
}

export function normalizeSettings(input: RawSettings | null = {}): Settings {
	// A missing, null or non-object stored value means "no saved preferences": every field falls back to its default.
	const raw: RawSettings = isRecord(input) ? input : {};
	const savedActionMode = isOneOf(
		[
			'sidepanel',
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
		: 'popup';
	const actionMode =
		raw.toolbarOpens === 'sidepanel' || raw.sidePanelEnabled === true
			? 'sidepanel'
			: savedActionMode;
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
		// Firefox opens a new tab as a blank page before the add-on's page loads, so the worker cannot tell it from the
		// dashboard being opened and cannot hand it on.
		newTabEnabled: isFirefox() || raw.newTabEnabled !== false,
		newTabFallback: isOneOf(['browser', 'blank', 'custom'], raw.newTabFallback)
			? raw.newTabFallback
			: 'browser',
		newTabFallbackUrl: httpUrlOrEmpty(raw.newTabFallbackUrl),
		autoFocusSearchOnNewTab: raw.autoFocusSearchOnNewTab === true,
		actionMode,
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
		restoreWindowBounds: raw.restoreWindowBounds === true,
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
		paletteLocation: raw.paletteLocation === 'window' ? 'window' : 'page',
		sessionSort: isOneOf(
			['newest', 'oldest', 'opened', 'name', 'tabs', 'custom'],
			raw.sessionSort,
		)
			? raw.sessionSort
			: 'newest',
		expandSessionsByDefault: raw.expandSessionsByDefault === true,
		showSessionFaviconPreviews: raw.showSessionFaviconPreviews !== false,
		sessionQuickActions: normalizeSessionQuickActions(raw),
		stretchBookmarkColumns: raw.stretchBookmarkColumns !== false,
		bookmarkColumnWidth: isOneOf(
			['narrow', 'default', 'wide', 'extra-wide'],
			raw.bookmarkColumnWidth,
		)
			? raw.bookmarkColumnWidth
			: 'default',
		bookmarkColumnsPerRow: clampInteger(raw.bookmarkColumnsPerRow, 0, 6, 0),
		bookmarkDensity:
			raw.bookmarkDensity === 'compact' ? 'compact' : 'comfortable',
		limitBookmarksPerColumn: raw.limitBookmarksPerColumn !== false,
		bookmarkColumnPageSize: clampInteger(
			raw.bookmarkColumnPageSize,
			1,
			500,
			16,
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
		bookmarkQuickActions: normalizeBookmarkQuickActions(raw),
		sessionsOnTop: raw.sessionsOnTop === true,
		showSaveWindowButton: raw.showSaveWindowButton !== false,
		linkPreviews: raw.linkPreviews === true,
		showTrashBinButton: raw.showTrashBinButton === true,
		dashboardWidth: isOneOf(
			['default', 'wider', 'full', 'narrower'],
			raw.dashboardWidth,
		)
			? raw.dashboardWidth
			: 'default',
		bookmarkBoardView: isOneOf(['board', 'focus'], raw.bookmarkBoardView)
			? raw.bookmarkBoardView
			: 'board',
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
		mobileApp: normalizeMobileApp(raw.mobileApp),
	};
	return settings;
}

/**
A number from a fixed list (numeric strings count); anything else gives the fallback.
*/
export function oneOfNumbers(
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
export function clampInteger(
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
export function urlHost(url: string): string | null {
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
export function normalizeExcludedHost(value: unknown): string | null {
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
Normalizes the stored list: hosts only, duplicates removed. A child such as "mail.google.com" next to "google.com"
is kept, since it is harmless and shows what the user added.
*/
export function normalizeExcludedOrigins(raw: unknown): string[] {
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
export function findOrAddArchivedFolder(folders: Folder[]): Folder {
	let folder = folders.find((entry) => isArchivedFolderName(entry.name));
	if (folder) {
		folder.name = ARCHIVED_FOLDER_NAME;
	} else {
		// Every read normalizes the library, so the added folder must come out the same each time: sync would
		// otherwise see a new folder on every read and send it forever.
		const taken = new Set(folders.map((entry) => entry.id));
		let id = ARCHIVED_FOLDER_ID;
		for (let suffix = 2; taken.has(id); suffix += 1) {
			id = `${ARCHIVED_FOLDER_ID}-${suffix}`;
		}

		folder = {
			id,
			name: ARCHIVED_FOLDER_NAME,
			icon: 'archive',
			createdAt: 0,
			isDefault: false,
		};
		folders.push(folder);
	}

	return folder;
}

export function normalizeStore(raw: Raw | null | undefined): Store {
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
	const archivedIds = archivedFolderIds(raw?.folders);
	const folders = normalizeFolders(raw?.folders);
	const archivedFolderId = folders.find((folder) =>
		isArchivedFolderName(folder.name),
	)?.id;
	const knownFolderIds = new Set(folders.map((folder) => folder.id));
	for (const group of groups) {
		if (archivedIds.has(group.folderId) && archivedFolderId) {
			group.folderId = archivedFolderId;
		}

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
