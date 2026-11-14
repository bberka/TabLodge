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
	bookmarksKey,
	assertStableIds,
	contentHash,
	idsOf,
	isRecordsEntry,
	LAYOUT_VERSION,
	LEGACY_SCHEMA_VERSION,
	LibraryDamagedError,
	type LibraryIndex,
	MIGRATION_KEY,
	type MigrationNote,
	parseIndex,
	type Plan,
	planState,
	PREMIGRATION_KEY,
	referencedKeys,
	SIDECAR,
	sessionContent,
	sessionKey,
	STATE_KEY,
} from './library-index';
import {carriedSync, keepOnly} from './library-sync';
import {canonicalJson, hashText, isRecord, type Raw} from './library-values';

export {
	BOOKMARKS_KEY_PREFIX,
	bookmarksKey,
	LAYOUT_VERSION,
	LEGACY_SCHEMA_VERSION,
	LibraryDamagedError,
	type LibraryIndex,
	MIGRATION_KEY,
	PREMIGRATION_KEY,
	SESSION_KEY_PREFIX,
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
	undoDelta: 1;
	index: LibraryIndex;
	records: Raw;
};

export const isUndoDelta = (value: unknown): value is UndoDelta =>
	isRecord(value) &&
	value.undoDelta === 1 &&
	isRecord(value.index) &&
	isRecord(value.records);

