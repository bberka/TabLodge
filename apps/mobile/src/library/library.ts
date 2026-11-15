/*
Pure edits of the synced library. The phone keeps the same `Store` the extension does, so the sync client in
apps/extension/src/shared/sync can merge it with the server; these functions only change bookmarks and columns.
*/
import type {
	Bookmark,
	Folder,
	SavedTab,
	Session,
	Settings,
	Store,
} from '../../../extension/src/shared/types';
import {isColumnColor} from '../../../extension/src/shared/accent-colors';
import {
	BOOKMARK_UNFILED_ID,
	cleanColumnName,
	columnNameProblem,
	DEFAULT_BOOKMARK_COLUMN_ID,
	DEFAULT_BOOKMARK_COLUMN_NAME,
	landingColumnId,
} from '../../../extension/src/shared/bookmark-rules';
import {
	columnForUrl,
	domainsField,
} from '../../../extension/src/shared/column-sites';
import type {DeviceStamp} from '../../../extension/src/shared/device';
import {LAYOUT_VERSION} from '../../../extension/src/shared/library-index';
import {normalizeNotes} from '../../../extension/src/shared/library-normalize';
import {
	FOLDER_LIMIT_MESSAGE,
	folderLimitReached,
	folderNameProblem as sharedFolderNameProblem,
	normalizeFolderName,
} from '../../../extension/src/shared/session-folders';

type ColumnView = {id: string; name: string; icon?: string; color?: string};

export const isStore = (value: unknown): value is Store =>
	typeof value === 'object' &&
	value !== null &&
	Array.isArray((value as Store).bookmarks) &&
	Array.isArray((value as Store).bookmarkColumns) &&
	Array.isArray((value as Store).groups) &&
	Array.isArray((value as Store).folders);

export function emptyStore(now: number): Store {
	return {
		schemaVersion: LAYOUT_VERSION,
		groups: [],
		folders: [],
		bookmarkColumns: [],
		bookmarks: [],
		// Portable preferences arrive from the server; this app reads none of them.
		settings: {} as Settings,
		updatedAt: now,
	};
}

/**
The first web address in a piece of shared text, or undefined when there is none. Share sheets often send
"Title https://example.com" rather than a bare link.
*/
export function extractUrl(text: string): string | undefined {
	for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
		const candidate = match[0].replace(/[!),.:;?\]]+$/, '');
		try {
			const url = new URL(candidate);
			if (url.protocol === 'http:' || url.protocol === 'https:') {
				return url.href;
			}
		} catch {
			// Try the next match.
		}
	}

	return undefined;
}

/**
Every web link in some text, in order and without repeats. Browsers share a list of tabs this way.
*/
export function extractUrls(text: string): string[] {
	const urls = new Set<string>();
	for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
		const url = extractUrl(match[0]);
		if (url) {
			urls.add(url);
		}
	}

	return [...urls];
}

export function hostOf(url: string): string {
	try {
		return new URL(url).host.replace(/^www\./, '');
	} catch {
		return url;
	}
}

export type LibraryStats = {
	sessions: number;
	/**
	Saved tabs, across every session.
	*/
	tabs: number;
	folders: number;
	bookmarks: number;
	columns: number;
	/**
	The sites that hold the most saved links (bookmarks and saved tabs), most first.
	*/
	topSites: Array<{host: string; count: number}>;
	largestSession?: {name: string; tabs: number};
	/**
	When the oldest session or bookmark was saved, if any has a date.
	*/
	since?: number;
};

const TOP_SITES = 5;

/**
What the library holds, for the Statistics sheet.
*/
export function libraryStats(store: Store): LibraryStats {
	const counts = new Map<string, number>();
	const count = (url: string) => {
		const host = hostOf(url);
		counts.set(host, (counts.get(host) ?? 0) + 1);
	};

	let tabs = 0;
	let largest: {name: string; tabs: number} | undefined;
	let since: number | undefined;
	const seen = (time: number | undefined) => {
		if (
			time !== undefined &&
			time > 0 &&
			(since === undefined || time < since)
		) {
			since = time;
		}
	};

	for (const session of store.groups) {
		tabs += session.tabs.length;
		for (const tab of session.tabs) {
			count(tab.url);
		}

		if (!largest || session.tabs.length > largest.tabs) {
			largest = {name: session.name, tabs: session.tabs.length};
		}

		seen(session.createdAt);
	}

	for (const bookmark of store.bookmarks) {
		count(bookmark.url);
		seen(bookmark.createdAt);
	}

	return {
		sessions: store.groups.length,
		tabs,
		folders: store.folders.length,
		bookmarks: store.bookmarks.length,
		columns: store.bookmarkColumns.length,
		topSites: [...counts]
			.map(([host, total]) => ({host, count: total}))
			.toSorted((a, b) => b.count - a.count || a.host.localeCompare(b.host))
			.slice(0, TOP_SITES),
		largestSession: largest,
		since,
	};
}

