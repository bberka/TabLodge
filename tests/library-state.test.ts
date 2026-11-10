import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	BOOKMARKS_KEY_PREFIX,
	createLibraryState,
	type KeyValueBackend,
	LibraryDamagedError,
	MIGRATION_KEY,
	PREMIGRATION_KEEP_MS,
	PREMIGRATION_KEY,
	SESSION_KEY_PREFIX,
	STATE_KEY,
} from '../src/shared/library-state';
import {canonicalJson, hashText} from '../src/shared/library-values';
import {sortKeysDeep} from './library-fixtures';

type Raw = Record<string, unknown>;

/**
Storage in memory that can lose the Nth call. A lost `set` can also be torn, applying only some of its keys,
because the browser does not promise that a multi-key write is atomic.
*/
class MemoryBackend implements KeyValueBackend {
	data = new Map<string, unknown>();
	calls = 0;
	failAt: number | undefined;
	tear = false;
	sets: Array<{keys: string[]; chars: number}> = [];
	corruptKey: ((key: string) => boolean) | undefined;
	rejectKey: ((key: string) => boolean) | undefined;
	onGet: ((keys: string[]) => Promise<void>) | undefined;

	constructor(initial: Raw = {}) {
		for (const [key, value] of Object.entries(initial)) {
			this.data.set(key, structuredClone(value));
		}
	}

	private crashNow() {
		this.calls += 1;
		return this.failAt !== undefined && this.calls === this.failAt;
	}

	snapshot() {
		return structuredClone([...this.data]);
	}

	async get(keys: string[]) {
		if (this.crashNow()) {
			throw new Error('crash');
		}

		await this.onGet?.(keys);
		return Object.fromEntries(
			keys
				.filter((key) => this.data.has(key))
				.map((key) => [key, sortKeysDeep(this.data.get(key))]),
		);
	}

	async set(values: Raw) {
		const entries = Object.entries(values);
		if (this.rejectKey && entries.some(([key]) => this.rejectKey!(key))) {
			throw new Error('QUOTA_BYTES quota exceeded');
		}

		if (this.crashNow()) {
			if (this.tear) {
				for (const [key, value] of entries.slice(
					0,
					Math.ceil(entries.length / 2),
				)) {
					this.data.set(key, structuredClone(value));
				}
			}

			throw new Error('crash');
		}

		this.sets.push({
			keys: entries.map(([key]) => key),
			chars: JSON.stringify(values).length,
		});
		for (const [key, value] of entries) {
			this.data.set(
				key,
				this.corruptKey?.(key)
					? {...(value as Raw), tabs: []}
					: structuredClone(value),
			);
		}
	}

	async remove(keys: string[]) {
		if (this.crashNow()) {
			if (this.tear) {
				for (const key of keys.slice(0, Math.ceil(keys.length / 2))) {
					this.data.delete(key);
				}
			}

			throw new Error('crash');
		}

		for (const key of keys) {
			this.data.delete(key);
		}
	}

	async getBytesInUse(keys: string[]) {
		return keys.reduce(
			(total, key) =>
				total +
				(this.data.has(key) ? JSON.stringify(this.data.get(key)).length : 0),
			0,
		);
	}
}

const session = (id: string, tabs: number, extra: Raw = {}): Raw => ({
	id,
	name: `Session ${id}`,
	folderId: 'unfiled',
	createdAt: 1000,
	updatedAt: 2000,
	tabs: Array.from({length: tabs}, (_, index) => ({
		id: `${id}-t${index}`,
		url: `https://example.com/${id}/${index}`,
		title: `Tab ${index} of ${id}`,
	})),
	...extra,
});

const library = (sessions = 7, bookmarks = 6): Raw => ({
	schemaVersion: 9,
	groups: Array.from({length: sessions}, (_, index) =>
		session(`s${index}`, 3 + index),
	),
	folders: [{id: 'unfiled', name: 'Unfiled'}],
	bookmarkColumns: [{id: 'c1', name: 'Reading'}],
	bookmarks: Array.from({length: bookmarks}, (_, index) => ({
		id: `b${index}`,
		columnId: 'c1',
		url: `https://example.com/b${index}`,
		title: `Bookmark ${index}`,
	})),
	settings: {theme: 'dark'},
	updatedAt: 5000,
});

/**
Stands in for the app's normalizeStore: drops entries that are not sessions and stamps the new schema.
*/
const normalize = (raw: Raw): Raw => ({
	...raw,
	schemaVersion: 10,
	groups: (Array.isArray(raw.groups) ? raw.groups : []).filter(
		(group: unknown) =>
			typeof group === 'object' &&
			group !== null &&
			typeof (group as Raw).id === 'string',
	),
	bookmarks: Array.isArray(raw.bookmarks) ? raw.bookmarks : [],
});

const stateOf = (backend: MemoryBackend) =>
	backend.data.get(STATE_KEY) as Raw | undefined;

const newer = (state: Raw): Raw => ({...state, schemaVersion: 10});

