import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import type {Settings, Store} from '../src/shared/types';
import {ChangeLog} from '../src/shared/sync/change-log';
import type {SyncChange} from '../src/shared/sync/changes';
import {
	capture,
	finishResync,
	inOrder,
	newSyncState,
	orderList,
	outgoing,
	receive,
	settle,
	startResync,
	type SyncState,
} from '../src/shared/sync/engine';
import {
	assemble,
	splitLibrary,
	trashOf,
} from '../src/shared/sync/library-records';
import {TRASH_SYNC_MAX_CHARS, type TrashEntry} from '../src/shared/trash';
import {normalizeBookmarkColumn} from '../src/shared/library-normalize';
import {sourceColumnSite} from '../src/shared/source-columns';

const T0 = Date.UTC(2026, 10, 1);
const DAY = 24 * 60 * 60 * 1000;

const emptyStore = (): Store => ({
	schemaVersion: 10,
	groups: [],
	folders: [{id: 'unfiled', name: 'Unsorted', createdAt: 0, isDefault: true}],
	bookmarkColumns: [],
	bookmarks: [],
	settings: {sessionSort: 'manual', closeOnSave: true} as unknown as Settings,
	updatedAt: 0,
});

const tab = (id: string, url = `https://example.com/${id}`) => ({
	id,
	title: id,
	url,
	notes: '',
	pinned: false,
	nativeGroup: null,
	savedAt: 0,
	originalIndex: 0,
});

const session = (
	id: string,
	tabs: string[],
	extra: Record<string, unknown> = {},
) =>
	({
		id,
		name: id,
		folderId: 'unfiled',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		sourceWindowName: '',
		sourceWindowId: null,
		tabs: tabs.map((tabId) => tab(tabId)),
		...extra,
	}) as Store['groups'][number];

type Device = {store: Store; state: SyncState};

const device = (id: string, store = emptyStore()): Device => ({
	store,
	state: newSyncState(id),
});

/**
One sync round the way the worker runs it: capture, pull, push, then rewrite the library if needed.
*/
function sync(target: Device, log: ChangeLog, now: number) {
	let records = splitLibrary(target.store);
	let {state} = target;
	let changed = false;
	if (state.joined) {
		state = capture(state, records, now);
	}

	for (;;) {
		const response = log.pull(state.cursor, 3, state.purged);
		if (response.resync) {
			state = startResync(state);
			continue;
		}

		const result = receive(state, records, response, now);
		({state, records} = result);
		changed ||= result.changed;
		if (!response.more) {
			break;
		}
	}

	const resynced = finishResync(state, records);
	({state, records} = resynced);
	changed ||= resynced.changed;
	if (!state.joined) {
		state = {...capture(state, records, now), joined: true};
	}

	for (;;) {
		const sent = outgoing(state, records, 2);
		if (sent.length === 0) {
			break;
		}

		({state} = settle(state, sent, log.push(sent, now)));
	}

	target.state = state;
	if (changed) {
		target.store = assemble(inOrder(state, records), target.store);
	}
}

const sessionNames = (store: Store) => store.groups.map((group) => group.name);
const tabIds = (store: Store, sessionId: string) =>
	store.groups
		.find((group) => group.id === sessionId)
		?.tabs.map((saved) => saved.id);

test('order keys keep the siblings that did not move', () => {
	const keys = orderList(['a', 'b', 'c', 'd'], () => undefined);
	const known = new Map(
		['a', 'b', 'c', 'd'].map((key, index) => [key, keys[index]]),
	);
	const moved = orderList(['b', 'c', 'a', 'd', 'e'], (key) => known.get(key));
	assert.equal(moved[0], known.get('b'));
	assert.equal(moved[1], known.get('c'));
	assert.equal(moved[3], known.get('d'));
	assert.ok(moved[1] < moved[2]);
	assert.ok(moved[2] < moved[3]);
	assert.ok(moved[3] < moved[4]);
});

test('a session saved on one device appears on the other, in order and with its tabs', () => {
	const log = new ChangeLog();
	const a = device('a');
	const b = device('b');
	sync(a, log, T0);
	sync(b, log, T0);

	a.store = {
		...a.store,
		groups: [session('work', ['t1', 't2']), session('home', ['t3'])],
	};
	sync(a, log, T0 + 1000);
	sync(b, log, T0 + 2000);
	assert.deepEqual(sessionNames(b.store), ['work', 'home']);
	assert.deepEqual(tabIds(b.store, 'work'), ['t1', 't2']);

	// A move and a delete on b travel back as single record changes.
	const [work, home] = b.store.groups;
	b.store = {...b.store, groups: [home, {...work, tabs: [work.tabs[1]]}]};
	sync(b, log, T0 + 3000);
	const pushed = log.pull(0, 100);
	assert.ok(!pushed.resync);
	sync(a, log, T0 + 4000);
	assert.deepEqual(sessionNames(a.store), ['home', 'work']);
	assert.deepEqual(tabIds(a.store, 'work'), ['t2']);
});

