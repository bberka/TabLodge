// The column an Add bookmark dialog starts on: the one that took the newest bookmark, else the first column.
// It is read from the bookmarks themselves, so there is nothing to store, sync, or clean up when a column is deleted.

import type {Bookmark, BookmarkColumn} from './types';

export function defaultBookmarkColumnId(
	columns: readonly BookmarkColumn[],
	bookmarks: readonly Bookmark[],
): string | undefined {
	const known = new Set(columns.map((column) => column.id));
	let newest: Bookmark | undefined;
	for (const bookmark of bookmarks) {
		if (
			known.has(bookmark.columnId) &&
			(!newest || bookmark.createdAt > newest.createdAt)
		) {
			newest = bookmark;
		}
	}

	return newest?.columnId ?? columns[0]?.id;
}
