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

export type ColumnView = {id: string; name: string};

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
	const views = store.bookmarkColumns.map(({id, name}) => ({id, name}));
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

export type NewBookmark = {url: string; title: string; columnId: string};

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

export function removeBookmark(store: Store, id: string, now: number): Store {
	return {
		...store,
		bookmarks: store.bookmarks.filter((bookmark) => bookmark.id !== id),
		updatedAt: now,
	};
}

export function moveBookmark(
	store: Store,
	id: string,
	columnId: string,
	now: number,
): Store {
	if (store.bookmarkColumns.every((column) => column.id !== columnId)) {
		return store;
	}

	return {
		...store,
		bookmarks: store.bookmarks.map((bookmark) =>
			bookmark.id === id ? {...bookmark, columnId, updatedAt: now} : bookmark,
		),
		updatedAt: now,
	};
}