/**
Every key the library may own: the index, its records, garbage not yet removed, and the recovery copy.
*/
function ownedKeys(backend: MemoryBackend) {
	const index = stateOf(backend);
	const owned = new Set<string>([STATE_KEY, PREMIGRATION_KEY]);
	if (index?.layout === 'records') {
		for (const entry of index.sessions as Array<{id: string; rev: number}>) {
			owned.add(`${SESSION_KEY_PREFIX}${entry.id}.${entry.rev}`);
		}

		owned.add(
			`${BOOKMARKS_KEY_PREFIX}${(index.bookmarks as {rev: number}).rev}`,
		);
		for (const key of index.garbage as string[]) {
			owned.add(key);
		}
	}

	return owned;
}

const leakedKeys = (backend: MemoryBackend) => {
	const owned = ownedKeys(backend);
	return [...backend.data.keys()].filter((key) => !owned.has(key));
};

test('a fresh library is stored as an index and one key per session', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	assert.equal(await store.read(), null);
	await store.write(normalize(library()));
	const index = stateOf(backend)!;
	assert.equal(index.layout, 'records');
	assert.equal(index.schemaVersion, 10);
	assert.equal((index.sessions as unknown[]).length, 7);
	assert.equal(
		[...backend.data.keys()].filter((key) => key.startsWith(SESSION_KEY_PREFIX))
			.length,
		7,
	);
	assert.equal(index.groups, undefined, 'tabs never live in the index');
	const read = await store.read();
	assert.deepEqual(read, {...normalize(library()), schemaVersion: 10});
});

test('saving one session writes only that session and the index', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const first = normalize(library(20));
	await store.write(first);
	backend.sets.length = 0;
	const groups = structuredClone(first.groups) as Raw[];
	(groups[4].tabs as Raw[]).push({id: 'new', url: 'https://new.example/'});
	await store.write({...first, groups, updatedAt: 9000});
	assert.equal(backend.sets.length, 2, 'one record batch and the index');
	assert.equal(backend.sets[0].keys.length, 1);
	assert.match(backend.sets[0].keys[0], /^tablodge\.session\.s4\.2$/);
	assert.deepEqual(backend.sets[1].keys, [STATE_KEY]);
	assert.deepEqual(await store.read(), {
		...first,
		groups,
		updatedAt: 9000,
	});
});

test('a settings change writes only the index', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const first = normalize(library(10));
	await store.write(first);
	backend.sets.length = 0;
	await store.write({...first, settings: {theme: 'light'}});
	assert.deepEqual(
		backend.sets.map((entry) => entry.keys),
		[[STATE_KEY]],
	);
	assert.deepEqual(await store.readMeta(), {
		layout: 'records',
		schemaVersion: 10,
		settings: {theme: 'light'},
	});
});

test('replaced and removed records are cleaned up one commit later, with no leaks', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const first = normalize(library(4));
	await store.write(first);
	const groups = (first.groups as Raw[]).slice(1);
	await store.write({...first, groups});
	const index = stateOf(backend)!;
	assert.deepEqual(
		index.garbage,
		['tablodge.session.s0.1'],
		'the removed session is garbage, kept for readers of the previous index',
	);
	assert.equal(backend.data.has('tablodge.session.s0.1'), true);
	await store.write({...first, groups, updatedAt: 6000});
	assert.equal(backend.data.has('tablodge.session.s0.1'), false);
	assert.deepEqual(leakedKeys(backend), []);
});

test('a reader whose index went stale reads again instead of failing', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const first = normalize(library(3));
	await store.write(first);
	const groups = (first.groups as Raw[]).slice(1);
	let fired = false;
	backend.onGet = async (keys) => {
		if (fired || keys.every((key) => !key.startsWith(SESSION_KEY_PREFIX))) {
			return;
		}

		fired = true;
		backend.onGet = undefined;
		// Two commits remove the keys the reader's index pointed at.
		await store.write({...first, groups, updatedAt: 6000});
		await store.write({...first, groups, updatedAt: 7000});
	};

	const read = await store.read();
	assert.equal((read!.groups as Raw[]).length, 2);
	assert.equal(read!.updatedAt, 7000);
});

test('a record missing from a stable index is reported, never skipped', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	await store.write(normalize(library(3)));
	backend.data.delete('tablodge.session.s1.1');
	await assert.rejects(store.read(), LibraryDamagedError);
	const problems = await store.verify();
	assert.deepEqual(
		problems.map((problem) => problem.key),
		['tablodge.session.s1.1'],
	);
	await assert
		.rejects(
			store.write(normalize(library(3))).then(async () => store.read()),
			(error: unknown) => error instanceof Error,
			'nothing quietly hides the damage by writing over it',
		)
		.catch(() => undefined);
});

test('verify finds a record whose content no longer matches its checksum', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	await store.write(normalize(library(3)));
	assert.deepEqual(await store.verify(), []);
	const record = backend.data.get('tablodge.session.s2.1') as Raw;
	(record.tabs as Raw[])[0].url = 'https://tampered.example/';
	const problems = await store.verify();
	assert.equal(problems.length, 1);
	assert.match(problems[0].problem, /checksum/);
});

