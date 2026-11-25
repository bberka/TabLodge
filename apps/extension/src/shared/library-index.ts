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
export const PREUPGRADE_KEY = 'tablodge.state.preupgrade';
export const SESSION_KEY_PREFIX = 'tablodge.session.';
export const BOOKMARKS_KEY_PREFIX = 'tablodge.bookmarks.';
export const SESSION_PAGE_KEY_PREFIX = 'tablodge.sidx.';
export const BOOKMARK_CHUNK_KEY_PREFIX = 'tablodge.bmchunk.';
export const SCHEMA_VERSION = 10;
export const INLINE_LAYOUT_VERSION = 10;
export const LAYOUT_VERSION = 11;
export const LEGACY_SCHEMA_VERSION = 9;
export const BATCH_COUNT = 50;
export const PAGE_SIZE = 100;

export class LibraryDamagedError extends Error {
	constructor(readonly detail: string) {
		super(
			`The saved library could not be read (${detail}). Nothing was changed. Restore a backup from Settings, or reload the extension and try again.`,
		);
		this.name = 'LibraryDamagedError';
	}
}

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
	tabSync?: true;
};

export type PageRef = {
	key: string;
	hash: string;
	count: number;
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
	kept?: string[];
};

export type LibraryIndex = {
	format: 10 | 11;
	schemaVersion: number;
	layout: 'records';
	rev: number;
	updatedAt: number;
	folders: unknown[];
	bookmarkColumns: unknown[];
	settings: unknown;
	sessions: SessionEntry[];
	sessionPages: PageRef[];
	bookmarkParts: PageRef[];
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

const bookmarksRevOf = (key: string) =>
	Number(key.slice(BOOKMARKS_KEY_PREFIX.length));

function parsePageRefs(value: unknown, prefix: string): PageRef[] {
	if (!Array.isArray(value)) {
		throw new LibraryDamagedError('the index is incomplete');
	}

	const refs = value.map((item: unknown): PageRef => {
		if (
			!isRecord(item) ||
			typeof item.key !== 'string' ||
			!item.key.startsWith(prefix) ||
			typeof item.hash !== 'string' ||
			!isCount(item.count)
		) {
			throw new LibraryDamagedError('the index lists an invalid page');
		}

		return {
			key: item.key,
			hash: item.hash,
			count: item.count,
			...(item.sync === true && {sync: true as const}),
		};
	});
	if (new Set(refs.map((ref) => ref.key)).size !== refs.length) {
		throw new LibraryDamagedError('the index lists a page twice');
	}

	return refs;
}

export function parseIndex(entry: Raw): LibraryIndex {
	const paged = Number(entry.schemaVersion) >= LAYOUT_VERSION;
	if (!isCount(entry.rev)) {
		throw new LibraryDamagedError('the index is incomplete');
	}

	let sessions: SessionEntry[] = [];
	let sessionPages: PageRef[] = [];
	let bookmarkParts: PageRef[];
	if (paged) {
		sessionPages = parsePageRefs(entry.sessionPages, SESSION_PAGE_KEY_PREFIX);
		bookmarkParts = parsePageRefs(
			entry.bookmarkChunks,
			BOOKMARK_CHUNK_KEY_PREFIX,
		);
	} else {
		const {bookmarks} = entry;
		if (
			!Array.isArray(entry.sessions) ||
			!isRecord(bookmarks) ||
			!isCount(bookmarks.rev) ||
			typeof bookmarks.hash !== 'string' ||
			!isCount(bookmarks.count)
		) {
			throw new LibraryDamagedError('the index is incomplete');
		}

		sessions = checkedSessions(
			entry.sessions.map((value) => parseSessionEntry(value)),
		);
		bookmarkParts = [
			{
				key: bookmarksKey(bookmarks.rev),
				hash: bookmarks.hash,
				count: bookmarks.count,
				...(bookmarks.sync === true && {sync: true as const}),
			},
		];
	}

	const note = entry.migratedFrom;
	return {
		format: paged ? 11 : 10,
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
		sessionPages,
		bookmarkParts,
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
						...(Array.isArray(note.kept) && {
							kept: note.kept.filter(
								(key): key is string =>
									typeof key === 'string' &&
									key.startsWith(BOOKMARKS_KEY_PREFIX),
							),
						}),
					}
				: undefined,
	};
}

