/*
The library's stored layout: sessions and bookmarks live in their own storage keys, with a small index
under `tablodge.state` that says which key versions make up the library right now.

Why: `tablodge.state` used to hold every session and bookmark in one value, so saving one tab rewrote the whole
library. Now a save writes the changed sessions and the index.

Keys (all in the same storage area, under the same private prefix, as the logical key `tablodge.state`):
  tablodge.state                  the index (`layout: 'records'`, schema 10): folders, columns, settings, an entry per session
  tablodge.session.<id>.<rev>     one session with its tabs; never edited in place, an edit writes a new key
  tablodge.bookmarks.<rev>        all bookmarks as one array
  tablodge.migration              progress marker, present only while a migration is unfinished
  tablodge.state.premigration     exact copy of the old single entry, kept for a few days after a verified migration

A commit writes new record keys first, then the index. The index write is the commit point, so a crash leaves
either the previous library or the new one, never a mix. Keys a commit replaces are listed in the index as
`garbage` and removed by the next commit, so a reader that fetched the previous index can still finish.

Sync-ready metadata. Record level sync (issue #3) needs a stable id, a revision stamp, a tombstone, and an order key
per record. Ids already exist on every record and are checked when the library is migrated. The rest is reserved
here as optional fields that the app never sees (they are not part of the app's data model, so imports cannot
inject them and exports cannot leak them) and that every write carries along:
  index `sessions[i].sync`, `folderSync`, `columnSync`, `preferenceSync`   stamp and order key by record id
  index `tombstones`                       deleted records with `deletedAt` and `purgeAfter`, dropped once expired
  index `device`                           this library copy's device id, assigned when sync is switched on
  session record `$sync.tabs`              stamp and order key by saved tab id (flagged by `sessions[i].tabSync`)
  bookmarks record `$sync`                 the same for bookmarks (flagged by `bookmarks.sync`)
Nothing writes stamps, tombstones, or order keys yet. A missing stamp means "never stamped": its implied stamp is the
record's own `updatedAt` (or `createdAt`) with no device. A missing order key means "position in the stored array".
So switching sync on needs no storage migration; the sync engine stamps and orders on first sync.

This module knows nothing about the browser: it takes a key/value backend, so tests can make any call fail.
*/

import {
	BATCH_COUNT,
	batches,
	bookmarkCount,
	assertStableIds,
	BOOKMARK_CHUNK_KEY_PREFIX,
	BOOKMARKS_KEY_PREFIX,
	checkedSessions,
	contentHash,
	idsOf,
	INLINE_LAYOUT_VERSION,
	isRecordsEntry,
	LAYOUT_VERSION,
	LEGACY_SCHEMA_VERSION,
	LibraryDamagedError,
	type LibraryIndex,
	MIGRATION_KEY,
	type MigrationNote,
	type PageRef,
	parseIndex,
	parseSessionEntry,
	type Plan,
	type PlannedPart,
	planParts,
	planState,
	PREMIGRATION_KEY,
	PREUPGRADE_KEY,
	referencedKeys,
	SCHEMA_VERSION,
	SESSION_KEY_PREFIX,
	SESSION_PAGE_KEY_PREFIX,
	SIDECAR,
	type SessionEntry,
	sessionContent,
	sessionKey,
	STATE_KEY,
	storedIndex,
} from './library-index';
import {
	applyPatch,
	diffList,
	type ListPatch,
	parsePatch,
} from './library-patch';
import {
	carriedSync,
	keepOnly,
	parseSyncMap,
	type SyncMap,
} from './library-sync';
import {canonicalJson, hashText, isRecord, type Raw} from './library-values';

export {
	BOOKMARK_CHUNK_KEY_PREFIX,
	BOOKMARKS_KEY_PREFIX,
	bookmarksKey,
	LAYOUT_VERSION,
	LEGACY_SCHEMA_VERSION,
	LibraryDamagedError,
	type LibraryIndex,
	MIGRATION_KEY,
	PREMIGRATION_KEY,
	PREUPGRADE_KEY,
	SCHEMA_VERSION,
	SESSION_KEY_PREFIX,
	SESSION_PAGE_KEY_PREFIX,
	type SessionEntry,
	sessionKey,
	STATE_KEY,
} from './library-index';
export type {RecordSync, Tombstone, TombstoneKind} from './library-sync';

export type KeyValueBackend = {
	get(keys: string[]): Promise<Raw>;
	set(values: Raw): Promise<void>;
	remove(keys: string[]): Promise<void>;
	getBytesInUse?(keys: string[]): Promise<number>;
};

// The recovery copy outlives a verified migration by this long.
export const PREMIGRATION_KEEP_MS = 7 * 86_400_000;
// Serialized characters per `set`, and tabs per `get`, so one call never holds a huge value.
const WRITE_BATCH_CHARS = 2_000_000;
const READ_BATCH_TABS = 5000;
const MAX_READ_RETRIES = 4;

type MigrationMarker = {
	version: 1;
	from: number;
	sourceHash: string;
	startedAt: number;
	attempts: number;
	written: string[];
	lastError?: string;
};

export type MigrationOutcome =
	| {status: 'none'}
	| {status: 'current'}
	| {status: 'newer'}
	| {
			status: 'migrated';
			sessions: number;
			tabs: number;
			bookmarks: number;
			resumed: boolean;
	  };