/**
The columns to show: the library's own, plus "Unfiled" when a bookmark points at a column that does not exist.
*/
export function columnViews(store: Store): ColumnView[] {
	const known = new Set(store.bookmarkColumns.map((column) => column.id));
	const views: ColumnView[] = store.bookmarkColumns.map(
		({id, name, icon, color}) => ({id, name, icon, color}),
	);
	if (store.bookmarks.some((bookmark) => !known.has(bookmark.columnId))) {
		views.push({id: BOOKMARK_UNFILED_ID, name: 'Unfiled'});
	}

	return views;
}

export function bookmarksIn(store: Store, columnId: string): Bookmark[] {
	const known = new Set(store.bookmarkColumns.map((column) => column.id));
	return store.bookmarks.filter((bookmark) =>
		columnId === BOOKMARK_UNFILED_ID
			? !known.has(bookmark.columnId)
			: bookmark.columnId === columnId,
	);
}

/**
The id of the system column that lists every bookmark of every column. It is not stored and cannot be changed.
*/
export const ALL_BOOKMARKS_ID = 'all-bookmarks';

/**
Every bookmark, column by column in the columns' order and the Unfiled bucket last, each column in its own order.
*/
export function allBookmarks(store: Store): Bookmark[] {
	return columnViews(store).flatMap((column) => bookmarksIn(store, column.id));
}

export function searchBookmarks(store: Store, query: string): Bookmark[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return store.bookmarks.filter((bookmark) => {
		const text = `${bookmark.title} ${bookmark.url}`.toLowerCase();
		return words.every((word) => text.includes(word));
	});
}

/**
Adds a column with an optional icon id from the extension's icon set, and an optional color from its accent palette.
*/
export function addColumn(
	store: Store,
	name: string,
	id: string,
	now: number,
	icon?: string,
	color?: string,
): Store {
	const trimmed = cleanColumnName(name);
	if (!trimmed) {
		return store;
	}

	return {
		...store,
		bookmarkColumns: [
			...store.bookmarkColumns,
			{
				id,
				name: trimmed,
				createdAt: now,
				isDefault: false,
				...(icon && {icon}),
				...(isColumnColor(color) && {color}),
			},
		],
		updatedAt: now,
	};
}

type NewBookmark = {url: string; title: string; columnId: string};

/**
Adds a bookmark at the end of its column, as the extension does. A column that does not exist falls back as it does there (the column that claims the link's site, the default column, the first). When the library has no column yet, the extension's default one is
created, so a first link can be saved before the first sync.
*/
export function addBookmark(
	store: Store,
	input: NewBookmark,
	id: string,
	now: number,
): Store {
	const url = extractUrl(input.url);
	if (!url) {
		return store;
	}

	let next = store;
	if (next.bookmarkColumns.length === 0) {
		next = {
			...next,
			bookmarkColumns: [
				{
					id: DEFAULT_BOOKMARK_COLUMN_ID,
					name: DEFAULT_BOOKMARK_COLUMN_NAME,
					createdAt: now,
					isDefault: true,
				},
			],
		};
	}

	const columnId = landingColumnId(next.bookmarkColumns, input.columnId, {
		claimedId: columnForUrl(next.bookmarkColumns, url)?.id,
	});
	const bookmark: Bookmark = {
		id,
		title: input.title.trim() || hostOf(url),
		url,
		columnId,
		createdAt: now,
		updatedAt: now,
	};
	return {...next, bookmarks: [...next.bookmarks, bookmark], updatedAt: now};
}

/**
Changes a bookmark's link, title, or column. It keeps its place, unless the column changes: then it goes to the
end of the new column, as in the extension. An unusable link or a missing bookmark or column leaves the store as it was.
*/
export function updateBookmark(
	store: Store,
	id: string,
	input: NewBookmark,
	now: number,
): Store {
	const current = store.bookmarks.find((bookmark) => bookmark.id === id);
	const url = extractUrl(input.url);
	if (
		!current ||
		!url ||
		store.bookmarkColumns.every((column) => column.id !== input.columnId)
	) {
		return store;
	}

	const changed: Bookmark = {
		...current,
		url,
		title: input.title.trim() || hostOf(url),
		columnId: input.columnId,
		updatedAt: now,
	};
	const bookmarks =
		current.columnId === input.columnId
			? store.bookmarks.map((bookmark) =>
					bookmark.id === id ? changed : bookmark,
				)
			: [...store.bookmarks.filter((bookmark) => bookmark.id !== id), changed];
	return {...store, bookmarks, updatedAt: now};
}

