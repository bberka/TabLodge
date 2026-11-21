/*
Pure edits of the synced library's bookmark board: columns and bookmarks. The phone keeps the same `Store` the
extension does, so the sync client in apps/extension/src/shared/sync can merge it with the server.
*/
import type {Bookmark, Store} from '../../../extension/src/shared/types';
import type {DeviceStamp} from '../../../extension/src/shared/device';
import {isSourceColumnId} from '../../../extension/src/shared/source-columns';
import {isColumnColor} from '../../../extension/src/shared/accent-colors';
import {
	BOOKMARK_UNFILED_ID,
	cleanColumnName,
	columnNameProblem,
	DEFAULT_BOOKMARK_COLUMN_ID,
	DEFAULT_BOOKMARK_COLUMN_NAME,
	landingColumnId,
} from '../../../extension/src/shared/bookmark-rules';
import {
	columnForUrl,
	domainsField,
} from '../../../extension/src/shared/column-sites';
import {
	bookmarkFacets,
	hasOperators,
	parseSearchQuery,
	passesOperators,
} from '../../../extension/src/shared/search-query';
import {bookmarkNotes} from '../../../extension/src/shared/library-normalize';
import {
	shownTags,
	withTagEdits,
} from '../../../extension/src/shared/bookmark-tags';
import {
	bookmarkIsDuplicate,
	duplicateHandlingOf,
} from '../../../extension/src/shared/save-rules';
import {extractUrl, hostOf} from './store-shape';

type ColumnView = {id: string; name: string; icon?: string; color?: string};

/**
The columns to show: the library's own, plus "Unfiled" when a bookmark points at a column that does not exist.
*/
export function columnViews(store: Store): ColumnView[] {
	const known = new Set(store.bookmarkColumns.map((column) => column.id));
	const views: ColumnView[] = store.bookmarkColumns.map(
		({id, name, icon, color}) => ({id, name, icon, color}),
	);
	if (store.bookmarks.some((bookmark) => !known.has(bookmark.columnId))) {
		views.push({id: BOOKMARK_UNFILED_ID, name: 'Unfiled'});
	}

	return views;
}

export function bookmarksByColumn(store: Store): Map<string, Bookmark[]> {
	const known = new Set(store.bookmarkColumns.map((column) => column.id));
	const groups = new Map<string, Bookmark[]>();
	for (const bookmark of store.bookmarks) {
		const id = known.has(bookmark.columnId)
			? bookmark.columnId
			: BOOKMARK_UNFILED_ID;
		const list = groups.get(id);
		if (list) {
			list.push(bookmark);
		} else {
			groups.set(id, [bookmark]);
		}
	}

	return groups;
}

export function bookmarksIn(store: Store, columnId: string): Bookmark[] {
	const known = new Set(store.bookmarkColumns.map((column) => column.id));
	return store.bookmarks.filter((bookmark) =>
		columnId === BOOKMARK_UNFILED_ID
			? !known.has(bookmark.columnId)
			: bookmark.columnId === columnId,
	);
}

/**
The id of the system column that lists every bookmark of every column. It is not stored and cannot be changed.
*/
export const ALL_BOOKMARKS_ID = 'all-bookmarks';

/**
Every bookmark, column by column in the columns' order and the Unfiled bucket last, each column in its own order.
*/
export function allBookmarks(store: Store): Bookmark[] {
	const groups = bookmarksByColumn(store);
	return columnViews(store).flatMap((column) => groups.get(column.id) ?? []);
}

const searchText = new WeakMap<Bookmark, {tags: string; text: string}>();

function searchableText(bookmark: Bookmark) {
	let found = searchText.get(bookmark);
	if (!found) {
		const tags = shownTags(bookmark).join(' ');
		found = {
			tags,
			text: `${bookmark.title} ${bookmark.url} ${bookmark.notes ?? ''} ${tags}`.toLowerCase(),
		};
		searchText.set(bookmark, found);
	}

	return found;
}

export function searchBookmarks(store: Store, query: string): Bookmark[] {
	const search = parseSearchQuery(query);
	const filtering = hasOperators(search);
	const words = search.text.toLowerCase().split(/\s+/).filter(Boolean);
	const columnName = new Map(
		store.bookmarkColumns.map((column) => [column.id, column.name]),
	);
	return store.bookmarks.filter((bookmark) => {
		const {tags, text} = searchableText(bookmark);
		return (
			words.every((word) => text.includes(word)) &&
			(!filtering ||
				passesOperators(
					search,
					[bookmark.title, bookmark.notes, tags],
					bookmarkFacets(bookmark, columnName.get(bookmark.columnId)),
				))
		);
	});
}