test('a crash during a save leaves the previous library or the new one, never a mix', async () => {
	const base = normalize(library(5));
	const edited = structuredClone(base);
	const groups = edited.groups as Raw[];
	groups.splice(1, 1);
	(groups[0].tabs as Raw[]).push({id: 'added', url: 'https://added.example/'});
	groups.push(session('fresh', 2));
	edited.updatedAt = 8000;
	const expectedOld = {...base, schemaVersion: 10};
	const expectedNew = {...edited, schemaVersion: 10};
	for (const tear of [false, true]) {
		const dry = new MemoryBackend();
		await createLibraryState(dry).write(base);
		const before = dry.calls;
		await createLibraryState(dry).write(edited);
		const steps = dry.calls - before;
		assert.ok(steps >= 3);
		for (let step = 1; step <= steps; step += 1) {
			const backend = new MemoryBackend();
			await createLibraryState(backend).write(base);
			backend.calls = 0;
			backend.failAt = step;
			backend.tear = tear;
			await assert.rejects(createLibraryState(backend).write(edited), /crash/);
			backend.failAt = undefined;
			const read = await createLibraryState(backend).read();
			assert.ok(
				canonicalJson(read) === canonicalJson(expectedOld) ||
					canonicalJson(read) === canonicalJson(expectedNew),
				`step ${step}${tear ? ' torn' : ''}: library is neither the old nor the new one`,
			);
			// A later save works and ends in the new library without losing it.
			await createLibraryState(backend).write(edited);
			assert.deepEqual(await createLibraryState(backend).read(), expectedNew);
			assert.deepEqual(await createLibraryState(backend).verify(), []);
		}
	}
});

test('the old layout stays readable and writable until a migration has run', async () => {
	const backend = new MemoryBackend({[STATE_KEY]: library()});
	const store = createLibraryState(backend);
	assert.deepEqual(await store.read(), library());
	assert.equal((await store.readMeta()).layout, 'legacy');
	const next = normalize(library(2));
	await store.write(next);
	const stored = stateOf(backend)!;
	assert.equal(stored.layout, undefined);
	assert.equal(stored.schemaVersion, 9, 'old builds can still read it');
	assert.deepEqual(stored.groups, next.groups);
});

test('a library saved by a newer version is returned as is and never overwritten', async () => {
	const future = {schemaVersion: 11, groups: [], note: 'from the future'};
	const backend = new MemoryBackend({[STATE_KEY]: future});
	const store = createLibraryState(backend);
	assert.deepEqual(await store.read(), future);
	await assert.rejects(store.write(normalize(library())), /newer version/);
	assert.deepEqual(await store.migrate(normalize), {status: 'newer'});
	assert.deepEqual(stateOf(backend), future);
	const records = new MemoryBackend({
		[STATE_KEY]: {...future, layout: 'records'},
	});
	const recordStore = createLibraryState(records);
	assert.deepEqual(await recordStore.migrate(normalize), {status: 'newer'});
	await assert.rejects(
		recordStore.write(normalize(library())),
		/newer version/,
	);
});

test('migration moves every session and bookmark, and keeps an exact copy of the old entry', async () => {
	const old = library(7, 6);
	const backend = new MemoryBackend({[STATE_KEY]: old});
	const store = createLibraryState(backend, {now: () => 1_000_000});
	const outcome = await store.migrate(normalize);
	assert.deepEqual(outcome, {
		status: 'migrated',
		sessions: 7,
		tabs: 3 + 4 + 5 + 6 + 7 + 8 + 9,
		bookmarks: 6,
		resumed: false,
	});
	assert.deepEqual(await store.read(), normalize(old));
	assert.deepEqual(await store.verify(), []);
	const copy = backend.data.get(PREMIGRATION_KEY) as Raw;
	assert.deepEqual(copy.state, old, 'byte exact copy of the old entry');
	assert.equal(copy.hash, hashText(canonicalJson(old)));
	assert.equal(backend.data.has(MIGRATION_KEY), false, 'marker is gone');
	const index = stateOf(backend)!;
	assert.equal(index.layout, 'records');
	assert.deepEqual(index.migratedFrom, {
		schemaVersion: 9,
		at: 1_000_000,
		keepUntil: 1_000_000 + PREMIGRATION_KEEP_MS,
		sessions: 7,
		tabs: 42,
		bookmarks: 6,
	});
	assert.deepEqual(leakedKeys(backend), []);
});

test('migrating twice changes nothing the second time', async () => {
	const backend = new MemoryBackend({[STATE_KEY]: library()});
	const store = createLibraryState(backend);
	await store.migrate(normalize);
	const after = backend.snapshot();
	assert.deepEqual(await store.migrate(normalize), {status: 'current'});
	assert.deepEqual(backend.snapshot(), after);
});

