/*
The record layout's index and the code that plans a commit from it. See the header of library-state.ts for the
layout; this module has no storage access, only shapes, parsing, and diffing.
*/
import {
	parseSync,
	parseSyncMap,
	parseTombstones,
	type RecordSync,
	type SyncMap,
	type Tombstone,
	syncText,
} from './library-sync';
import {
	canonicalJson,
	hashText,
	isCount,
	isRecord,
	type Raw,
} from './library-values';

export const STATE_KEY = 'tablodge.state';
export const MIGRATION_KEY = 'tablodge.migration';
export const PREMIGRATION_KEY = 'tablodge.state.premigration';
export const SESSION_KEY_PREFIX = 'tablodge.session.';
export const BOOKMARKS_KEY_PREFIX = 'tablodge.bookmarks.';
export const LAYOUT_VERSION = 10;
export const LEGACY_SCHEMA_VERSION = 9;
export const BATCH_COUNT = 50;

export class LibraryDamagedError extends Error {
	constructor(detail: string) {
		super(
			`The saved library could not be read (${detail}). Nothing was changed. Restore a backup from Settings, or reload the extension and try again.`,
		);
		this.name = 'LibraryDamagedError';
	}
}

/**
What the index says about one session. The summary fields let menus list sessions without reading any tabs.
*/
export type SessionEntry = {
	id: string;
	rev: number;
	hash: string;
	tabs: number;
	name: string;
	folderId: string;
	createdAt: number;
	updatedAt: number;
	sync?: RecordSync;
	/**
	True when the record carries a `$sync` sidecar for its tabs.
	*/
	tabSync?: true;
};

export type BookmarksEntry = {
	rev: number;
	hash: string;
	count: number;
	/**
	True when the bookmarks record carries a `$sync` sidecar.
	*/
	sync?: true;
};

export const SIDECAR = '$sync';

export type MigrationNote = {
	schemaVersion: number;
	at: number;
	keepUntil: number;
	sessions: number;
	tabs: number;
	bookmarks: number;
};

export type LibraryIndex = {
	schemaVersion: number;
	layout: 'records';
	rev: number;
	updatedAt: number;
	folders: unknown[];
	bookmarkColumns: unknown[];
	settings: unknown;
	sessions: SessionEntry[];
	bookmarks: BookmarksEntry;
	garbage: string[];
	migratedFrom?: MigrationNote;
	device?: string;
	tombstones: Tombstone[];
	folderSync: SyncMap;
	columnSync: SyncMap;
	preferenceSync: SyncMap;
};

export const sessionKey = (id: string, rev: number) =>
	`${SESSION_KEY_PREFIX}${id}.${rev}`;
export const bookmarksKey = (rev: number) => `${BOOKMARKS_KEY_PREFIX}${rev}`;

export const isRecordsEntry = (
	value: unknown,
): value is Raw & {layout: 'records'} =>
	isRecord(value) && value.layout === 'records';

export function parseSessionEntry(value: unknown): SessionEntry {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		value.id === '' ||
		!isCount(value.rev) ||
		value.rev < 1 ||
		typeof value.hash !== 'string' ||
		!isCount(value.tabs)
	) {
		throw new LibraryDamagedError('the index lists an invalid session');
	}

	return {
		id: value.id,
		rev: value.rev,
		hash: value.hash,
		tabs: value.tabs,
		name: typeof value.name === 'string' ? value.name : '',
		folderId: typeof value.folderId === 'string' ? value.folderId : '',
		createdAt: Number(value.createdAt) || 0,
		updatedAt: Number(value.updatedAt) || 0,
		...(parseSync(value.sync) && {sync: parseSync(value.sync)}),
		...(value.tabSync === true && {tabSync: true as const}),
	};
}

export function parseIndex(entry: Raw): LibraryIndex {
	const {bookmarks} = entry;
	if (
		!isCount(entry.rev) ||
		!Array.isArray(entry.sessions) ||
		!isRecord(bookmarks) ||
		!isCount(bookmarks.rev) ||
		typeof bookmarks.hash !== 'string' ||
		!isCount(bookmarks.count)
	) {
		throw new LibraryDamagedError('the index is incomplete');
	}

	const sessions = entry.sessions.map((value) => parseSessionEntry(value));
	if (new Set(sessions.map((session) => session.id)).size !== sessions.length) {
		throw new LibraryDamagedError('the index lists a session twice');
	}

	const note = entry.migratedFrom;
	return {
		schemaVersion: Number(entry.schemaVersion),
		layout: 'records',
		rev: entry.rev,
		updatedAt: Number(entry.updatedAt) || 0,
		folders: Array.isArray(entry.folders) ? entry.folders : [],
		bookmarkColumns: Array.isArray(entry.bookmarkColumns)
			? entry.bookmarkColumns
			: [],
		settings: entry.settings,
		sessions,
		bookmarks: {
			rev: bookmarks.rev,
			hash: bookmarks.hash,
			count: bookmarks.count,
			...(bookmarks.sync === true && {sync: true as const}),
		},
		device: syncText(entry.device),
		tombstones: parseTombstones(entry.tombstones),
		folderSync: parseSyncMap(entry.folderSync),
		columnSync: parseSyncMap(entry.columnSync),
		preferenceSync: parseSyncMap(entry.preferenceSync),
		garbage: Array.isArray(entry.garbage)
			? entry.garbage.filter((key): key is string => typeof key === 'string')
			: [],
		migratedFrom:
			isRecord(note) && isCount(note.keepUntil)
				? {
						schemaVersion: Number(note.schemaVersion) || 0,
						at: Number(note.at) || 0,
						keepUntil: note.keepUntil,
						sessions: Number(note.sessions) || 0,
						tabs: Number(note.tabs) || 0,
						bookmarks: Number(note.bookmarks) || 0,
					}
				: undefined,
	};
}

