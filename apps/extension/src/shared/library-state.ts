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
	type PlannedSession,
	planPart,
	planParts,
	planSession,
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

export const PREMIGRATION_KEEP_MS = 7 * 86_400_000;
const WRITE_BATCH_CHARS = 2_000_000;
const READ_BATCH_TABS = 5000;
const MAX_READ_RETRIES = 4;
const PAGE_SCAN_STEPS = [1, 4, 15] as const;

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

export type UndoDelta = {
	undoDelta: 1 | 2 | 3;
	index: Raw;
	records: Raw;
	sessions?: ListPatch;
	bookmarks?: ListPatch;
};

export const isUndoDelta = (value: unknown): value is UndoDelta =>
	isRecord(value) &&
	([1, 2, 3] as unknown[]).includes(value.undoDelta) &&
	isRecord(value.index) &&
	isRecord(value.records);

type Collector = {
	index: LibraryIndex;
	entry: Raw;
	pending: Set<string>;
	records: Map<string, unknown>;
	complete: boolean;
};

export type Checkpoint = {readonly collector: Collector};

export type LibraryScope = {
	sessions?: readonly string[];
	bookmarks?: readonly string[] | 'all';
};

export type ScopedCommit = {from: string; to: string};

export type OpenScope = {
	raw: Raw;
	commit(next: Raw, announce?: (commit: ScopedCommit) => void): Promise<void>;
};

export const stampOf = (entry: Raw) =>
	`${Number(entry.rev)}:${Number(entry.updatedAt) || 0}`;

