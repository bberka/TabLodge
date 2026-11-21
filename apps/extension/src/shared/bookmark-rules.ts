// The bookmark column rules every app follows: the extension's, which the Android app adopts. The service worker and
// the phone each keep their own storage and undo; what they agree on is here.
import type {Bookmark, BookmarkColumn, BookmarkSort} from './types';
import {siteName} from './web-url';

// The id of the extension's first column, and the bucket for bookmarks whose column is gone.
export const DEFAULT_BOOKMARK_COLUMN_ID = 'bookmark-default';
export const BOOKMARK_UNFILED_ID = 'bookmark-unfiled';
export const DEFAULT_BOOKMARK_COLUMN_NAME = 'Bookmarks';
export const MAX_COLUMN_NAME = 60;

/**
A column name as stored: control characters become spaces, the ends are trimmed, and it is cut to 60 characters.
*/
export const cleanColumnName = (value: unknown): string =>
	typeof value === 'string'
		? value
				.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
				.trim()
				.slice(0, MAX_COLUMN_NAME)
		: '';

/**
Whether another column already has this name, ignoring case. `exceptId` is the column being renamed.
*/
export const columnNameTaken = (
	columns: ReadonlyArray<Pick<BookmarkColumn, 'id' | 'name'>>,
	name: string,
	exceptId: string | null = null,
): boolean => {
	const normalized = name.toLocaleLowerCase();
	return columns.some(
		(column) =>
			column.id !== exceptId && column.name.toLocaleLowerCase() === normalized,
	);
};

/**
Why a column cannot have this name, or undefined when it can: not empty, not "All bookmarks", and not the name of
another column, ignoring case. `exceptId` is the column being renamed.
*/
export function columnNameProblem(
	columns: ReadonlyArray<Pick<BookmarkColumn, 'id' | 'name'>>,
	name: string,
	exceptId: string | null = null,
): string | undefined {
	const cleaned = cleanColumnName(name);
	if (!cleaned || cleaned.toLocaleLowerCase() === 'all bookmarks') {
		return 'Choose a different column name.';
	}

	return columnNameTaken(columns, cleaned, exceptId)
		? 'A bookmark column with that name already exists.'
		: undefined;
}

/**
The column a new bookmark goes into: the one asked for when it exists (or is the Unfiled bucket, when `allowUnfiled`),
else the column that claims its site, else the default column, else the first column, else Unfiled.
*/
export function landingColumnId(
	columns: ReadonlyArray<Pick<BookmarkColumn, 'id'>>,
	wanted: string | null | undefined,
	{
		claimedId,
		allowUnfiled = false,
	}: {claimedId?: string; allowUnfiled?: boolean} = {},
): string {
	if (
		wanted &&
		(columns.some((column) => column.id === wanted) ||
			(allowUnfiled && wanted === BOOKMARK_UNFILED_ID))
	) {
		return wanted;
	}

	return (
		claimedId ||
		columns.find((column) => column.id === DEFAULT_BOOKMARK_COLUMN_ID)?.id ||
		columns[0]?.id ||
		BOOKMARK_UNFILED_ID
	);
}

/**
The sort choices of a bookmark column, in menu order, with the label each app shows.
*/
export const BOOKMARK_SORT_OPTIONS = [
	['manual', 'Manual order'],
	['newest', 'Newest first'],
	['oldest', 'Oldest first'],
	['title', 'Title A–Z'],
	['site', 'Site A–Z'],
] as const satisfies ReadonlyArray<readonly [BookmarkSort, string]>;

/**
The bookmarks of one column as a sort shows them. `manual` returns the list as stored; every other sort returns a
sorted copy and leaves the stored order alone. Ties keep their stored order.
*/
export function sortBookmarks<
	T extends Pick<Bookmark, 'title' | 'url' | 'createdAt'>,
>(bookmarks: readonly T[], sort: BookmarkSort): readonly T[] {
	if (sort === 'manual') {
		return bookmarks;
	}

	const compare: Record<
		Exclude<BookmarkSort, 'manual'>,
		(a: T, b: T) => number
	> = {
		newest: (a, b) => b.createdAt - a.createdAt,
		oldest: (a, b) => a.createdAt - b.createdAt,
		title: (a, b) =>
			(a.title || siteName(a.url)).localeCompare(b.title || siteName(b.url)),
		site: (a, b) => siteName(a.url).localeCompare(siteName(b.url)),
	};
	return bookmarks.toSorted(compare[sort]);
}