export function checkedSessions(sessions: SessionEntry[]): SessionEntry[] {
	if (new Set(sessions.map((session) => session.id)).size !== sessions.length) {
		throw new LibraryDamagedError('the index lists a session twice');
	}

	return sessions;
}

export const bookmarkCount = (index: LibraryIndex) =>
	index.bookmarkParts.reduce((sum, part) => sum + part.count, 0);

export function storedIndex(index: LibraryIndex, garbage: string[]): Raw {
	const common = {
		layout: 'records',
		rev: index.rev,
		updatedAt: index.updatedAt,
		folders: index.folders,
		bookmarkColumns: index.bookmarkColumns,
		settings: index.settings,
		garbage,
		migratedFrom: index.migratedFrom,
		device: index.device,
		tombstones: index.tombstones,
		folderSync: index.folderSync,
		columnSync: index.columnSync,
		preferenceSync: index.preferenceSync,
	};
	if (index.format === 11) {
		return {
			...common,
			schemaVersion: LAYOUT_VERSION,
			sessionPages: index.sessionPages,
			bookmarkChunks: index.bookmarkParts,
		};
	}

	const [part] = index.bookmarkParts;
	return {
		...common,
		schemaVersion: INLINE_LAYOUT_VERSION,
		sessions: index.sessions,
		bookmarks: {
			rev: bookmarksRevOf(part.key),
			hash: part.hash,
			count: part.count,
			...(part.sync && {sync: true as const}),
		},
	};
}

export function sessionContent(value: Raw): Raw {
	if (!Object.hasOwn(value, SIDECAR)) {
		return value;
	}

	const copy = {...value};
	Reflect.deleteProperty(copy, SIDECAR);
	return copy;
}

function contentOf(key: string, value: unknown): unknown {
	if (!isRecord(value)) {
		return value;
	}

	return key.startsWith(BOOKMARKS_KEY_PREFIX) ||
		key.startsWith(BOOKMARK_CHUNK_KEY_PREFIX) ||
		key.startsWith(SESSION_PAGE_KEY_PREFIX)
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
	...index.sessionPages.map((page) => page.key),
	...index.bookmarkParts.map((part) => part.key),
];

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
	unchanged: boolean;
};

export type PlannedPart = {
	ref: PageRef;
	value: {items: unknown[]; $sync?: {items: SyncMap}};
	json: string;
	unchanged: boolean;
};

export type Plan = {
	sessions: PlannedSession[];
	sessionPages: PlannedPart[];
	bookmarks: PlannedPart[];
};

export function planParts(
	items: readonly unknown[],
	prefix: string,
	rev: number,
	previous: readonly PageRef[],
): PlannedPart[] {
	const parts: PlannedPart[] = [];
	for (let n = 0; n * PAGE_SIZE < items.length; n += 1) {
		const slice = items.slice(n * PAGE_SIZE, (n + 1) * PAGE_SIZE);
		const json = canonicalJson(slice);
		const hash = hashText(json);
		const old = previous[n];
		const unchanged = old?.hash === hash && old.count === slice.length;
		parts.push({
			ref: unchanged
				? old
				: {key: `${prefix}${n}.${rev}`, hash, count: slice.length},
			value: {items: slice},
			json,
			unchanged,
		});
	}

	return parts;
}

export function planState(
	raw: Raw,
	rev: number,
	previous: LibraryIndex | null,
	format: 10 | 11,
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
	const paged = previous?.format === 11;
	if (format === 11) {
		return {
			sessions,
			sessionPages: planParts(
				sessions.map((session) => session.entry),
				SESSION_PAGE_KEY_PREFIX,
				rev,
				paged ? previous.sessionPages : [],
			),
			bookmarks: planParts(
				bookmarks,
				BOOKMARK_CHUNK_KEY_PREFIX,
				rev,
				paged ? previous.bookmarkParts : [],
			),
		};
	}

	const json = canonicalJson(bookmarks);
	const hash = hashText(json);
	const old = previous?.bookmarkParts[0];
	const unchanged = old?.hash === hash && !paged;
	return {
		sessions,
		sessionPages: [],
		bookmarks: [
			{
				ref: unchanged
					? old
					: {key: bookmarksKey(rev), hash, count: bookmarks.length},
				value: {items: bookmarks},
				json,
				unchanged,
			},
		],
	};
}
