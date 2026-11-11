import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {createApi} from '../server/src/api';
import {isAuthMessage} from '../server/src/live';
import type {Settings, Store} from '../src/app/types';
import {ChangeLog} from '../src/shared/sync/change-log';
import {
	createSyncClient,
	parseServerUrl,
	SYNC_CONFIG_KEY,
	SyncError,
	type SyncSocket,
} from '../src/shared/sync/client';
import {spreadKeys} from '../src/shared/sync/order-key';

const TOKEN = 'client-test-token-0123456789-abcdefghij';
const URL_BASE = 'https://sync.example.test';

/**
The reference server behind a fake network, with live sockets that hear about every applied push.
*/
function makeServer() {
	const sockets = new Set<FakeSocket>();
	const app = createApi({
		token: TOKEN,
		log: (() => {
			const log = new ChangeLog();
			return () => log;
		})(),
		onApplied(cursor) {
			for (const socket of sockets) {
				socket.receive(JSON.stringify({type: 'cursor', cursor}));
			}
		},
	});
	let online = true;
	return {
		app,
		sockets,
		setOnline(value: boolean) {
			online = value;
		},
		async fetch(url: string, init: RequestInit) {
			if (!online) {
				throw new TypeError('Failed to fetch');
			}

			return app.request(url, init);
		},
	};
}

type Listener = (event: {data: unknown}) => void;

class FakeSocket implements SyncSocket {
	private readonly listeners = new Map<string, Listener[]>();

	constructor(private readonly server: ReturnType<typeof makeServer>) {
		queueMicrotask(() => {
			this.emit('open', {data: undefined});
		});
	}

	private emit(type: string, event: {data: unknown}) {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}

	addEventListener(type: string, listener: Listener) {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	}

	send(data: string) {
		if (data === 'ping' || !isAuthMessage(data, TOKEN)) {
			return;
		}

		this.server.sockets.add(this);
		this.receive(JSON.stringify({type: 'ready', cursor: 0}));
	}

	close() {
		this.server.sockets.delete(this);
		this.emit('close', {data: undefined});
	}

	receive(data: string) {
		queueMicrotask(() => {
			this.emit('message', {data});
		});
	}
}

const emptyStore = (): Store => ({
	schemaVersion: 10,
	groups: [],
	folders: [{id: 'unfiled', name: 'Unsorted', createdAt: 0, isDefault: true}],
	bookmarkColumns: [{id: 'col', name: 'Links', createdAt: 0, isDefault: true}],
	bookmarks: [],
	settings: {sessionSort: 'manual'} as unknown as Settings,
	updatedAt: 0,
});

const bookmark = (id: string) => ({
	id,
	title: id,
	url: `https://example.com/${id}`,
	columnId: 'col',
	createdAt: 0,
	updatedAt: 0,
});

let deviceCount = 0;

type Device = {
	store: Store;
	storage: Map<string, unknown>;
	backups: string[];
	client: ReturnType<typeof createSyncClient>;
	edit(change: (store: Store) => Store): void;
};

function makeDevice(
	server: ReturnType<typeof makeServer>,
	store = emptyStore(),
) {
	const storage = new Map<string, unknown>();
	let queue = Promise.resolve();
	const backups: string[] = [];
	const device: Device = {
		store,
		storage,
		backups,
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
			fetch: async (url, init) => server.fetch(url, init),
			openSocket: () => new FakeSocket(server),
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
			async backup(_store, reason) {
				backups.push(reason);
			},
			randomId() {
				deviceCount += 1;
				return `device-${deviceCount}`;
			},
			now: () => Date.now(),
		}),
		/**
		A local edit the way the worker reports it.
		*/
		edit(change: (store: Store) => Store) {
			device.store = change(device.store);
			device.client.localChanged();
		},
	};
	return device;
}

async function until(check: () => boolean, ms = 3000) {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) {
			throw new Error('timed out');
		}

		await new Promise((resolve) => {
			setTimeout(resolve, 20);
		});
	}
}

const ids = (store: Store) => store.bookmarks.map((entry) => entry.id);

test('server addresses need https, except on this computer', () => {
	assert.equal(
		parseServerUrl(' https://sync.example.com/base/ '),
		'https://sync.example.com/base',
	);
	assert.equal(
		parseServerUrl('http://localhost:8787'),
		'http://localhost:8787',
	);
	for (const bad of [
		// eslint-disable-next-line unicorn/prefer-https -- plain HTTP to another host is what is refused
		'http://sync.example.com',
		'sync.example.com',
		'https://user:pw@x.test',
		'https://x.test/?a=1',
	]) {
		assert.throws(() => parseServerUrl(bad), SyncError, bad);
	}
});

test('connecting checks the token and the server', async () => {
	const server = makeServer();
	const device = makeDevice(server);
	await assert.rejects(device.client.connect(URL_BASE, 'short'), /at least 32/);
	await assert.rejects(
		device.client.connect(URL_BASE, `${TOKEN}x`),
		/refused the token/,
	);
	server.setOnline(false);
	await assert.rejects(
		device.client.connect(URL_BASE, TOKEN),
		/cannot be reached/,
	);
	assert.equal(device.storage.has(SYNC_CONFIG_KEY), false);
});