test('fields that belong to one device stay on it', () => {
	const log = new ChangeLog();
	const a = device('a', {
		...emptyStore(),
		groups: [session('work', ['t1'], {sourceWindowId: 7, lastOpenedAt: 5})],
	});
	const b = device('b', {
		...emptyStore(),
		groups: [session('work', ['t1'], {sourceWindowId: 99, lastOpenedAt: 9})],
	});
	sync(a, log, T0);
	sync(b, log, T0);
	a.store = {
		...a.store,
		groups: [{...a.store.groups[0], name: 'Work renamed'}],
	};
	sync(a, log, T0 + 1000);
	sync(b, log, T0 + 2000);
	assert.equal(b.store.groups[0].name, 'Work renamed');
	assert.equal(b.store.groups[0].sourceWindowId, 99);
	assert.equal(b.store.groups[0].lastOpenedAt, 9);
});

test('only portable settings travel', () => {
	const log = new ChangeLog();
	const a = device('a');
	const b = device('b');
	sync(a, log, T0);
	sync(b, log, T0);
	a.store = {
		...a.store,
		settings: {
			...a.store.settings,
			sessionSort: 'name',
			closeOnSave: false,
			snapshotKeep: 50,
		},
	};
	sync(a, log, T0 + 1000);
	sync(b, log, T0 + 2000);
	assert.equal(b.store.settings.sessionSort, 'name');
	assert.equal(b.store.settings.closeOnSave, false);
	assert.notEqual(b.store.settings.snapshotKeep, 50);
});

test('a new device takes the server copy of shared records and adds its own', () => {
	const log = new ChangeLog();
	const a = device('a', {...emptyStore(), groups: [session('work', ['t1'])]});
	sync(a, log, T0);
	a.store = {
		...a.store,
		groups: [{...a.store.groups[0], name: 'Work (newer)'}],
	};
	sync(a, log, T0 + 1000);

	// B restored an old backup holding the same session, and has one of its own.
	const b = device('b', {
		...emptyStore(),
		groups: [session('work', ['t1']), session('mine', [])],
	});
	sync(b, log, T0 + 5000);
	assert.deepEqual(sessionNames(b.store).toSorted(), ['Work (newer)', 'mine']);
	sync(a, log, T0 + 6000);
	assert.deepEqual(sessionNames(a.store).toSorted(), ['Work (newer)', 'mine']);
});

test('an edit made while a push is in flight stays queued', () => {
	const a = device('a', {...emptyStore(), groups: [session('work', [])]});
	let state = {...capture(a.state, splitLibrary(a.store), T0), joined: true};
	const records = splitLibrary(a.store);
	const sent = outgoing(state, records, 100);
	a.store = {...a.store, groups: [{...a.store.groups[0], name: 'edited'}]};
	state = capture(state, splitLibrary(a.store), T0 + 1);
	({state} = settle(
		state,
		sent,
		sent.map(() => 'applied'),
	));
	assert.deepEqual(state.outbox, ['session:work']);
});

test('a device back after the tombstones were purged drops what was deleted meanwhile', () => {
	const log = new ChangeLog();
	const a = device('a', {
		...emptyStore(),
		groups: [session('old', ['t1']), session('kept', [])],
	});
	const b = device('b');
	sync(a, log, T0);
	sync(b, log, T0);
	assert.deepEqual(sessionNames(b.store), ['old', 'kept']);

	a.store = {...a.store, groups: [a.store.groups[1]]};
	sync(a, log, T0 + DAY);
	log.purge(T0 + 100 * DAY);

	// B was offline the whole time, and saved a new session meanwhile.
	b.store = {...b.store, groups: [...b.store.groups, session('offline', [])]};
	sync(b, log, T0 + 101 * DAY);
	assert.deepEqual(sessionNames(b.store), ['kept', 'offline']);
	sync(a, log, T0 + 102 * DAY);
	assert.deepEqual(sessionNames(a.store), ['kept', 'offline']);
});