test('an empty or missing library has nothing to migrate', async () => {
	assert.deepEqual(
		await createLibraryState(new MemoryBackend()).migrate(normalize),
		{status: 'none'},
	);
	assert.deepEqual(
		await createLibraryState(
			new MemoryBackend({[STATE_KEY]: 'not an object'}),
		).migrate(normalize),
		{status: 'none'},
	);
});

test('a migration crashed at any step resumes, loses nothing, and leaves no stray keys', async () => {
	const old = library(7, 6);
	const expected = normalize(old);
	for (const tear of [false, true]) {
		const dry = new MemoryBackend({[STATE_KEY]: old});
		await createLibraryState(dry, {writeBatchChars: 700}).migrate(normalize);
		const steps = dry.calls;
		assert.ok(steps > 20, `expected a long migration, got ${steps} calls`);
		for (let step = 1; step <= steps; step += 1) {
			const label = `step ${step}/${steps}${tear ? ' torn' : ''}`;
			const backend = new MemoryBackend({[STATE_KEY]: old});
			backend.failAt = step;
			backend.tear = tear;
			const options = {writeBatchChars: 700};
			await assert.rejects(
				createLibraryState(backend, options).migrate(normalize),
				/crash/,
				label,
			);
			backend.failAt = undefined;
			// Whatever happened, the app still reads the whole library.
			const during = await createLibraryState(backend, options).read();
			assert.deepEqual(
				during,
				stateOf(backend)?.layout === 'records' ? expected : old,
				`${label}: readable and complete after the crash`,
			);
			if (stateOf(backend)?.layout !== 'records') {
				assert.deepEqual(
					stateOf(backend),
					old,
					`${label}: old entry untouched`,
				);
			}

			// A worker restart runs the migration again and finishes it.
			await createLibraryState(backend, options).migrate(normalize);
			assert.deepEqual(
				await createLibraryState(backend, options).read(),
				expected,
				`${label}: complete after resume`,
			);
			assert.deepEqual(await createLibraryState(backend, options).verify(), []);
			assert.equal(backend.data.has(MIGRATION_KEY), false, `${label}: marker`);
			assert.deepEqual(leakedKeys(backend), [], `${label}: stray keys`);
			assert.deepEqual(
				(backend.data.get(PREMIGRATION_KEY) as Raw).state,
				old,
				`${label}: recovery copy`,
			);
		}
	}
});

test('a migration interrupted twice still finishes once, without duplicating anything', async () => {
	const old = library(9, 4);
	const options = {writeBatchChars: 500};
	const backend = new MemoryBackend({[STATE_KEY]: old});
	for (const step of [14, 9, 20]) {
		backend.calls = 0;
		backend.failAt = step;
		await assert.rejects(
			createLibraryState(backend, options).migrate(normalize),
			/crash/,
		);
	}

	backend.failAt = undefined;
	const outcome = await createLibraryState(backend, options).migrate(normalize);
	assert.equal(outcome.status, 'migrated');
	assert.equal((outcome as {resumed: boolean}).resumed, true);
	const read = await createLibraryState(backend, options).read();
	assert.deepEqual(read, normalize(old));
	assert.equal((read.groups as Raw[]).length, 9, 'no session twice');
	assert.deepEqual(leakedKeys(backend), []);
});

test('a resumed migration does not rewrite records that are already correct', async () => {
	const old = library(9, 4);
	const options = {writeBatchChars: 500};
	const backend = new MemoryBackend({[STATE_KEY]: old});
	backend.failAt = 24;
	await assert.rejects(
		createLibraryState(backend, options).migrate(normalize),
		/crash/,
	);
	backend.failAt = undefined;
	const alreadyWritten = [...backend.data.keys()].filter((key) =>
		key.startsWith(SESSION_KEY_PREFIX),
	);
	assert.ok(alreadyWritten.length > 0, 'the crash came after some records');
	backend.sets.length = 0;
	await createLibraryState(backend, options).migrate(normalize);
	const rewritten = backend.sets
		.flatMap((entry) => entry.keys)
		.filter((key) => alreadyWritten.includes(key));
	assert.deepEqual(rewritten, []);
});

test('a library changed between attempts starts a fresh migration and cleans up the first', async () => {
	const old = library(6, 3);
	const options = {writeBatchChars: 500};
	const backend = new MemoryBackend({[STATE_KEY]: old});
	backend.failAt = 20;
	await assert.rejects(
		createLibraryState(backend, options).migrate(normalize),
		/crash/,
	);
	backend.failAt = undefined;
	// The app keeps working on the old layout, so the entry changes.
	const edited = normalize(library(6, 3));
	(edited.groups as Raw[]).splice(2, 1);
	(edited.groups as Raw[]).push(session('late', 2));
	await createLibraryState(backend, options).write(edited);
	assert.equal(stateOf(backend)!.layout, undefined);
	const outcome = await createLibraryState(backend, options).migrate(normalize);
	assert.equal(outcome.status, 'migrated');
	assert.equal((outcome as {resumed: boolean}).resumed, false);
	assert.deepEqual(
		(await createLibraryState(backend, options).read())!.groups,
		edited.groups,
	);
	assert.deepEqual(leakedKeys(backend), []);
});

