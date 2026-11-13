/*
Pure edits of the synced library. The phone keeps the same `Store` the extension does, so the sync client in
src/shared/sync can merge it with the server; these functions only change bookmarks and columns.
*/
import type {Bookmark, Settings, Store} from '../../src/app/types';
import {LAYOUT_VERSION} from '../../src/shared/library-index';

// Ids the extension gives its first column and the bucket for bookmarks whose column is gone.
export const DEFAULT_COLUMN_ID = 'bookmark-default';
export const UNFILED_ID = 'bookmark-unfiled';
export const DEFAULT_COLUMN_NAME = 'Bookmarks';

type ColumnView = {id: string; name: string; icon?: string};

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
Adds a column, and returns the store with the id it got.
*/
export function addColumn(
	store: Store,
	name: string,
	id: string,
	now: number,
): Store {
	const trimmed = name.trim();
	if (!trimmed) {
		return store;
	}

	return {
		...store,
		bookmarkColumns: [
			...store.bookmarkColumns,
			{id, name: trimmed, createdAt: now, isDefault: false},
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