test('syncing an unchanged library sends nothing', () => {
	const log = new ChangeLog();
	const a = device('a', {...emptyStore(), groups: [session('work', ['t1'])]});
	sync(a, log, T0);
	const {cursor} = log;
	sync(a, log, T0 + 1000);
	sync(a, log, T0 + 2000);
	assert.equal(log.cursor, cursor);
	assert.deepEqual(a.state.outbox, []);
});

test('a change waits for the record it belongs in, and is released if that record is deleted', () => {
	const page = (changes: SyncChange[], cursor: number) => ({
		changes,
		cursor,
		purged: 0,
	});
	const h = (offset: number) =>
		(T0 + offset).toString(36).padStart(11, '0') + '00000';
	let state: SyncState = {...newSyncState('b'), joined: true};
	let records = splitLibrary(emptyStore());

	const link = {
		kind: 'bookmark',
		id: 'link',
		h: h(1),
		d: 'a',
		o: 'a0',
		value: {
			id: 'link',
			title: 'Link',
			url: 'https://example.com/',
			columnId: 'reading',
			createdAt: 0,
			updatedAt: 0,
		},
	} as const;
	({state, records} = receive(state, records, page([link], 1), T0));
	assert.equal(records.has('bookmark:link'), false);
	assert.equal(state.held?.length, 1);
	// Nothing the device sends treats the waiting bookmark as deleted.
	assert.ok(!capture(state, records, T0).outbox.includes('bookmark:link'));

	const column = {
		kind: 'column',
		id: 'reading',
		h: h(2),
		d: 'a',
		o: 'a0',
		value: {id: 'reading', name: 'Reading', createdAt: 0, isDefault: false},
	} as const;
	({state, records} = receive(state, records, page([column], 2), T0));
	assert.equal(records.has('bookmark:link'), true);
	assert.equal(state.held, undefined);

	const orphan = {
		kind: 'tab',
		id: 't',
		parentId: 'gone',
		h: h(3),
		d: 'a',
		o: 'a0',
		value: tab('t'),
	} as const;
	({state, records} = receive(state, records, page([orphan], 3), T0));
	assert.equal(state.held?.length, 1);
	({state, records} = receive(
		state,
		records,
		page([{kind: 'session', id: 'gone', h: h(4), d: 'a', deleted: true}], 4),
		T0,
	));
	assert.equal(state.held, undefined);
	assert.equal(records.has('tab:gone:t'), true);
});

test('a column keeps its sites through a sync round trip', () => {
	const store = emptyStore();
	store.bookmarkColumns = [
		{
			id: 'mine',
			name: 'Mine',
			domains: ['github.com/bberka', 'gitlab.com'],
			createdAt: 0,
			isDefault: false,
		},
	];
	const records = [...splitLibrary(store).values()];
	assert.deepEqual(assemble(records, emptyStore()).bookmarkColumns[0].domains, [
		'github.com/bberka',
		'gitlab.com',
	]);
});

test('a bookmark keeps the device that saved it through a sync round trip, and one without a device gets none', () => {
	const store = emptyStore();
	const bookmark = (id: string) => ({
		id,
		title: id,
		url: `https://example.com/${id}`,
		columnId: 'bookmark-unfiled',
		createdAt: 0,
		updatedAt: 0,
	});
	store.bookmarks = [
		{...bookmark('phone'), deviceName: 'Pixel 9', deviceKind: 'mobile'},
		bookmark('old'),
	];
	const records = splitLibrary(store);
	assert.deepEqual(Object.keys(records.get('bookmark:old')!.value as object), [
		'id',
		'title',
		'url',
		'columnId',
		'createdAt',
		'updatedAt',
	]);
	const [phone, old] = assemble(records.values(), emptyStore()).bookmarks;
	assert.equal(phone.deviceName, 'Pixel 9');
	assert.equal(phone.deviceKind, 'mobile');
	assert.equal('deviceName' in old, false);
});

const redditColumn = (createdAt: number) => ({
	id: 'source-reddit',
	name: 'Reddit',
	icon: 'message-circle',
	color: '#ff4500',
	createdAt,
	isDefault: false,
});
const saved = (id: string, columnId: string, createdAt: number) => ({
	id,
	title: id,
	url: `https://www.reddit.com/r/a/comments/${id}/`,
	columnId,
	createdAt,
	updatedAt: createdAt,
});
const columnIds = (store: Store) =>
	store.bookmarkColumns.map((column) => column.id);