export type LibraryProblem = {key: string; problem: string};

/**
What Undo keeps of the library: the index as it was and only the records the action replaced. Records are never
edited in place, so everything else is still where the index says.
*/
export type UndoDelta = {
	undoDelta: 1 | 2 | 3;
	/**
	The index as it was stored when the checkpoint began (from version 2 on, a layout 10 one without its sessions).
	*/
	index: Raw;
	records: Raw;
	/**
	From version 2 on: the index lists no sessions and the replaced bookmarks record is not in `records`. The old
	session list and the old bookmarks are given as what differs from the commit the action ended on, whose `rev` is
	the list lengths each patch records.
	*/
	sessions?: ListPatch;
	bookmarks?: ListPatch;
};

export const isUndoDelta = (value: unknown): value is UndoDelta =>
	isRecord(value) &&
	[1, 2, 3].includes(Number(value.undoDelta)) &&
	isRecord(value.index) &&
	isRecord(value.records);

type Collector = {
	index: LibraryIndex;
	entry: Raw;
	pending: Set<string>;
	records: Map<string, unknown>;
	complete: boolean;
};

/**
An open checkpoint: hand it back to `endCheckpoint`.
*/
export type Checkpoint = {readonly collector: Collector};

export type LibraryState = ReturnType<typeof createLibraryState>;

