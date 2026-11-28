import type {
	Bookmark,
	BookmarkColumn,
	BookmarkSort,
	NewBookmarkPosition,
} from './types';
import {siteName} from './web-url';

export const DEFAULT_BOOKMARK_COLUMN_ID = 'bookmark-default';
export const BOOKMARK_UNFILED_ID = 'bookmark-unfiled';
export const DEFAULT_BOOKMARK_COLUMN_NAME = 'Bookmarks';
export const MAX_COLUMN_NAME = 60;

export const cleanColumnName = (value: unknown): string =>
	typeof value === 'string'
		? value
				.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
				.trim()
				.slice(0, MAX_COLUMN_NAME)
		: '';

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

export const BOOKMARK_SORT_OPTIONS = [
	['manual', 'Manual order'],
	['newest', 'Newest first'],
	['oldest', 'Oldest first'],
	['title', 'Title A–Z'],
	['site', 'Site A–Z'],
] as const satisfies ReadonlyArray<readonly [BookmarkSort, string]>;

export const NEW_BOOKMARK_POSITION_OPTIONS = [
	['bottom', 'Bottom'],
	['top', 'Top'],
] as const satisfies ReadonlyArray<readonly [NewBookmarkPosition, string]>;

export function insertNewBookmarks<T>(
	existing: readonly T[],
	added: readonly T[],
	position: NewBookmarkPosition = 'bottom',
): T[] {
	if (added.length === 0) {
		return [...existing];
	}

	return position === 'top' ? [...added, ...existing] : [...existing, ...added];
}

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