/**
A session record as the app sees it: without the sync sidecar.
*/
export function sessionContent(value: Raw): Raw {
	if (!Object.hasOwn(value, SIDECAR)) {
		return value;
	}

	const copy = {...value};
	Reflect.deleteProperty(copy, SIDECAR);
	return copy;
}

/**
What a stored record holds for the app, which is what its checksum covers.
*/
function contentOf(key: string, value: unknown): unknown {
	if (!isRecord(value)) {
		return value;
	}

	return key.startsWith(BOOKMARKS_KEY_PREFIX)
		? value.items
		: sessionContent(value);
}

export const contentHash = (key: string, value: unknown) =>
	hashText(canonicalJson(contentOf(key, value)));

export const idsOf = (items: unknown): Set<string> =>
	new Set(
		(Array.isArray(items) ? items : []).flatMap((item: unknown) =>
			isRecord(item) && typeof item.id === 'string' ? [item.id] : [],
		),
	);

/**
Every record must carry a stable id that no sibling shares, because sync addresses records by id.
*/
export function assertStableIds(raw: Raw): void {
	const check = (items: unknown, label: string) => {
		const seen = new Set<string>();
		for (const item of Array.isArray(items) ? items : []) {
			if (!isRecord(item) || typeof item.id !== 'string' || item.id === '') {
				throw new Error(`A ${label} has no stable id.`);
			}

			if (seen.has(item.id)) {
				throw new Error(`Two ${label}s share the id ${item.id}.`);
			}

			seen.add(item.id);
		}
	};

	for (const group of Array.isArray(raw.groups) ? raw.groups : []) {
		check(isRecord(group) ? group.tabs : [], 'saved tab');
	}

	check(raw.folders, 'folder');
	check(raw.bookmarkColumns, 'bookmark column');
	check(raw.bookmarks, 'bookmark');
}

export const referencedKeys = (index: LibraryIndex) => [
	...index.sessions.map((session) => sessionKey(session.id, session.rev)),
	bookmarksKey(index.bookmarks.rev),
];

/**
Groups items into runs that stay under both limits, keeping order.
*/
export function batches<T>(
	items: readonly T[],
	weight: (item: T) => number,
	maxWeight: number,
	maxCount = BATCH_COUNT,
): T[][] {
	const result: T[][] = [];
	let run: T[] = [];
	let total = 0;
	for (const item of items) {
		const size = weight(item);
		if (
			run.length > 0 &&
			(run.length >= maxCount || total + size > maxWeight)
		) {
			result.push(run);
			run = [];
			total = 0;
		}

		run.push(item);
		total += size;
	}

	if (run.length > 0) {
		result.push(run);
	}

	return result;
}

export type PlannedSession = {
	entry: SessionEntry;
	key: string;
	value: Raw;
	json: string;
	/**
	True when the stored record already matches, so nothing is written.
	*/
	unchanged: boolean;
};

export type Plan = {
	sessions: PlannedSession[];
	bookmarks: {
		entry: BookmarksEntry;
		key: string;
		value: {items: unknown[]; $sync?: {items: SyncMap}};
		json: string;
		unchanged: boolean;
	};
};

export function planState(
	raw: Raw,
	rev: number,
	previous: LibraryIndex | null,
): Plan {
	const before = new Map(
		previous?.sessions.map((session) => [session.id, session]),
	);
	const seen = new Set<string>();
	const sessions = (Array.isArray(raw.groups) ? raw.groups : []).map(
		(group: unknown): PlannedSession => {
			if (!isRecord(group) || typeof group.id !== 'string' || group.id === '') {
				throw new Error('A session has no id, so it cannot be stored.');
			}

			if (seen.has(group.id)) {
				throw new Error(`Two sessions share the id ${group.id}.`);
			}

			seen.add(group.id);
			const json = canonicalJson(group);
			const hash = hashText(json);
			const old = before.get(group.id);
			if (old?.hash === hash) {
				return {
					entry: old,
					key: sessionKey(old.id, old.rev),
					value: group,
					json,
					unchanged: true,
				};
			}

			return {
				entry: {
					id: group.id,
					rev,
					hash,
					tabs: Array.isArray(group.tabs) ? group.tabs.length : 0,
					name: typeof group.name === 'string' ? group.name : '',
					folderId: typeof group.folderId === 'string' ? group.folderId : '',
					createdAt: Number(group.createdAt) || 0,
					updatedAt: Number(group.updatedAt) || 0,
					// Stamps follow the session until the sync engine changes them.
					...(old?.sync && {sync: old.sync}),
					...(old?.tabSync && {tabSync: true as const}),
				},
				key: sessionKey(group.id, rev),
				value: group,
				json,
				unchanged: false,
			};
		},
	);
	const bookmarks = Array.isArray(raw.bookmarks) ? raw.bookmarks : [];
	const json = canonicalJson(bookmarks);
	const hash = hashText(json);
	const unchanged = previous?.bookmarks.hash === hash;
	const bookmarkRev = unchanged ? previous.bookmarks.rev : rev;
	return {
		sessions,
		bookmarks: {
			entry: {
				rev: bookmarkRev,
				hash,
				count: bookmarks.length,
				...(previous?.bookmarks.sync && {sync: true as const}),
			},
			key: bookmarksKey(bookmarkRev),
			value: {items: bookmarks},
			json,
			unchanged,
		},
	};
}