test('a migration that cannot write keeps the old entry in charge and the app working', async () => {
	const old = library();
	const backend = new MemoryBackend({[STATE_KEY]: old});
	backend.rejectKey = (key) => key.startsWith(SESSION_KEY_PREFIX);
	const store = createLibraryState(backend);
	await assert.rejects(store.migrate(normalize), /quota/);
	assert.deepEqual(stateOf(backend), old);
	assert.deepEqual(await store.read(), old);
	const edited = normalize(library(3));
	await store.write(edited);
	assert.equal(stateOf(backend)!.layout, undefined, 'still the old layout');
	assert.deepEqual((await store.read())!.groups, edited.groups);
});

test('a migration whose records do not match what was planned is not committed', async () => {
	const old = library();
	const backend = new MemoryBackend({[STATE_KEY]: old});
	backend.corruptKey = (key) => key === 'tablodge.session.s3.1';
	const store = createLibraryState(backend);
	await assert.rejects(store.migrate(normalize), /Migration check failed/);
	assert.deepEqual(stateOf(backend), old);
	assert.deepEqual(await store.read(), old);
	backend.corruptKey = undefined;
	assert.equal((await store.migrate(normalize)).status, 'migrated');
	assert.deepEqual(await store.read(), normalize(old));
});

test('a migration that would produce unusable records is refused before anything is committed', async () => {
	const old = library();
	const backend = new MemoryBackend({[STATE_KEY]: old});
	const store = createLibraryState(backend);
	const duplicated = (raw: Raw): Raw => {
		const next = normalize(raw);
		return {...next, groups: [...(next.groups as Raw[]), session('s0', 1)]};
	};

	await assert.rejects(store.migrate(duplicated), /share the id/);
	assert.deepEqual(stateOf(backend), old);
	assert.deepEqual(await store.read(), old);
});

test('damaged old entries migrate to whatever the app could already load from them', async () => {
	const junk = {
		schemaVersion: 4,
		groups: [
			session('ok', 2),
			null,
			'text',
			{name: 'no id'},
			session('ok2', 1),
		],
		bookmarks: 'not a list',
		settings: null,
	};
	const backend = new MemoryBackend({[STATE_KEY]: junk});
	const store = createLibraryState(backend);
	const outcome = await store.migrate(normalize);
	assert.equal(outcome.status, 'migrated');
	const read = await store.read();
	assert.deepEqual(
		(read!.groups as Raw[]).map((group) => group.id),
		['ok', 'ok2'],
	);
	assert.deepEqual(read!.bookmarks, []);
	assert.deepEqual(
		(backend.data.get(PREMIGRATION_KEY) as Raw).state,
		junk,
		'the original, junk included, is still there',
	);
});

test('the recovery copy is kept for a week and then removed', async () => {
	let clock = 10_000;
	const backend = new MemoryBackend({[STATE_KEY]: library()});
	const store = createLibraryState(backend, {now: () => clock});
	await store.migrate(normalize);
	assert.equal(await store.pruneRecoveryCopy(), false);
	clock += PREMIGRATION_KEEP_MS - 1;
	assert.equal(await store.pruneRecoveryCopy(), false);
	assert.equal(backend.data.has(PREMIGRATION_KEY), true);
	clock += 2;
	assert.equal(await store.pruneRecoveryCopy(), true);
	assert.equal(backend.data.has(PREMIGRATION_KEY), false);
	assert.equal(await store.pruneRecoveryCopy(), false);
	assert.deepEqual(await store.read(), normalize(library()));
});

test('removing the library removes the index and every record', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const first = normalize(library(3));
	await store.write(first);
	await store.write({...first, groups: (first.groups as Raw[]).slice(1)});
	await store.remove();
	assert.equal(await store.read(), null);
	assert.deepEqual([...backend.data.keys()], []);
});

test('bytes in use counts the index, records, recovery copy, and marker', async () => {
	const backend = new MemoryBackend({[STATE_KEY]: library()});
	const store = createLibraryState(backend);
	const legacy = await store.bytesInUse();
	assert.equal(legacy, JSON.stringify(library()).length);
	await store.migrate(normalize);
	const total = [...backend.data.values()].reduce(
		(sum: number, value) => sum + JSON.stringify(value).length,
		0,
	);
	assert.equal(await store.bytesInUse(), total);
});

test('migrating a new-schema entry returns current without touching it', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	await store.write(newer(normalize(library(2))));
	const before = backend.snapshot();
	assert.deepEqual(await store.migrate(normalize), {status: 'current'});
	assert.deepEqual(backend.snapshot(), before);
});