/**
Adds a column with an optional icon id from the extension's icon set, and an optional color from its accent palette.
*/
export function addColumn(
	store: Store,
	name: string,
	id: string,
	now: number,
	icon?: string,
	color?: string,
): Store {
	const trimmed = cleanColumnName(name);
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
				...(isColumnColor(color) && {color}),
			},
		],
		updatedAt: now,
	};
}

type NewBookmark = {
	url: string;
	title: string;
	columnId: string;
	/**
	The note. Blank removes it; leaving it out keeps the one a bookmark being changed has.
	*/
	notes?: string;
	/**
	The tags the person typed and the automatic kinds they removed. Each list, when given, replaces the one the bookmark
	has; leaving it out keeps it.
	*/
	tags?: readonly string[];
	hiddenKinds?: Bookmark['hiddenKinds'];
	/**
	The phone that saves a new bookmark. A bookmark being changed keeps the device it was saved on.
	*/
	device?: DeviceStamp;
};

/**
The bookmark with `notes` as its note, cleaned as the extension stores it. Undefined keeps the note it has.
*/
function withNotes(bookmark: Bookmark, notes: string | undefined): Bookmark {
	if (notes === undefined) {
		return bookmark;
	}

	const {notes: _previous, ...rest} = bookmark;
	const text = bookmarkNotes(notes);
	return text ? {...rest, notes: text} : rest;
}

/**
Adds a bookmark at the end of its column, as the extension does, unless it is a duplicate under the shared rule
(`save-rules.ts`: the same column never holds a link twice, and the duplicate setting covers the other columns). A column that does not exist falls back as it does there (the column that claims the link's site, the default column, the first). When the library has no column yet, the extension's default one is
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
	if (next.bookmarkColumns.length === 0) {
		next = {
			...next,
			bookmarkColumns: [
				{
					id: DEFAULT_BOOKMARK_COLUMN_ID,
					name: DEFAULT_BOOKMARK_COLUMN_NAME,
					createdAt: now,
					isDefault: true,
				},
			],
		};
	}

	const columnId = landingColumnId(next.bookmarkColumns, input.columnId, {
		claimedId: columnForUrl(next.bookmarkColumns, url)?.id,
	});
	// A duplicate (save-rules.ts) is skipped and the store comes back as it was.
	if (
		bookmarkIsDuplicate(
			next.bookmarks,
			columnId,
			url,
			duplicateHandlingOf(next.settings),
		)
	) {
		return store;
	}

	const bookmark = withTagEdits(
		withNotes(
			{
				id,
				title: input.title.trim() || hostOf(url),
				url,
				columnId,
				...input.device,
				createdAt: now,
				updatedAt: now,
			},
			input.notes,
		),
		input,
	);
	return {...next, bookmarks: [...next.bookmarks, bookmark], updatedAt: now};
}

/**
Changes a bookmark's link, title, note, or column. It keeps its place, unless the column changes: then it goes to the
end of the new column, as in the extension. An unusable link or a missing bookmark or column leaves the store as it was.
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

	const changed = withTagEdits(
		withNotes(
			{
				...current,
				url,
				title: input.title.trim() || hostOf(url),
				columnId: input.columnId,
				updatedAt: now,
			},
			input.notes,
		),
		input,
	);
	const bookmarks =
		current.columnId === input.columnId
			? store.bookmarks.map((bookmark) =>
					bookmark.id === id ? changed : bookmark,
				)
			: [...store.bookmarks.filter((bookmark) => bookmark.id !== id), changed];
	return {...store, bookmarks, updatedAt: now};
}

/**
Puts a bookmark's tags and removed kinds back as they were, for Undo after an edit took some away. A bookmark that is
gone leaves the store as it was.
*/
export function setBookmarkTags(
	store: Store,
	id: string,
	tagged: Pick<Bookmark, 'tags' | 'hiddenKinds'>,
	now: number,
): Store {
	if (store.bookmarks.every((bookmark) => bookmark.id !== id)) {
		return store;
	}

	return {
		...store,
		bookmarks: store.bookmarks.map((bookmark) =>
			bookmark.id === id
				? {
						...withTagEdits(bookmark, {
							tags: tagged.tags ?? [],
							hiddenKinds: tagged.hiddenKinds ?? [],
						}),
						updatedAt: now,
					}
				: bookmark,
		),
		updatedAt: now,
	};
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
Moves several bookmarks to the end of another column, keeping their order.
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
	return {...store, bookmarks: [...rest, ...moved], updatedAt: now};
}

/**
A bookmark about to be removed, with where it sat: `after` is the bookmark before it in the same column that stays,
or null when it was first there.
*/
export type RemovedBookmark = {bookmark: Bookmark; after: string | null};