export function createLibraryState(
	backend: KeyValueBackend,
	{
		now = Date.now,
		writeBatchChars = WRITE_BATCH_CHARS,
		writeBatchCount = BATCH_COUNT,
		layoutVersion: maxLayout = LAYOUT_VERSION,
	}: {
		now?: () => number;
		/**
		The newest layout this instance understands. Tests pin it to 10 to be the version before layout 11.
		*/
		layoutVersion?: number;
		/**
		Serialized characters and records per `set`; tests shrink them to force several batches.
		*/
		writeBatchChars?: number;
		writeBatchCount?: number;
	} = {},
) {
	const getOne = async (key: string): Promise<unknown> =>
		(await backend.get([key]))[key];

	const collectors = new Set<Collector>();

	/**
	Before a commit replaces records, open checkpoints take a copy of the ones they still need. A failure here
	only costs the checkpoint (no Undo); it never fails the save.
	*/
	const captureReplaced = async (keys: readonly string[]) => {
		for (const collector of collectors) {
			const wanted = keys.filter(
				(key) => collector.pending.has(key) && !collector.records.has(key),
			);
			try {
				for (const run of batches(wanted, () => 1, 10, 10)) {
					const saved = await backend.get(run);
					for (const key of run) {
						if (saved[key] === undefined) {
							collector.complete = false;
						} else {
							collector.records.set(key, saved[key]);
						}
					}
				}
			} catch {
				collector.complete = false;
			}
		}
	};

	const removeKeys = async (keys: readonly string[]) => {
		for (const run of batches(keys, () => 1, 200, 200)) {
			await backend.remove(run);
		}
	};

	const writeAll = async (
		items: Array<{key: string; value: unknown; json: string}>,
	) => {
		for (const run of batches(
			items,
			(item) => item.json.length,
			writeBatchChars,
			writeBatchCount,
		)) {
			await backend.set(
				Object.fromEntries(run.map((item) => [item.key, item.value])),
			);
		}
	};

	const getMany = async (keys: string[], extra?: Raw): Promise<Raw> => {
		if (!extra) {
			return backend.get(keys);
		}

		const missing = keys.filter((key) => !Object.hasOwn(extra, key));
		const saved = missing.length > 0 ? await backend.get(missing) : {};
		return {
			...saved,
			...Object.fromEntries(
				keys
					.filter((key) => Object.hasOwn(extra, key))
					.map((key) => [key, extra[key]]),
			),
		};
	};

	const known = (entry: unknown): entry is Raw & {layout: 'records'} =>
		isRecordsEntry(entry) && Number(entry.schemaVersion) <= maxLayout;

	const tooNew = (entry: Raw) =>
		Number(entry.schemaVersion) >
		(isRecordsEntry(entry) ? maxLayout : SCHEMA_VERSION);

	const why = (value: unknown) =>
		value === undefined ? 'missing' : 'does not match the index';

	const pageCache = new Map<string, {hash: string; entries: SessionEntry[]}>();

	/**
	The index with every session entry: a layout 11 index keeps them in pages, which are read here. A page is read
	once per content: the pages of the latest index stay in memory, so a commit reads only what it changed.
	*/
	async function loadIndex(entry: Raw, extra?: Raw): Promise<LibraryIndex> {
		const index = parseIndex(entry);
		if (index.format === 10) {
			return index;
		}

		const pages = new Map<string, SessionEntry[]>();
		const missing = index.sessionPages.filter((page) => {
			const cached = pageCache.get(page.key);
			if (cached?.hash === page.hash) {
				pages.set(page.key, cached.entries);
				return false;
			}

			return true;
		});
		for (const run of batches(missing, () => 1, 20, 20)) {
			const saved = await getMany(
				run.map((page) => page.key),
				extra,
			);
			for (const page of run) {
				const value = saved[page.key];
				if (
					!isRecord(value) ||
					!Array.isArray(value.items) ||
					value.items.length !== page.count
				) {
					throw new LibraryDamagedError(`${page.key} ${why(value)}`);
				}

				const entries = value.items.map((item) => parseSessionEntry(item));
				pages.set(page.key, entries);
				if (!extra) {
					pageCache.set(page.key, {hash: page.hash, entries});
				}
			}
		}

		if (!extra) {
			for (const key of pageCache.keys()) {
				if (!pages.has(key)) {
					pageCache.delete(key);
				}
			}
		}

		return {
			...index,
			sessions: checkedSessions(
				index.sessionPages.flatMap((page) => pages.get(page.key)!),
			),
		};
	}

	/**
	The session entries (id, name, folder, times) of an index as stored, without reading any session.
	*/
	async function readSessionEntries(entry: Raw): Promise<SessionEntry[]> {
		return known(entry) ? (await loadIndex(entry)).sessions : [];
	}

	/**
	Reads the pieces that hold the bookmarks and returns them in order, or what was wrong with them.
	*/
	async function readParts(parts: readonly PageRef[], extra?: Raw) {
		const problems: LibraryProblem[] = [];
		const pieces: unknown[][] = [];
		for (const run of batches(parts, () => 1, 20, 20)) {
			const saved = await getMany(
				run.map((part) => part.key),
				extra,
			);
			for (const part of run) {
				const value = saved[part.key];
				const items = isRecord(value) ? value.items : undefined;
				if (Array.isArray(items) && items.length === part.count) {
					pieces.push(items);
				} else {
					problems.push({key: part.key, problem: why(value)});
				}
			}
		}

		return {problems, items: pieces.flat()};
	}

	/**
	Reads and checks the records an index points at. Returns what was wrong instead of throwing, so the caller can retry.
	*/
	async function loadRecords(index: LibraryIndex) {
		const problems: LibraryProblem[] = [];
		const groups: Raw[] = [];
		for (const run of batches(
			index.sessions,
			(session) => session.tabs + 1,
			READ_BATCH_TABS,
		)) {
			const keys = run.map((session) => sessionKey(session.id, session.rev));
			const saved = await backend.get(keys);
			for (const [at, session] of run.entries()) {
				const value = saved[keys[at]];
				if (
					!isRecord(value) ||
					value.id !== session.id ||
					!Array.isArray(value.tabs) ||
					value.tabs.length !== session.tabs
				) {
					problems.push({
						key: keys[at],
						problem: why(value),
					});
				} else {
					groups.push(sessionContent(value));
				}
			}
		}

		const bookmarks = await readParts(index.bookmarkParts);
		problems.push(...bookmarks.problems);
		return {problems, groups, bookmarks: bookmarks.items};
	}

	function assemble(
		index: LibraryIndex,
		groups: Raw[],
		bookmarks: unknown[],
	): Raw {
		return {
			schemaVersion: SCHEMA_VERSION,
			groups,
			folders: index.folders,
			bookmarkColumns: index.bookmarkColumns,
			bookmarks,
			settings: index.settings,
			updatedAt: index.updatedAt,
		};
	}

	/**
	The whole library in the old single entry's shape (`groups`, `bookmarks`, ...), or null when nothing is stored.
	An entry in the old layout, or one saved by a newer version, comes back as stored.
	*/
	async function read(): Promise<Raw | null> {
		for (let attempt = 0; ; attempt += 1) {
			const entry = await getOne(STATE_KEY);
			if (!isRecord(entry)) {
				return null;
			}

			if (!known(entry)) {
				return entry;
			}

			let problem: string;
			try {
				const index = await loadIndex(entry);
				const loaded = await loadRecords(index);
				if (loaded.problems.length === 0) {
					return assemble(index, loaded.groups, loaded.bookmarks);
				}

				const [first] = loaded.problems;
				problem = `${first.key} ${first.problem}${loaded.problems.length > 1 ? `, and ${loaded.problems.length - 1} more` : ''}`;
			} catch (error) {
				if (!(error instanceof LibraryDamagedError)) {
					throw error;
				}

				problem = error.detail;
			}

			// A commit that finished while this read was in flight removed keys this index pointed at: read again.
			const again = await getOne(STATE_KEY);
			if (
				attempt < MAX_READ_RETRIES &&
				isRecordsEntry(again) &&
				again.rev !== entry.rev
			) {
				continue;
			}

			throw new LibraryDamagedError(problem);
		}
	}

	/**
	Settings and schema version without reading any session. In the old layout this still reads the whole entry.
	`upgradable` is true while the index is still in layout 10, which `upgrade` moves to layout 11.
	*/
	async function readMeta(): Promise<{
		layout: 'none' | 'legacy' | 'records';
		schemaVersion: number;
		settings: unknown;
		upgradable: boolean;
	}> {
		const entry = await getOne(STATE_KEY);
		if (!isRecord(entry)) {
			return {
				layout: 'none',
				schemaVersion: 0,
				settings: undefined,
				upgradable: false,
			};
		}

		const stored = Number(entry.schemaVersion) || 0;
		return {
			layout: isRecordsEntry(entry) ? 'records' : 'legacy',
			schemaVersion: known(entry) ? SCHEMA_VERSION : stored,
			settings: entry.settings,
			upgradable:
				known(entry) &&
				stored === INLINE_LAYOUT_VERSION &&
				maxLayout > INLINE_LAYOUT_VERSION,
		};
	}

	const writtenParts = (parts: readonly PlannedPart[]) =>
		parts
			.filter((part) => !part.unchanged)
			.map((part) => ({key: part.ref.key, value: part.value, json: part.json}));

	/**
	Stores the library. Writes only the sessions, pages, and bookmark chunks that changed, and the index. While the
	library is still in the old layout (a migration that could not finish) it writes the old single entry, so the app
	keeps working; a layout 10 index is written as layout 10 until `upgrade` has moved it.
	*/
	async function write(raw: Raw): Promise<void> {
		const current = await getOne(STATE_KEY);
		if (isRecord(current) && tooNew(current)) {
			throw new Error('This library was saved by a newer version.');
		}

		if (isRecord(current) && !isRecordsEntry(current)) {
			await backend.set({
				[STATE_KEY]: {...raw, schemaVersion: LEGACY_SCHEMA_VERSION},
			});
			return;
		}

		const previous = isRecordsEntry(current) ? await loadIndex(current) : null;
		const format = previous?.format ?? (maxLayout >= LAYOUT_VERSION ? 11 : 10);
		const rev = (previous?.rev ?? 0) + 1;
		const plan = planState(raw, rev, previous, format);
		await carrySidecars(plan, previous);
		await writeAll([
			...plan.sessions.filter((session) => !session.unchanged),
			...writtenParts(plan.sessionPages),
			...writtenParts(plan.bookmarks),
		]);
		const index = buildIndex(raw, plan, rev, previous, format);
		const next = new Set(referencedKeys(index));
		const replaced = previous
			? referencedKeys(previous).filter((key) => !next.has(key))
			: [];
		await captureReplaced(replaced);
		// Nothing reads the previous commit's garbage any more; a failed cleanup is carried over, not fatal.
		let leftover: string[] = [];
		if (previous && previous.garbage.length > 0) {
			try {
				await removeKeys(previous.garbage);
			} catch {
				leftover = previous.garbage;
			}
		}

		await backend.set({
			[STATE_KEY]: storedIndex(
				index,
				[...new Set([...replaced, ...leftover])].filter(
					(key) => !next.has(key),
				),
			),
		});
	}

	/**
	A rewritten record keeps its sync sidecar (minus entries for tabs or bookmarks that are gone), so an app edit
	never erases stamps. Only records flagged in the index cost an extra read.
	*/
	async function carrySidecars(plan: Plan, previous: LibraryIndex | null) {
		if (!previous) {
			return;
		}

		const before = new Map(
			previous.sessions.map((session) => [session.id, session]),
		);
		const flagged = plan.sessions.filter(
			(session) => !session.unchanged && session.entry.tabSync,
		);
		for (const run of batches(
			flagged,
			(item) => item.entry.tabs + 1,
			READ_BATCH_TABS,
		)) {
			const keys = run.map((item) => {
				const old = before.get(item.entry.id)!;
				return sessionKey(old.id, old.rev);
			});
			const saved = await backend.get(keys);
			for (const [at, item] of run.entries()) {
				const old = saved[keys[at]];
				const tabs = carriedSync(
					isRecord(old) ? old[SIDECAR] : undefined,
					'tabs',
					idsOf(item.value.tabs),
				);
				if (Object.keys(tabs).length > 0) {
					item.value = {...item.value, [SIDECAR]: {tabs}};
				} else {
					Reflect.deleteProperty(item.entry, 'tabSync');
				}
			}
		}

		const changed = plan.bookmarks.filter((part) => !part.unchanged);
		const sidecars = previous.bookmarkParts.filter((part) => part.sync);
		if (changed.length === 0 || sidecars.length === 0) {
			return;
		}

		const stamps: SyncMap = {};
		for (const run of batches(sidecars, () => 1, 20, 20)) {
			const saved = await backend.get(run.map((part) => part.key));
			for (const part of run) {
				const old = saved[part.key];
				const sidecar = isRecord(old) ? old[SIDECAR] : undefined;
				Object.assign(
					stamps,
					parseSyncMap(isRecord(sidecar) ? sidecar.items : undefined),
				);
			}
		}

		for (const part of changed) {
			const ids = idsOf(part.value.items);
			const items = Object.fromEntries(
				Object.entries(stamps).filter(([id]) => ids.has(id)),
			);
			if (Object.keys(items).length === 0) {
				continue;
			}

			part.value = {...part.value, [SIDECAR]: {items}};
			part.ref.sync = true;
		}
	}

	function buildIndex(
		raw: Raw,
		plan: Plan,
		rev: number,
		previous: LibraryIndex | null,
		format: 10 | 11,
		note?: MigrationNote,
	): LibraryIndex {
		const kept = previous?.migratedFrom;
		return {
			format,
			schemaVersion: format === 11 ? LAYOUT_VERSION : INLINE_LAYOUT_VERSION,
			layout: 'records',
			rev,
			updatedAt: Number(raw.updatedAt) || now(),
			folders: Array.isArray(raw.folders) ? raw.folders : [],
			bookmarkColumns: Array.isArray(raw.bookmarkColumns)
				? raw.bookmarkColumns
				: [],
			settings: raw.settings,
			sessions: plan.sessions.map((session) => session.entry),
			sessionPages: plan.sessionPages.map((page) => page.ref),
			bookmarkParts: plan.bookmarks.map((part) => part.ref),
			garbage: [],
			migratedFrom: note ?? (kept && kept.keepUntil > now() ? kept : undefined),
			device: previous?.device,
			// Expired tombstones stop being carried; a record deleted that long ago can no longer come back.
			tombstones: (previous?.tombstones ?? []).filter(
				(tombstone) => tombstone.purgeAfter > now(),
			),
			folderSync: keepOnly(previous?.folderSync, idsOf(raw.folders)),
			columnSync: keepOnly(previous?.columnSync, idsOf(raw.bookmarkColumns)),
			preferenceSync: previous?.preferenceSync ?? {},
		};
	}

	/**
	Removes the stored library (the logical key `tablodge.state` disappears). The record keys go after the
	index, so a crash in between leaves unreferenced keys, never an index that points at nothing.
	*/
	async function remove(): Promise<void> {
		const current = await getOne(STATE_KEY);
		const index = known(current)
			? await loadIndex(current).catch(() => parseIndex(current))
			: null;
		if (index) {
			await captureReplaced(referencedKeys(index));
		}

		await backend.remove([STATE_KEY]);
		if (!index) {
			return;
		}

		await removeKeys([
			...referencedKeys(index),
			...index.garbage,
			PREUPGRADE_KEY,
			...(index.migratedFrom?.kept ?? []),
		]);
	}

	/**
	Re-reads every record the index lists and compares it with the index. An empty list means the stored library is whole.
	*/
	async function verify(): Promise<LibraryProblem[]> {
		const entry = await getOne(STATE_KEY);
		if (!known(entry)) {
			return [];
		}

		try {
			return await checkIndex(await loadIndex(entry), true);
		} catch (error) {
			if (error instanceof LibraryDamagedError) {
				return [{key: STATE_KEY, problem: error.detail}];
			}

			throw error;
		}
	}

	async function checkIndex(
		index: LibraryIndex,
		withSessions: boolean,
	): Promise<LibraryProblem[]> {
		const problems: LibraryProblem[] = [];
		for (const run of batches(
			withSessions ? index.sessions : [],
			(session) => session.tabs + 1,
			READ_BATCH_TABS,
		)) {
			const keys = run.map((session) => sessionKey(session.id, session.rev));
			const saved = await backend.get(keys);
			for (const [at, session] of run.entries()) {
				const value = saved[keys[at]];
				if (value === undefined) {
					problems.push({key: keys[at], problem: 'missing'});
				} else if (contentHash(keys[at], value) !== session.hash) {
					problems.push({
						key: keys[at],
						problem: 'content differs from its checksum',
					});
				}
			}
		}

		for (const run of batches(
			[...index.sessionPages, ...index.bookmarkParts],
			() => 1,
			20,
			20,
		)) {
			const saved = await backend.get(run.map((part) => part.key));
			for (const part of run) {
				const value = saved[part.key];
				if (value === undefined) {
					problems.push({key: part.key, problem: 'missing'});
				} else if (contentHash(part.key, value) !== part.hash) {
					problems.push({
						key: part.key,
						problem: 'content differs from its checksum',
					});
				}
			}
		}

		return problems;
	}

	async function readMarker(): Promise<MigrationMarker | undefined> {
		const value = await getOne(MIGRATION_KEY);
		if (
			!isRecord(value) ||
			typeof value.sourceHash !== 'string' ||
			!Array.isArray(value.written)
		) {
			return undefined;
		}

		return {
			version: 1,
			from: Number(value.from) || 0,
			sourceHash: value.sourceHash,
			startedAt: Number(value.startedAt) || 0,
			attempts: Number(value.attempts) || 0,
			written: value.written.filter(
				(key): key is string => typeof key === 'string',
			),
		};
	}

	/**
	Keeps the old entry as it was, in its own key, until a migration has been verified and a week has passed.
	An existing copy of the same entry (an earlier attempt) is reused.
	*/
	async function writeRecoveryCopy(entry: Raw, sourceHash: string) {
		const existing = await getOne(PREMIGRATION_KEY);
		if (isRecord(existing) && existing.hash === sourceHash) {
			return;
		}

		await backend.set({
			[PREMIGRATION_KEY]: {
				version: 1,
				hash: sourceHash,
				createdAt: now(),
				schemaVersion: Number(entry.schemaVersion) || 0,
				state: entry,
			},
		});
		const stored = await getOne(PREMIGRATION_KEY);
		if (
			!isRecord(stored) ||
			hashText(canonicalJson(stored.state)) !== sourceHash
		) {
			throw new Error('The recovery copy could not be verified.');
		}
	}

	/**
	Moves the library from the old single entry to records. Safe to call at any time and to call again after a
	crash: the old entry stays the only authority until the final index write, and each step can be repeated.
	`normalize` is the app's own loader for the old entry, so the records hold exactly what the app showed before.
	Throws when a step fails; the old entry is untouched.
	*/
	async function migrate(
		normalize: (raw: Raw) => Raw,
	): Promise<MigrationOutcome> {
		const entry = await getOne(STATE_KEY);
		if (!isRecord(entry)) {
			return {status: 'none'};
		}

		if (isRecordsEntry(entry)) {
			if (Number(entry.schemaVersion) > maxLayout) {
				return {status: 'newer'};
			}

			// A crash after the commit left only the marker to remove.
			if ((await getOne(MIGRATION_KEY)) !== undefined) {
				await backend.remove([MIGRATION_KEY]);
			}

			return {status: 'current'};
		}

		// Dev tools write the app's own state shape (stamped with the current schema) without an index: that is the old layout too.
		if (tooNew(entry)) {
			return {status: 'newer'};
		}

		const sourceHash = hashText(canonicalJson(entry));
		// Anything the records cannot hold is found before the first byte is written.
		const store = normalize(entry);
		const raw = Array.isArray(store.bookmarks) ? store.bookmarks : [];
		const format = maxLayout >= LAYOUT_VERSION ? 11 : 10;
		const plan = planState(store, 1, null, format);
		assertStableIds(store);
		await writeRecoveryCopy(entry, sourceHash);
		const previousMarker = await readMarker();
		const resumed = previousMarker?.sourceHash === sourceHash;
		const marker: MigrationMarker = {
			version: 1,
			from: Number(entry.schemaVersion) || 0,
			sourceHash,
			startedAt: resumed ? previousMarker.startedAt : now(),
			attempts: (previousMarker?.attempts ?? 0) + 1,
			// Keys from an attempt on a different source are still ours to clean up.
			written: previousMarker?.written ?? [],
		};
		await backend.set({[MIGRATION_KEY]: marker});

		try {
			const pending = [
				...plan.sessions.map((item) => ({
					key: item.key,
					value: item.value,
					json: item.json,
					hash: item.entry.hash,
				})),
				...[...plan.sessionPages, ...plan.bookmarks].map((part) => ({
					key: part.ref.key,
					value: part.value,
					json: part.json,
					hash: part.ref.hash,
				})),
			];
			for (const run of batches(
				pending,
				(item) => item.json.length,
				writeBatchChars,
				writeBatchCount,
			)) {
				const keys = run.map((item) => item.key);
				for (const key of keys) {
					if (!marker.written.includes(key)) {
						marker.written.push(key);
					}
				}

				// The marker names the keys before they are written, so a crash mid-batch leaves nothing untracked.
				await backend.set({[MIGRATION_KEY]: marker});
				// A resumed attempt skips records that an earlier attempt already wrote correctly.
				const stored = resumed ? await backend.get(keys) : {};
				await writeAll(
					run.filter(
						(item) =>
							stored[item.key] === undefined ||
							contentHash(item.key, stored[item.key]) !== item.hash,
					),
				);
			}

			const tabs = plan.sessions.reduce(
				(sum, item) => sum + item.entry.tabs,
				0,
			);
			const index = buildIndex(store, plan, 1, null, format, {
				schemaVersion: marker.from,
				at: now(),
				keepUntil: now() + PREMIGRATION_KEEP_MS,
				sessions: plan.sessions.length,
				tabs,
				bookmarks: raw.length,
			});
			const problems = await checkIndex(index, true);
			if (problems.length > 0) {
				throw new Error(
					`Migration check failed: ${problems[0].key} ${problems[0].problem}.`,
				);
			}

			const referenced = new Set(referencedKeys(index));
			index.garbage = marker.written.filter((key) => !referenced.has(key));
			// The commit: until this write the old entry is the library, after it the records are.
			await backend.set({[STATE_KEY]: storedIndex(index, index.garbage)});
			await backend.remove([MIGRATION_KEY]);
			return {
				status: 'migrated',
				sessions: plan.sessions.length,
				tabs,
				bookmarks: bookmarkCount(index),
				resumed,
			};
		} catch (error) {
			// What went wrong stays in the marker, for a bug report.
			await backend
				.set({
					[MIGRATION_KEY]: {
						...marker,
						lastError: String((error as Error)?.message ?? error).slice(0, 300),
					},
				})
				.catch(() => undefined);
			throw error;
		}
	}

	/**
	Drops the recovery copies once their week is over. Returns true when it removed something.
	*/
	async function pruneRecoveryCopy(): Promise<boolean> {
		const entry = await getOne(STATE_KEY);
		if (!known(entry)) {
			return false;
		}

		const index = parseIndex(entry);
		const {migratedFrom} = index;
		if (!migratedFrom || migratedFrom.keepUntil > now()) {
			return false;
		}

		const kept = migratedFrom.kept ?? [];
		if (kept.length === 0 && (await getOne(PREMIGRATION_KEY)) === undefined) {
			return false;
		}

		await removeKeys([PREMIGRATION_KEY, PREUPGRADE_KEY, ...kept]);
		if (kept.length > 0) {
			await backend.set({
				[STATE_KEY]: storedIndex(
					{...index, migratedFrom: undefined},
					index.garbage,
				),
			});
		}

		return true;
	}

	/**
	Storage used by the library, recovery copy and marker included.
	*/
	async function bytesInUse(): Promise<number> {
		if (!backend.getBytesInUse) {
			return 0;
		}

		const entry = await getOne(STATE_KEY);
		const keys = [STATE_KEY, MIGRATION_KEY, PREMIGRATION_KEY, PREUPGRADE_KEY];
		if (known(entry)) {
			const index = await loadIndex(entry).catch(() => parseIndex(entry));
			keys.push(
				...referencedKeys(index),
				...index.garbage,
				...(index.migratedFrom?.kept ?? []),
			);
		}

		return backend.getBytesInUse(keys);
	}

	/**
	Marks the library as it is now. Call `endCheckpoint` after the action: it returns just enough to put the
	library back. Returns null when the library is not in the record layout (use a full copy then).
	*/
	async function beginCheckpoint(): Promise<Checkpoint | null> {
		const entry = await getOne(STATE_KEY);
		if (!known(entry)) {
			return null;
		}

		let index: LibraryIndex;
		try {
			index = await loadIndex(entry);
		} catch (error) {
			if (error instanceof LibraryDamagedError) {
				return null;
			}

			throw error;
		}

		const collector: Collector = {
			index,
			entry,
			pending: new Set(referencedKeys(index)),
			records: new Map(),
			complete: true,
		};
		collectors.add(collector);
		return {collector};
	}

	/**
	Closes a checkpoint. Null when a copy it needed could not be taken.
	*/
	async function endCheckpoint(
		checkpoint: Checkpoint,
	): Promise<UndoDelta | null> {
		const {collector} = checkpoint;
		collectors.delete(collector);
		if (!collector.complete) {
			return null;
		}

		const {index, entry: started} = collector;
		if (index.format === 11) {
			return {
				undoDelta: 3,
				index: started,
				records: Object.fromEntries(collector.records),
			};
		}

		try {
			const entry = await getOne(STATE_KEY);
			const current = known(entry) ? await loadIndex(entry) : null;
			const records = new Map(collector.records);
			const oldKey = index.bookmarkParts[0].key;
			const old = records.get(oldKey);
			let bookmarks: ListPatch | undefined;
			if (isRecord(old) && Array.isArray(old.items)) {
				const latest = current
					? await readParts(current.bookmarkParts)
					: {problems: [], items: []};
				bookmarks = diffList(
					old.items,
					latest.problems.length === 0 ? latest.items : [],
				);
				records.delete(oldKey);
			}

			return {
				undoDelta: 2,
				index: {...started, sessions: []},
				sessions: diffList(index.sessions, current?.sessions ?? []),
				...(bookmarks && {bookmarks}),
				records: Object.fromEntries(records),
			};
		} catch {
			return null;
		}
	}

	/**
	Identifies the stored library's current state, or undefined when it is not in the record layout. It changes
	with every commit, from any worker.
	*/
	async function fingerprint(): Promise<string | undefined> {
		const entry = await getOne(STATE_KEY);
		return known(entry) ? `rev:${Number(entry.rev)}` : undefined;
	}

	const missingForUndo = (key: string) =>
		new LibraryDamagedError(`${key} is missing, so Undo cannot run`);

	/**
	Puts the library back as a checkpoint saw it, as a new commit that rewrites only what differs.
	*/
	async function restoreCheckpoint(delta: UndoDelta): Promise<void> {
		let index: LibraryIndex;
		let bookmarks: unknown[];
		if (delta.undoDelta === 3) {
			index = await loadIndex(delta.index, delta.records);
			const loaded = await readParts(index.bookmarkParts, delta.records);
			if (loaded.problems.length > 0) {
				throw missingForUndo(loaded.problems[0].key);
			}

			bookmarks = loaded.items;
		} else {
			let raw: Raw = delta.index;
			let patched: unknown[] | undefined;
			if (delta.undoDelta === 2) {
				const entry = await getOne(STATE_KEY);
				const current = known(entry) ? await loadIndex(entry) : null;
				const sessions = parsePatch(delta.sessions);
				const applied =
					sessions && applyPatch(current?.sessions ?? [], sessions);
				if (!applied) {
					throw new LibraryDamagedError(
						'the library changed since the action, so Undo cannot run',
					);
				}

				raw = {...raw, sessions: applied};
				const bookmarksPatch = parsePatch(delta.bookmarks);
				if (bookmarksPatch) {
					const latest = current
						? await readParts(current.bookmarkParts)
						: {problems: [], items: []};
					patched =
						latest.problems.length === 0
							? applyPatch(latest.items, bookmarksPatch)
							: undefined;
					if (!patched) {
						throw new LibraryDamagedError(
							'the bookmarks changed since the action, so Undo cannot run',
						);
					}
				}
			}

			index = parseIndex(raw);
			const {key} = index.bookmarkParts[0];
			const stored = patched
				? {items: patched}
				: Object.hasOwn(delta.records, key)
					? delta.records[key]
					: await getOne(key);
			if (!isRecord(stored) || !Array.isArray(stored.items)) {
				throw missingForUndo(key);
			}

			bookmarks = stored.items;
		}

		const groups: Raw[] = [];
		for (const run of batches(
			index.sessions,
			(session) => session.tabs + 1,
			READ_BATCH_TABS,
		)) {
			const keys = run.map((session) => sessionKey(session.id, session.rev));
			const saved = await getMany(keys, delta.records);
			for (const key of keys) {
				const value = saved[key];
				if (!isRecord(value)) {
					throw missingForUndo(key);
				}

				groups.push(sessionContent(value));
			}
		}

		await write({
			schemaVersion: SCHEMA_VERSION,
			groups,
			folders: index.folders,
			bookmarkColumns: index.bookmarkColumns,
			bookmarks,
			settings: index.settings,
			updatedAt: index.updatedAt,
		});
	}

	async function dropGarbage(): Promise<void> {
		const current = await getOne(STATE_KEY);
		if (!known(current)) {
			return;
		}

		const index = await loadIndex(current).catch(() => undefined);
		if (!index || index.garbage.length === 0) {
			return;
		}

		const referenced = new Set(referencedKeys(index));
		const garbage = index.garbage.filter(
			(key) =>
				!referenced.has(key) &&
				(key.startsWith(SESSION_KEY_PREFIX) ||
					key.startsWith(BOOKMARKS_KEY_PREFIX) ||
					key.startsWith(SESSION_PAGE_KEY_PREFIX) ||
					key.startsWith(BOOKMARK_CHUNK_KEY_PREFIX)),
		);
		await removeKeys(garbage);
		await backend.set({[STATE_KEY]: {...current, garbage: []}});
	}

	/**
	Moves a layout 10 library to layout 11: the session entries go into pages and the bookmarks into chunks, which
	are new keys, so the stored library stays whole until the one write that switches the index. The index and the
	bookmarks record it replaces stay for a week (`PREUPGRADE_KEY`, `migratedFrom.kept`). Throws when a step fails;
	the layout 10 library is untouched and keeps working.
	*/
	async function upgrade(): Promise<{
		status: 'none' | 'newer' | 'current' | 'upgraded';
	}> {
		const entry = await getOne(STATE_KEY);
		if (!isRecordsEntry(entry)) {
			return {status: 'none'};
		}

		if (Number(entry.schemaVersion) > maxLayout) {
			return {status: 'newer'};
		}

		if (Number(entry.schemaVersion) >= LAYOUT_VERSION) {
			if ((await getOne(MIGRATION_KEY)) !== undefined) {
				await backend.remove([MIGRATION_KEY]);
			}

			return {status: 'current'};
		}

		const previous = await loadIndex(entry);
		const part = previous.bookmarkParts[0];
		const written: string[] = [];
		const startedAt = now();
		try {
			const record = await getOne(part.key);
			const items = isRecord(record) ? record.items : undefined;
			if (
				!Array.isArray(items) ||
				items.length !== part.count ||
				contentHash(part.key, record) !== part.hash
			) {
				throw new Error(
					`Upgrade check failed: ${part.key} does not match the index.`,
				);
			}

			const rev = previous.rev + 1;
			const sessionPages = planParts(
				previous.sessions,
				SESSION_PAGE_KEY_PREFIX,
				rev,
				[],
			);
			const chunks = planParts(items, BOOKMARK_CHUNK_KEY_PREFIX, rev, []);
			const sidecar = isRecord(record) ? record[SIDECAR] : undefined;
			const stamps = part.sync
				? parseSyncMap(isRecord(sidecar) ? sidecar.items : undefined)
				: {};
			for (const chunk of chunks) {
				const ids = idsOf(chunk.value.items);
				const carried = Object.fromEntries(
					Object.entries(stamps).filter(([id]) => ids.has(id)),
				);
				if (Object.keys(carried).length === 0) {
					continue;
				}

				chunk.value = {...chunk.value, [SIDECAR]: {items: carried}};
				chunk.ref.sync = true;
			}

			const tabs = previous.sessions.reduce((sum, item) => sum + item.tabs, 0);
			const index: LibraryIndex = {
				...previous,
				format: 11,
				schemaVersion: LAYOUT_VERSION,
				rev,
				sessions: previous.sessions,
				sessionPages: sessionPages.map((page) => page.ref),
				bookmarkParts: chunks.map((chunk) => chunk.ref),
				migratedFrom: {
					schemaVersion: previous.schemaVersion,
					at: startedAt,
					keepUntil: Math.max(
						startedAt + PREMIGRATION_KEEP_MS,
						previous.migratedFrom?.keepUntil ?? 0,
					),
					sessions: previous.sessions.length,
					tabs,
					bookmarks: items.length,
					kept: [part.key],
				},
			};
			const pieces = [...writtenParts(sessionPages), ...writtenParts(chunks)];
			written.push(...pieces.map((piece) => piece.key));
			await writeAll(pieces);
			const problems = await checkIndex(index, false);
			if (problems.length > 0) {
				throw new Error(
					`Upgrade check failed: ${problems[0].key} ${problems[0].problem}.`,
				);
			}

			await backend.set({
				[PREUPGRADE_KEY]: {
					version: 1,
					createdAt: startedAt,
					kept: [part.key],
					state: entry,
				},
			});
			await backend.set({[STATE_KEY]: storedIndex(index, previous.garbage)});
		} catch (error) {
			const after = await getOne(STATE_KEY).catch(() => undefined);
			if (
				isRecordsEntry(after) &&
				Number(after.schemaVersion) >= LAYOUT_VERSION
			) {
				await backend.remove([MIGRATION_KEY]).catch(() => undefined);
				return {status: 'upgraded'};
			}

			await removeKeys(written).catch(() => undefined);
			await backend
				.set({
					[MIGRATION_KEY]: {
						version: 1,
						from: previous.schemaVersion,
						sourceHash: '',
						startedAt,
						attempts: 1,
						written: [],
						lastError: String((error as Error)?.message ?? error).slice(0, 300),
					},
				})
				.catch(() => undefined);
			throw error;
		}

		await backend.remove([MIGRATION_KEY]).catch(() => undefined);
		return {status: 'upgraded'};
	}

	return {
		read,
		readMeta,
		write,
		remove,
		dropGarbage,
		verify,
		migrate,
		upgrade,
		readSessionEntries,
		pruneRecoveryCopy,
		bytesInUse,
		beginCheckpoint,
		endCheckpoint,
		fingerprint,
		restoreCheckpoint,
	};
}