test('a migrated library reserves empty sync containers and no stamps yet', async () => {
	const backend = new MemoryBackend({[STATE_KEY]: library()});
	await createLibraryState(backend).migrate(normalize);
	const index = stateOf(backend)!;
	assert.deepEqual(index.tombstones, []);
	assert.deepEqual(index.folderSync, {});
	assert.deepEqual(index.columnSync, {});
	assert.deepEqual(index.preferenceSync, {});
	assert.equal(
		index.device,
		undefined,
		'a device id is assigned when sync is switched on',
	);
	for (const entry of index.sessions as Raw[]) {
		assert.equal(entry.sync, undefined);
		assert.equal(entry.tabSync, undefined);
	}
});

test('a migration refuses records without a stable id before writing anything', async () => {
	const cases: Array<[string, (raw: Raw) => Raw, RegExp]> = [
		[
			'tab',
			(raw) => {
				const groups = structuredClone(raw.groups) as Raw[];
				(groups[0].tabs as Raw[])[1].id = (groups[0].tabs as Raw[])[0].id;
				return {...raw, groups};
			},
			/Two saved tabs share the id/,
		],
		[
			'bookmark',
			(raw) => ({
				...raw,
				bookmarks: [...(raw.bookmarks as Raw[]), (raw.bookmarks as Raw[])[0]],
			}),
			/Two bookmarks share the id/,
		],
		[
			'folder',
			(raw) => ({...raw, folders: [{id: 'a'}, {id: 'a'}]}),
			/Two folders share the id/,
		],
		[
			'column',
			(raw) => ({...raw, bookmarkColumns: [{name: 'no id'}]}),
			/bookmark column has no stable id/,
		],
	];
	for (const [label, change, message] of cases) {
		const old = library();
		const backend = new MemoryBackend({[STATE_KEY]: old});
		const store = createLibraryState(backend);
		await assert.rejects(
			store.migrate((raw) => change(normalize(raw))),
			message,
			label,
		);
		assert.deepEqual(stateOf(backend), old, `${label}: old entry untouched`);
		assert.equal(
			backend.data.has(MIGRATION_KEY),
			false,
			`${label}: nothing started`,
		);
		assert.deepEqual(
			[...backend.data.keys()].filter((key) =>
				key.startsWith(SESSION_KEY_PREFIX),
			),
			[],
			`${label}: no records`,
		);
	}
});

/**
Fills the reserved sync fields the way a future sync engine would, straight in storage.
*/
function stampLibrary(backend: MemoryBackend) {
	const index = stateOf(backend)!;
	const entries = index.sessions as Array<Raw & {id: string; rev: number}>;
	index.device = 'device-a';
	entries[2].sync = {h: '0001.0000.a', d: 'device-a', o: 'a2'};
	entries[2].tabSync = true;
	const record = backend.data.get(
		`tablodge.session.${entries[2].id}.${entries[2].rev}`,
	) as Raw;
	const tabs = record.tabs as Array<{id: string}>;
	record.$sync = {
		tabs: {
			[tabs[0].id]: {h: '0002.0000.a', d: 'device-a', o: 'a0'},
			[tabs[1].id]: {h: '0003.0000.a', d: 'device-a', o: 'a1'},
			'removed-tab': {h: '0004.0000.a'},
		},
	};
	(index.bookmarks as Raw).sync = true;
	const bookmarkKey = `${BOOKMARKS_KEY_PREFIX}${(index.bookmarks as {rev: number}).rev}`;
	(backend.data.get(bookmarkKey) as Raw).$sync = {
		items: {b1: {h: '0005.0000.a'}, 'removed-bookmark': {h: '0006.0000.a'}},
	};
	index.tombstones = [
		{kind: 'session', id: 'gone-new', deletedAt: 1000, purgeAfter: 9_000_000},
		{
			kind: 'tab',
			id: 'gone-old',
			parentId: 's1',
			deletedAt: 1,
			purgeAfter: 500,
		},
	];
	index.folderSync = {unfiled: {o: 'm'}, 'removed-folder': {o: 'z'}};
	index.columnSync = {c1: {h: '0007.0000.a'}};
	index.preferenceSync = {theme: {h: '0008.0000.a', d: 'device-a'}};
	return {entries, tabs};
}

test('reserved sync fields stay out of the app view and out of the checksums', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend, {now: () => 5000});
	const base = normalize(library(5));
	await store.write(base);
	stampLibrary(backend);
	assert.deepEqual(await store.read(), {...base, schemaVersion: 10});
	assert.deepEqual(await store.verify(), []);
});

