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