/**
The bookmarks of `ids`, each with its place, so an undo can put them back where they were.
*/
export function removedBookmarks(
	store: Store,
	ids: ReadonlySet<string>,
): RemovedBookmark[] {
	const removed: RemovedBookmark[] = [];
	const lastKept = new Map<string, string>();
	for (const bookmark of store.bookmarks) {
		if (ids.has(bookmark.id)) {
			removed.push({
				bookmark,
				after: lastKept.get(bookmark.columnId) ?? null,
			});
		} else {
			lastKept.set(bookmark.columnId, bookmark.id);
		}
	}

	return removed;
}

/**
Puts bookmarks back after an undo, where they were in their column, as the extension's undo does. They get new ids,
though the sync server would take the old ones back too, since a newer change beats a delete. A
bookmark whose column is gone goes to the first column, at its start.
*/
export function restoreBookmarks(
	store: Store,
	removed: readonly RemovedBookmark[],
	newIds: string[],
	now: number,
): Store {
	const known = new Set(store.bookmarkColumns.map((column) => column.id));
	const bookmarks = [...store.bookmarks];
	// The last bookmark restored behind each anchor, so neighbours removed together come back in their old order.
	const lastBehind = new Map<string, string>();
	for (const [index, {bookmark, after}] of removed.entries()) {
		const moved = !known.has(bookmark.columnId);
		const columnId = moved
			? (store.bookmarkColumns[0]?.id ?? bookmark.columnId)
			: bookmark.columnId;
		const restored = {...bookmark, id: newIds[index], columnId, updatedAt: now};
		const key = `${columnId}\n${moved ? '' : (after ?? '')}`;
		const behind = lastBehind.get(key) ?? (moved ? null : after);
		const anchor = behind
			? bookmarks.findIndex((entry) => entry.id === behind)
			: -1;
		const firstInColumn = bookmarks.findIndex(
			(entry) => entry.columnId === columnId,
		);
		let at = bookmarks.length;
		if (anchor !== -1) {
			at = anchor + 1;
		} else if (firstInColumn !== -1) {
			at = firstInColumn;
		}

		bookmarks.splice(at, 0, restored);
		lastBehind.set(key, restored.id);
	}

	return {...store, bookmarks, updatedAt: now};
}

export type ColumnEdit = {name: string; icon: string; color: string};

/**
Changes a column's name, icon, and color, and keeps everything else about it, such as the sites that file into it. An
empty icon or color removes it. A bad name or an unknown column leaves the store as it was.
*/
export function updateColumn(
	store: Store,
	id: string,
	edit: ColumnEdit,
	now: number,
): Store {
	const current = store.bookmarkColumns.find((column) => column.id === id);
	if (!current || columnNameProblem(store.bookmarkColumns, edit.name, id)) {
		return store;
	}

	// The icon and color are rebuilt, so an empty or unknown value drops the field rather than leaving the old one.
	const {icon: _icon, color: _color, ...rest} = current;
	const changed = {
		...rest,
		name: cleanColumnName(edit.name),
		...(edit.icon && {icon: edit.icon}),
		...(isColumnColor(edit.color) && {color: edit.color}),
	};
	return {
		...store,
		bookmarkColumns: store.bookmarkColumns.map((column) =>
			column.id === id ? changed : column,
		),
		updatedAt: now,
	};
}

/**
Replaces the sites that file into a column. Each entry is normalized and repeats are dropped; an empty list removes the
field, as in the extension. An unknown column leaves the store as it was.
*/
export function setColumnSites(
	store: Store,
	id: string,
	sites: readonly string[],
	now: number,
): Store {
	const current = store.bookmarkColumns.find((column) => column.id === id);
	if (!current) {
		return store;
	}

	const {domains: _domains, ...rest} = current;
	const changed = {...rest, ...domainsField(sites)};
	return {
		...store,
		bookmarkColumns: store.bookmarkColumns.map((column) =>
			column.id === id ? changed : column,
		),
		updatedAt: now,
	};
}

/**
Sets a session's color, a preset id or `#rrggbb`, or removes it with an empty or unknown value. An unknown session
leaves the store as it was.
*/
export function setSessionColor(
	store: Store,
	id: string,
	color: string,
	now: number,
): Store {
	const current = store.groups.find((session) => session.id === id);
	if (!current) {
		return store;
	}

	const {color: _color, ...rest} = current;
	const changed = {
		...rest,
		...(isColumnColor(color) && {color}),
		updatedAt: now,
	};
	return {
		...store,
		groups: store.groups.map((session) =>
			session.id === id ? changed : session,
		),
		updatedAt: now,
	};
}