/**
Removes several bookmarks at once.
*/
export function removeBookmarks(
	store: Store,
	ids: ReadonlySet<string>,
	now: number,
): Store {
	if (ids.size === 0) {
		return store;
	}

	return {
		...store,
		bookmarks: store.bookmarks.filter((bookmark) => !ids.has(bookmark.id)),
		updatedAt: now,
	};
}

/**
Moves several bookmarks to the end of another column, keeping their order.
*/
export function moveBookmarks(
	store: Store,
	ids: ReadonlySet<string>,
	columnId: string,
	now: number,
): Store {
	if (
		ids.size === 0 ||
		store.bookmarkColumns.every((column) => column.id !== columnId)
	) {
		return store;
	}

	const moved = store.bookmarks
		.filter((bookmark) => ids.has(bookmark.id))
		.map((bookmark) => ({...bookmark, columnId, updatedAt: now}));
	const rest = store.bookmarks.filter((bookmark) => !ids.has(bookmark.id));
	return {...store, bookmarks: [...rest, ...moved], updatedAt: now};
}

/**
A bookmark about to be removed, with where it sat: `after` is the bookmark before it in the same column that stays,
or null when it was first there.
*/
export type RemovedBookmark = {bookmark: Bookmark; after: string | null};

/**
The bookmarks of `ids`, each with its place, so an undo can put them back where they were.
*/
export function removedBookmarks(
	store: Store,
	ids: ReadonlySet<string>,
): RemovedBookmark[] {
	const removed: RemovedBookmark[] = [];
	const lastKept = new Map<string, string>();
	for (const bookmark of store.bookmarks) {
		if (ids.has(bookmark.id)) {
			removed.push({
				bookmark,
				after: lastKept.get(bookmark.columnId) ?? null,
			});
		} else {
			lastKept.set(bookmark.columnId, bookmark.id);
		}
	}

	return removed;
}

/**
Puts bookmarks back after an undo, where they were in their column, as the extension's undo does. They get new ids,
though the sync server would take the old ones back too, since a newer change beats a delete. A
bookmark whose column is gone goes to the first column, at its start.
*/
export function restoreBookmarks(
	store: Store,
	removed: readonly RemovedBookmark[],
	newIds: string[],
	now: number,
): Store {
	const known = new Set(store.bookmarkColumns.map((column) => column.id));
	const bookmarks = [...store.bookmarks];
	// The last bookmark restored behind each anchor, so neighbours removed together come back in their old order.
	const lastBehind = new Map<string, string>();
	for (const [index, {bookmark, after}] of removed.entries()) {
		const moved = !known.has(bookmark.columnId);
		const columnId = moved
			? (store.bookmarkColumns[0]?.id ?? bookmark.columnId)
			: bookmark.columnId;
		const restored = {...bookmark, id: newIds[index], columnId, updatedAt: now};
		const key = `${columnId}\n${moved ? '' : (after ?? '')}`;
		const behind = lastBehind.get(key) ?? (moved ? null : after);
		const anchor = behind
			? bookmarks.findIndex((entry) => entry.id === behind)
			: -1;
		const firstInColumn = bookmarks.findIndex(
			(entry) => entry.columnId === columnId,
		);
		let at = bookmarks.length;
		if (anchor !== -1) {
			at = anchor + 1;
		} else if (firstInColumn !== -1) {
			at = firstInColumn;
		}

		bookmarks.splice(at, 0, restored);
		lastBehind.set(key, restored.id);
	}

	return {...store, bookmarks, updatedAt: now};
}