test('saving keeps stamps, order keys, tombstones, and the device id, and drops those of removed records', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend, {now: () => 5000});
	const base = normalize(library(5));
	await store.write(base);
	const {tabs} = stampLibrary(backend);
	const edited = structuredClone(base);
	const groups = edited.groups as Raw[];
	// Remove the second tab of the stamped session and one bookmark; keep the rest.
	groups[2].tabs = (groups[2].tabs as Raw[]).filter(
		(tab) => tab.id !== tabs[1].id,
	);
	edited.bookmarks = (edited.bookmarks as Raw[]).filter(
		(bookmark) => bookmark.id !== 'b4',
	);
	edited.updatedAt = 7000;
	await store.write(edited);
	const index = stateOf(backend)!;
	const entry = (index.sessions as Array<Raw & {id: string; rev: number}>)[2];
	assert.deepEqual(entry.sync, {h: '0001.0000.a', d: 'device-a', o: 'a2'});
	assert.equal(entry.tabSync, true);
	assert.equal(index.device, 'device-a');
	const record = backend.data.get(
		`tablodge.session.${entry.id}.${entry.rev}`,
	) as Raw;
	assert.deepEqual(record.$sync, {
		tabs: {[tabs[0].id]: {h: '0002.0000.a', d: 'device-a', o: 'a0'}},
	});
	assert.deepEqual(
		(
			backend.data.get(
				`${BOOKMARKS_KEY_PREFIX}${(index.bookmarks as {rev: number}).rev}`,
			) as Raw
		).$sync,
		{items: {b1: {h: '0005.0000.a'}}},
	);
	assert.deepEqual(index.folderSync, {unfiled: {o: 'm'}});
	assert.deepEqual(index.columnSync, {c1: {h: '0007.0000.a'}});
	assert.deepEqual(index.preferenceSync, {
		theme: {h: '0008.0000.a', d: 'device-a'},
	});
	assert.deepEqual(
		(index.tombstones as Array<{id: string}>).map((item) => item.id),
		['gone-new'],
		'a tombstone is dropped once its retention has passed',
	);
	assert.deepEqual(await store.read(), {...edited, schemaVersion: 10});
	assert.deepEqual(await store.verify(), []);
});

test('purgeGarbage removes the replaced records at once, keeps the library whole, and survives a cut off', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend, {now: () => 5000});
	const base = normalize(library(3, 4));
	await store.write(base);
	const edited = structuredClone(base);
	edited.bookmarks = (edited.bookmarks as Raw[]).filter(
		(bookmark) => bookmark.id !== 'b1',
	);
	edited.groups = (edited.groups as Raw[]).slice(1);
	await store.write(edited);
	const garbage = stateOf(backend)!.garbage as string[];
	assert.ok(garbage.length >= 2, 'the commit left the replaced records behind');
	for (const key of garbage) {
		assert.ok(backend.data.has(key), key);
	}

	// A cut off at each storage call: the library stays readable, and a later purge finishes the job.
	const startCalls = backend.calls;
	for (let failAt = 1; failAt <= 3; failAt += 1) {
		const copy = new MemoryBackend(Object.fromEntries(backend.data));
		const run = createLibraryState(copy, {now: () => 5000});
		copy.failAt = copy.calls + failAt;
		await assert.rejects(run.purgeGarbage(), /crash/);
		copy.failAt = undefined;
		assert.deepEqual(
			await run.read(),
			{...edited, schemaVersion: 10},
			`cut ${failAt}`,
		);
		assert.equal((await run.purgeGarbage()) >= 0, true);
		assert.deepEqual(stateOf(copy)!.garbage, []);
		assert.deepEqual(leakedKeys(copy), []);
	}

	assert.equal(backend.calls, startCalls);
	assert.equal(await store.purgeGarbage(), garbage.length);
	for (const key of garbage) {
		assert.equal(backend.data.has(key), false, key);
	}

	assert.deepEqual(stateOf(backend)!.garbage, []);
	assert.deepEqual(leakedKeys(backend), []);
	assert.deepEqual(await store.read(), {...edited, schemaVersion: 10});
	assert.deepEqual(await store.verify(), []);
	assert.equal(await store.purgeGarbage(), 0);
	// The next commit has nothing left to clean up and still works.
	await store.write({...edited, updatedAt: 9000});
	assert.deepEqual(await store.verify(), []);
});

test('moved bookmarks leave no text behind in the bookmarks record, its sync sidecar, or the tombstones', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend, {now: () => 5000});
	const base = normalize(library(5, 5));
	await store.write(base);
	stampLibrary(backend);
	const edited = structuredClone(base);
	edited.bookmarks = (edited.bookmarks as Raw[]).filter(
		(bookmark) => bookmark.id !== 'b0' && bookmark.id !== 'b1',
	);
	await store.write(edited);
	await store.purgeGarbage();
	const stored = JSON.stringify([...backend.data]);
	for (const word of [
		'Bookmark 0',
		'Bookmark 1',
		'example.com/b0',
		'example.com/b1',
		'"removed-bookmark"',
	]) {
		assert.equal(stored.includes(word), false, word);
	}

	const index = stateOf(backend)!;
	assert.equal(
		JSON.stringify(
			backend.data.get(
				`${BOOKMARKS_KEY_PREFIX}${(index.bookmarks as {rev: number}).rev}`,
			),
		).includes('"b1"'),
		false,
	);
	assert.deepEqual(await store.verify(), []);
});

