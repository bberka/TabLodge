// The column an Add bookmark dialog starts on: the one that took the newest bookmark, else the first column. Source
// columns never count, so a save on a site does not move the user's own default. It is read from the bookmarks
// themselves, so there is nothing to store, sync, or clean up when a column is deleted.

import {sourceColumnSite} from '../shared/source-columns';
import type {Bookmark, BookmarkColumn} from '../shared/types';

export function defaultBookmarkColumnId(
	columns: readonly BookmarkColumn[],
	bookmarks: readonly Bookmark[],
): string | undefined {
	const own = columns.filter((column) => !sourceColumnSite(column.id));
	const known = new Set(own.map((column) => column.id));
	let newest: Bookmark | undefined;
	for (const bookmark of bookmarks) {
		if (
			known.has(bookmark.columnId) &&
			(!newest || bookmark.createdAt > newest.createdAt)
		) {
			newest = bookmark;
		}
	}

	return newest?.columnId ?? own[0]?.id;
}
