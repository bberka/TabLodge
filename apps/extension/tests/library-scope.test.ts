import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	BOOKMARK_CHUNK_KEY_PREFIX,
	createLibraryState,
	SESSION_KEY_PREFIX,
	SESSION_PAGE_KEY_PREFIX,
	STATE_KEY,
} from '../src/shared/library-state';
import {canonicalJson, hashText} from '../src/shared/library-values';
import {library, MemoryBackend, normalize, session} from './library-memory';

type Raw = Record<string, unknown>;

const large = (sessions: number, bookmarks: number): Raw => ({
	...library(0, bookmarks),
	groups: Array.from({length: sessions}, (_, index) => session(`s${index}`, 3)),
});

async function stored(sessions: number, bookmarks: number) {
	const backend = new MemoryBackend();
	const store = createLibraryState(backend);
	const base: Raw = {
		...normalize(large(sessions, bookmarks)),
		schemaVersion: 10,
	};
	await store.write(base);
	const reads: string[] = [];
	backend.onGet = async (keys) => {
		reads.push(...keys);
	};

	const recordReads = (prefix: string) =>
		reads.filter((key) => key.startsWith(prefix));
	backend.sets.length = 0;
	return {backend, store, base, reads, recordReads};
}

const items = (raw: Raw, field: 'groups' | 'bookmarks') => raw[field] as Raw[];

function stampsIn(backend: MemoryBackend): Raw {
	const root = backend.data.get(STATE_KEY) as {
		bookmarkChunks: Array<{key: string}>;
	};
	return Object.fromEntries(
		root.bookmarkChunks.flatMap(({key}) => {
			const chunk = backend.data.get(key) as {$sync?: {items: Raw}};
			return Object.entries(chunk.$sync?.items ?? {});
		}),
	);
}

test('a session edit reads one session, one index page, and no bookmarks', async () => {
	const {store, base, recordReads} = await stored(450, 450);
	await (await store.openScope({sessions: ['s7']}))!.commit(
		(await store.openScope({sessions: ['s7']}))!.raw,
	);
	const opened = (await store.openScope({sessions: ['s321']}))!;
	assert.deepEqual(items(opened.raw, 'groups'), [items(base, 'groups')[321]]);
	assert.deepEqual(items(opened.raw, 'bookmarks'), []);
	const renamed = {...items(opened.raw, 'groups')[0], name: 'Renamed'};
	await opened.commit({...opened.raw, groups: [renamed], updatedAt: 9000});

	assert.equal(new Set(recordReads(SESSION_KEY_PREFIX)).size, 2);
	assert.deepEqual(recordReads(BOOKMARK_CHUNK_KEY_PREFIX), []);
	const expected = structuredClone(base);
	items(expected, 'groups')[321] = renamed;
	expected.updatedAt = 9000;
	assert.deepEqual(await store.read(), expected);
	assert.deepEqual(await store.verify(), []);
});

test('a session edit writes its record, its index page, and the root only', async () => {
	const {backend, store} = await stored(450, 450);
	const opened = (await store.openScope({sessions: ['s321']}))!;
	await opened.commit({
		...opened.raw,
		groups: [{...items(opened.raw, 'groups')[0], name: 'Renamed'}],
	});
	assert.deepEqual(
		backend.sets.flatMap((set) => set.keys),
		[`${SESSION_KEY_PREFIX}s321.2`, `${SESSION_PAGE_KEY_PREFIX}3.2`, STATE_KEY],
	);
});

test('a scoped session that is dropped leaves the library, and the rest stay', async () => {
	const {store, base} = await stored(250, 0);
	const opened = (await store.openScope({sessions: ['s5']}))!;
	await opened.commit({...opened.raw, groups: [], updatedAt: 9000});
	const read = (await store.read())!;
	assert.deepEqual(
		items(read, 'groups'),
		items(base, 'groups').filter((group) => group.id !== 's5'),
	);
	assert.deepEqual(await store.verify(), []);
});

test('a bookmark edit reads its own chunk and no session', async () => {
	const {store, base, reads, recordReads} = await stored(30, 5000);
	const first = (await store.openScope({bookmarks: ['b4321']}))!;
	await first.commit({
		...first.raw,
		bookmarks: [{...items(first.raw, 'bookmarks')[0], title: 'Once'}],
	});
	reads.length = 0;
	const opened = (await store.openScope({bookmarks: ['b4321']}))!;
	const renamed = {...items(opened.raw, 'bookmarks')[0], title: 'Twice'};
	await opened.commit({...opened.raw, bookmarks: [renamed], updatedAt: 9000});

	assert.equal(new Set(recordReads(BOOKMARK_CHUNK_KEY_PREFIX)).size, 1);
	assert.deepEqual(recordReads(SESSION_KEY_PREFIX), []);
	const expected = structuredClone(base);
	items(expected, 'bookmarks')[4321] = renamed;
	expected.updatedAt = 9000;
	assert.deepEqual(await store.read(), expected);
	assert.deepEqual(await store.verify(), []);
});

