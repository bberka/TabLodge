import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {createApi} from '../../server/src/api';
import {sqlite} from '../../server/src/node-sqlite';
import {SqlChangeLog} from '../../server/src/sql-change-log';
import {createSyncClient} from '../../extension/src/shared/sync/client';
import type {Store} from '../../extension/src/shared/types';
import {
	deleteColumn,
	removeBookmarks,
	removedBookmarks,
	restoreBookmarks,
	restoreColumn,
} from '../src/library/board-edits';
import {
	deleteFolder,
	removeSession,
	removeSessionTab,
	restoreFolder,
	restoreSession,
} from '../src/library/session-edits';
import {emptyStore} from '../src/library/store-shape';
import {addToTrash, restoreEntry, type NewTrash} from '../src/library/trash';

/*
Undo and the trash's Restore, against the Docker server's own storage (SQLite) and the extension's sync client: the
phone deletes something, both devices sync, the phone brings it back, both sync again, and the other device must hold
what the phone holds. A restore that the server refuses to bring back shows up as a library that differs.
*/
const TOKEN = 'undo-test-token-0123456789-abcdefghijkl';
const URL_BASE = 'https://sync.example.test';

let clock = 1_700_000_000_000;
const tickMs = (ms = 1000) => {
	clock += ms;
	return clock;
};

type Device = {
	store: Store;
	client: ReturnType<typeof createSyncClient>;
};

function makeDevice(name: string, app: ReturnType<typeof createApi>) {
	const storage = new Map<string, unknown>();
	let queue = Promise.resolve();
	let count = 0;
	const device: Device = {
		store: emptyStore(clock),
		client: createSyncClient({
			get: async (key) => structuredClone(storage.get(key)),
			async set(key, value) {
				storage.set(key, structuredClone(value));
			},
			async remove(keys) {
				for (const key of keys) {
					storage.delete(key);
				}
			},
			fetch: async (url, init) => app.request(url, init),
			readOnly: false,
			mutate<T>(work: () => Promise<T>) {
				const result = queue.then(work);
				queue = result.then(
					() => undefined,
					() => undefined,
				);
				return result;
			},
			readLibrary: async () => structuredClone(device.store),
			async writeLibrary(next) {
				device.store = structuredClone(next);
			},
			async backup() {},
			randomId() {
				count += 1;
				return `${name}-${count}`;
			},
			now: () => clock,
		}),
	};
	return device;
}

const tab = (id: string) => ({
	id,
	title: `Tab ${id}`,
	url: `https://example.com/${id}`,
	notes: '',
	pinned: false,
	nativeGroup: null,
	savedAt: 1,
	originalIndex: 0,
});

const bookmark = (id: string, columnId: string) => ({
	id,
	title: `Bookmark ${id}`,
	url: `https://example.com/${id}`,
	columnId,
	createdAt: 1,
	updatedAt: 1,
});

const seed = (): Store => ({
	...emptyStore(clock),
	folders: [
		{id: 'f1', name: 'Unfiled', createdAt: 1, isDefault: true},
		{id: 'f2', name: 'Work', createdAt: 1, isDefault: false},
	],
	groups: [
		{
			id: 's1',
			name: 'Research',
			folderId: 'f2',
			description: '',
			createdAt: 1,
			updatedAt: 1,
			sourceWindowName: '',
			sourceWindowId: null,
			tabs: [tab('t1'), tab('t2'), tab('t3')],
		},
		{
			id: 's2',
			name: 'Other',
			folderId: 'f2',
			description: '',
			createdAt: 1,
			updatedAt: 1,
			sourceWindowName: '',
			sourceWindowId: null,
			tabs: [tab('t4')],
		},
	],
	bookmarkColumns: [
		{id: 'c1', name: 'Read later', createdAt: 1, isDefault: true},
		{id: 'c2', name: 'Tools', createdAt: 1, isDefault: false},
	],
	bookmarks: [bookmark('b1', 'c1'), bookmark('b2', 'c2'), bookmark('b3', 'c2')],
});

async function setup() {
	const app = createApi({
		token: TOKEN,
		log: (() => {
			const log = new SqlChangeLog(sqlite(':memory:'));
			return () => log;
		})(),
	});
	const phone = makeDevice('phone', app);
	const extension = makeDevice('extension', app);
	phone.store = seed();
	await phone.client.connect(URL_BASE, TOKEN);
	await extension.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(extension.store.groups.map((s) => s.id).toSorted(), [
		's1',
		's2',
	]);
	return {phone, extension};
}

/**
Runs a phone edit, then syncs both devices, like a person waiting for the sync after each action.
*/
async function edit(
	phone: Device,
	extension: Device,
	change: (store: Store) => Store,
) {
	tickMs();
	phone.store = change(phone.store);
	phone.client.localChanged();
	await phone.client.syncNow();
	await extension.client.syncNow();
	tickMs();
}

