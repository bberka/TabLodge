/*
The phone's trash: what was deleted, with enough to put it back. Entries have the shape the extension and the sync
server use (`shared/trash.ts`), so a deletion made on any device can be restored on this phone and the other way round.
The functions here are pure; the storage is in `trash-storage.ts`.
*/
import {isRecord} from '../../../extension/src/shared/library-values';
import {
	normalizeBookmark,
	normalizeBookmarkColumn,
	normalizeFolder,
	normalizeGroup,
	normalizeTab,
} from '../../../extension/src/shared/library-normalize';
import {
	parseTrashEntry,
	type TrashEntry,
} from '../../../extension/src/shared/trash';
import type {
	Bookmark,
	BookmarkColumn,
	Folder,
	SavedTab,
	Session,
	Store,
} from '../../../extension/src/shared/types';
import {restoreBookmarks, restoreColumn} from './board-edits';
import {restoreFolder, restoreSession} from './session-edits';

export const TRASH_KEY = 'tablodge.trash';
export const PRIVATE_TRASH_KEY = 'tablodge.private.trash';

/**
The extension's default retention, used until the library says otherwise.
*/
export const DEFAULT_RETENTION_DAYS = 30;
/**
The most entries kept, as in the extension.
*/
export const TRASH_MAX_ITEMS = 500;
const DAY = 86_400_000;

/**
What a delete on this phone hands over. `addToTrash` turns it into an entry in the shared shape.
*/
type Details =
	| {kind: 'session'; session: Session}
	| {
			kind: 'tab';
			tab: SavedTab;
			index: number;
			sessionId: string;
			sessionName: string;
			folderId: string;
	  }
	| {kind: 'bookmark'; bookmark: Bookmark; after: string | null}
	| {kind: 'column'; column: BookmarkColumn; bookmarks: Bookmark[]}
	| {kind: 'folder'; folder: Folder; sessionIds: string[]};

export type NewTrash = Details;

const entryFor = (
	details: Details,
	id: string,
	deletedAt: number,
): TrashEntry => {
	switch (details.kind) {
		case 'session': {
			return {
				id,
				deletedAt,
				kind: 'session',
				label: details.session.name,
				origin: '',
				count: details.session.tabs.length,
				data: {session: details.session, index: 0},
			};
		}

		case 'tab': {
			return {
				id,
				deletedAt,
				kind: 'tabs',
				label: details.tab.title || details.tab.url,
				origin: details.sessionName,
				count: 1,
				data: {
					groupId: details.sessionId,
					groupName: details.sessionName,
					groupIndex: 0,
					groupMeta: null,
					folderId: details.folderId,
					items: [{tab: details.tab, index: details.index}],
				},
			};
		}

		case 'bookmark': {
			return {
				id,
				deletedAt,
				kind: 'bookmark',
				label: details.bookmark.title || details.bookmark.url,
				origin: '',
				count: 1,
				data: {
					bookmark: details.bookmark,
					columnId: details.bookmark.columnId,
					prevId: details.after,
					nextId: null,
				},
			};
		}

		case 'column': {
			return {
				id,
				deletedAt,
				kind: 'column',
				label: details.column.name,
				origin: '',
				count: details.bookmarks.length,
				data: {
					column: details.column,
					bookmarks: details.bookmarks,
					movedIds: [],
					movedTo: null,
				},
			};
		}

		case 'folder': {
			return {
				id,
				deletedAt,
				kind: 'folder',
				label: details.folder.name,
				origin: '',
				count: details.sessionIds.length,
				data: {folder: details.folder, groupIds: details.sessionIds},
			};
		}
	}
};

/**
An entry this app stored before it used the shared shape: the details sat beside the id.
*/
function fromEarlier(value: unknown): TrashEntry | undefined {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		typeof value.deletedAt !== 'number'
	) {
		return undefined;
	}

	let details: Details | undefined;
	switch (value.kind) {
		case 'session': {
			details = isRecord(value.session)
				? {kind: 'session', session: value.session as Session}
				: undefined;
			break;
		}

		case 'tab': {
			details =
				isRecord(value.tab) && typeof value.sessionId === 'string'
					? {
							kind: 'tab',
							tab: value.tab as SavedTab,
							index: Number(value.index) || 0,
							sessionId: value.sessionId,
							sessionName: String(value.sessionName ?? ''),
							folderId: String(value.folderId ?? ''),
						}
					: undefined;
			break;
		}

		case 'bookmark': {
			details = isRecord(value.bookmark)
				? {
						kind: 'bookmark',
						bookmark: value.bookmark as Bookmark,
						after: typeof value.after === 'string' ? value.after : null,
					}
				: undefined;
			break;
		}

		case 'column': {
			details =
				isRecord(value.column) && Array.isArray(value.bookmarks)
					? {
							kind: 'column',
							column: value.column as BookmarkColumn,
							bookmarks: value.bookmarks as Bookmark[],
						}
					: undefined;
			break;
		}

		case 'folder': {
			details =
				isRecord(value.folder) && Array.isArray(value.sessionIds)
					? {
							kind: 'folder',
							folder: value.folder as Folder,
							sessionIds: value.sessionIds as string[],
						}
					: undefined;
			break;
		}

		default: {
			break;
		}
	}

	return details && entryFor(details, value.id, value.deletedAt);
}