test('an edit of the whole bookmark list reads no session and can add, move, and remove', async () => {
	const {store, base, recordReads} = await stored(30, 350);
	const opened = (await store.openScope({bookmarks: 'all'}))!;
	const bookmarks = items(opened.raw, 'bookmarks').filter(
		(item) => item.id !== 'b3',
	);
	bookmarks.unshift(bookmarks.pop()!, {
		id: 'new',
		columnId: 'c1',
		url: 'https://example.com/new',
		title: 'New',
	});
	await opened.commit({...opened.raw, bookmarks, updatedAt: 9000});
	assert.deepEqual(recordReads(SESSION_KEY_PREFIX), []);
	assert.deepEqual(await store.read(), {
		...base,
		bookmarks,
		updatedAt: 9000,
	});
	assert.deepEqual(await store.verify(), []);
});

test('an edit of single bookmarks cannot add or remove one, and changes nothing', async () => {
	const {backend, store} = await stored(2, 250);
	const opened = (await store.openScope({bookmarks: ['b1']}))!;
	const before = backend.snapshot();
	await assert.rejects(
		opened.commit({...opened.raw, bookmarks: []}),
		/cannot add, remove, or move/,
	);
	assert.deepEqual(backend.snapshot(), before);
});

test('a scoped commit is refused when the library changed since it was opened', async () => {
	const {store, base} = await stored(3, 3);
	const opened = (await store.openScope({sessions: ['s1']}))!;
	await store.write({...base, updatedAt: 7000});
	await assert.rejects(opened.commit(opened.raw), /changed while/);
	assert.deepEqual(await store.read(), {...base, updatedAt: 7000});
});

test('bookmark stamps stay with their bookmarks through scoped and whole-list edits', async () => {
	const {backend, store} = await stored(1, 250);
	const root = backend.data.get(STATE_KEY) as {
		bookmarkChunks: Array<{key: string; sync?: true}>;
	};
	for (const chunk of root.bookmarkChunks) {
		const value = backend.data.get(chunk.key) as {items: Raw[]};
		backend.data.set(chunk.key, {
			...value,
			$sync: {
				items: Object.fromEntries(
					value.items.map((item) => [
						String(item.id),
						{h: String(item.id), d: 'device'},
					]),
				),
			},
		});
		chunk.sync = true;
	}

	const stamps = stampsIn(backend);
	assert.equal(Object.keys(stamps).length, 250);

	const single = (await store.openScope({bookmarks: ['b120']}))!;
	await single.commit({
		...single.raw,
		bookmarks: [{...items(single.raw, 'bookmarks')[0], title: 'Renamed'}],
	});
	assert.deepEqual(stampsIn(backend), stamps);

	const all = (await store.openScope({bookmarks: 'all'}))!;
	const bookmarks = items(all.raw, 'bookmarks');
	bookmarks.push(bookmarks.shift()!);
	await all.commit({...all.raw, bookmarks});
	assert.deepEqual(stampsIn(backend), stamps);
});

test('a scoped edit can be undone from its checkpoint', async () => {
	const {store, base} = await stored(150, 150);
	const checkpoint = (await store.beginCheckpoint())!;
	const opened = (await store.openScope({
		sessions: ['s9'],
		bookmarks: ['b140'],
	}))!;
	await opened.commit({
		...opened.raw,
		groups: [{...items(opened.raw, 'groups')[0], name: 'Renamed'}],
		bookmarks: [{...items(opened.raw, 'bookmarks')[0], title: 'Renamed'}],
		updatedAt: 9000,
	});
	await store.restoreCheckpoint((await store.endCheckpoint(checkpoint))!);
	assert.deepEqual(await store.read(), base);
});

test('a layout 10 library and a damaged record fall back to the whole read', async () => {
	const backend = new MemoryBackend();
	const old = createLibraryState(backend, {layoutVersion: 10});
	await old.write(normalize(large(3, 3)));
	assert.equal(await old.openScope({sessions: ['s1']}), null);

	const current = await stored(3, 3);
	current.backend.data.delete(`${SESSION_KEY_PREFIX}s1.1`);
	assert.equal(await current.store.openScope({sessions: ['s1']}), null);
	assert.ok(await current.store.openScope({sessions: ['s2']}));
});

test('removing the only stamped tab of a session leaves an index page that still checks out', async () => {
	const {backend, store} = await stored(3, 0);
	const root = backend.data.get(STATE_KEY) as {
		sessionPages: Array<{key: string; hash: string}>;
	};
	const [page] = root.sessionPages;
	const {items: entries} = backend.data.get(page.key) as {items: Raw[]};
	const flagged = entries.map((entry) =>
		entry.id === 's1' ? {...entry, tabSync: true} : entry,
	);
	backend.data.set(page.key, {items: flagged});
	page.hash = hashText(canonicalJson(flagged));
	const key = `${SESSION_KEY_PREFIX}s1.1`;
	backend.data.set(key, {
		...(backend.data.get(key) as Raw),
		$sync: {tabs: {'s1-t0': {h: 'stamp', d: 'device'}}},
	});

	const opened = (await store.openScope({sessions: ['s1']}))!;
	const [edited] = items(opened.raw, 'groups');
	const tabs = (edited.tabs as Raw[]).filter((tab) => tab.id !== 's1-t0');
	await opened.commit({...opened.raw, groups: [{...edited, tabs}]});

	assert.deepEqual(await store.verify(), []);
	assert.deepEqual(
		await createLibraryState(backend).read(),
		await store.read(),
	);
});

