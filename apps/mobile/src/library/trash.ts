/*
The phone's trash: what the person deleted on this phone, with enough to put it back. It is local like the
extension's trash and never syncs, so the sync protocol does not know it exists. The functions here are pure; the
storage is in `trash-store.ts`.
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
	restoreBookmarks,
	restoreColumn,
	restoreFolder,
	restoreSession,
} from './library';

export const TRASH_KEY = 'tablodge.trash';
export const PRIVATE_TRASH_KEY = 'tablodge.private.trash';

/**
The extension's default retention, used until the library says otherwise.
*/
export const DEFAULT_RETENTION_DAYS = 30;
const DAY = 86_400_000;

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

export type TrashEntry = Details & {id: string; deletedAt: number};
export type TrashKind = TrashEntry['kind'];

/**
An entry before it gets an id and a time.
*/
export type NewTrash = Details;

/**
Reads the stored list, dropping anything that is not an entry.
*/
export function parseTrash(value: unknown): TrashEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter(
		(entry): entry is TrashEntry =>
			typeof entry === 'object' &&
			entry !== null &&
			typeof (entry as TrashEntry).id === 'string' &&
			typeof (entry as TrashEntry).deletedAt === 'number' &&
			['session', 'tab', 'bookmark', 'column', 'folder'].includes(
				(entry as TrashEntry).kind,
			),
	);
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
		...added.map((entry, index) => ({
			...entry,
			id: ids[index],
			deletedAt: now,
		})),
		...items,
	];
}

/**
Drops what has been in the trash longer than the retention. A retention that is not a positive number keeps the default.
*/
export function purgeExpired(
	items: readonly TrashEntry[],
	retentionDays: number,
	now: number,
): TrashEntry[] {
	const days = retentionDays > 0 ? retentionDays : DEFAULT_RETENTION_DAYS;
	return items.filter((entry) => now - entry.deletedAt < days * DAY);
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
A line for the list: what it was, where it came from, and how many links it holds.
*/
export function describeEntry(entry: TrashEntry): {
	title: string;
	origin: string;
	count: number;
} {
	switch (entry.kind) {
		case 'session': {
			return {
				title: entry.session.name,
				origin: 'Session',
				count: entry.session.tabs.length,
			};
		}

		case 'tab': {
			return {
				title: entry.tab.title || entry.tab.url,
				origin: `Link from ${entry.sessionName}`,
				count: 1,
			};
		}

		case 'bookmark': {
			return {
				title: entry.bookmark.title || entry.bookmark.url,
				origin: 'Bookmark',
				count: 1,
			};
		}

		case 'column': {
			return {
				title: entry.column.name,
				origin: 'Bookmark column',
				count: entry.bookmarks.length,
			};
		}

		case 'folder': {
			return {
				title: entry.folder.name,
				origin: 'Session folder',
				count: entry.sessionIds.length,
			};
		}
	}
}

export type Restored = {
	store: Store;
	/**
	Set when the original place was gone and the item went somewhere else.
	*/
	note?: string;
};

/**
Puts an entry back in the library. Where its folder or column is gone it goes to the first one, and `note` says so.
Bookmarks get new ids (the server may have recorded the delete of the old ones); the rest keep theirs.
*/
export function restoreEntry(
	store: Store,
	entry: TrashEntry,
	newId: () => string,
	now: number,
): Restored {
	switch (entry.kind) {
		case 'session': {
			const folderGone = store.folders.every(
				(folder) => folder.id !== entry.session.folderId,
			);
			return {
				store: restoreSession(store, entry.session, now),
				note: folderGone
					? `Its folder is gone, so it went to ${store.folders[0]?.name ?? 'the first folder'}.`
					: undefined,
			};
		}

		case 'tab': {
			const session = store.groups.find(
				(group) => group.id === entry.sessionId,
			);
			if (session) {
				const tabs = [...session.tabs];
				tabs.splice(Math.min(entry.index, tabs.length), 0, entry.tab);
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

			const rebuilt: Session = {
				id: newId(),
				name: entry.sessionName,
				folderId: entry.folderId,
				description: '',
				createdAt: now,
				updatedAt: now,
				sourceWindowName: '',
				sourceWindowId: null,
				tabs: [entry.tab],
			};
			return {
				store: restoreSession(store, rebuilt, now),
				note: 'Its session is gone, so the link went into a new session with the same name.',
			};
		}

		case 'bookmark': {
			const columnGone = store.bookmarkColumns.every(
				(column) => column.id !== entry.bookmark.columnId,
			);
			return {
				store: restoreBookmarks(
					store,
					[{bookmark: entry.bookmark, after: entry.after}],
					[newId()],
					now,
				),
				note: columnGone
					? `Its column is gone, so it went to ${store.bookmarkColumns[0]?.name ?? 'the first column'}.`
					: undefined,
			};
		}

		case 'column': {
			return {store: restoreColumn(store, entry.column, entry.bookmarks, now)};
		}

		case 'folder': {
			return {
				store: restoreFolder(store, entry.folder, entry.sessionIds, now),
			};
		}
	}
}