test('two devices that create the same source column end with one', () => {
	const log = new ChangeLog();
	const a = device('a');
	const b = device('b');
	sync(a, log, T0);
	sync(b, log, T0);

	// Both save on Reddit before either has synced the other's column.
	a.store = {
		...a.store,
		bookmarkColumns: [redditColumn(T0 + 1)],
		bookmarks: [saved('p1', 'source-reddit', T0 + 1)],
	};
	b.store = {
		...b.store,
		bookmarkColumns: [redditColumn(T0 + 2)],
		bookmarks: [saved('p2', 'source-reddit', T0 + 2)],
	};
	sync(a, log, T0 + 1000);
	sync(b, log, T0 + 2000);
	sync(a, log, T0 + 3000);
	for (const store of [a.store, b.store]) {
		assert.deepEqual(columnIds(store), ['source-reddit']);
		assert.deepEqual(
			store.bookmarks.map((bookmark) => bookmark.columnId).toSorted(),
			['source-reddit', 'source-reddit'],
		);
	}
});

test('a source column deleted on one device comes back on it when another saves there again', () => {
	const log = new ChangeLog();
	const a = device('a');
	const b = device('b');
	a.store = {...a.store, bookmarkColumns: [redditColumn(T0)]};
	sync(a, log, T0);
	sync(b, log, T0 + 1000);
	b.store = {...b.store, bookmarkColumns: []};
	sync(b, log, T0 + 2000);
	sync(a, log, T0 + 3000);
	assert.deepEqual(columnIds(a.store), []);

	// The next save on a makes the column again under the same id, over the tombstone.
	a.store = {
		...a.store,
		bookmarkColumns: [redditColumn(T0 + 4000)],
		bookmarks: [saved('p3', 'source-reddit', T0 + 4000)],
	};
	sync(a, log, T0 + 4000);
	sync(b, log, T0 + 5000);
	assert.deepEqual(columnIds(b.store), ['source-reddit']);
	assert.deepEqual(
		b.store.bookmarks.map((bookmark) => bookmark.columnId),
		['source-reddit'],
	);
});

test('a source column record has only the fields older versions know, so they keep it as it is', () => {
	const store = emptyStore();
	store.bookmarkColumns = [redditColumn(0)];
	const record = [...splitLibrary(store).values()].find(
		(entry) => entry.kind === 'column',
	);
	assert.ok(record);
	assert.deepEqual(Object.keys(record.value as object).toSorted(), [
		'color',
		'createdAt',
		'icon',
		'id',
		'isDefault',
		'name',
	]);
	// An older version that renames it writes the same id back, so the column stays the source column.
	const renamed = normalizeBookmarkColumn({
		...(record.value as object),
		name: 'Saved on Reddit',
	});
	assert.equal(renamed?.id, 'source-reddit');
	assert.equal(sourceColumnSite(String(renamed?.id)), 'reddit');
});

const trashed = (id: string, deletedAt: number, data = {}): TrashEntry => ({
	id,
	kind: 'bookmark',
	deletedAt,
	label: id,
	origin: 'Links',
	count: 1,
	data,
});

test('trash entries are records of their own that never reach the library', () => {
	const entries = [trashed('old', 1), trashed('new', 2)];
	const records = splitLibrary(emptyStore(), entries);
	assert.deepEqual(
		[...records.keys()].filter((key) => key.startsWith('trash:')),
		['trash:old', 'trash:new'],
	);
	assert.deepEqual(
		trashOf(records.values()).map((entry) => entry.id),
		['new', 'old'],
	);
	assert.deepEqual(
		assemble(records.values(), emptyStore()),
		assemble(splitLibrary(emptyStore()).values(), emptyStore()),
	);
});

test('the size cache stays on the device, and an entry too large for the server is not a record', () => {
	const small = {...trashed('a', 1), size: 42};
	const huge = trashed('b', 2, {text: 'x'.repeat(TRASH_SYNC_MAX_CHARS)});
	const records = splitLibrary(emptyStore(), [small, huge]);
	assert.equal(records.has('trash:b'), false);
	assert.equal('size' in (records.get('trash:a')!.value as object), false);
});