test('first scoped session edit after a cold start reads only the index pages it needs', async () => {
	const {backend, base, reads, recordReads} = await stored(1000, 100);
	const restarted = createLibraryState(backend);
	reads.length = 0;

	const checkpoint = (await restarted.beginCheckpoint())!;
	const opened = (await restarted.openScope({sessions: ['s0']}))!;
	const renamed = {...items(opened.raw, 'groups')[0], name: 'Cold rename'};
	await opened.commit({...opened.raw, groups: [renamed], updatedAt: 9100});
	const delta = (await restarted.endCheckpoint(checkpoint))!;

	assert.deepEqual(
		[...new Set(recordReads(SESSION_PAGE_KEY_PREFIX))],
		[`${SESSION_PAGE_KEY_PREFIX}0.1`],
	);
	assert.deepEqual(
		[...new Set(recordReads(SESSION_KEY_PREFIX))],
		[`${SESSION_KEY_PREFIX}s0.1`],
	);
	assert.deepEqual(recordReads(BOOKMARK_CHUNK_KEY_PREFIX), []);

	const expected = structuredClone(base);
	items(expected, 'groups')[0] = renamed;
	expected.updatedAt = 9100;
	assert.deepEqual(await restarted.read(), expected);
	assert.deepEqual(await restarted.verify(), []);

	await restarted.restoreCheckpoint(delta);
	assert.deepEqual(await restarted.read(), base);
	assert.deepEqual(await restarted.verify(), []);
});

test('cold-start scoped edit of a later session stops scanning once found, and non-session edits read no session pages', async () => {
	const {backend, base, reads, recordReads} = await stored(1000, 150);

	const forFolder = createLibraryState(backend);
	reads.length = 0;
	const folderCheckpoint = (await forFolder.beginCheckpoint())!;
	const folderScope = (await forFolder.openScope({}))!;
	await folderScope.commit({...folderScope.raw, updatedAt: 9200});
	await forFolder.endCheckpoint(folderCheckpoint);
	assert.deepEqual(recordReads(SESSION_PAGE_KEY_PREFIX), []);

	const forBookmark = createLibraryState(backend);
	reads.length = 0;
	const bookmarkScope = (await forBookmark.openScope({bookmarks: ['b5']}))!;
	await bookmarkScope.commit({
		...bookmarkScope.raw,
		bookmarks: [{...items(bookmarkScope.raw, 'bookmarks')[0], title: 'Cold'}],
	});
	assert.deepEqual(recordReads(SESSION_PAGE_KEY_PREFIX), []);

	const forLaterSession = createLibraryState(backend);
	reads.length = 0;
	const sessionCheckpoint = (await forLaterSession.beginCheckpoint())!;
	const sessionScope = (await forLaterSession.openScope({sessions: ['s321']}))!;
	await sessionScope.commit({
		...sessionScope.raw,
		groups: [{...items(sessionScope.raw, 'groups')[0], name: 'Page 3'}],
	});
	const delta = (await forLaterSession.endCheckpoint(sessionCheckpoint))!;
	const pagesRead = new Set(recordReads(SESSION_PAGE_KEY_PREFIX));
	assert.ok(pagesRead.size < 10, `read ${pagesRead.size} of 10 pages`);
	assert.ok(pagesRead.has(`${SESSION_PAGE_KEY_PREFIX}3.1`));

	await forLaterSession.restoreCheckpoint(delta);
	const restored = (await forLaterSession.read())!;
	assert.equal(
		items(restored, 'groups')[321].name,
		items(base, 'groups')[321].name,
	);
	assert.deepEqual(await forLaterSession.verify(), []);
});

test('a cold-start layout 11 checkpoint across multiple commits keeps only starting records', async () => {
	const {backend, base} = await stored(250, 0);
	const restarted = createLibraryState(backend);
	const checkpoint = (await restarted.beginCheckpoint())!;

	const first = (await restarted.openScope({sessions: ['s1']}))!;
	await first.commit({
		...first.raw,
		groups: [{...items(first.raw, 'groups')[0], name: 'First'}],
	});
	const second = (await restarted.openScope({sessions: ['s1']}))!;
	await second.commit({
		...second.raw,
		groups: [{...items(second.raw, 'groups')[0], name: 'Second'}],
	});
	const delta = (await restarted.endCheckpoint(checkpoint))!;

	assert.deepEqual(Object.keys(delta.records).toSorted(), [
		`${SESSION_KEY_PREFIX}s1.1`,
		`${SESSION_PAGE_KEY_PREFIX}0.1`,
	]);
	await restarted.restoreCheckpoint(delta);
	assert.deepEqual(await restarted.read(), base);
	assert.deepEqual(await restarted.verify(), []);
});
