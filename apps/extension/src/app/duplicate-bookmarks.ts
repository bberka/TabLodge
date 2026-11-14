import type {Bookmark} from '../shared/types';
import {webUrl} from './web-url';

export type DuplicateCopy = Pick<
	Bookmark,
	'id' | 'title' | 'columnId' | 'createdAt'
>;

export type DuplicateGroup = {
	/**
	The canonical address saved more than once.
	*/
	url: string;
	/**
	Every copy, in board order.
	*/
	copies: DuplicateCopy[];
	/**
	The copy kept by default: the oldest, or the first on the board when they tie.
	*/
	keepId: string;
};

/**
Addresses saved more than once on the bookmark board. Copies match when their canonical web address is exactly equal, the rule saving uses, whatever column they are in. One pass over the board.
*/
export function findDuplicateBookmarks(
	bookmarks: readonly Bookmark[],
): DuplicateGroup[] {
	const byUrl = new Map<string, DuplicateCopy[]>();
	for (const bookmark of bookmarks) {
		const url = webUrl(bookmark.url) ?? bookmark.url;
		const copy = {
			id: bookmark.id,
			title: bookmark.title,
			columnId: bookmark.columnId,
			createdAt: bookmark.createdAt,
		};
		const copies = byUrl.get(url);
		if (copies) {
			copies.push(copy);
		} else {
			byUrl.set(url, [copy]);
		}
	}

	const groups: DuplicateGroup[] = [];
	for (const [url, copies] of byUrl) {
		if (copies.length < 2) {
			continue;
		}

		let keep = copies[0];
		for (const copy of copies) {
			if (copy.createdAt < keep.createdAt) {
				keep = copy;
			}
		}

		groups.push({url, copies, keepId: keep.id});
	}

	return groups;
}

/**
The copies to remove: every one except the kept copy of each group. `keep` maps an address to the copy the person chose instead of the default.
*/
export function removalIds(
	groups: readonly DuplicateGroup[],
	keep: ReadonlyMap<string, string>,
) {
	const ids: string[] = [];
	for (const group of groups) {
		const keepId = keep.get(group.url) ?? group.keepId;
		for (const copy of group.copies) {
			if (copy.id !== keepId) {
				ids.push(copy.id);
			}
		}
	}

	return ids;
}
