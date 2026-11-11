/*
How a library splits into sync records and goes back together. Each folder, session (without its tabs), saved tab,
bookmark column, bookmark, and portable preference is one record. Order is not part of a record's value: siblings
share an order group and the sync engine gives each one an order key.

Some fields belong to one device and never travel: the browser window a session came from, its window position,
and when it was last opened here. `assemble` keeps this device's values for them.
*/
import type {
	Bookmark,
	BookmarkColumn,
	Folder,
	SavedTab,
	Session,
	Settings,
	Store,
} from '../../app/types';
import type {TombstoneKind} from '../library-sync';
import {isRecord} from '../library-values';
import {recordKey} from './changes';

/**
Preferences that describe how the library looks and behaves, so they follow the user. Everything else (new tab,
toolbar, startup, context menus, snapshots, backups, browser bookmark monitoring) stays per device.
*/
export const PORTABLE_PREFERENCES = [
	'excludedOrigins',
	'saveDuplicateHandling',
	'saveDuplicateTitle',
	'restoreDuplicateHandling',
	'sessionSort',
	'expandSessionsByDefault',
	'showSessionFaviconPreviews',
	'sessionQuickActions',
	'stretchBookmarkColumns',
	'bookmarkColumnWidth',
	'bookmarkColumnsPerRow',
	'bookmarkDensity',
	'limitBookmarksPerColumn',
	'bookmarkColumnPageSize',
	'cleanTitles',
	'bookmarkClickAction',
	'sessionLinkClickAction',
	'bookmarkQuickActions',
	'sessionsOnTop',
	'copyFormat',
	'removeTrackingParameters',
	'simplifyUrls',
	'markInsecureLinks',
	'markLocalLinks',
	'urlDisplayMode',
	'groupTitleAction',
	'trashRetentionDays',
	'autoArchiveDays',
	'sessionNameStyle',
	'sessionNameTemplate',
	'sessionNameFallback',
] as const satisfies ReadonlyArray<keyof Settings>;

const SESSION_LOCAL_FIELDS = [
	'sourceWindowId',
	'windowBounds',
	'lastOpenedAt',
] as const;

export type LibraryRecord = {
	kind: TombstoneKind;
	id: string;
	parentId?: string;
	value: unknown;
};

/**
The order group of a record kind; tabs are ordered within their session.
*/
export function orderGroup(
	kind: TombstoneKind,
	parentId?: string,
): string | undefined {
	switch (kind) {
		case 'folder': {
			return 'folders';
		}

		case 'session': {
			return 'sessions';
		}

		case 'tab': {
			return `tabs:${parentId ?? ''}`;
		}

		case 'column': {
			return 'columns';
		}

		case 'bookmark': {
			return 'bookmarks';
		}

		case 'preference': {
			return undefined;
		}
	}
}

/**
The library's records in display order, keyed by `recordKey`.
*/
export function splitLibrary(store: Store): Map<string, LibraryRecord> {
	const records = new Map<string, LibraryRecord>();
	const add = (record: LibraryRecord) => records.set(recordKey(record), record);
	for (const folder of store.folders) {
		add({kind: 'folder', id: folder.id, value: folder});
	}

	for (const session of store.groups) {
		const {tabs, sourceWindowId, windowBounds, lastOpenedAt, ...value} =
			session;

		add({kind: 'session', id: session.id, value});
		for (const tab of tabs) {
			add({kind: 'tab', id: tab.id, parentId: session.id, value: tab});
		}
	}

	for (const column of store.bookmarkColumns) {
		add({kind: 'column', id: column.id, value: column});
	}

	for (const bookmark of store.bookmarks) {
		add({kind: 'bookmark', id: bookmark.id, value: bookmark});
	}

	for (const key of PORTABLE_PREFERENCES) {
		// A missing value has nothing to send; a change always carries a value or a delete.
		if (store.settings[key] !== undefined) {
			add({kind: 'preference', id: key, value: store.settings[key]});
		}
	}

	return records;
}

/**
A library from records in display order, with this device's own fields and settings taken from `local`. Record
values came from other devices, so the result must still go through the worker's normalization.
*/
export function assemble(
	records: Iterable<LibraryRecord>,
	local: Store,
): Store {
	const localSessions = new Map(
		local.groups.map((session) => [session.id, session]),
	);
	const folders: Folder[] = [];
	const sessions: Session[] = [];
	const tabs = new Map<string, SavedTab[]>();
	const bookmarkColumns: BookmarkColumn[] = [];
	const bookmarks: Bookmark[] = [];
	const settings: Record<string, unknown> = {...local.settings};

	for (const record of records) {
		if (!isRecord(record.value) && record.kind !== 'preference') {
			continue;
		}

		switch (record.kind) {
			case 'folder': {
				folders.push(record.value as Folder);
				break;
			}

			case 'session': {
				const here = localSessions.get(record.id);
				const session = {...(record.value as Session), tabs: []} as Session;
				for (const field of SESSION_LOCAL_FIELDS) {
					if (here?.[field] !== undefined) {
						(session as Record<string, unknown>)[field] = here[field];
					}
				}

				sessions.push(session);
				break;
			}

			case 'tab': {
				const list = tabs.get(record.parentId!) ?? [];
				list.push(record.value as SavedTab);
				tabs.set(record.parentId!, list);
				break;
			}

			case 'column': {
				bookmarkColumns.push(record.value as BookmarkColumn);
				break;
			}

			case 'bookmark': {
				bookmarks.push(record.value as Bookmark);
				break;
			}

			case 'preference': {
				if ((PORTABLE_PREFERENCES as readonly string[]).includes(record.id)) {
					settings[record.id] = record.value;
				}

				break;
			}
		}
	}

	for (const session of sessions) {
		session.tabs = tabs.get(session.id) ?? [];
	}

	return {
		...local,
		folders,
		groups: sessions,
		bookmarkColumns,
		bookmarks,
		settings: settings as Settings,
	};
}