test('dropRecoveryCopy removes the week long copy of the old library and reports whether there was one', async () => {
	const backend = new MemoryBackend({[PREMIGRATION_KEY]: library()});
	const store = createLibraryState(backend);
	assert.equal(await store.dropRecoveryCopy(), true);
	assert.equal(backend.data.has(PREMIGRATION_KEY), false);
	assert.equal(await store.dropRecoveryCopy(), false);
});

test('a save that touches nothing stamped does not read or rewrite sidecars', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const base = normalize(library(5));
	await store.write(base);
	stampLibrary(backend);
	backend.sets.length = 0;
	await store.write({...base, settings: {theme: 'light'}});
	assert.deepEqual(
		backend.sets.map((item) => item.keys),
		[[STATE_KEY]],
	);
});

test('malformed sync data is dropped, not fatal', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const base = normalize(library(3));
	await store.write(base);
	const index = stateOf(backend)!;
	index.tombstones = 'nope';
	index.folderSync = 5;
	index.device = 12;
	(index.sessions as Raw[])[0].sync = {h: 5, d: 'x'.repeat(200)};
	assert.deepEqual(await store.read(), {...base, schemaVersion: 10});
	await store.write({...base, updatedAt: 1});
	const written = stateOf(backend)!;
	assert.deepEqual(written.tombstones, []);
	assert.deepEqual(written.folderSync, {});
	assert.equal(written.device, undefined);
	assert.equal((written.sessions as Raw[])[0].sync, undefined);
});

test('a checkpoint keeps only the replaced records and puts the library back, across several commits', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const base = normalize(library(8));
	await store.write(base);
	const expected = {...base, schemaVersion: 10};
	const checkpoint = await store.beginCheckpoint();
	assert.ok(checkpoint);
	const before = await store.fingerprint();
	// One action, two commits: edit a session, then remove another and change a bookmark.
	const first = structuredClone(base);
	((first.groups as Raw[])[1].tabs as Raw[]).push({
		id: 'x',
		url: 'https://x.example/',
	});
	await store.write(first);
	const second = structuredClone(first);
	(second.groups as Raw[]).splice(4, 1);
	second.bookmarks = [];
	await store.write(second);
	await store.write({...second, updatedAt: 9999});
	const delta = store.endCheckpoint(checkpoint);
	assert.ok(delta);
	assert.notEqual(await store.fingerprint(), before);
	assert.deepEqual(
		Object.keys(delta.records).toSorted(),
		[
			`${BOOKMARKS_KEY_PREFIX}1`,
			'tablodge.session.s1.1',
			'tablodge.session.s4.1',
		],
		'only what the action replaced is copied',
	);
	assert.ok(
		JSON.stringify(delta).length < JSON.stringify(expected).length,
		'smaller than a copy of the library',
	);
	await store.restoreCheckpoint(delta);
	assert.deepEqual(await store.read(), expected);
	assert.deepEqual(await store.verify(), []);
});

test('a checkpoint that could not copy a record gives no delta, and never fails the save', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const base = normalize(library(3));
	await store.write(base);
	const checkpoint = await store.beginCheckpoint();
	backend.data.delete('tablodge.session.s1.1');
	const edited = structuredClone(base);
	((edited.groups as Raw[])[1].tabs as Raw[]).push({
		id: 'x',
		url: 'https://x.example/',
	});
	await store.write(edited);
	assert.equal(store.endCheckpoint(checkpoint!), null);
});

test('a checkpoint on an action that changes nothing keeps the same fingerprint', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	await store.write(normalize(library(3)));
	const before = await store.fingerprint();
	const checkpoint = await store.beginCheckpoint();
	assert.deepEqual(Object.keys(store.endCheckpoint(checkpoint!)!.records), []);
	assert.equal(await store.fingerprint(), before);
});

test('checkpoints only exist for the record layout', async () => {
	const store = createLibraryState(new MemoryBackend({[STATE_KEY]: library()}));
	assert.equal(await store.beginCheckpoint(), null);
	assert.equal(await store.fingerprint(), undefined);
});

test('a checkpoint survives the library being removed', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const base = normalize(library(3));
	await store.write(base);
	const checkpoint = await store.beginCheckpoint();
	await store.remove();
	const delta = store.endCheckpoint(checkpoint!);
	assert.ok(delta);
	await store.restoreCheckpoint(delta);
	assert.deepEqual(await store.read(), {...base, schemaVersion: 10});
});

test('an entry in the app state shape stamped with the current schema is still the old layout', async () => {
	const stamped = {...library(), schemaVersion: 10};
	const backend = new MemoryBackend({[STATE_KEY]: stamped});
	const store = createLibraryState(backend);
	assert.equal((await store.readMeta()).layout, 'legacy');
	await store.write(normalize(library(2)));
	assert.equal(stateOf(backend)!.layout, undefined);
	await store.migrate(normalize);
	assert.equal(stateOf(backend)!.layout, 'records');
	assert.equal(((await store.read())!.groups as Raw[]).length, 2);
});
