import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {test} from 'vite-plus/test';
import {buildFullBackup, readFullBackup} from '../src/shared/full-backup';
import {
	BOOKMARK_CHUNK_KEY_PREFIX,
	BOOKMARKS_KEY_PREFIX,
	createLibraryState,
	isUndoDelta,
	LibraryDamagedError,
	MIGRATION_KEY,
	PREMIGRATION_KEEP_MS,
	PREUPGRADE_KEY,
	SESSION_PAGE_KEY_PREFIX,
	STATE_KEY,
} from '../src/shared/library-state';
import {normalizeStore} from '../src/shared/library-normalize';
import {assemble, splitLibrary} from '../src/shared/sync/library-records';
import {
	library as quadratic,
	MemoryBackend,
	normalize,
	session,
} from './library-memory';

type Raw = Record<string, unknown>;

const library = (sessions: number, bookmarks: number): Raw => ({
	...quadratic(0, bookmarks),
	groups: Array.from({length: sessions}, (_, index) => session(`s${index}`, 3)),
});

const layout10 = (backend: MemoryBackend) =>
	createLibraryState(backend, {layoutVersion: 10});

const stateOf = (backend: MemoryBackend) => backend.data.get(STATE_KEY) as Raw;

const keysWith = (backend: MemoryBackend, prefix: string) =>
	[...backend.data.keys()].filter((key) => key.startsWith(prefix));

const expected = (raw: Raw) => ({...raw, schemaVersion: 10});

async function storedInLayout10(sessions: number, bookmarks: number) {
	const backend = new MemoryBackend();
	const old = layout10(backend);
	const base = normalize(library(sessions, bookmarks));
	await old.write(base);
	return {backend, base};
}

test('a fresh library is stored as a root with pages and chunks, at layout 11', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const base = normalize(library(250, 250));
	await store.write(base);
	const root = stateOf(backend);
	assert.equal(root.schemaVersion, 11);
	assert.equal(root.layout, 'records');
	assert.equal(root.sessions, undefined);
	assert.equal(root.bookmarks, undefined);
	assert.equal((root.sessionPages as unknown[]).length, 3);
	assert.equal((root.bookmarkChunks as unknown[]).length, 3);
	assert.deepEqual(await store.read(), expected(base));
	assert.deepEqual(await store.verify(), []);
	assert.equal((await store.readMeta()).upgradable, false);
});

test('an empty library and one with only a session or only a bookmark round trip', async () => {
	for (const [sessions, bookmarks] of [
		[0, 0],
		[1, 0],
		[0, 1],
		[100, 100],
		[101, 101],
	]) {
		const backend = new MemoryBackend();
		const store = createLibraryState(backend);
		const base = normalize(library(sessions, bookmarks));
		await store.write(base);
		assert.deepEqual(
			await store.read(),
			expected(base),
			`${sessions}/${bookmarks}`,
		);
		await store.write({...base, bookmarks: [], groups: []});
		assert.deepEqual(
			await store.read(),
			expected({...base, bookmarks: [], groups: []}),
		);
		assert.deepEqual(await store.verify(), []);
	}
});

test('one bookmark edit among 10,000 writes one chunk and the root, under 300 KB', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const base = normalize(library(3, 10_000));
	await store.write(base);
	const edited = structuredClone(base);
	(edited.bookmarks as Raw[])[6543].title = 'Renamed';
	backend.sets.length = 0;
	backend.bytesWritten = 0;
	await store.write(edited);
	const keys = backend.sets.flatMap((set) => set.keys);
	assert.equal(
		keys.filter((key) => key !== STATE_KEY).length,
		1,
		keys.join(', '),
	);
	assert.ok(keys.some((key) => key.startsWith(BOOKMARK_CHUNK_KEY_PREFIX)));
	assert.ok(backend.bytesWritten < 300_000, String(backend.bytesWritten));
	assert.deepEqual(await store.read(), expected(edited));
}, 60_000);

