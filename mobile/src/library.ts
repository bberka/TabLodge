/*
Pure edits of the synced library. The phone keeps the same `Store` the extension does, so the sync client in
src/shared/sync can merge it with the server; these functions only change bookmarks and columns.
*/
import type {
	Bookmark,
	SavedTab,
	Session,
	Settings,
	Store,
} from '../../src/app/types';
import {LAYOUT_VERSION} from '../../src/shared/library-index';

// Ids the extension gives its first column and the bucket for bookmarks whose column is gone.
export const DEFAULT_COLUMN_ID = 'bookmark-default';
export const UNFILED_ID = 'bookmark-unfiled';
export const DEFAULT_COLUMN_NAME = 'Bookmarks';

type ColumnView = {id: string; name: string; icon?: string};

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

/**
The columns to show: the library's own, plus "Unfiled" when a bookmark points at a column that does not exist.
*/
export function columnViews(store: Store): ColumnView[] {
	const known = new Set(store.bookmarkColumns.map((column) => column.id));
	const views: ColumnView[] = store.bookmarkColumns.map(({id, name, icon}) => ({
		id,
		name,
		icon,
	}));
	if (store.bookmarks.some((bookmark) => !known.has(bookmark.columnId))) {
		views.push({id: UNFILED_ID, name: 'Unfiled'});
	}

	return views;
}

export function bookmarksIn(store: Store, columnId: string): Bookmark[] {
	const known = new Set(store.bookmarkColumns.map((column) => column.id));
	return store.bookmarks.filter((bookmark) =>
		columnId === UNFILED_ID
			? !known.has(bookmark.columnId)
			: bookmark.columnId === columnId,
	);
}

export function searchBookmarks(store: Store, query: string): Bookmark[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return store.bookmarks.filter((bookmark) => {
		const text = `${bookmark.title} ${bookmark.url}`.toLowerCase();
		return words.every((word) => text.includes(word));
	});
}

/**
Adds a column with an optional icon id from the extension's icon set.
*/
export function addColumn(
	store: Store,
	name: string,
	id: string,
	now: number,
	icon?: string,
): Store {
	const trimmed = name.trim();
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
			},
		],
		updatedAt: now,
	};
}

type NewBookmark = {url: string; title: string; columnId: string};

/**
Adds a bookmark at the top of its column. When the library has no column yet, the extension's default one is
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
	let {columnId} = input;
	if (next.bookmarkColumns.every((column) => column.id !== columnId)) {
		columnId = next.bookmarkColumns[0]?.id ?? DEFAULT_COLUMN_ID;
		if (next.bookmarkColumns.length === 0) {
			next = {
				...next,
				bookmarkColumns: [
					{
						id: DEFAULT_COLUMN_ID,
						name: DEFAULT_COLUMN_NAME,
						createdAt: now,
						isDefault: true,
					},
				],
			};
		}
	}

	const bookmark: Bookmark = {
		id,
		title: input.title.trim() || hostOf(url),
		url,
		columnId,
		createdAt: now,
		updatedAt: now,
	};
	return {...next, bookmarks: [bookmark, ...next.bookmarks], updatedAt: now};
}

/**
Changes a bookmark's link, title, or column. It keeps its place, unless the column changes: then it goes to the
top of the new column. An unusable link or a missing bookmark or column leaves the store as it was.
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
			: [changed, ...store.bookmarks.filter((bookmark) => bookmark.id !== id)];
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
Moves several bookmarks to the top of another column, keeping their order.
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
	return {...store, bookmarks: [...moved, ...rest], updatedAt: now};
}

/**
Puts bookmarks back after an undo. They get new ids, because the server may already have recorded the delete of
the old ones and refuses to bring a deleted id back.
*/
export function restoreBookmarks(
	store: Store,
	removed: Bookmark[],
	newIds: string[],
	now: number,
): Store {
	const known = new Set(store.bookmarkColumns.map((column) => column.id));
	const restored = removed.map((bookmark, index) => ({
		...bookmark,
		id: newIds[index],
		columnId: known.has(bookmark.columnId)
			? bookmark.columnId
			: (store.bookmarkColumns[0]?.id ?? bookmark.columnId),
		updatedAt: now,
	}));
	return {
		...store,
		bookmarks: [...restored, ...store.bookmarks],
		updatedAt: now,
	};
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

export const ALL_SESSIONS_ID = 'all';
const ARCHIVED_FOLDER_ID = 'archived-sessions';
const OTHER_FOLDER_ID = 'other-sessions';

const isArchived = (folder: {id: string; name: string}) =>
	folder.id === ARCHIVED_FOLDER_ID ||
	folder.name.toLocaleLowerCase() === 'archived';

export type SessionFolderView = {
	id: string;
	name: string;
	icon?: string;
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
	// Added last to first, because a new bookmark goes to the top.
	for (const [index, url] of [...urls.entries()].toReversed()) {
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
): SavedTab => ({
	id,
	title: hostOf(url),
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
	input: {name: string; urls: readonly string[]; folderId?: string},
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
		tabs: input.urls.map((url, index) =>
			savedTab(url, tabIds[index] ?? `${id}-${index}`, index, now),
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
