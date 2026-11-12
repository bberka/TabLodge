import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import type {Settings, Store} from '../src/app/types';
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
import {assemble, splitLibrary} from '../src/shared/sync/library-records';

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