const shape = (store: Store) => ({
	folders: store.folders.map((f) => f.id).toSorted(),
	sessions: store.groups
		.map((s) => `${s.id}:${s.folderId}:${s.tabs.map((t) => t.id).join(',')}`)
		.toSorted(),
	columns: store.bookmarkColumns.map((c) => c.id).toSorted(),
	bookmarks: store.bookmarks.map((b) => `${b.id}:${b.columnId}`).toSorted(),
});

function assertSame(phone: Device, extension: Device) {
	assert.deepEqual(shape(extension.store), shape(phone.store));
}

describe('Undo of something that already synced reaches the other device', () => {
	test('a deleted session', async () => {
		const {phone, extension} = await setup();
		const session = phone.store.groups.find((s) => s.id === 's1')!;
		await edit(phone, extension, (s) => removeSession(s, 's1', clock));
		assert.deepEqual(
			extension.store.groups.map((s) => s.id),
			['s2'],
		);
		await edit(phone, extension, (s) => restoreSession(s, session, clock));
		assert.ok(phone.store.groups.some((s) => s.id === 's1'));
		assert.ok(extension.store.groups.some((s) => s.id === 's1'));
		assert.equal(
			extension.store.groups.find((s) => s.id === 's1')?.tabs.length,
			3,
		);
		assertSame(phone, extension);
	});

	test('several deleted sessions at once', async () => {
		const {phone, extension} = await setup();
		const gone = [...phone.store.groups];
		await edit(phone, extension, (s) => {
			let next = s;
			for (const g of gone) {
				next = removeSession(next, g.id, clock);
			}

			return next;
		});
		assert.equal(extension.store.groups.length, 0);
		await edit(phone, extension, (s) => {
			let next = s;
			for (const g of gone) {
				next = restoreSession(next, g, clock);
			}

			return next;
		});
		assertSame(phone, extension);
		assert.equal(extension.store.groups.length, 2);
	});

	test('a link removed from a session', async () => {
		const {phone, extension} = await setup();
		const session = phone.store.groups.find((s) => s.id === 's1')!;
		await edit(phone, extension, (s) => removeSessionTab(s, 's1', 't2', clock));
		assert.deepEqual(
			extension.store.groups.find((g) => g.id === 's1')?.tabs.map((t) => t.id),
			['t1', 't3'],
		);
		// The app's Undo puts the whole session back as it was.
		await edit(phone, extension, (s) =>
			restoreSession(removeSession(s, 's1', clock), session, clock),
		);
		assert.deepEqual(
			extension.store.groups.find((g) => g.id === 's1')?.tabs.map((t) => t.id),
			['t1', 't2', 't3'],
		);
		assertSame(phone, extension);
	});

	test('a deleted column with its bookmarks, and one that moved them', async () => {
		const {phone, extension} = await setup();
		const whole = phone.store.bookmarkColumns.find((c) => c.id === 'c2')!;
		const own = phone.store.bookmarks.filter((b) => b.columnId === 'c2');
		await edit(phone, extension, (s) => deleteColumn(s, 'c2', 'c1', clock));
		assert.ok(extension.store.bookmarkColumns.every((c) => c.id !== 'c2'));
		await edit(phone, extension, (s) => restoreColumn(s, whole, own, clock));
		assertSame(phone, extension);
		assert.equal(
			extension.store.bookmarks.filter((b) => b.columnId === 'c2').length,
			2,
		);

		// Deleted together with its bookmarks.
		await edit(phone, extension, (s) => deleteColumn(s, 'c2', null, clock));
		assert.equal(extension.store.bookmarks.length, 1);
		await edit(phone, extension, (s) => restoreColumn(s, whole, own, clock));
		assertSame(phone, extension);
		assert.equal(extension.store.bookmarks.length, 3);
	});

	test('a deleted session folder with its sessions', async () => {
		const {phone, extension} = await setup();
		const folder = phone.store.folders.find((f) => f.id === 'f2')!;
		const held = phone.store.groups
			.filter((g) => g.folderId === 'f2')
			.map((g) => g.id);
		await edit(phone, extension, (s) => deleteFolder(s, 'f2', clock));
		assert.ok(extension.store.folders.every((f) => f.id !== 'f2'));
		await edit(phone, extension, (s) => restoreFolder(s, folder, held, clock));
		assertSame(phone, extension);
		assert.ok(extension.store.folders.some((f) => f.id === 'f2'));
	});

	test('deleted bookmarks, which come back under new ids', async () => {
		const {phone, extension} = await setup();
		const removed = removedBookmarks(phone.store, new Set(['b2', 'b3']));
		await edit(phone, extension, (s) =>
			removeBookmarks(s, new Set(['b2', 'b3']), clock),
		);
		await edit(phone, extension, (s) =>
			restoreBookmarks(s, removed, ['n1', 'n2'], clock),
		);
		assertSame(phone, extension);
		assert.equal(extension.store.bookmarks.length, 3);
	});
});