/**
Moves a column one place earlier (-1) or later (1) in the order the selectors and the extension show. A column at an
end, or one that does not exist, leaves the store as it was.
*/
export function moveColumn(
	store: Store,
	id: string,
	step: -1 | 1,
	now: number,
): Store {
	const from = store.bookmarkColumns.findIndex((column) => column.id === id);
	const to = from + step;
	if (from === -1 || to < 0 || to >= store.bookmarkColumns.length) {
		return store;
	}

	const columns = [...store.bookmarkColumns];
	const [moved] = columns.splice(from, 1);
	columns.splice(to, 0, moved);
	return {...store, bookmarkColumns: columns, updatedAt: now};
}

export type BookmarkMove = 'up' | 'down' | 'top' | 'bottom';

/**
Moves a bookmark within its own column: one place earlier or later, or to the top or the bottom. Other columns keep
their order. A bookmark already there, or one that does not exist, leaves the store as it was.
*/
export function moveBookmark(
	store: Store,
	id: string,
	move: BookmarkMove,
	now: number,
): Store {
	const bookmark = store.bookmarks.find((item) => item.id === id);
	if (!bookmark) {
		return store;
	}

	// The positions in the library's list that belong to this bookmark's column, in order.
	const slots = store.bookmarks.flatMap((item, index) =>
		item.columnId === bookmark.columnId ? [index] : [],
	);
	const here = slots.findIndex((index) => store.bookmarks[index]?.id === id);
	const target = {
		up: here - 1,
		down: here + 1,
		top: 0,
		bottom: slots.length - 1,
	}[move];
	if (target < 0 || target >= slots.length || target === here) {
		return store;
	}

	const order = slots.map((index) => store.bookmarks[index]);
	const [moved] = order.splice(here, 1);
	order.splice(target, 0, moved);
	const bookmarks = [...store.bookmarks];
	for (const [position, index] of slots.entries()) {
		bookmarks[index] = order[position]!;
	}

	return {...store, bookmarks, updatedAt: now};
}

/**
Deletes a column. Its bookmarks move to `moveTo` (another column, going after that column's own), or are deleted with
it when `moveTo` is null. With no other column to take them they go to the Unfiled bucket, as the extension does.
*/
export function deleteColumn(
	store: Store,
	id: string,
	moveTo: string | null,
	now: number,
): Store {
	if (store.bookmarkColumns.every((column) => column.id !== id)) {
		return store;
	}

	const remaining = store.bookmarkColumns.filter((column) => column.id !== id);
	const own = store.bookmarks.filter((bookmark) => bookmark.columnId === id);
	const others = store.bookmarks.filter((bookmark) => bookmark.columnId !== id);
	let bookmarks = others;
	if (moveTo !== null && own.length > 0) {
		const target =
			remaining.length === 0
				? BOOKMARK_UNFILED_ID
				: (remaining.find((column) => column.id === moveTo)?.id ??
					remaining[0]?.id ??
					BOOKMARK_UNFILED_ID);
		bookmarks = [
			...others,
			...own.map((bookmark) => ({
				...bookmark,
				columnId: target,
				updatedAt: now,
			})),
		];
	}

	return {...store, bookmarkColumns: remaining, bookmarks, updatedAt: now};
}

/**
Puts back a column that was deleted, with the bookmarks it held (as they were), for Undo. A bookmark that was moved to
another column comes back to this one; one that was deleted with it is added again.
*/
export function restoreColumn(
	store: Store,
	column: Store['bookmarkColumns'][number],
	bookmarks: ReadonlyArray<Store['bookmarks'][number]>,
	now: number,
): Store {
	// A source column can be back already (the browser saved on its site again): its bookmarks rejoin it.
	const there = store.bookmarkColumns.some((entry) => entry.id === column.id);
	if (there && !isSourceColumnId(column.id)) {
		return store;
	}

	const back = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark]));
	const kept = store.bookmarks.map((bookmark) => {
		const original = back.get(bookmark.id);
		back.delete(bookmark.id);
		return original
			? {...bookmark, columnId: column.id, updatedAt: now}
			: bookmark;
	});
	return {
		...store,
		bookmarkColumns: there
			? store.bookmarkColumns
			: [...store.bookmarkColumns, column],
		bookmarks: [
			...kept,
			...[...back.values()].map((bookmark) => ({...bookmark, updatedAt: now})),
		],
		updatedAt: now,
	};
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
	device?: DeviceStamp,
): Store {
	let next = store;
	for (const [index, url] of urls.entries()) {
		next = addBookmark(
			next,
			{url, title: '', columnId, device},
			ids[index] ?? `${now}-${index}`,
			now,
		);
	}

	return next;
}
