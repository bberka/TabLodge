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

export const ALL_BOOKMARKS_ID = 'all-bookmarks';

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
	notes?: string;
	tags?: readonly string[];
	hiddenKinds?: Bookmark['hiddenKinds'];
	device?: DeviceStamp;
};

function withNotes(bookmark: Bookmark, notes: string | undefined): Bookmark {
	if (notes === undefined) {
		return bookmark;
	}

	const {notes: _previous, ...rest} = bookmark;
	const text = bookmarkNotes(notes);
	return text ? {...rest, notes: text} : rest;
}

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

export type RemovedBookmark = {bookmark: Bookmark; after: string | null};

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

export function restoreBookmarks(
	store: Store,
	removed: readonly RemovedBookmark[],
	newIds: string[],
	now: number,
): Store {
	const known = new Set(store.bookmarkColumns.map((column) => column.id));
	const bookmarks = [...store.bookmarks];
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

export function restoreColumn(
	store: Store,
	column: Store['bookmarkColumns'][number],
	bookmarks: ReadonlyArray<Store['bookmarks'][number]>,
	now: number,
): Store {
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