test('a deleted trash entry is sent as a delete', () => {
	let state = {
		...capture(
			newSyncState('dev'),
			splitLibrary(emptyStore(), [trashed('a', 1)]),
			T0,
		),
		joined: true,
	};
	assert.ok(state.outbox.includes('trash:a'));
	state = settle(
		state,
		outgoing(state, splitLibrary(emptyStore(), [trashed('a', 1)]), 10),
		['applied'],
	).state;
	state = capture(state, splitLibrary(emptyStore()), T0 + 1);
	const sent = outgoing(state, splitLibrary(emptyStore()), 10);
	assert.deepEqual(
		sent
			.filter((change) => change.kind === 'trash')
			.map((change) => [change.kind, change.id, change.deleted]),
		[['trash', 'a', true]],
	);
});

const noted = (notes?: string) => ({
	...emptyStore(),
	bookmarkColumns: [
		{id: 'reading', name: 'Reading', createdAt: 0, isDefault: false},
	],
	bookmarks: [
		{
			id: 'link',
			title: 'Link',
			url: 'https://example.com/',
			columnId: 'reading',
			...(notes !== undefined && {notes}),
			createdAt: 0,
			updatedAt: 0,
		},
	],
});

test('a bookmark note is a record of its own, and a bookmark without one is the record it always was', () => {
	const records = splitLibrary(noted('Why I saved this'));
	assert.deepEqual(records.get('note:link')?.value, {
		notes: 'Why I saved this',
	});
	assert.equal(
		'notes' in (records.get('bookmark:link')?.value as object),
		false,
	);
	assert.equal(
		assemble([...records.values()], emptyStore()).bookmarks[0].notes,
		'Why I saved this',
	);

	const plain = splitLibrary(noted());
	assert.equal(plain.has('note:link'), false);
	assert.deepEqual(plain.get('bookmark:link')?.value, noted().bookmarks[0]);
});

test('a note that arrives before its bookmark waits for it', () => {
	const h = (offset: number) =>
		(T0 + offset).toString(36).padStart(11, '0') + '00000';
	const page = (changes: SyncChange[], cursor: number) => ({
		changes,
		cursor,
		purged: 0,
	});
	const source = splitLibrary(noted('Read later'));
	const change = (key: string, offset: number): SyncChange => {
		const record = source.get(key)!;
		return {
			kind: record.kind,
			id: record.id,
			h: h(offset),
			d: 'a',
			...(record.kind !== 'note' && {o: 'a0'}),
			value: record.value,
		};
	};

	let state: SyncState = {...newSyncState('b'), joined: true};
	let records = splitLibrary(emptyStore());
	({state, records} = receive(
		state,
		records,
		page([change('note:link', 3)], 1),
		T0,
	));
	assert.equal(records.has('note:link'), false);
	assert.equal(state.held?.length, 1);
	assert.ok(!capture(state, records, T0).outbox.includes('note:link'));

	({state, records} = receive(
		state,
		records,
		page([change('column:reading', 1), change('bookmark:link', 2)], 2),
		T0,
	));
	assert.equal(state.held, undefined);
	assert.equal(
		assemble(inOrder(state, records), emptyStore()).bookmarks[0].notes,
		'Read later',
	);
});

test('deleting a bookmark deletes its note on every device', () => {
	const log = new ChangeLog();
	const a = device('a', noted('Gone with it'));
	const b = device('b');
	sync(a, log, T0);
	sync(b, log, T0 + 1000);
	assert.equal(b.store.bookmarks[0].notes, 'Gone with it');

	a.store = {...a.store, bookmarks: []};
	sync(a, log, T0 + 2000);
	sync(b, log, T0 + 3000);
	assert.deepEqual(b.store.bookmarks, []);
	const pulled = log.pull(0, 100, 0);
	assert.ok(!pulled.resync);
	assert.ok(
		pulled.changes.some((change) => change.kind === 'note' && change.deleted),
	);
	assert.equal(splitLibrary(b.store).has('note:link'), false);
});

test('clearing a note sends a delete for its record and keeps the bookmark', () => {
	const log = new ChangeLog();
	const a = device('a', noted('Draft'));
	const b = device('b');
	sync(a, log, T0);
	sync(b, log, T0 + 1000);

	a.store = noted();
	sync(a, log, T0 + 2000);
	sync(b, log, T0 + 3000);
	assert.equal(b.store.bookmarks.length, 1);
	assert.equal(b.store.bookmarks[0].notes, undefined);
});

const taggedStore = (
	fields: {tags?: string[]; hiddenKinds?: Array<'repo'>} = {},
) => ({
	...emptyStore(),
	bookmarkColumns: [
		{id: 'reading', name: 'Reading', createdAt: 0, isDefault: false},
	],
	bookmarks: [
		{
			id: 'link',
			title: 'Link',
			url: 'https://github.com/bberka/TabLodge',
			columnId: 'reading',
			...fields,
			createdAt: 0,
			updatedAt: 0,
		},
	],
});