describe('the trash restores what was deleted and synced', () => {
	const trash = (entry: NewTrash) =>
		addToTrash([], [entry], ['trash1'], clock)[0];
	let counter = 0;
	const newId = () => `restored-${++counter}`;

	test('a session', async () => {
		const {phone, extension} = await setup();
		const session = phone.store.groups.find((s) => s.id === 's1')!;
		const entry = trash({kind: 'session', session});
		await edit(phone, extension, (s) => removeSession(s, 's1', clock));
		await edit(
			phone,
			extension,
			(s) => restoreEntry(s, entry, newId, clock).store,
		);
		assertSame(phone, extension);
		assert.ok(extension.store.groups.some((s) => s.id === 's1'));
	});

	test('a session whose folder was deleted since', async () => {
		const {phone, extension} = await setup();
		const session = phone.store.groups.find((s) => s.id === 's1')!;
		const entry = trash({kind: 'session', session});
		await edit(phone, extension, (s) => removeSession(s, 's1', clock));
		await edit(phone, extension, (s) => deleteFolder(s, 'f2', clock));
		await edit(
			phone,
			extension,
			(s) => restoreEntry(s, entry, newId, clock).store,
		);
		assertSame(phone, extension);
		assert.equal(
			extension.store.groups.find((s) => s.id === 's1')?.folderId,
			'f1',
		);
	});

	test('a link, into its session and into a new one when the session is gone', async () => {
		const {phone, extension} = await setup();
		const session = phone.store.groups.find((s) => s.id === 's1')!;
		const entry = trash({
			kind: 'tab',
			tab: session.tabs[1],
			index: 1,
			sessionId: 's1',
			sessionName: session.name,
			folderId: 'f2',
		});
		await edit(phone, extension, (s) => removeSessionTab(s, 's1', 't2', clock));
		await edit(
			phone,
			extension,
			(s) => restoreEntry(s, entry, newId, clock).store,
		);
		assertSame(phone, extension);
		assert.deepEqual(
			extension.store.groups.find((s) => s.id === 's1')?.tabs.map((t) => t.id),
			['t1', 't2', 't3'],
		);

		await edit(phone, extension, (s) => removeSessionTab(s, 's1', 't2', clock));
		await edit(phone, extension, (s) => removeSession(s, 's1', clock));
		await edit(
			phone,
			extension,
			(s) => restoreEntry(s, entry, newId, clock).store,
		);
		assertSame(phone, extension);
		assert.ok(extension.store.groups.some((s) => s.name === 'Research'));
	});

	test('a bookmark', async () => {
		const {phone, extension} = await setup();
		const [removed] = removedBookmarks(phone.store, new Set(['b2']));
		const entry = trash({
			kind: 'bookmark',
			bookmark: removed.bookmark,
			after: removed.after,
		});
		await edit(phone, extension, (s) =>
			removeBookmarks(s, new Set(['b2']), clock),
		);
		await edit(
			phone,
			extension,
			(s) => restoreEntry(s, entry, newId, clock).store,
		);
		assertSame(phone, extension);
		assert.equal(extension.store.bookmarks.length, 3);
	});

	test('a column', async () => {
		const {phone, extension} = await setup();
		const column = phone.store.bookmarkColumns.find((c) => c.id === 'c2')!;
		const bookmarks = phone.store.bookmarks.filter((b) => b.columnId === 'c2');
		const entry = trash({kind: 'column', column, bookmarks});
		await edit(phone, extension, (s) => deleteColumn(s, 'c2', null, clock));
		await edit(
			phone,
			extension,
			(s) => restoreEntry(s, entry, newId, clock).store,
		);
		assertSame(phone, extension);
		assert.equal(extension.store.bookmarks.length, 3);
	});

	test('a folder', async () => {
		const {phone, extension} = await setup();
		const folder = phone.store.folders.find((f) => f.id === 'f2')!;
		const entry = trash({kind: 'folder', folder, sessionIds: ['s1', 's2']});
		await edit(phone, extension, (s) => deleteFolder(s, 'f2', clock));
		await edit(
			phone,
			extension,
			(s) => restoreEntry(s, entry, newId, clock).store,
		);
		assertSame(phone, extension);
		assert.ok(extension.store.folders.some((f) => f.id === 'f2'));
	});
});