test('one session rename among 10,000 writes the session, one page and the root, under 300 KB', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const base = normalize(library(10_000, 0));
	await store.write(base);
	const edited = structuredClone(base);
	(edited.groups as Raw[])[7777].name = 'Renamed';
	backend.sets.length = 0;
	backend.bytesWritten = 0;
	await store.write(edited);
	const keys = backend.sets.flatMap((set) => set.keys);
	assert.equal(keys.length, 3, keys.join(', '));
	assert.equal(
		keys.filter((key) => key.startsWith(SESSION_PAGE_KEY_PREFIX)).length,
		1,
	);
	assert.ok(backend.bytesWritten < 300_000, String(backend.bytesWritten));
	assert.deepEqual(await store.read(), expected(edited));
}, 60_000);

test('an Undo entry for one edit among 10,000 bookmarks and 10,000 sessions holds only the changed pieces, and Undo restores everything', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const base = normalize(library(10_000, 10_000));
	await store.write(base);
	const checkpoint = await store.beginCheckpoint();
	const edited = structuredClone(base);
	(edited.bookmarks as Raw[])[1234].title = 'Renamed';
	(edited.groups as Raw[])[4321].name = 'Renamed';
	await store.write(edited);
	const delta = await store.endCheckpoint(checkpoint!);
	assert.ok(delta);
	assert.equal(delta.undoDelta, 3);
	assert.ok(
		JSON.stringify(delta).length < 300_000,
		String(JSON.stringify(delta).length),
	);
	await store.restoreCheckpoint(delta);
	assert.deepEqual(await store.read(), expected(base));
	assert.deepEqual(await store.verify(), []);
}, 60_000);

test('a library stored in layout 10 loads, upgrades, and keeps every session and bookmark at 10,000 each', async () => {
	const {backend, base} = await storedInLayout10(10_000, 10_000);
	const store = createLibraryState(backend);
	const meta = await store.readMeta();
	assert.equal(meta.upgradable, true);
	assert.deepEqual(await store.read(), expected(base));

	const before = stateOf(backend);
	assert.equal(before.schemaVersion, 10);
	assert.deepEqual(await store.upgrade(), {status: 'upgraded'});

	const root = stateOf(backend);
	assert.equal(root.schemaVersion, 11);
	assert.equal((root.sessionPages as unknown[]).length, 100);
	assert.equal((root.bookmarkChunks as unknown[]).length, 100);
	assert.deepEqual(await store.read(), expected(base));
	assert.deepEqual(await store.verify(), []);
	assert.equal((await store.readMeta()).upgradable, false);
	assert.deepEqual(await store.upgrade(), {status: 'current'});

	const edited = structuredClone(base);
	(edited.bookmarks as Raw[])[5000].title = 'After the upgrade';
	(edited.groups as Raw[])[5000].name = 'After the upgrade';
	await store.write(edited);
	assert.deepEqual(await store.read(), expected(edited));

	const state = normalizeStore(await store.read());
	const backup = readFullBackup(
		buildFullBackup(
			{
				state,
				preferences: {},
				snapshots: undefined,
				trash: undefined,
				copies: [],
			},
			{appVersion: '1.0.0', now: new Date('2026-11-24T00:00:00Z')},
		).bytes,
	);
	assert.ok(backup);
	const restored = createLibraryState(new MemoryBackend());
	await restored.write(backup.state as Raw);
	assert.deepEqual(await restored.read(), expected(backup.state as Raw));
	assert.equal(((await restored.read())!.groups as unknown[]).length, 10_000);
	assert.equal(
		((await restored.read())!.bookmarks as unknown[]).length,
		10_000,
	);

	const records = splitLibrary(state);
	const rebuilt = assemble(records.values(), {...state, groups: []});
	assert.equal(normalizeStore(rebuilt as never).groups.length, 10_000);
	assert.equal(normalizeStore(rebuilt as never).bookmarks.length, 10_000);
}, 60_000);

test('an upgrade reads the same library back as one that was never in layout 10', async () => {
	const {backend, base} = await storedInLayout10(250, 250);
	const store = createLibraryState(backend);
	await store.upgrade();
	const direct = createLibraryState(new MemoryBackend());
	await direct.write(base);
	assert.deepEqual(await store.read(), await direct.read());
});