test('tags and removed kinds are a record of their own, and an untagged bookmark is the record it always was', () => {
	const records = splitLibrary(
		taggedStore({tags: ['rust'], hiddenKinds: ['repo']}),
	);
	assert.deepEqual(records.get('tag:link')?.value, {
		tags: ['rust'],
		hiddenKinds: ['repo'],
	});
	const value = records.get('bookmark:link')?.value as object;
	assert.equal('tags' in value || 'hiddenKinds' in value, false);
	const back = assemble([...records.values()], emptyStore()).bookmarks[0];
	assert.deepEqual([back.tags, back.hiddenKinds], [['rust'], ['repo']]);

	const plain = splitLibrary(taggedStore());
	assert.equal(plain.has('tag:link'), false);
	assert.deepEqual(
		plain.get('bookmark:link')?.value,
		taggedStore().bookmarks[0],
	);
});

test('a pulled tag record is not sent back, and a malformed one is dropped', () => {
	const log = new ChangeLog();
	const a = device('a', taggedStore({tags: ['rust', 'web']}));
	const b = device('b');
	sync(a, log, T0);
	sync(b, log, T0 + 1000);
	assert.deepEqual(b.store.bookmarks[0].tags, ['rust', 'web']);
	// The pulled library, read back as this device's own, holds no edit to send.
	const again = splitLibrary(structuredClone(b.store));
	assert.deepEqual(capture(b.state, again, T0 + 2000).outbox, []);

	const odd = assemble(
		[
			...splitLibrary(taggedStore()).values(),
			{kind: 'tag', id: 'link', value: {tags: 'rust', hiddenKinds: [7]}},
		],
		emptyStore(),
	).bookmarks[0];
	assert.equal(odd.tags, undefined);
	assert.equal(odd.hiddenKinds, undefined);
});

test('a tag record that arrives before its bookmark waits for it', () => {
	const h = (offset: number) =>
		(T0 + offset).toString(36).padStart(11, '0') + '00000';
	const source = splitLibrary(taggedStore({tags: ['later']}));
	const change = (key: string, offset: number): SyncChange => {
		const record = source.get(key)!;
		return {
			kind: record.kind,
			id: record.id,
			h: h(offset),
			d: 'a',
			...(record.kind !== 'tag' && {o: 'a0'}),
			value: record.value,
		};
	};

	let state: SyncState = {...newSyncState('b'), joined: true};
	let records = splitLibrary(emptyStore());
	({state, records} = receive(
		state,
		records,
		{changes: [change('tag:link', 3)], cursor: 1, purged: 0},
		T0,
	));
	assert.equal(records.has('tag:link'), false);
	assert.equal(state.held?.length, 1);
	({state, records} = receive(
		state,
		records,
		{
			changes: [change('column:reading', 1), change('bookmark:link', 2)],
			cursor: 2,
			purged: 0,
		},
		T0,
	));
	assert.equal(state.held, undefined);
	assert.deepEqual(
		assemble(inOrder(state, records), emptyStore()).bookmarks[0].tags,
		['later'],
	);
});

test('deleting a bookmark deletes its tags, and clearing them keeps the bookmark', () => {
	const log = new ChangeLog();
	const a = device('a', taggedStore({tags: ['gone'], hiddenKinds: ['repo']}));
	const b = device('b');
	sync(a, log, T0);
	sync(b, log, T0 + 1000);
	assert.deepEqual(b.store.bookmarks[0].hiddenKinds, ['repo']);

	a.store = taggedStore();
	sync(a, log, T0 + 2000);
	sync(b, log, T0 + 3000);
	assert.equal(b.store.bookmarks.length, 1);
	assert.equal(b.store.bookmarks[0].tags, undefined);
	assert.equal(b.store.bookmarks[0].hiddenKinds, undefined);

	a.store = taggedStore({tags: ['back']});
	sync(a, log, T0 + 4000);
	a.store = {...a.store, bookmarks: []};
	sync(a, log, T0 + 5000);
	sync(b, log, T0 + 6000);
	assert.deepEqual(b.store.bookmarks, []);
	const pulled = log.pull(0, 100, 0);
	assert.ok(!pulled.resync);
	assert.ok(
		pulled.changes.some((entry) => entry.kind === 'tag' && entry.deleted),
	);
});