const idOf = (item: unknown) =>
	isRecord(item) && typeof item.id === 'string' ? item.id : '';

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
		layoutVersion?: number;
		writeBatchChars?: number;
		writeBatchCount?: number;
	} = {},
) {
	const getOne = async (key: string): Promise<unknown> =>
		(await backend.get([key]))[key];

	const collectors = new Set<Collector>();

	const sessionRevOf = (key: string) => {
		const dot = key.lastIndexOf('.');
		return dot >= SESSION_KEY_PREFIX.length ? Number(key.slice(dot + 1)) : NaN;
	};

	const tracksKey = (collector: Collector, key: string) =>
		collector.pending.has(key) ||
		(collector.index.format === 11 &&
			key.startsWith(SESSION_KEY_PREFIX) &&
			sessionRevOf(key) <= collector.index.rev);

	const captureReplaced = async (keys: readonly string[]) => {
		for (const collector of collectors) {
			const wanted = keys.filter(
				(key) => tracksKey(collector, key) && !collector.records.has(key),
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

	function parseSessionPage(
		page: PageRef,
		value: unknown,
		verifyHash: boolean,
	): SessionEntry[] {
		if (
			!isRecord(value) ||
			!Array.isArray(value.items) ||
			value.items.length !== page.count ||
			(verifyHash && contentHash(page.key, value) !== page.hash)
		) {
			throw new LibraryDamagedError(`${page.key} ${why(value)}`);
		}

		return checkedSessions(value.items.map((item) => parseSessionEntry(item)));
	}

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
				const entries = parseSessionPage(page, saved[page.key], !extra);
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

	async function readSessionEntries(entry: Raw): Promise<SessionEntry[]> {
		return known(entry) ? (await loadIndex(entry)).sessions : [];
	}

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

	async function read(): Promise<Raw | null> {
		return (await readStamped()).raw;
	}

	async function readStamped(): Promise<{raw: Raw | null; stamp?: string}> {
		for (let attempt = 0; ; attempt += 1) {
			const entry = await getOne(STATE_KEY);
			if (!isRecord(entry)) {
				return {raw: null};
			}

			if (!known(entry)) {
				return {raw: entry};
			}

			let problem: string;
			try {
				const index = await loadIndex(entry);
				const loaded = await loadRecords(index);
				if (loaded.problems.length === 0) {
					return {
						raw: assemble(index, loaded.groups, loaded.bookmarks),
						stamp: stampOf(entry),
					};
				}

				const [first] = loaded.problems;
				problem = `${first.key} ${first.problem}${loaded.problems.length > 1 ? `, and ${loaded.problems.length - 1} more` : ''}`;
			} catch (error) {
				if (!(error instanceof LibraryDamagedError)) {
					throw error;
				}

				problem = error.detail;
			}

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
		if (format === 11) {
			plan.sessionPages = planParts(
				plan.sessions.map((session) => session.entry),
				SESSION_PAGE_KEY_PREFIX,
				rev,
				previous?.format === 11 ? previous.sessionPages : [],
			);
		}

		await commitPlan(raw, plan, rev, previous, format);
	}

	async function commitPlan(
		raw: Raw,
		plan: Plan,
		rev: number,
		previous: LibraryIndex | null,
		format: 10 | 11,
		announce?: (stored: Raw) => void,
	): Promise<void> {
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
		let leftover: string[] = [];
		if (previous && previous.garbage.length > 0) {
			try {
				await removeKeys(previous.garbage);
			} catch {
				leftover = previous.garbage;
			}
		}

		const stored = storedIndex(
			index,
			[...new Set([...replaced, ...leftover])].filter((key) => !next.has(key)),
		);
		announce?.(stored);
		await backend.set({[STATE_KEY]: stored});
	}

	const chunkIds = new Map<string, {hash: string; ids: Set<string>}>();

	async function findChunks(
		parts: readonly PageRef[],
		ids: readonly string[],
	): Promise<Map<number, unknown[]> | undefined> {
		const live = new Set(parts.map((part) => part.key));
		for (const key of chunkIds.keys()) {
			if (!live.has(key)) {
				chunkIds.delete(key);
			}
		}

		const found = new Map<number, unknown[]>();
		const missing = new Set(ids);
		const cachedIds = (part: PageRef) => {
			const cached = chunkIds.get(part.key);
			return cached?.hash === part.hash ? cached.ids : undefined;
		};

		const listed: number[] = [];
		const unknown: number[] = [];
		for (const [at, part] of parts.entries()) {
			const cached = cachedIds(part);
			if (!cached) {
				unknown.push(at);
			} else if (ids.some((id) => cached.has(id))) {
				listed.push(at);
			}
		}

		for (const run of batches([...listed, ...unknown], () => 1, 20, 20)) {
			if (missing.size === 0) {
				break;
			}

			const saved = await backend.get(run.map((at) => parts[at].key));
			for (const at of run) {
				const part = parts[at];
				const value = saved[part.key];
				const items = isRecord(value) ? value.items : undefined;
				if (!Array.isArray(items) || items.length !== part.count) {
					return undefined;
				}

				const held = idsOf(items);
				chunkIds.set(part.key, {hash: part.hash, ids: held});
				const wanted = ids.filter((id) => held.has(id));
				if (wanted.length === 0) {
					continue;
				}

				found.set(at, items);
				for (const id of wanted) {
					missing.delete(id);
				}
			}
		}

		return found;
	}

	async function findSessionPages(
		pages: readonly PageRef[],
		ids: readonly string[],
	): Promise<Map<number, SessionEntry[]>> {
		const found = new Map<number, SessionEntry[]>();
		if (ids.length === 0 || pages.length === 0) {
			return found;
		}

		const live = new Set(pages.map((page) => page.key));
		for (const key of pageCache.keys()) {
			if (!live.has(key)) {
				pageCache.delete(key);
			}
		}

		const missing = new Set(ids);
		const collect = (at: number, entries: SessionEntry[]) => {
			let matched = false;
			for (const entry of entries) {
				if (!missing.has(entry.id)) {
					continue;
				}

				missing.delete(entry.id);
				matched = true;
			}

			if (matched) {
				found.set(at, entries);
			}
		};

		const unknown: number[] = [];
		for (const [at, page] of pages.entries()) {
			const cached = pageCache.get(page.key);
			if (cached?.hash === page.hash) {
				collect(at, cached.entries);
			} else {
				unknown.push(at);
			}
		}

		let offset = 0;
		for (let step = 0; missing.size > 0 && offset < unknown.length; step += 1) {
			const size = PAGE_SCAN_STEPS[step] ?? 20;
			const run = unknown.slice(offset, offset + size);
			offset += size;
			const saved = await backend.get(run.map((at) => pages[at].key));
			for (const at of run) {
				if (missing.size === 0) {
					break;
				}

				const page = pages[at];
				const entries = parseSessionPage(page, saved[page.key], true);
				pageCache.set(page.key, {hash: page.hash, entries});
				collect(at, entries);
			}
		}

		return found;
	}

	async function openScope(scope: LibraryScope): Promise<OpenScope | null> {
		const entry = await getOne(STATE_KEY);
		if (!known(entry)) {
			return null;
		}

		let index: LibraryIndex;
		try {
			index = parseIndex(entry);
		} catch (error) {
			if (error instanceof LibraryDamagedError) {
				return null;
			}

			throw error;
		}

		if (index.format !== 11) {
			return null;
		}

		const wanted = new Set(scope.sessions);
		let sessionPages: Map<number, SessionEntry[]>;
		try {
			sessionPages = await findSessionPages(index.sessionPages, [...wanted]);
		} catch (error) {
			if (error instanceof LibraryDamagedError) {
				return null;
			}

			throw error;
		}

		const openedEntries = index.sessionPages.flatMap((_page, at) =>
			(sessionPages.get(at) ?? []).filter((session) => wanted.has(session.id)),
		);
		const loaded = await loadRecords({
			...index,
			sessions: openedEntries,
			bookmarkParts: scope.bookmarks === 'all' ? index.bookmarkParts : [],
		});
		if (loaded.problems.length > 0) {
			return null;
		}

		let chunks = new Map<number, unknown[]>();
		let {bookmarks} = loaded;
		if (Array.isArray(scope.bookmarks)) {
			const found = await findChunks(index.bookmarkParts, scope.bookmarks);
			if (!found) {
				return null;
			}

			chunks = found;
			const ids = new Set<string>(scope.bookmarks);
			bookmarks = index.bookmarkParts.flatMap((_part, at) =>
				(chunks.get(at) ?? []).filter((item) => ids.has(idOf(item))),
			);
		}

		const from = stampOf(entry);
		const opened = loaded.groups.map((group) => String(group.id));
		const openedBookmarks = bookmarks.map((item) => idOf(item));
		return {
			raw: assemble(index, loaded.groups, bookmarks),
			async commit(next, announce) {
				const current = await getOne(STATE_KEY);
				if (!known(current) || stampOf(current) !== from) {
					throw new Error(
						'The library changed while it was being edited. Try again.',
					);
				}

				const editedGroups = new Map(
					(Array.isArray(next.groups) ? next.groups : []).map(
						(group: unknown) => [idOf(group), group],
					),
				);
				const scoped = new Set(opened);
				if ([...editedGroups.keys()].some((id) => !scoped.has(id))) {
					throw new Error('An edit of single sessions cannot add any.');
				}

				const dropped = opened.some((id) => !editedGroups.has(id));
				const previous = dropped
					? await loadIndex(current)
					: {...parseIndex(current), sessions: openedEntries};
				const rev = previous.rev + 1;
				const plan: Plan = {
					sessions: dropped
						? scopedSessions(previous, rev, opened, next)
						: openedEntries.map((sessionEntry) =>
								planSession(
									editedGroups.get(sessionEntry.id),
									rev,
									sessionEntry,
								),
							),
					sessionPages: [],
					bookmarks: [],
				};
				const items = Array.isArray(next.bookmarks) ? next.bookmarks : [];
				if (scope.bookmarks === 'all') {
					plan.bookmarks = planParts(
						items,
						BOOKMARK_CHUNK_KEY_PREFIX,
						rev,
						previous.bookmarkParts,
					);
				} else {
					if (
						items.length !== openedBookmarks.length ||
						items.some((item, at) => idOf(item) !== openedBookmarks[at])
					) {
						throw new Error(
							'An edit of single bookmarks cannot add, remove, or move any.',
						);
					}

					const edited = new Map(
						items.map((item: unknown) => [idOf(item), item]),
					);
					plan.bookmarks = previous.bookmarkParts.map((part, at) => {
						const stored = chunks.get(at);
						return stored
							? planPart(
									stored.map((item) => edited.get(idOf(item)) ?? item),
									`${BOOKMARK_CHUNK_KEY_PREFIX}${at}.${rev}`,
									part,
								)
							: {ref: part, value: {items: []}, json: '', unchanged: true};
					});
				}

				await carrySidecars(plan, previous);
				if (dropped) {
					plan.sessionPages = planParts(
						plan.sessions.map((session) => session.entry),
						SESSION_PAGE_KEY_PREFIX,
						rev,
						previous.sessionPages,
						previous.sessions,
					);
				} else {
					const updated = new Map(
						plan.sessions.map((session) => [session.entry.id, session.entry]),
					);
					plan.sessionPages = previous.sessionPages.map((page, at) => {
						const entries = sessionPages.get(at);
						return entries
							? planPart(
									entries.map((item) => updated.get(item.id) ?? item),
									`${SESSION_PAGE_KEY_PREFIX}${at}.${rev}`,
									page,
								)
							: {ref: page, value: {items: []}, json: '', unchanged: true};
					});
				}

				await commitPlan(next, plan, rev, previous, 11, (stored) => {
					announce?.({from, to: stampOf(stored)});
				});
				for (const page of plan.sessionPages) {
					if (!page.unchanged) {
						pageCache.set(page.ref.key, {
							hash: page.ref.hash,
							entries: page.value.items as SessionEntry[],
						});
					}
				}
			},
		};
	}

	function scopedSessions(
		previous: LibraryIndex,
		rev: number,
		opened: readonly string[],
		next: Raw,
	): PlannedSession[] {
		const edited = new Map(
			(Array.isArray(next.groups) ? next.groups : []).map((group: unknown) => [
				idOf(group),
				group,
			]),
		);
		const scoped = new Set(opened);
		if ([...edited.keys()].some((id) => !scoped.has(id))) {
			throw new Error('An edit of single sessions cannot add any.');
		}

		return previous.sessions.flatMap((entry): PlannedSession[] => {
			if (!scoped.has(entry.id)) {
				return [
					{
						entry,
						key: sessionKey(entry.id, entry.rev),
						value: {},
						json: '',
						unchanged: true,
					},
				];
			}

			const group = edited.get(entry.id);
			return group === undefined ? [] : [planSession(group, rev, entry)];
		});
	}

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
		const kept = new Set(plan.bookmarks.map((part) => part.ref.key));
		const sidecars = previous.bookmarkParts.filter(
			(part) => part.sync && !kept.has(part.key),
		);
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
			migratedFrom: note ?? previous?.migratedFrom,
			device: previous?.device,
			tombstones: (previous?.tombstones ?? []).filter(
				(tombstone) => tombstone.purgeAfter > now(),
			),
			folderSync: keepOnly(previous?.folderSync, idsOf(raw.folders)),
			columnSync: keepOnly(previous?.columnSync, idsOf(raw.bookmarkColumns)),
			preferenceSync: previous?.preferenceSync ?? {},
		};
	}

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

			if ((await getOne(MIGRATION_KEY)) !== undefined) {
				await backend.remove([MIGRATION_KEY]);
			}

			return {status: 'current'};
		}

		if (tooNew(entry)) {
			return {status: 'newer'};
		}

		const sourceHash = hashText(canonicalJson(entry));
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

				await backend.set({[MIGRATION_KEY]: marker});
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

	async function beginCheckpoint(): Promise<Checkpoint | null> {
		const entry = await getOne(STATE_KEY);
		if (!known(entry)) {
			return null;
		}

		let index: LibraryIndex;
		try {
			index = parseIndex(entry);
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
				if (latest.problems.length === 0) {
					bookmarks = diffList(old.items, latest.items);
					records.delete(oldKey);
				}
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

	async function stamp(): Promise<string | undefined> {
		const entry = await getOne(STATE_KEY);
		return known(entry) ? stampOf(entry) : undefined;
	}

	async function fingerprint(): Promise<string | undefined> {
		const entry = await getOne(STATE_KEY);
		return known(entry) ? `rev:${Number(entry.rev)}` : undefined;
	}

	const missingForUndo = (key: string) =>
		new LibraryDamagedError(`${key} is missing, so Undo cannot run`);

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

		if (Number(entry.schemaVersion) >= Math.min(LAYOUT_VERSION, maxLayout)) {
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
			const after = await getOne(STATE_KEY).then(
				(value) => ({value}),
				() => undefined,
			);
			if (!after) {
				throw error;
			}

			if (
				isRecordsEntry(after.value) &&
				Number(after.value.schemaVersion) >= LAYOUT_VERSION
			) {
				await backend.remove([MIGRATION_KEY]).catch(() => undefined);
				return {status: 'upgraded'};
			}

			await removeKeys(written).catch(() => undefined);
			await backend.remove([PREUPGRADE_KEY]).catch(() => undefined);
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
		readStamped,
		openScope,
		stamp,
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