test('the old index and bookmarks record stay for a week after an upgrade, then go', async () => {
	let time = 1_000_000;
	const {backend, base} = await storedInLayout10(5, 5);
	const store = createLibraryState(backend, {now: () => time});
	const oldRoot = structuredClone(stateOf(backend));
	const oldBookmarks = `${BOOKMARKS_KEY_PREFIX}1`;
	assert.equal(backend.data.has(oldBookmarks), true);
	await store.upgrade();

	const copy = backend.data.get(PREUPGRADE_KEY) as Raw;
	assert.deepEqual(copy.state, oldRoot);
	assert.equal(backend.data.has(oldBookmarks), true);
	await store.write({...base, updatedAt: 9});
	await store.write({...base, updatedAt: 10});
	assert.equal(backend.data.has(oldBookmarks), true, 'later commits keep it');
	assert.equal(await store.pruneRecoveryCopy(), false);

	time += PREMIGRATION_KEEP_MS + 1;
	assert.equal(await store.pruneRecoveryCopy(), true);
	assert.equal(backend.data.has(PREUPGRADE_KEY), false);
	assert.equal(backend.data.has(oldBookmarks), false);
	assert.equal(stateOf(backend).migratedFrom, undefined);
	assert.deepEqual(await store.read(), expected({...base, updatedAt: 10}));
	assert.equal(await store.pruneRecoveryCopy(), false);
});

test('erasing the library also removes the kept copies', async () => {
	const {backend} = await storedInLayout10(5, 5);
	const store = createLibraryState(backend);
	await store.upgrade();
	await store.remove();
	assert.deepEqual([...backend.data.keys()], []);
});

test('a failed upgrade at any step leaves layout 10 whole and working, and the next try succeeds', async () => {
	const probe = await storedInLayout10(120, 120);
	const dry = createLibraryState(probe.backend);
	probe.backend.calls = 0;
	await dry.upgrade();
	const steps = probe.backend.calls;
	assert.ok(steps > 5);

	for (let at = 1; at <= steps; at += 1) {
		const {backend, base} = await storedInLayout10(120, 120);
		const store = createLibraryState(backend);
		const before = structuredClone(stateOf(backend));
		const keysBefore = new Set(backend.data.keys());
		backend.calls = 0;
		backend.failAt = at;
		backend.tear = at % 2 === 0;
		let failed = false;
		try {
			await store.upgrade();
		} catch {
			failed = true;
		}

		backend.failAt = undefined;
		if (!failed) {
			assert.equal(stateOf(backend).schemaVersion, 11, `step ${at}`);
			assert.deepEqual(await store.read(), expected(base), `step ${at}`);
			assert.deepEqual(await store.verify(), [], `step ${at}`);
			continue;
		}

		const root = stateOf(backend);
		if (root.schemaVersion === 11) {
			assert.deepEqual(await store.read(), expected(base), `step ${at}`);
			continue;
		}

		assert.deepEqual(root, before, `step ${at}: the index is untouched`);
		assert.deepEqual(await store.read(), expected(base), `step ${at}`);
		assert.deepEqual(await store.verify(), [], `step ${at}`);
		assert.equal(
			keysWith(backend, SESSION_PAGE_KEY_PREFIX).length,
			0,
			`step ${at}`,
		);
		assert.equal(
			keysWith(backend, BOOKMARK_CHUNK_KEY_PREFIX).length,
			0,
			`step ${at}`,
		);
		for (const key of backend.data.keys()) {
			assert.ok(
				keysBefore.has(key) || key === MIGRATION_KEY || key === PREUPGRADE_KEY,
				`step ${at}: stray key ${key}`,
			);
		}

		const edited = structuredClone(base);
		(edited.bookmarks as Raw[])[3].title = 'Still works';
		await store.write(edited);
		assert.equal(stateOf(backend).schemaVersion, 10);
		assert.deepEqual(await store.read(), expected(edited), `step ${at}`);
		await store.upgrade();
		assert.equal(stateOf(backend).schemaVersion, 11, `step ${at}`);
		assert.deepEqual(await store.read(), expected(edited), `step ${at}`);
		assert.equal(backend.data.has(MIGRATION_KEY), false, `step ${at}`);
	}
});