test('a bookmark added on one device reaches the other through the live channel', async () => {
	const server = makeServer();
	const a = makeDevice(server, {...emptyStore(), bookmarks: [bookmark('b1')]});
	const b = makeDevice(server);
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(ids(b.store), ['b1']);
	assert.deepEqual(b.backups, ['Before the first sync']);

	a.edit((store) => ({
		...store,
		bookmarks: [...store.bookmarks, bookmark('b2')],
	}));
	await until(() => ids(b.store).length === 2);
	assert.deepEqual(ids(b.store), ['b1', 'b2']);

	b.edit((store) => ({
		...store,
		bookmarks: store.bookmarks.filter((entry) => entry.id !== 'b1'),
	}));
	await until(() => ids(a.store).length === 1);
	assert.deepEqual(ids(a.store), ['b2']);
	assert.equal((await a.client.status()).live, true);
	assert.equal((await a.client.status()).pending, 0);
});

test('edits made offline are pushed once the server is back', async () => {
	const server = makeServer();
	const a = makeDevice(server);
	const b = makeDevice(server);
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);

	server.setOnline(false);
	a.edit((store) => ({...store, bookmarks: [bookmark('offline')]}));
	await until(() => a.storage.get('tablodge.sync.status') !== undefined);
	await a.client.syncNow();
	const offline = await a.client.status();
	assert.equal(offline.phase, 'offline');
	assert.equal(offline.pending, 1);

	server.setOnline(true);
	await a.client.syncNow();
	await until(() => ids(b.store).length === 1);
	assert.equal((await a.client.status()).phase, 'idle');
});

test('disconnecting keeps the library and stops syncing', async () => {
	const server = makeServer();
	const a = makeDevice(server, {...emptyStore(), bookmarks: [bookmark('b1')]});
	await a.client.connect(URL_BASE, TOKEN);
	const status = await a.client.disconnect();
	assert.equal(status.connected, false);
	assert.deepEqual(ids(a.store), ['b1']);
	assert.equal(server.sockets.size, 0);
	assert.equal([...a.storage.keys()].length, 0);
});

test('a value that changes on every read cannot keep sync pushing', async () => {
	const server = makeServer();
	const device = makeDevice(server, {
		...emptyStore(),
		bookmarks: [bookmark('flaky')],
	});
	let reads = 0;
	const steady = device.store;
	Object.defineProperty(device, 'store', {
		get() {
			reads += 1;
			return {
				...steady,
				bookmarks: [{...bookmark('flaky'), title: `read ${reads}`}],
			};
		},
		set() {},
	});
	await device.client.connect(URL_BASE, TOKEN);
	await new Promise((resolve) => {
		setTimeout(resolve, 300);
	});
	const status = (await (
		await server.app.request('/v1/status', {
			headers: {Authorization: `Bearer ${TOKEN}`},
		})
	).json()) as {cursor: number};
	assert.ok(status.cursor < 20, `pushed ${status.cursor} changes`);
	assert.notEqual((await device.client.status()).phase, 'error');
});

test('tabs pulled a page before their session are kept, and nothing is sent back', async () => {
	const server = makeServer();
	const device = makeDevice(server);
	await device.client.connect(URL_BASE, TOKEN);
	// Another device saved 600 tabs, then renamed their session, so the session comes after the tabs and the
	// device gets the tabs on one page (500 changes) and the session on the next.
	const now = Date.now();
	const stamp = (offset: number) =>
		(now + offset).toString(36).padStart(11, '0') + '00000';
	const orderKeys = spreadKeys(600);
	const tabs = Array.from({length: 600}, (_, index) => ({
		kind: 'tab',
		id: `t${index}`,
		parentId: 'work',
		h: stamp(index),
		d: 'other',
		o: orderKeys[index],
		value: {
			id: `t${index}`,
			title: `Tab ${index}`,
			url: `https://example.com/${index}`,
			notes: '',
			pinned: false,
			nativeGroup: null,
			savedAt: now,
			originalIndex: index,
		},
	}));
	const session = {
		kind: 'session',
		id: 'work',
		h: stamp(1000),
		d: 'other',
		o: 'a0',
		value: {
			id: 'work',
			name: 'Work',
			folderId: 'unfiled',
			description: '',
			createdAt: now,
			updatedAt: now,
			sourceWindowName: '',
		},
	};
	const headers = {
		Authorization: `Bearer ${TOKEN}`,
		'Content-Type': 'application/json',
	};
	for (const changes of [tabs.slice(0, 500), [...tabs.slice(500), session]]) {
		await server.app.request(`${URL_BASE}/v1/changes`, {
			method: 'POST',
			headers,
			body: JSON.stringify({changes}),
		});
	}

	const before = (await (
		await server.app.request(`${URL_BASE}/v1/status`, {headers})
	).json()) as {cursor: number};
	await device.client.syncNow();
	assert.equal(device.store.groups.length, 1);
	assert.equal(device.store.groups[0].tabs.length, 600);
	const after = (await (
		await server.app.request(`${URL_BASE}/v1/status`, {headers})
	).json()) as {cursor: number};
	assert.equal(after.cursor, before.cursor);
});
