/*
Applies an import to the phone's library, and builds what the phone shares and exports. The reading of other apps'
files, and the share and export formats, are the extension's own pure code in apps/extension/src/app, so a file reads
the same on both. Only how the result lands in the library is written here.
*/
import type {
	Bookmark,
	BookmarkColumn,
	Folder,
	SavedTab,
	Session,
	Store,
} from '../../../extension/src/shared/types';
import {
	cleanColumnName,
	DEFAULT_BOOKMARK_COLUMN_ID,
	DEFAULT_BOOKMARK_COLUMN_NAME,
} from '../../../extension/src/shared/bookmark-rules';
import {deviceStamp} from '../../../extension/src/shared/device';
import {
	type ImportGroup,
	type ImportKind,
	type ImportLink,
	type ImportPreview,
	type ParsedImport,
	previewImport,
} from '../../../extension/src/shared/import-formats';
import type {ShareGroup} from '../../../extension/src/shared/share-formats';
import {
	SOURCE_COLUMNS,
	sourceColumnSite,
} from '../../../extension/src/shared/source-columns';
import {
	trashedUrls,
	type TrashEntry,
} from '../../../extension/src/shared/trash';
import {hostOf} from '../library/store-shape';

export type ImportResult = {
	store: Store;
	/**
	Sessions, or bookmark columns, that received links.
	*/
	groups: number;
	links: number;
	duplicates: number;
};

const DEFAULT_FOLDER_ID = 'unfiled';
const DEFAULT_SESSION_NAME = 'Imported tabs';

/**
The addresses already saved for this kind of import, or deleted to the trash, which an import can skip.
*/
export function existingUrls(
	store: Store,
	kind: ImportKind,
	trash: readonly TrashEntry[] = [],
): string[] {
	return [
		...(kind === 'sessions'
			? store.groups.flatMap((group) => group.tabs.map((tab) => tab.url))
			: store.bookmarks.map((bookmark) => bookmark.url)),
		...trashedUrls(trash, kind),
	];
}

/**
What an import would add, before it is applied.
*/
export function previewFor(
	store: Store,
	parsed: ParsedImport,
	kind: ImportKind,
	trash: readonly TrashEntry[] = [],
): ImportPreview {
	return previewImport(parsed, kind, {
		existingUrls: existingUrls(store, kind, trash),
	});
}

const sameName = (a: string, b: string) =>
	a.trim().toLowerCase() === b.trim().toLowerCase();

/**
The links of a group that are worth adding: not already saved, and not repeated within the import. Pinned tabs only come
from the extension's own export, as in the extension.
*/
function freshLinks(
	links: readonly ImportLink[],
	seen: Set<string>,
	skipDuplicates: boolean,
	keepPinned: boolean,
	kind: ImportKind,
): {kept: ImportLink[]; duplicates: number} {
	const kept: ImportLink[] = [];
	let duplicates = 0;
	for (const link of links) {
		if (kind === 'sessions' && link.pinned && !keepPinned) {
			continue;
		}

		if (skipDuplicates && seen.has(link.url)) {
			duplicates += 1;
			continue;
		}

		seen.add(link.url);
		kept.push(link);
	}

	return {kept, duplicates};
}

function sessionFolder(
	folders: Folder[],
	name: string | undefined,
	now: number,
	newId: () => string,
): {folders: Folder[]; id: string} {
	if (name) {
		const found = folders.find((folder) => sameName(folder.name, name));
		if (found) {
			return {folders, id: found.id};
		}

		const id = newId();
		return {
			folders: [
				...folders,
				{id, name: name.slice(0, 60), createdAt: now, isDefault: false},
			],
			id,
		};
	}

	const fallback = folders.find((folder) => folder.isDefault);
	if (fallback) {
		return {folders, id: fallback.id};
	}

	return {
		folders: [
			...folders,
			{id: DEFAULT_FOLDER_ID, name: 'Unfiled', createdAt: now, isDefault: true},
		],
		id: DEFAULT_FOLDER_ID,
	};
}