type Collector = {
	index: LibraryIndex;
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
	}: {
		now?: () => number;
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
						problem:
							value === undefined ? 'missing' : 'does not match the index',
					});
				} else {
					groups.push(sessionContent(value));
				}
			}
		}

		const key = bookmarksKey(index.bookmarks.rev);
		const stored = await getOne(key);
		const bookmarks = isRecord(stored) ? stored.items : undefined;
		if (
			!Array.isArray(bookmarks) ||
			bookmarks.length !== index.bookmarks.count
		) {
			problems.push({
				key,
				problem: stored === undefined ? 'missing' : 'does not match the index',
			});
		}

		return {problems, groups, bookmarks: bookmarks as unknown[]};
	}

	function assemble(
		index: LibraryIndex,
		groups: Raw[],
		bookmarks: unknown[],
	): Raw {
		return {
			schemaVersion: index.schemaVersion,
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

			if (
				!isRecordsEntry(entry) ||
				Number(entry.schemaVersion) > LAYOUT_VERSION
			) {
				return entry;
			}

			const index = parseIndex(entry);

			const loaded = await loadRecords(index);
			if (loaded.problems.length === 0) {
				return assemble(index, loaded.groups, loaded.bookmarks);
			}

			// A commit that finished while this read was in flight removed keys this index pointed at: read again.
			const again = await getOne(STATE_KEY);
			if (
				attempt < MAX_READ_RETRIES &&
				isRecordsEntry(again) &&
				again.rev !== index.rev
			) {
				continue;
			}

			const [first] = loaded.problems;
			throw new LibraryDamagedError(
				`${first.key} ${first.problem}${loaded.problems.length > 1 ? `, and ${loaded.problems.length - 1} more` : ''}`,
			);
		}
	}

	/**
	Settings and schema version without reading any session. In the old layout this still reads the whole entry.
	*/
	async function readMeta(): Promise<{
		layout: 'none' | 'legacy' | 'records';
		schemaVersion: number;
		settings: unknown;
	}> {
		const entry = await getOne(STATE_KEY);
		if (!isRecord(entry)) {
			return {layout: 'none', schemaVersion: 0, settings: undefined};
		}

		return {
			layout: isRecordsEntry(entry) ? 'records' : 'legacy',
			schemaVersion: Number(entry.schemaVersion) || 0,
			settings: entry.settings,
		};
	}

	/**
	Stores the library. Writes only sessions that changed and the index. While the library is still in the old
	layout (a migration that could not finish) it writes the old single entry, so the app keeps working.
	*/
	async function write(raw: Raw): Promise<void> {
		const current = await getOne(STATE_KEY);
		if (isRecord(current) && Number(current.schemaVersion) > LAYOUT_VERSION) {
			throw new Error('This library was saved by a newer version.');
		}

		if (isRecord(current) && !isRecordsEntry(current)) {
			await backend.set({
				[STATE_KEY]: {...raw, schemaVersion: LEGACY_SCHEMA_VERSION},
			});
			return;
		}

		const previous = isRecordsEntry(current) ? parseIndex(current) : null;
		const rev = (previous?.rev ?? 0) + 1;
		const plan = planState(raw, rev, previous);
		await carrySidecars(plan, previous);
		const changed = [
			...plan.sessions.filter((session) => !session.unchanged),
			...(plan.bookmarks.unchanged ? [] : [plan.bookmarks]),
		];
		await writeAll(changed);
		const index = buildIndex(raw, plan, rev, previous);
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
			[STATE_KEY]: {
				...index,
				garbage: [...new Set([...replaced, ...leftover])].filter(
					(key) => !next.has(key),
				),
			},
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

		const {bookmarks} = plan;
		if (bookmarks.unchanged || !bookmarks.entry.sync) {
			return;
		}

		const old = await getOne(bookmarksKey(previous.bookmarks.rev));
		const items = carriedSync(
			isRecord(old) ? old[SIDECAR] : undefined,
			'items',
			idsOf(bookmarks.value.items),
		);
		if (Object.keys(items).length > 0) {
			bookmarks.value = {...bookmarks.value, [SIDECAR]: {items}};
		} else {
			Reflect.deleteProperty(bookmarks.entry, 'sync');
		}
	}

	function buildIndex(
		raw: Raw,
		plan: Plan,
		rev: number,
		previous: LibraryIndex | null,
		note?: MigrationNote,
	): LibraryIndex {
		const kept = previous?.migratedFrom;
		return {
			schemaVersion: LAYOUT_VERSION,
			layout: 'records',
			rev,
			updatedAt: Number(raw.updatedAt) || now(),
			folders: Array.isArray(raw.folders) ? raw.folders : [],
			bookmarkColumns: Array.isArray(raw.bookmarkColumns)
				? raw.bookmarkColumns
				: [],
			settings: raw.settings,
			sessions: plan.sessions.map((session) => session.entry),
			bookmarks: plan.bookmarks.entry,
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
		if (
			isRecordsEntry(current) &&
			Number(current.schemaVersion) <= LAYOUT_VERSION
		) {
			await captureReplaced(referencedKeys(parseIndex(current)));
		}

		await backend.remove([STATE_KEY]);
		if (
			!isRecordsEntry(current) ||
			Number(current.schemaVersion) > LAYOUT_VERSION
		) {
			return;
		}

		const index = parseIndex(current);
		await removeKeys([...referencedKeys(index), ...index.garbage]);
	}

	/**
	Re-reads every record the index lists and compares it with the index. An empty list means the stored library is whole.
	*/
	async function verify(): Promise<LibraryProblem[]> {
		const entry = await getOne(STATE_KEY);
		return isRecordsEntry(entry) ? checkIndex(parseIndex(entry)) : [];
	}

	async function checkIndex(index: LibraryIndex): Promise<LibraryProblem[]> {
		const problems: LibraryProblem[] = [];
		for (const run of batches(
			index.sessions,
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

		const key = bookmarksKey(index.bookmarks.rev);
		const bookmarks = await getOne(key);
		if (bookmarks === undefined) {
			problems.push({key, problem: 'missing'});
		} else if (contentHash(key, bookmarks) !== index.bookmarks.hash) {
			problems.push({key, problem: 'content differs from its checksum'});
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
			if (Number(entry.schemaVersion) > LAYOUT_VERSION) {
				return {status: 'newer'};
			}

			// A crash after the commit left only the marker to remove.
			if ((await getOne(MIGRATION_KEY)) !== undefined) {
				await backend.remove([MIGRATION_KEY]);
			}

			return {status: 'current'};
		}

		// Dev tools write the app's own state shape (stamped with the current schema) without an index: that is the old layout too.
		if (Number(entry.schemaVersion) > LAYOUT_VERSION) {
			return {status: 'newer'};
		}

		const sourceHash = hashText(canonicalJson(entry));
		// Anything the records cannot hold is found before the first byte is written.
		const store = normalize(entry);
		const plan = planState(store, 1, null);
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
			const pending = [...plan.sessions, plan.bookmarks];
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
							contentHash(item.key, stored[item.key]) !== item.entry.hash,
					),
				);
			}

			const tabs = plan.sessions.reduce(
				(sum, item) => sum + item.entry.tabs,
				0,
			);
			const index = buildIndex(store, plan, 1, null, {
				schemaVersion: marker.from,
				at: now(),
				keepUntil: now() + PREMIGRATION_KEEP_MS,
				sessions: plan.sessions.length,
				tabs,
				bookmarks: plan.bookmarks.entry.count,
			});
			const problems = await checkIndex(index);
			if (problems.length > 0) {
				throw new Error(
					`Migration check failed: ${problems[0].key} ${problems[0].problem}.`,
				);
			}

			const referenced = new Set(referencedKeys(index));
			index.garbage = marker.written.filter((key) => !referenced.has(key));
			// The commit: until this write the old entry is the library, after it the records are.
			await backend.set({[STATE_KEY]: index});
			await backend.remove([MIGRATION_KEY]);
			return {
				status: 'migrated',
				sessions: plan.sessions.length,
				tabs,
				bookmarks: plan.bookmarks.entry.count,
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
	Drops the recovery copy once its week is over. Returns true when it removed something.
	*/
	async function pruneRecoveryCopy(): Promise<boolean> {
		const entry = await getOne(STATE_KEY);
		if (
			!isRecordsEntry(entry) ||
			Number(entry.schemaVersion) > LAYOUT_VERSION
		) {
			return false;
		}

		const {migratedFrom} = parseIndex(entry);
		if (
			!migratedFrom ||
			migratedFrom.keepUntil > now() ||
			(await getOne(PREMIGRATION_KEY)) === undefined
		) {
			return false;
		}

		await backend.remove([PREMIGRATION_KEY]);
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
		const keys = [STATE_KEY, MIGRATION_KEY, PREMIGRATION_KEY];
		if (
			isRecordsEntry(entry) &&
			Number(entry.schemaVersion) <= LAYOUT_VERSION
		) {
			const index = parseIndex(entry);
			keys.push(...referencedKeys(index), ...index.garbage);
		}

		return backend.getBytesInUse(keys);
	}

	/**
	Marks the library as it is now. Call `endCheckpoint` after the action: it returns just enough to put the
	library back. Returns null when the library is not in the record layout (use a full copy then).
	*/
	async function beginCheckpoint(): Promise<Checkpoint | null> {
		const entry = await getOne(STATE_KEY);
		if (
			!isRecordsEntry(entry) ||
			Number(entry.schemaVersion) > LAYOUT_VERSION
		) {
			return null;
		}

		const index = parseIndex(entry);
		const collector: Collector = {
			index,
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
	function endCheckpoint(checkpoint: Checkpoint): UndoDelta | null {
		const {collector} = checkpoint;
		collectors.delete(collector);
		return collector.complete
			? {
					undoDelta: 1,
					index: collector.index,
					records: Object.fromEntries(collector.records),
				}
			: null;
	}

	/**
	Identifies the stored library's current state, or undefined when it is not in the record layout. It changes
	with every commit, from any worker.
	*/
	async function fingerprint(): Promise<string | undefined> {
		const entry = await getOne(STATE_KEY);
		return isRecordsEntry(entry) &&
			Number(entry.schemaVersion) <= LAYOUT_VERSION
			? `rev:${Number(entry.rev)}`
			: undefined;
	}

	/**
	Puts the library back as a checkpoint saw it, as a new commit that rewrites only what differs.
	*/
	async function restoreCheckpoint(delta: UndoDelta): Promise<void> {
		const index = parseIndex(delta.index);
		const groups: Raw[] = [];
		for (const run of batches(
			index.sessions,
			(session) => session.tabs + 1,
			READ_BATCH_TABS,
		)) {
			const keys = run.map((session) => sessionKey(session.id, session.rev));
			const missing = keys.filter((key) => !Object.hasOwn(delta.records, key));
			const saved = missing.length > 0 ? await backend.get(missing) : {};
			for (const key of keys) {
				const value = Object.hasOwn(delta.records, key)
					? delta.records[key]
					: saved[key];
				if (!isRecord(value)) {
					throw new LibraryDamagedError(
						`${key} is missing, so Undo cannot run`,
					);
				}

				groups.push(sessionContent(value));
			}
		}

		const key = bookmarksKey(index.bookmarks.rev);
		const stored = Object.hasOwn(delta.records, key)
			? delta.records[key]
			: await getOne(key);
		if (!isRecord(stored) || !Array.isArray(stored.items)) {
			throw new LibraryDamagedError(`${key} is missing, so Undo cannot run`);
		}

		await write({
			schemaVersion: index.schemaVersion,
			groups,
			folders: index.folders,
			bookmarkColumns: index.bookmarkColumns,
			bookmarks: stored.items,
			settings: index.settings,
			updatedAt: index.updatedAt,
		});
	}

	return {
		read,
		readMeta,
		write,
		remove,
		verify,
		migrate,
		pruneRecoveryCopy,
		bytesInUse,
		beginCheckpoint,
		endCheckpoint,
		fingerprint,
		restoreCheckpoint,
	};
}