/**
Reads the stored list, keeping what was stored in the app's earlier shape and dropping anything that is not an entry.
*/
export function parseTrash(value: unknown): TrashEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((entry): TrashEntry[] => {
		const parsed = parseTrashEntry(entry) ?? fromEarlier(entry);
		return parsed ? [parsed] : [];
	});
}

/**
Puts new entries at the front, newest first.
*/
export function addToTrash(
	items: readonly TrashEntry[],
	added: readonly NewTrash[],
	ids: readonly string[],
	now: number,
): TrashEntry[] {
	return [
		...added.map((entry, index) => entryFor(entry, ids[index], now)),
		...items,
	];
}

/**
Drops what has been in the trash longer than the retention, and what is past the most entries kept. A retention that
is not a positive number keeps the default.
*/
export function purgeExpired(
	items: readonly TrashEntry[],
	retentionDays: number,
	now: number,
): TrashEntry[] {
	const days = retentionDays > 0 ? retentionDays : DEFAULT_RETENTION_DAYS;
	return items
		.filter((entry) => now - entry.deletedAt < days * DAY)
		.slice(0, TRASH_MAX_ITEMS);
}

/**
Whole days before an entry is purged, at least one while it is still there.
*/
export const daysLeft = (
	entry: TrashEntry,
	retentionDays: number,
	now: number,
): number =>
	Math.max(1, Math.ceil((entry.deletedAt + retentionDays * DAY - now) / DAY));

export const removeFromTrash = (
	items: readonly TrashEntry[],
	id: string,
): TrashEntry[] => items.filter((entry) => entry.id !== id);

/**
Which side of TabLodge an entry belongs to, for the Sessions and Bookmarks filter.
*/
export type TrashFilter = 'all' | 'sessions' | 'bookmarks';

export const trashSide = (entry: TrashEntry): Exclude<TrashFilter, 'all'> =>
	entry.kind === 'bookmark' || entry.kind === 'column'
		? 'bookmarks'
		: 'sessions';

export const filterTrash = (
	items: readonly TrashEntry[],
	filter: TrashFilter,
): TrashEntry[] =>
	filter === 'all'
		? [...items]
		: items.filter((entry) => trashSide(entry) === filter);

/**
A line for the list: what it was, where it came from, and how many links it holds.
*/
export function describeEntry(entry: TrashEntry): {
	title: string;
	origin: string;
	/**
	Links inside it, for the kinds that hold several.
	*/
	links: number;
} {
	const title = entry.label || 'Deleted item';
	switch (entry.kind) {
		case 'session': {
			return {
				title,
				origin: entry.origin ? `Session from ${entry.origin}` : 'Session',
				links: entry.count,
			};
		}

		case 'tabs': {
			return {
				title,
				origin: entry.origin
					? `${entry.count === 1 ? 'Link' : 'Links'} from ${entry.origin}`
					: entry.count === 1
						? 'Link'
						: 'Links',
				links: entry.count > 1 ? entry.count : 0,
			};
		}

		case 'bookmark': {
			return {
				title,
				origin: entry.origin ? `Bookmark from ${entry.origin}` : 'Bookmark',
				links: 0,
			};
		}

		case 'column': {
			return {title, origin: 'Bookmark column', links: entry.count};
		}

		case 'folder': {
			return {title, origin: 'Session folder', links: entry.count};
		}
	}
}

export type Restored = {
	store: Store;
	/**
	Set when the original place was gone and the item went somewhere else.
	*/
	note?: string;
	/**
	Set when the entry could not be put back, with the reason. The library is unchanged and the entry stays.
	*/
	error?: string;
};

const clampIndex = (value: unknown, length: number): number =>
	Math.max(
		0,
		Math.min(length, Number.isSafeInteger(value) ? (value as number) : length),
	);

const failed = (store: Store, error: string): Restored => ({store, error});