function columnFor(
	columns: BookmarkColumn[],
	{name, sourceColumnId}: ImportGroup,
	now: number,
	newId: () => string,
): {columns: BookmarkColumn[]; id: string} {
	// A source column is marked by its id, so it joins the column with that id or keeps the id.
	if (sourceColumnId) {
		if (columns.some((column) => column.id === sourceColumnId)) {
			return {columns, id: sourceColumnId};
		}

		const site = sourceColumnSite(sourceColumnId);
		const look = site ? SOURCE_COLUMNS[site] : undefined;
		const column: BookmarkColumn = {
			...look,
			id: sourceColumnId,
			name: cleanColumnName(name) || look?.name || 'Imported',
			createdAt: now,
			isDefault: false,
		};
		return {columns: [...columns, column], id: sourceColumnId};
	}

	if (name) {
		const found = columns.find((column) => sameName(column.name, name));
		if (found) {
			return {columns, id: found.id};
		}

		const clean = cleanColumnName(name);
		if (clean) {
			const id = newId();
			return {
				columns: [
					...columns,
					{id, name: clean, createdAt: now, isDefault: false},
				],
				id,
			};
		}
	}

	const fallback = columns.find((column) => column.isDefault) ?? columns[0];
	if (fallback) {
		return {columns, id: fallback.id};
	}

	return {
		columns: [
			{
				id: DEFAULT_BOOKMARK_COLUMN_ID,
				name: DEFAULT_BOOKMARK_COLUMN_NAME,
				createdAt: now,
				isDefault: true,
			},
		],
		id: DEFAULT_BOOKMARK_COLUMN_ID,
	};
}

/**
Adds what a parsed file holds to the library: each session becomes a session in its folder, each bookmark folder a
column. Links already saved or in the `trash`, or repeated in the file, are skipped unless `skipDuplicates` is off.
Nothing is removed.
*/
export function importIntoStore(
	store: Store,
	parsed: ParsedImport,
	{
		kind,
		now,
		newId,
		skipDuplicates = true,
		trash = [],
	}: {
		kind: ImportKind;
		now: number;
		newId: () => string;
		skipDuplicates?: boolean;
		trash?: readonly TrashEntry[];
	},
): ImportResult {
	const seen = new Set(existingUrls(store, kind, trash));
	const keepPinned = Boolean(parsed.native?.sessions);
	const source: ImportGroup[] =
		kind === 'sessions' ? parsed.sessions : parsed.bookmarks;
	let {folders, bookmarkColumns} = store;
	const sessions: Session[] = [];
	const bookmarks: Bookmark[] = [];
	let groups = 0;
	let links = 0;
	let duplicates = 0;
	for (const entry of source) {
		const {kept, duplicates: skipped} = freshLinks(
			entry.links,
			seen,
			skipDuplicates,
			keepPinned,
			kind,
		);
		duplicates += skipped;
		if (kept.length === 0) {
			continue;
		}

		groups += 1;
		links += kept.length;
		if (kind === 'sessions') {
			const folder = sessionFolder(folders, entry.folder, now, newId);
			folders = folder.folders;
			const id = newId();
			const created = entry.createdAt ?? now;
			sessions.push({
				id,
				name: entry.name.trim() || DEFAULT_SESSION_NAME,
				folderId: folder.id,
				description: entry.description ?? '',
				createdAt: created,
				updatedAt: now,
				sourceWindowName: 'Imported',
				sourceWindowId: null,
				tabs: kept.map((link, index): SavedTab => ({
					id: newId(),
					title: link.title || hostOf(link.url),
					url: link.url,
					notes: link.notes ?? '',
					pinned: Boolean(link.pinned) && keepPinned,
					nativeGroup: null,
					savedAt: link.createdAt ?? created,
					originalIndex: index,
				})),
			});
		} else {
			const column = columnFor(bookmarkColumns, entry, now, newId);
			bookmarkColumns = column.columns;
			for (const link of kept) {
				bookmarks.push({
					id: newId(),
					title: link.title || hostOf(link.url),
					url: link.url,
					columnId: column.id,
					...(link.notes && {notes: link.notes}),
					...deviceStamp(link.deviceName ?? '', link.deviceKind ?? 'desktop'),
					createdAt: link.createdAt ?? now,
					updatedAt: now,
				});
			}
		}
	}

	if (links === 0) {
		return {store, groups: 0, links: 0, duplicates};
	}

	return {
		store: {
			...store,
			folders,
			bookmarkColumns,
			groups: [...sessions, ...store.groups],
			bookmarks: [...store.bookmarks, ...bookmarks],
			updatedAt: now,
		},
		groups,
		links,
		duplicates,
	};
}

/**
Sessions as the groups the Share formats take.
*/
export function shareGroupsOf(sessions: readonly Session[]): ShareGroup[] {
	return sessions.map((session) => ({
		name: session.name,
		description: session.description,
		createdAt: session.createdAt,
		tabs: session.tabs.map((tab) => ({
			title: tab.title,
			url: tab.url,
			pinned: tab.pinned,
		})),
	}));
}