/**
Splits text shared from another app into its link and a title. Browsers share "Page title https://example.com",
so the words around the link become the title.
*/
export function splitShared(text: string): {url?: string; title: string} {
	const url = extractUrl(text);
	if (!url) {
		return {title: ''};
	}

	const match = /https?:\/\/[^\s"'<>]+/i.exec(text);
	const rest = match
		? `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`
		: text;
	return {url, title: rest.replaceAll(/\s+/g, ' ').trim()};
}

export type ColumnEdit = {name: string; icon: string; color: string};

/**
Changes a column's name, icon, and color, and keeps everything else about it, such as the sites that file into it. An
empty icon or color removes it. A bad name or an unknown column leaves the store as it was.
*/
export function updateColumn(
	store: Store,
	id: string,
	edit: ColumnEdit,
	now: number,
): Store {
	const current = store.bookmarkColumns.find((column) => column.id === id);
	if (!current || columnNameProblem(store.bookmarkColumns, edit.name, id)) {
		return store;
	}

	// The icon and color are rebuilt, so an empty or unknown value drops the field rather than leaving the old one.
	const {icon: _icon, color: _color, ...rest} = current;
	const changed = {
		...rest,
		name: cleanColumnName(edit.name),
		...(edit.icon && {icon: edit.icon}),
		...(isColumnColor(edit.color) && {color: edit.color}),
	};
	return {
		...store,
		bookmarkColumns: store.bookmarkColumns.map((column) =>
			column.id === id ? changed : column,
		),
		updatedAt: now,
	};
}

/**
Replaces the sites that file into a column. Each entry is normalized and repeats are dropped; an empty list removes the
field, as in the extension. An unknown column leaves the store as it was.
*/
export function setColumnSites(
	store: Store,
	id: string,
	sites: readonly string[],
	now: number,
): Store {
	const current = store.bookmarkColumns.find((column) => column.id === id);
	if (!current) {
		return store;
	}

	const {domains: _domains, ...rest} = current;
	const changed = {...rest, ...domainsField(sites)};
	return {
		...store,
		bookmarkColumns: store.bookmarkColumns.map((column) =>
			column.id === id ? changed : column,
		),
		updatedAt: now,
	};
}

/**
Sets a session's color, a preset id or `#rrggbb`, or removes it with an empty or unknown value. An unknown session
leaves the store as it was.
*/
export function setSessionColor(
	store: Store,
	id: string,
	color: string,
	now: number,
): Store {
	const current = store.groups.find((session) => session.id === id);
	if (!current) {
		return store;
	}

	const {color: _color, ...rest} = current;
	const changed = {
		...rest,
		...(isColumnColor(color) && {color}),
		updatedAt: now,
	};
	return {
		...store,
		groups: store.groups.map((session) =>
			session.id === id ? changed : session,
		),
		updatedAt: now,
	};
}

/**
Moves a column one place earlier (-1) or later (1) in the order the selectors and the extension show. A column at an
end, or one that does not exist, leaves the store as it was.
*/
export function moveColumn(
	store: Store,
	id: string,
	step: -1 | 1,
	now: number,
): Store {
	const from = store.bookmarkColumns.findIndex((column) => column.id === id);
	const to = from + step;
	if (from === -1 || to < 0 || to >= store.bookmarkColumns.length) {
		return store;
	}

	const columns = [...store.bookmarkColumns];
	const [moved] = columns.splice(from, 1);
	columns.splice(to, 0, moved);
	return {...store, bookmarkColumns: columns, updatedAt: now};
}

export type BookmarkMove = 'up' | 'down' | 'top' | 'bottom';

/**
Moves a bookmark within its own column: one place earlier or later, or to the top or the bottom. Other columns keep
their order. A bookmark already there, or one that does not exist, leaves the store as it was.
*/
export function moveBookmark(
	store: Store,
	id: string,
	move: BookmarkMove,
	now: number,
): Store {
	const bookmark = store.bookmarks.find((item) => item.id === id);
	if (!bookmark) {
		return store;
	}

	// The positions in the library's list that belong to this bookmark's column, in order.
	const slots = store.bookmarks.flatMap((item, index) =>
		item.columnId === bookmark.columnId ? [index] : [],
	);
	const here = slots.findIndex((index) => store.bookmarks[index]?.id === id);
	const target = {
		up: here - 1,
		down: here + 1,
		top: 0,
		bottom: slots.length - 1,
	}[move];
	if (target < 0 || target >= slots.length || target === here) {
		return store;
	}

	const order = slots.map((index) => store.bookmarks[index]);
	const [moved] = order.splice(here, 1);
	order.splice(target, 0, moved);
	const bookmarks = [...store.bookmarks];
	for (const [position, index] of slots.entries()) {
		bookmarks[index] = order[position]!;
	}

	return {...store, bookmarks, updatedAt: now};
}

/**
Deletes a column. Its bookmarks move to `moveTo` (another column, going after that column's own), or are deleted with
it when `moveTo` is null. With no other column to take them they go to the Unfiled bucket, as the extension does.
*/
export function deleteColumn(
	store: Store,
	id: string,
	moveTo: string | null,
	now: number,
): Store {
	if (store.bookmarkColumns.every((column) => column.id !== id)) {
		return store;
	}

	const remaining = store.bookmarkColumns.filter((column) => column.id !== id);
	const own = store.bookmarks.filter((bookmark) => bookmark.columnId === id);
	const others = store.bookmarks.filter((bookmark) => bookmark.columnId !== id);
	let bookmarks = others;
	if (moveTo !== null && own.length > 0) {
		const target =
			remaining.length === 0
				? BOOKMARK_UNFILED_ID
				: (remaining.find((column) => column.id === moveTo)?.id ??
					remaining[0]?.id ??
					BOOKMARK_UNFILED_ID);
		bookmarks = [
			...others,
			...own.map((bookmark) => ({
				...bookmark,
				columnId: target,
				updatedAt: now,
			})),
		];
	}

	return {...store, bookmarkColumns: remaining, bookmarks, updatedAt: now};
}

/**
Puts back a column that was deleted, with the bookmarks it held (as they were), for Undo. A bookmark that was moved to
another column comes back to this one; one that was deleted with it is added again.
*/
export function restoreColumn(
	store: Store,
	column: Store['bookmarkColumns'][number],
	bookmarks: ReadonlyArray<Store['bookmarks'][number]>,
	now: number,
): Store {
	if (store.bookmarkColumns.some((entry) => entry.id === column.id)) {
		return store;
	}

	const back = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
	const kept = store.bookmarks.map((bookmark) => {
		const original = back.get(bookmark.id);
		back.delete(bookmark.id);
		return original
			? {...bookmark, columnId: column.id, updatedAt: now}
			: bookmark;
	});
	return {
		...store,
		bookmarkColumns: [...store.bookmarkColumns, column],
		bookmarks: [
			...kept,
			...[...back.values()].map((bookmark) => ({...bookmark, updatedAt: now})),
		],
		updatedAt: now,
	};
}

export const ALL_SESSIONS_ID = 'all';
const ARCHIVED_FOLDER_ID = 'archived-sessions';
const OTHER_FOLDER_ID = 'other-sessions';

const isArchived = (folder: {id: string; name: string}) =>
	folder.id === ARCHIVED_FOLDER_ID ||
	folder.name.toLocaleLowerCase() === 'archived';

/**
Whether a session folder can be renamed or deleted: not Unfiled, which holds whatever has no other home, and not
Archived, as in the extension.
*/
export const canChangeFolder = (folder: {
	id: string;
	name: string;
	isDefault: boolean;
}): boolean => !folder.isDefault && !isArchived(folder);

/**
The message to show when the library holds the most folders it can, so a new one cannot be made, or undefined.
*/
export const folderLimitProblem = (store: Store): string | undefined =>
	folderLimitReached(store.folders) ? FOLDER_LIMIT_MESSAGE : undefined;

/**
Why this name cannot be a folder's, or undefined when it can: empty, the reserved "All sessions", another folder's, or, for
a new folder (no `exceptId`), the limit of 200 folders. The rules are the extension's.
*/
export const folderNameProblem = (
	store: Store,
	name: string,
	exceptId?: string,
): string | undefined =>
	sharedFolderNameProblem(store.folders, name, exceptId ?? null);

/**
Renames a session folder. A folder that cannot change, or a name that is not allowed, leaves the library as it was.
*/
export function renameFolder(
	store: Store,
	id: string,
	name: string,
	now: number,
): Store {
	const folder = store.folders.find((entry) => entry.id === id);
	if (
		!folder ||
		!canChangeFolder(folder) ||
		folderNameProblem(store, name, id)
	) {
		return store;
	}

	return {
		...store,
		folders: store.folders.map((entry) =>
			entry.id === id ? {...entry, name: normalizeFolderName(name)} : entry,
		),
		updatedAt: now,
	};
}

export type FolderEdit = {
	name: string;
	icon: string;
	color: string;
	colorSessions: boolean;
};

const folderFields = (edit: FolderEdit) => ({
	name: normalizeFolderName(edit.name),
	...(edit.icon && {icon: edit.icon}),
	...(isColumnColor(edit.color) && {
		color: edit.color,
		...(edit.colorSessions && {colorSessions: true as const}),
	}),
});

/**
Makes a session folder with a name, an icon, and a color. A name that is not allowed leaves the library as it was.
*/
export function addFolder(
	store: Store,
	edit: FolderEdit,
	id: string,
	now: number,
): Store {
	if (folderNameProblem(store, edit.name)) {
		return store;
	}

	return {
		...store,
		folders: [
			...store.folders,
			{id, createdAt: now, isDefault: false, ...folderFields(edit)},
		],
		updatedAt: now,
	};
}

/**
Changes a session folder's name, icon, color, and whether it colors the sessions moved into it. The icon and color are
rebuilt, so an empty value drops the field. A folder that cannot change, or a name that is not allowed, leaves the
library as it was.
*/
export function updateFolder(
	store: Store,
	id: string,
	edit: FolderEdit,
	now: number,
): Store {
	const folder = store.folders.find((entry) => entry.id === id);
	if (
		!folder ||
		!canChangeFolder(folder) ||
		folderNameProblem(store, edit.name, id)
	) {
		return store;
	}

	const {
		icon: _icon,
		color: _color,
		colorSessions: _colorSessions,
		...rest
	} = folder;
	return {
		...store,
		folders: store.folders.map((entry) =>
			entry.id === id ? {...rest, ...folderFields(edit)} : entry,
		),
		updatedAt: now,
	};
}

/**
Deletes a session folder and moves its sessions to Unfiled, as the extension does. A folder that cannot change leaves
the library as it was.
*/
export function deleteFolder(store: Store, id: string, now: number): Store {
	const folder = store.folders.find((entry) => entry.id === id);
	if (!folder || !canChangeFolder(folder)) {
		return store;
	}

	let {folders} = store;
	let fallback = folders.find((entry) => entry.isDefault)?.id;
	if (!fallback) {
		fallback = DEFAULT_SESSION_FOLDER_ID;
		folders = [
			...folders,
			{id: fallback, name: 'Unfiled', createdAt: now, isDefault: true},
		];
	}

	const target = fallback;
	return {
		...store,
		folders: folders.filter((entry) => entry.id !== id),
		groups: store.groups.map((session) =>
			session.folderId === id
				? {...session, folderId: target, updatedAt: now}
				: session,
		),
		updatedAt: now,
	};
}

/**
Puts back a folder that was deleted, with the sessions it held, for Undo.
*/
export function restoreFolder(
	store: Store,
	folder: Store['folders'][number],
	sessionIds: readonly string[],
	now: number,
): Store {
	if (store.folders.some((entry) => entry.id === folder.id)) {
		return store;
	}

	const back = new Set(sessionIds);
	return {
		...store,
		folders: [...store.folders, folder],
		groups: store.groups.map((session) =>
			back.has(session.id)
				? {...session, folderId: folder.id, updatedAt: now}
				: session,
		),
		updatedAt: now,
	};
}

export type SessionFolderView = {
	id: string;
	name: string;
	icon?: string;
	color?: string;
	count: number;
};

/**
The folders to filter sessions by, as the extension shows them: All (without what is archived), each folder in
its own order, and Archived last. Sessions in a folder that no longer exists fall under Other.
*/
export function sessionFolders(store: Store): SessionFolderView[] {
	const known = new Set(store.folders.map((folder) => folder.id));
	const archivedIds = new Set(
		store.folders.filter((folder) => isArchived(folder)).map(({id}) => id),
	);
	const count = (id: string) =>
		store.groups.filter((session) => session.folderId === id).length;
	const views: SessionFolderView[] = [
		{
			id: ALL_SESSIONS_ID,
			name: 'All',
			count: store.groups.filter(
				(session) => !archivedIds.has(session.folderId),
			).length,
		},
	];
	const plain = store.folders.filter((folder) => !isArchived(folder));
	const archived = store.folders.filter((folder) => isArchived(folder));
	for (const folder of [...plain, ...archived]) {
		views.push({
			id: folder.id,
			name: folder.name,
			icon: folder.icon,
			color: folder.color,
			count: count(folder.id),
		});
	}

	const loose = store.groups.filter(
		(session) => !known.has(session.folderId),
	).length;
	if (loose > 0) {
		views.splice(1 + plain.length, 0, {
			id: OTHER_FOLDER_ID,
			name: 'Other',
			count: loose,
		});
	}

	return views;
}

/**
The sessions in one filter, ordered like the extension's sort setting. All leaves out archived ones. `custom` keeps
the library's own order.
*/
export function sessionsIn(
	store: Store,
	folderId: string,
	sort: Settings['sessionSort'],
): Session[] {
	const known = new Set(store.folders.map((folder) => folder.id));
	const archivedIds = new Set(
		store.folders.filter((folder) => isArchived(folder)).map(({id}) => id),
	);
	const picked = store.groups.filter((session) => {
		if (folderId === ALL_SESSIONS_ID) {
			return !archivedIds.has(session.folderId);
		}

		return folderId === OTHER_FOLDER_ID
			? !known.has(session.folderId)
			: session.folderId === folderId;
	});
	switch (sort) {
		case 'newest': {
			return picked.toSorted((a, b) => b.createdAt - a.createdAt);
		}

		case 'oldest': {
			return picked.toSorted((a, b) => a.createdAt - b.createdAt);
		}

		case 'opened': {
			return picked.toSorted(
				(a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0),
			);
		}

		case 'name': {
			return picked.toSorted((a, b) => a.name.localeCompare(b.name));
		}

		case 'tabs': {
			return picked.toSorted((a, b) => b.tabs.length - a.tabs.length);
		}

		default: {
			return picked;
		}
	}
}

/**
Saves several links as bookmarks in one column, first link first. `ids` gives each bookmark its id.
*/
export function addBookmarks(
	store: Store,
	urls: readonly string[],
	columnId: string,
	ids: readonly string[],
	now: number,
): Store {
	let next = store;
	for (const [index, url] of urls.entries()) {
		next = addBookmark(
			next,
			{url, title: '', columnId},
			ids[index] ?? `${now}-${index}`,
			now,
		);
	}

	return next;
}

const DEFAULT_SESSION_FOLDER_ID = 'unfiled';

const savedTab = (
	url: string,
	id: string,
	index: number,
	now: number,
	title = '',
): SavedTab => ({
	id,
	title: title.trim() || hostOf(url),
	url,
	notes: '',
	pinned: false,
	nativeGroup: null,
	savedAt: now,
	originalIndex: index,
});

/**
Saves links as a new session, in the chosen folder or the default one. `tabIds` gives each tab its id.
*/
export function addSession(
	store: Store,
	input: {
		name: string;
		urls: readonly string[];
		folderId?: string;
		/**
		Where it was saved: the device's name and kind.
		*/
		device?: DeviceStamp;
		/**
		A title for each link, in order; a link without one is named by its site.
		*/
		titles?: readonly string[];
	},
	id: string,
	tabIds: readonly string[],
	now: number,
): Store {
	if (input.urls.length === 0) {
		return store;
	}

	let {folders} = store;
	let folderId = folders.find((folder) => folder.id === input.folderId)?.id;
	folderId ??= folders.find((folder) => folder.isDefault)?.id;

	if (!folderId) {
		folderId = DEFAULT_SESSION_FOLDER_ID;
		folders = [
			...folders,
			{id: folderId, name: 'Unfiled', createdAt: now, isDefault: true},
		];
	}

	const session: Session = {
		id,
		name: input.name.trim() || 'Shared links',
		folderId,
		description: '',
		createdAt: now,
		updatedAt: now,
		sourceWindowName: 'Phone',
		sourceWindowId: null,
		...input.device,
		tabs: input.urls.map((url, index) =>
			savedTab(
				url,
				tabIds[index] ?? `${id}-${index}`,
				index,
				now,
				input.titles?.[index],
			),
		),
	};
	return {
		...store,
		folders,
		groups: [session, ...store.groups],
		updatedAt: now,
	};
}

/**
Adds links to the end of an existing session.
*/
export function addTabsToSession(
	store: Store,
	sessionId: string,
	urls: readonly string[],
	tabIds: readonly string[],
	now: number,
	titles: readonly string[] = [],
): Store {
	const session = store.groups.find((group) => group.id === sessionId);
	if (!session || urls.length === 0) {
		return store;
	}

	const start = session.tabs.length;
	const changed: Session = {
		...session,
		updatedAt: now,
		tabs: [
			...session.tabs,
			...urls.map((url, index) =>
				savedTab(
					url,
					tabIds[index] ?? `${sessionId}-${start + index}`,
					start + index,
					now,
					titles[index],
				),
			),
		],
	};
	return {
		...store,
		groups: store.groups.map((group) =>
			group.id === sessionId ? changed : group,
		),
		updatedAt: now,
	};
}

const changeSession = (
	store: Store,
	id: string,
	change: (session: Session) => Session,
	now: number,
): Store =>
	store.groups.some((session) => session.id === id)
		? {
				...store,
				groups: store.groups.map((session) =>
					session.id === id ? change(session) : session,
				),
				updatedAt: now,
			}
		: store;

/**
Renames a session. A blank name, or an unknown session, leaves the store as it was.
*/
export function renameSession(
	store: Store,
	id: string,
	name: string,
	now: number,
): Store {
	const trimmed = name.trim();
	return trimmed
		? changeSession(
				store,
				id,
				(session) => ({...session, name: trimmed, updatedAt: now}),
				now,
			)
		: store;
}

// The longest description the extension keeps (`SESSION_TEXT_MAX` in its library-normalize.ts).
const DESCRIPTION_MAX = 10_502;

/**
Sets a session's description, which the extension shows under its name and syncs. It is cut to the extension's limit.
*/
export function describeSession(
	store: Store,
	id: string,
	description: string,
	now: number,
): Store {
	return changeSession(
		store,
		id,
		(session) => ({
			...session,
			description: description.trim().slice(0, DESCRIPTION_MAX),
			updatedAt: now,
		}),
		now,
	);
}

/**
Puts a session in another folder. An unknown folder or session leaves the store as it was.
*/
export function moveSession(
	store: Store,
	id: string,
	folderId: string,
	now: number,
): Store {
	const target = store.folders.find((folder) => folder.id === folderId);
	if (!target) {
		return store;
	}

	// A folder that colors its sessions gives a session moved into it the folder's color, as in the extension.
	return changeSession(
		store,
		id,
		(session) => ({
			...session,
			folderId,
			updatedAt: now,
			...(session.folderId !== folderId &&
				target.colorSessions &&
				target.color && {color: target.color}),
		}),
		now,
	);
}

/**
Moves a session to the Archived folder, which is made when there is none yet.
*/
export function archiveSession(store: Store, id: string, now: number): Store {
	const found = store.folders.find((folder) => isArchived(folder));
	const withFolder: Store = found
		? store
		: {
				...store,
				folders: [
					...store.folders,
					{
						id: ARCHIVED_FOLDER_ID,
						name: 'Archived',
						createdAt: now,
						isDefault: false,
					},
				],
			};
	return moveSession(withFolder, id, found?.id ?? ARCHIVED_FOLDER_ID, now);
}

/**
Whether a session sits in the Archived folder.
*/
export function isArchivedSession(
	folders: readonly Folder[],
	session: Session,
): boolean {
	const folder = folders.find((entry) => entry.id === session.folderId);
	return folder !== undefined && isArchived(folder);
}

/**
Takes a session out of the Archived folder, into Unfiled (or the first folder that is not Archived; Unfiled is made
when there is none).
*/
export function unarchiveSession(store: Store, id: string, now: number): Store {
	const open = store.folders.filter((folder) => !isArchived(folder));
	const target = open.find((folder) => folder.isDefault) ?? open[0];
	if (target) {
		return moveSession(store, id, target.id, now);
	}

	return moveSession(
		{
			...store,
			folders: [
				...store.folders,
				{
					id: DEFAULT_SESSION_FOLDER_ID,
					name: 'Unfiled',
					createdAt: now,
					isDefault: true,
				},
			],
		},
		id,
		DEFAULT_SESSION_FOLDER_ID,
		now,
	);
}

/**
Deletes a session.
*/
export function removeSession(store: Store, id: string, now: number): Store {
	return store.groups.some((session) => session.id === id)
		? {
				...store,
				groups: store.groups.filter((session) => session.id !== id),
				updatedAt: now,
			}
		: store;
}

/**
Puts a deleted session back, under its own id, unless one with that id exists again. A folder that is gone sends it
to the first folder.
*/
export function restoreSession(
	store: Store,
	session: Session,
	now: number,
): Store {
	if (store.groups.some((existing) => existing.id === session.id)) {
		return store;
	}

	const known = store.folders.some((folder) => folder.id === session.folderId);
	return {
		...store,
		groups: [
			{
				...session,
				folderId: known
					? session.folderId
					: (store.folders[0]?.id ?? session.folderId),
				updatedAt: now,
			},
			...store.groups,
		],
		updatedAt: now,
	};
}

/**
Changes the title, notes, and address of one saved tab. An address that is not a web address leaves the library as it
was. Like the extension, a new address belongs to this one saved link only, while a changed title or note is also
written to every other saved copy of the same address.
*/
export function updateSessionTab(
	store: Store,
	id: string,
	tabId: string,
	change: {title: string; url: string; notes?: string},
	now: number,
): Store {
	const url = extractUrl(change.url);
	const current = store.groups
		.find((session) => session.id === id)
		?.tabs.find((tab) => tab.id === tabId);
	if (!url || !current) {
		return store;
	}

	const title = change.title.trim().slice(0, 500) || url;
	const notes =
		change.notes === undefined ? undefined : normalizeNotes(change.notes);
	if (url !== current.url) {
		return changeSession(
			store,
			id,
			(session) => ({
				...session,
				tabs: session.tabs.map((tab) =>
					tab.id === tabId
						? {...tab, url, title, notes: notes ?? tab.notes}
						: tab,
				),
				updatedAt: now,
			}),
			now,
		);
	}

	return {
		...store,
		groups: store.groups.map((session) =>
			session.tabs.some((tab) => tab.url === current.url)
				? {
						...session,
						tabs: session.tabs.map((tab) =>
							tab.url === current.url
								? {...tab, title, notes: notes ?? tab.notes}
								: tab,
						),
						updatedAt: now,
					}
				: session,
		),
		updatedAt: now,
	};
}

/**
Takes one tab out of a session.
*/
export function removeSessionTab(
	store: Store,
	id: string,
	tabId: string,
	now: number,
): Store {
	return changeSession(
		store,
		id,
		(session) => ({
			...session,
			tabs: session.tabs.filter((tab) => tab.id !== tabId),
			updatedAt: now,
		}),
		now,
	);
}

/**
The addresses of a session's tabs, one per line, for sharing or copying.
*/
export const sessionLinks = (session: Session): string =>
	session.tabs.map((tab) => tab.url).join('\n');

/**
Notes that a session was opened now, which the "recently opened" sort uses.
*/
export function markSessionOpened(
	store: Store,
	id: string,
	now: number,
): Store {
	return changeSession(
		store,
		id,
		(session) => ({...session, lastOpenedAt: now}),
		now,
	);
}
