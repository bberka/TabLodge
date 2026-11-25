import type {
	Bookmark,
	BookmarkColumn,
	Folder,
	SavedTab,
	Session,
	Settings,
	Store,
} from '../types';
import type {TombstoneKind} from '../library-sync';
import {tagFields} from '../bookmark-tags';
import {bookmarkNotes, DEFAULT_SETTINGS} from '../library-normalize';
import {LIBRARY_SETTINGS} from '../setting-scopes';
import {canonicalJson, isRecord} from '../library-values';
import {parseTrashEntry, syncedTrash, type TrashEntry} from '../trash';
import {recordKey} from './changes';

const PORTABLE_PREFERENCES = [
	'closeOnSave',
	'emptyWindowAfterSave',
	'includePinnedTabs',
	'ignoreTabGroups',
	'openDashboardAfterSave',
	'openDashboardOnStartup',
	'startupBehavior',
	'newTabEnabled',
	'newTabFallback',
	'newTabFallbackUrl',
	'autoFocusSearchOnNewTab',
	'actionMode',
	'restoreTarget',
	'restoreWindowBounds',
	'restoreMode',
	'unloadRestoredTabs',
	'unloadRestoredTabsThreshold',
	'restoreSplitTabs',
	'saveSplitTabs',
	'paletteLocation',
	'pasteLinkToBookmark',
	'showSaveWindowButton',
	'showTrashBinButton',
	'dashboardWidth',
	'bookmarkBoardView',
	'sessionFolderView',
	'showAllBookmarks',
	'keepLodgePinned',
	'dashboardBehavior',
	'contextMenusEnabled',
	'contextMenuLinksEnabled',
	'contextMenuPageEnabled',
	'contextMenuSelectionEnabled',
	'contextMenuActionEnabled',
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
	'mobileApp',
] as const satisfies ReadonlyArray<keyof Settings>;

const scopes: Record<
	Exclude<keyof Settings, 'heldSettings'>,
	(typeof LIBRARY_SETTINGS)[keyof typeof LIBRARY_SETTINGS]
> = LIBRARY_SETTINGS;

export const SETTING_KEYS: ReadonlyArray<keyof Settings> = (
	Object.keys(scopes) as Array<keyof typeof scopes>
).filter(
	(key) =>
		scopes[key][0] !== 'device' &&
		!(PORTABLE_PREFERENCES as readonly string[]).includes(key),
);

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

export function isUntouchedDefault(
	record: LibraryRecord,
	defaults: Readonly<Record<string, unknown>> = {},
) {
	if (record.kind !== 'setting') {
		return false;
	}

	const own = Object.hasOwn(defaults, record.id)
		? defaults
		: (DEFAULT_SETTINGS as Readonly<Record<string, unknown>>);
	return (
		Object.hasOwn(own, record.id) &&
		canonicalJson(record.value) === canonicalJson(own[record.id])
	);
}

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

		case 'preference':
		case 'setting':
		case 'trash':
		case 'note':
		case 'tag':
		case 'source': {
			return undefined;
		}
	}
}

export type SyncedSource = {id: string; value: Record<string, unknown>};

const sessionCache = new WeakMap<Session, LibraryRecord[]>();
const bookmarkCache = new WeakMap<Bookmark, LibraryRecord[]>();

function sessionRecords(session: Session): LibraryRecord[] {
	let records = sessionCache.get(session);
	if (!records) {
		const {tabs, sourceWindowId, windowBounds, lastOpenedAt, ...value} =
			session;
		records = [
			{kind: 'session', id: session.id, value},
			...tabs.map((tab): LibraryRecord => ({
				kind: 'tab',
				id: tab.id,
				parentId: session.id,
				value: tab,
			})),
		];
		sessionCache.set(session, records);
	}

	return records;
}

function bookmarkRecords(source: Bookmark): LibraryRecord[] {
	let records = bookmarkCache.get(source);
	if (!records) {
		const {notes, tags, hiddenKinds, ...bookmark} = source;
		records = [{kind: 'bookmark', id: bookmark.id, value: bookmark}];
		if (notes) {
			records.push({kind: 'note', id: bookmark.id, value: {notes}});
		}

		const tagged = tagFields({tags, hiddenKinds});
		if (tagged.tags || tagged.hiddenKinds) {
			records.push({kind: 'tag', id: bookmark.id, value: tagged});
		}

		bookmarkCache.set(source, records);
	}

	return records;
}

