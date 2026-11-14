// The bookmark column rules every app follows: the extension's, which the Android app adopts. The service worker and
// the phone each keep their own storage and undo; what they agree on is here.
import type {BookmarkColumn} from './types';

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