/**
Puts an entry back in the library. Where its folder or column is gone it goes to the first one, and `note` says so.
Bookmarks get new ids; the rest keep theirs. All of them sync, because a restore is newer than the delete. Entries
made by other devices are read defensively: anything that does not look like a session, link, bookmark, column, or
folder is refused instead of written.
*/
export function restoreEntry(
	store: Store,
	entry: TrashEntry,
	newId: () => string,
	now: number,
): Restored {
	const {data} = entry;
	switch (entry.kind) {
		case 'session': {
			const session = normalizeGroup(data.session, now, true);
			if (!session) {
				return failed(store, 'That session could not be restored.');
			}

			const folderGone = store.folders.every(
				(folder) => folder.id !== session.folderId,
			);
			return {
				store: restoreSession(store, session, now),
				note: folderGone
					? `Its folder is gone, so it went to ${store.folders[0]?.name ?? 'the first folder'}.`
					: undefined,
			};
		}

		case 'tabs': {
			const items = (Array.isArray(data.items) ? data.items : [])
				.filter(isRecord)
				.flatMap((item) => {
					const tab = normalizeTab(item.tab, now, 0);
					return tab ? [{tab, index: Number(item.index)}] : [];
				})
				.toSorted((a, b) => a.index - b.index);
			if (items.length === 0) {
				return failed(store, 'Those links could not be restored.');
			}

			const session = store.groups.find((group) => group.id === data.groupId);
			if (session) {
				const known = new Set(session.tabs.map((tab) => tab.id));
				const tabs = [...session.tabs];
				for (const {tab, index} of items) {
					const restored = known.has(tab.id) ? {...tab, id: newId()} : tab;
					known.add(restored.id);
					tabs.splice(clampIndex(index, tabs.length), 0, restored);
				}

				return {
					store: {
						...store,
						groups: store.groups.map((group) =>
							group.id === session.id
								? {...group, tabs, updatedAt: now}
								: group,
						),
						updatedAt: now,
					},
				};
			}

			const meta = isRecord(data.groupMeta) ? data.groupMeta : {};
			const folderId =
				typeof meta.folderId === 'string'
					? meta.folderId
					: typeof data.folderId === 'string'
						? data.folderId
						: '';
			const rebuilt: Session = {
				id:
					typeof meta.id === 'string' &&
					store.groups.every((group) => group.id !== meta.id)
						? meta.id
						: newId(),
				name:
					typeof meta.name === 'string'
						? meta.name
						: typeof data.groupName === 'string'
							? data.groupName
							: 'Restored links',
				folderId,
				description:
					typeof meta.description === 'string' ? meta.description : '',
				createdAt: now,
				updatedAt: now,
				sourceWindowName: '',
				sourceWindowId: null,
				tabs: items.map((item) => item.tab),
			};
			return {
				store: restoreSession(store, rebuilt, now),
				note: 'Its session is gone, so the links went into a new session with the same name.',
			};
		}

		case 'bookmark': {
			const columnIds = new Set(
				store.bookmarkColumns.map((column) => column.id),
			);
			const bookmark = normalizeBookmark(data.bookmark, columnIds, now);
			if (!bookmark) {
				return failed(store, 'That bookmark could not be restored.');
			}

			const columnGone = !columnIds.has(
				typeof data.columnId === 'string' ? data.columnId : bookmark.columnId,
			);
			const original = {
				...bookmark,
				columnId:
					typeof data.columnId === 'string' ? data.columnId : bookmark.columnId,
			};
			// With no bookmark before it, the one after it says where it went.
			const next =
				typeof data.nextId === 'string'
					? store.bookmarks.findIndex((item) => item.id === data.nextId)
					: -1;
			const before =
				typeof data.prevId === 'string'
					? data.prevId
					: next === -1
						? null
						: (store.bookmarks
								.slice(0, next)
								.findLast((item) => item.columnId === original.columnId)?.id ??
							null);
			return {
				store: restoreBookmarks(
					store,
					[{bookmark: original, after: before}],
					[newId()],
					now,
				),
				note: columnGone
					? `Its column is gone, so it went to ${store.bookmarkColumns[0]?.name ?? 'the first column'}.`
					: undefined,
			};
		}

		case 'column': {
			const column = normalizeBookmarkColumn(data.column);
			if (!column) {
				return failed(store, 'That column could not be restored.');
			}

			const columnIds = new Set([
				...store.bookmarkColumns.map((existing) => existing.id),
				column.id,
			]);
			const bookmarks = (Array.isArray(data.bookmarks) ? data.bookmarks : [])
				.map((raw) => normalizeBookmark(raw, columnIds, now))
				.filter((bookmark): bookmark is Bookmark => bookmark !== null)
				.map((bookmark) => ({...bookmark, columnId: column.id}));
			const added = restoreColumn(store, column, bookmarks, now);
			// Links moved elsewhere when the column was deleted go back if they are still where they were put.
			const moved = new Set(
				Array.isArray(data.movedIds) ? (data.movedIds as unknown[]) : [],
			);
			return {
				store: {
					...added,
					bookmarks: added.bookmarks.map((bookmark) =>
						moved.has(bookmark.id) && bookmark.columnId === data.movedTo
							? {...bookmark, columnId: column.id, updatedAt: now}
							: bookmark,
					),
				},
			};
		}

		case 'folder': {
			const folder = normalizeFolder(data.folder);
			if (!folder) {
				return failed(store, 'That folder could not be restored.');
			}

			const sessionIds = Array.isArray(data.groupIds)
				? data.groupIds
				: data.sessionIds;
			return {
				store: restoreFolder(
					store,
					folder,
					Array.isArray(sessionIds)
						? sessionIds.filter((id): id is string => typeof id === 'string')
						: [],
					now,
				),
			};
		}
	}
}

export {type TrashKind} from '../../../extension/src/shared/types';
export {type TrashEntry} from '../../../extension/src/shared/trash';