test('an upgrade whose chunk write is refused, or whose final switch is refused, reports the error and leaves layout 10', async () => {
	for (const refuse of [
		(key: string) => key.startsWith(BOOKMARK_CHUNK_KEY_PREFIX),
		(key: string) => key.startsWith(SESSION_PAGE_KEY_PREFIX),
	]) {
		const {backend, base} = await storedInLayout10(30, 250);
		const store = createLibraryState(backend);
		const before = structuredClone(stateOf(backend));
		backend.rejectKey = refuse;
		await assert.rejects(store.upgrade(), /quota/);
		backend.rejectKey = undefined;
		assert.deepEqual(stateOf(backend), before);
		const marker = backend.data.get(MIGRATION_KEY) as Raw;
		assert.match(String(marker.lastError), /quota/);
		assert.deepEqual(await store.read(), expected(base));
	}

	const {backend, base} = await storedInLayout10(30, 250);
	const store = createLibraryState(backend);
	const before = structuredClone(stateOf(backend));
	let refusing = false;
	backend.rejectKey = (key) => key === STATE_KEY && refusing;
	backend.onGet = async (keys) => {
		refusing = keys.some((key) => key.startsWith(BOOKMARK_CHUNK_KEY_PREFIX));
	};

	await assert.rejects(store.upgrade(), /quota/);
	backend.rejectKey = undefined;
	assert.deepEqual(stateOf(backend), before);
	assert.equal(keysWith(backend, BOOKMARK_CHUNK_KEY_PREFIX).length, 0);
	assert.deepEqual(await store.read(), expected(base));
});

test('an upgrade refuses a bookmarks record that does not match its index and changes nothing', async () => {
	const {backend} = await storedInLayout10(5, 5);
	const before = structuredClone(stateOf(backend));
	backend.data.set(`${BOOKMARKS_KEY_PREFIX}1`, {items: []});
	const store = createLibraryState(backend);
	await assert.rejects(store.upgrade(), /does not match the index/);
	assert.deepEqual(stateOf(backend), before);
});

test('a build that only knows layout 10 refuses a layout 11 library and removes nothing', async () => {
	const backend = new MemoryBackend();
	const current = createLibraryState(backend);
	const base = normalize(library(150, 150));
	await current.write(base);
	const snapshot = backend.snapshot();

	const old = layout10(backend);
	assert.deepEqual(await old.read(), stateOf(backend));
	assert.equal((await old.read())!.schemaVersion, 11);
	const meta = await old.readMeta();
	assert.equal(meta.schemaVersion, 11);
	assert.equal(meta.upgradable, false);
	await assert.rejects(old.write(base), /saved by a newer version/);
	assert.deepEqual(await old.migrate(normalize), {status: 'newer'});
	assert.deepEqual(await old.upgrade(), {status: 'newer'});
	assert.equal(await old.beginCheckpoint(), null);
	assert.equal(await old.fingerprint(), undefined);
	assert.equal(await old.pruneRecoveryCopy(), false);
	await old.dropGarbage();
	assert.deepEqual(backend.snapshot(), snapshot);

	assert.deepEqual(await current.read(), expected(base));
});

test('a write to a layout 10 library stays layout 10 until it is upgraded', async () => {
	const {backend, base} = await storedInLayout10(20, 20);
	const store = createLibraryState(backend);
	const edited = structuredClone(base);
	(edited.bookmarks as Raw[])[2].title = 'Edited';
	await store.write(edited);
	assert.equal(stateOf(backend).schemaVersion, 10);
	assert.deepEqual(await store.read(), expected(edited));
	assert.equal(keysWith(backend, BOOKMARK_CHUNK_KEY_PREFIX).length, 0);
	assert.equal((await store.readMeta()).upgradable, true);
});

test('the old single entry migrates straight into layout 11', async () => {
	const backend = new MemoryBackend({[STATE_KEY]: library(130, 130)});
	const store = createLibraryState(backend);
	const outcome = await store.migrate(normalize);
	assert.equal(outcome.status, 'migrated');
	assert.equal(stateOf(backend).schemaVersion, 11);
	assert.deepEqual(await store.read(), expected(normalize(library(130, 130))));
	assert.deepEqual(await store.verify(), []);
});