export function splitLibrary(
	store: Store,
	trash: readonly TrashEntry[] = [],
	sources: readonly SyncedSource[] = [],
	outside: Readonly<Record<string, unknown>> = {},
): Map<string, LibraryRecord> {
	const records = new Map<string, LibraryRecord>();
	const add = (record: LibraryRecord) => records.set(recordKey(record), record);
	for (const folder of store.folders) {
		add({kind: 'folder', id: folder.id, value: folder});
	}

	for (const session of store.groups) {
		for (const record of sessionRecords(session)) {
			add(record);
		}
	}

	for (const column of store.bookmarkColumns) {
		add({kind: 'column', id: column.id, value: column});
	}

	for (const bookmark of store.bookmarks) {
		for (const record of bookmarkRecords(bookmark)) {
			add(record);
		}
	}

	for (const key of PORTABLE_PREFERENCES) {
		if (store.settings[key] !== undefined) {
			add({kind: 'preference', id: key, value: store.settings[key]});
		}
	}

	for (const [id, value] of Object.entries(store.settings.heldSettings ?? {})) {
		add({kind: 'setting', id, value});
	}

	for (const key of SETTING_KEYS) {
		if (store.settings[key] !== undefined) {
			add({kind: 'setting', id: key, value: store.settings[key]});
		}
	}

	for (const [id, value] of Object.entries(outside)) {
		add({kind: 'setting', id, value});
	}

	for (const entry of trash) {
		const value = syncedTrash(entry);
		if (value) {
			add({kind: 'trash', id: entry.id, value});
		}
	}

	for (const {id, value} of sources) {
		add({kind: 'source', id, value});
	}

	return records;
}

export function sourcesOf(records: Iterable<LibraryRecord>): SyncedSource[] {
	const sources: SyncedSource[] = [];
	for (const record of records) {
		if (record.kind === 'source' && isRecord(record.value)) {
			sources.push({id: record.id, value: record.value});
		}
	}

	return sources;
}

export function trashOf(records: Iterable<LibraryRecord>): TrashEntry[] {
	const entries: TrashEntry[] = [];
	for (const record of records) {
		const entry =
			record.kind === 'trash' ? parseTrashEntry(record.value) : undefined;
		if (entry) {
			entries.push({...entry, id: record.id});
		}
	}

	return entries.toSorted((a, b) => b.deletedAt - a.deletedAt);
}

export function assemble(
	records: Iterable<LibraryRecord>,
	local: Store,
	syncSettings = true,
	outside: ReadonlySet<string> = new Set(),
): Store {
	const localSessions = new Map(
		local.groups.map((session) => [session.id, session]),
	);
	const folders: Folder[] = [];
	const sessions: Session[] = [];
	const tabs = new Map<string, SavedTab[]>();
	const bookmarkColumns: BookmarkColumn[] = [];
	const bookmarks: Bookmark[] = [];
	const notes = new Map<string, string>();
	const tags = new Map<string, Pick<Bookmark, 'tags' | 'hiddenKinds'>>();
	const settings: Record<string, unknown> = {...local.settings};
	const held: Record<string, unknown> = {};

	for (const record of records) {
		if (
			record.kind === 'trash' ||
			record.kind === 'source' ||
			(!isRecord(record.value) &&
				record.kind !== 'preference' &&
				record.kind !== 'setting')
		) {
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

			case 'note': {
				const text = bookmarkNotes((record.value as {notes?: unknown}).notes);
				if (text) {
					notes.set(record.id, text);
				}

				break;
			}

			case 'tag': {
				const tagged = tagFields(record.value as Record<string, unknown>);
				if (tagged.tags || tagged.hiddenKinds) {
					tags.set(record.id, tagged);
				}

				break;
			}

			case 'preference': {
				if (
					syncSettings &&
					(PORTABLE_PREFERENCES as readonly string[]).includes(record.id)
				) {
					settings[record.id] = record.value;
				}

				break;
			}

			case 'setting': {
				if (!syncSettings) {
					break;
				}

				if ((SETTING_KEYS as readonly string[]).includes(record.id)) {
					settings[record.id] = record.value;
				} else if (
					!Object.hasOwn(DEFAULT_SETTINGS, record.id) &&
					!outside.has(record.id)
				) {
					held[record.id] = record.value;
				}

				break;
			}
		}
	}

	if (syncSettings) {
		settings.heldSettings = held;
	}

	for (const session of sessions) {
		session.tabs = tabs.get(session.id) ?? [];
	}

	return {
		...local,
		folders,
		groups: sessions,
		bookmarkColumns,
		bookmarks: bookmarks.map((bookmark) => {
			const text = notes.get(bookmark.id);
			return {
				...bookmark,
				...(text && {notes: text}),
				...tags.get(bookmark.id),
			};
		}),
		settings: settings as Settings,
	};
}