test('a commit that crashes at any step leaves the previous library or the new one, never a mix', async () => {
	const probe = new MemoryBackend();
	const probeStore = createLibraryState(probe);
	const base = normalize(library(150, 250));
	await probeStore.write(base);
	const edited = structuredClone(base);
	(edited.bookmarks as Raw[])[120].title = 'Edited';
	(edited.groups as Raw[])[130].name = 'Edited';
	probe.calls = 0;
	await probeStore.write(edited);
	const steps = probe.calls;

	for (let at = 1; at <= steps; at += 1) {
		const backend = new MemoryBackend();
		const store = createLibraryState(backend);
		await store.write(base);
		backend.calls = 0;
		backend.failAt = at;
		backend.tear = true;
		await store.write(edited).catch(() => undefined);
		backend.failAt = undefined;
		const read = await store.read();
		const isBase = isDeepStrictEqual(read, expected(base));
		const isEdited = isDeepStrictEqual(read, expected(edited));
		assert.ok(isBase || isEdited, `step ${at}`);
		assert.deepEqual(await store.verify(), [], `step ${at}`);
	}
});

test('a missing page or chunk is reported, not read as an empty library', async () => {
	for (const prefix of [SESSION_PAGE_KEY_PREFIX, BOOKMARK_CHUNK_KEY_PREFIX]) {
		const backend = new MemoryBackend();
		const store = createLibraryState(backend);
		await store.write(normalize(library(150, 150)));
		const [key] = keysWith(backend, prefix);
		backend.data.delete(key);
		await assert.rejects(store.read(), LibraryDamagedError);
		const problems = await store.verify();
		assert.ok(problems.length > 0);
		await store.remove();
	}
});

test('stamps in the bookmarks record follow their bookmarks through the upgrade and through moves between chunks', async () => {
	const {backend, base} = await storedInLayout10(2, 250);
	const root = stateOf(backend);
	const key = `${BOOKMARKS_KEY_PREFIX}1`;
	const record = backend.data.get(key) as Raw;
	const stamps = {
		b0: {h: '0001.0000.a', d: 'device-a'},
		b150: {h: '0002.0000.a', d: 'device-a', o: 'm'},
		gone: {h: '0003.0000.a', d: 'device-a'},
	};
	backend.data.set(key, {...record, $sync: {items: stamps}});
	backend.data.set(STATE_KEY, {
		...root,
		bookmarks: {...(root.bookmarks as Raw), sync: true},
	});
	const store = createLibraryState(backend);
	await store.upgrade();
	const chunks = (stateOf(backend).bookmarkChunks as Raw[]).map((chunk) => ({
		sync: chunk.sync,
		value: backend.data.get(chunk.key as string) as Raw,
	}));
	assert.equal(chunks[0].sync, true);
	assert.deepEqual((chunks[0].value.$sync as Raw).items, {b0: stamps.b0});
	assert.equal(chunks[1].sync, true);
	assert.deepEqual((chunks[1].value.$sync as Raw).items, {b150: stamps.b150});
	assert.equal(chunks[2].sync, undefined);

	const moved = structuredClone(base);
	const bookmarks = moved.bookmarks as Raw[];
	bookmarks.unshift(...bookmarks.splice(150, 1));
	await store.write(moved);
	const after = (stateOf(backend).bookmarkChunks as Raw[]).flatMap((chunk) => {
		const value = backend.data.get(chunk.key as string) as Raw;
		return Object.entries(((value.$sync as Raw)?.items ?? {}) as Raw);
	});
	assert.deepEqual(Object.fromEntries(after), {
		b0: stamps.b0,
		b150: stamps.b150,
	});
	assert.deepEqual(await store.read(), expected(moved));
});

test('session entries keep their stamps through the upgrade and an edit', async () => {
	const {backend, base} = await storedInLayout10(120, 3);
	const root = stateOf(backend);
	const sessions = (root.sessions as Raw[]).map((entry, at) =>
		at === 5 ? {...entry, sync: {h: '0001.0000.a', d: 'device-a'}} : entry,
	);
	backend.data.set(STATE_KEY, {...root, sessions});
	const store = createLibraryState(backend);
	await store.upgrade();
	const edited = structuredClone(base);
	(edited.groups as Raw[])[100].name = 'Edited';
	await store.write(edited);
	const pageKeys = (stateOf(backend).sessionPages as Raw[]).map(
		(page) => page.key as string,
	);
	const entries = pageKeys.flatMap(
		(key) => (backend.data.get(key) as {items: Raw[]}).items,
	);
	assert.deepEqual(entries[5].sync, {h: '0001.0000.a', d: 'device-a'});
	assert.equal(entries.length, 120);
});

test('a session and bookmark inserted at the front, removed, and reordered round trip through the pages', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	let current = normalize(library(230, 230));
	await store.write(current);
	const steps: Array<(raw: Raw) => void> = [
		(raw) => {
			(raw.groups as Raw[]).unshift(session('front', 2));
		},
		(raw) => {
			(raw.bookmarks as Raw[]).unshift({
				id: 'front',
				columnId: 'c1',
				url: 'https://front.example/',
			});
		},
		(raw) => (raw.groups as Raw[]).splice(50, 120),
		(raw) => (raw.bookmarks as Raw[]).splice(10, 200),
		(raw) => {
			raw.groups = (raw.groups as Raw[]).toReversed();
		},
		(raw) => {
			raw.bookmarks = (raw.bookmarks as Raw[]).toReversed();
		},
		(raw) => {
			raw.groups = [];
			raw.bookmarks = [];
		},
	];
	for (const step of steps) {
		current = structuredClone(current);
		step(current);
		await store.write(current);
		assert.deepEqual(await store.read(), expected(current));
		assert.deepEqual(await store.verify(), []);
	}
});

test('a page whose content is not what the root hashed is reported, not cached', async () => {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	await store.write(normalize(library(150, 0)));
	const [key] = keysWith(backend, SESSION_PAGE_KEY_PREFIX);
	const page = backend.data.get(key) as {items: Raw[]};
	backend.data.set(key, {
		items: page.items.map((item) => ({...item, name: 'x'})),
	});
	await assert.rejects(store.read(), LibraryDamagedError);
	backend.data.set(key, page);
	assert.equal(((await store.read())!.groups as unknown[]).length, 150);
});

test('a string undoDelta is not an Undo entry', () => {
	assert.equal(isUndoDelta({undoDelta: '3', index: {}, records: {}}), false);
	assert.equal(isUndoDelta({undoDelta: 3, index: {}, records: {}}), true);
});

test('the kept copies stay listed after the week until pruning removes them', async () => {
	let time = 1_000_000;
	const {backend, base} = await storedInLayout10(5, 5);
	const store = createLibraryState(backend, {now: () => time});
	await store.upgrade();
	time += PREMIGRATION_KEEP_MS + 1;
	await store.write({...base, updatedAt: 77});
	assert.ok(stateOf(backend).migratedFrom);
	assert.equal(await store.pruneRecoveryCopy(), true);
	assert.equal(backend.data.has(PREUPGRADE_KEY), false);
});

test('an upgrade whose root write succeeds but whose confirming read fails keeps every page and chunk', async () => {
	const {backend, base} = await storedInLayout10(120, 120);
	const store = createLibraryState(backend);
	const set = backend.set.bind(backend);
	let switched = false;
	backend.set = async (values) => {
		await set(values);
		if (!Object.keys(values).includes(STATE_KEY)) {
			return;
		}

		switched = true;
		throw new Error('answer lost');
	};

	backend.onGet = async () => {
		if (switched) {
			throw new Error('read failed');
		}
	};

	await assert.rejects(store.upgrade(), /answer lost/);
	backend.onGet = undefined;
	assert.equal(stateOf(backend).schemaVersion, 11);
	assert.deepEqual(await store.read(), expected(base));
	assert.deepEqual(await store.verify(), []);
});
