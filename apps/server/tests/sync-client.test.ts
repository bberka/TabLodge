import assert from 'node:assert/strict';
import {test, vi} from 'vite-plus/test';
import {createApi} from '../src/api';
import {isAuthMessage} from '../src/live';
import {exportLibrary, importLibrary} from '../src/transfer';
import type {Settings, Store} from '../../extension/src/shared/types';
import type {TrashEntry} from '../../extension/src/shared/trash';
import {ChangeLog} from '../../extension/src/shared/sync/change-log';
import {
	createSyncClient,
	createSyncToken,
	MIN_TOKEN_LENGTH,
	parseServerUrl,
	SYNC_CONFIG_KEY,
	SYNC_SETTINGS_KEY,
	SyncError,
	type SyncSocket,
} from '../../extension/src/shared/sync/client';
import {
	problemBanner,
	readCompat,
} from '../../extension/src/shared/sync/compat';
import type {SyncedSource} from '../../extension/src/shared/sync/library-records';
import {spreadKeys} from '../../extension/src/shared/sync/order-key';

const TOKEN = 'client-test-token-0123456789-abcdefghij';

test('a generated token is long enough, safe to paste anywhere, and different every time', () => {
	const tokens = new Set(Array.from({length: 50}, () => createSyncToken()));
	assert.equal(tokens.size, 50);
	for (const token of tokens) {
		assert.ok(token.length >= MIN_TOKEN_LENGTH, token);
		assert.match(token, /^[\w-]+$/);
	}
});
const URL_BASE = 'https://sync.example.test';

/**
The reference server behind a fake network, with live sockets that hear about every applied push.
*/
function makeServer(options: {legacy?: boolean} = {}) {
	let legacy = options.legacy ?? false;
	let resyncNext = false;
	let rewriteStatus: ((body: Record<string, unknown>) => unknown) | undefined;
	// Requests by path, so a test can tell whether a device pulled or pushed.
	const requests: string[] = [];
	// Pushes by how many changes each carried.
	const pushes: number[] = [];
	const sockets = new Set<FakeSocket>();
	const createServerApi = () =>
		createApi({
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
	let app = createServerApi();
	let online = true;
	let statusFails = false;
	const fetchFromApp = async (url: string, init: RequestInit) =>
		app.request(url, init);
	return {
		get app() {
			return app;
		},
		sockets,
		requests,
		pushes,
		/**
		Changes what /v1/status answers, as another server version would; undefined goes back to the real answer.
		*/
		setStatus(rewrite: typeof rewriteStatus) {
			rewriteStatus = rewrite;
		},
		setOnline(value: boolean) {
			online = value;
		},
		/**
		Makes /v1/status answer with a server error, as a proxy in front of the server might for a moment.
		*/
		setStatusFails(value: boolean) {
			statusFails = value;
		},
		setLegacy(value: boolean) {
			legacy = value;
		},
		/**
		Answers the next pull with `resync`, as a server does once it purged tombstones a device has not seen.
		*/
		resyncOnce() {
			resyncNext = true;
		},
		async fetch(url: string, init: RequestInit) {
			if (!online) {
				throw new TypeError('Failed to fetch');
			}

			requests.push(new URL(url).pathname);
			if (init.method === 'POST' && new URL(url).pathname === '/v1/changes') {
				pushes.push(
					(JSON.parse(String(init.body)) as {changes: unknown[]}).changes
						.length,
				);
			}

			if (statusFails && new URL(url).pathname === '/v1/status') {
				return Response.json({error: 'unavailable'}, {status: 503});
			}

			if (rewriteStatus && new URL(url).pathname === '/v1/status') {
				const response = await app.request(url, init);
				return Response.json(
					rewriteStatus((await response.json()) as Record<string, unknown>),
				);
			}

			if (resyncNext && new URL(url).pathname === '/v1/changes') {
				resyncNext = false;
				return Response.json({resync: true});
			}

			const response = await app.request(url, init);
			if (!legacy) {
				return response;
			}

			// A server from before the trash, notes, tags, and Sources: it lists none of them and refuses a kind it does not know.
			if (new URL(url).pathname === '/v1/status') {
				const body = (await response.json()) as {features: string[]};
				return Response.json({
					...body,
					features: body.features.filter(
						(feature) =>
							!['trash', 'notes', 'tags', 'sources'].includes(feature),
					),
				});
			}

			if (
				init.method === 'POST' &&
				/"kind":"(?:trash|note|tag|source)"/.test(String(init.body))
			) {
				return Response.json({error: 'bad_change'}, {status: 400});
			}

			return response;
		},
		/**
		A copy of the library as `node node.js export` writes it.
		*/
		async export() {
			const lines: string[] = [];
			await exportLibrary(
				{url: URL_BASE, token: TOKEN, fetch: fetchFromApp},
				(line) => {
					lines.push(line);
				},
			);
			return lines;
		},
		/**
		Wipes the server and loads `lines` into it, like restoring a backup.
		*/
		async restore(lines: string[]) {
			app = createServerApi();
			const read = async function* () {
				yield* lines;
			};

			await importLibrary(
				{url: URL_BASE, token: TOKEN, fetch: fetchFromApp},
				read(),
			);
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
	/**
	The trash, for a device whose host has one.
	*/
	trash: TrashEntry[];
	/**
	The Sources choices, for a device whose host has them (the extension's regular library).
	*/
	sources: SyncedSource[];
	storage: Map<string, unknown>;
	backups: string[];
	client: ReturnType<typeof createSyncClient>;
	edit(change: (store: Store) => Store): void;
};

function makeDevice(
	server: ReturnType<typeof makeServer>,
	store = emptyStore(),
	{
		withTrash = false,
		withSources = false,
		beforeNotes = false,
		storage = new Map<string, unknown>(),
	} = {},
) {
	let queue = Promise.resolve();
	const backups: string[] = [];
	const device: Device = {
		store,
		trash: [],
		sources: [],
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
			async fetch(url, init) {
				const response = await server.fetch(url, init);
				if (!beforeNotes || new URL(url).pathname !== '/v1/changes') {
					return response;
				}

				// A version from before notes, tags, and Sources (0.3.0) skips a kind it does not know (its `parseChange` refuses it).
				const body = (await response.json()) as {
					changes?: Array<{kind: string}>;
				};
				return Response.json({
					...body,
					changes: body.changes?.filter(
						(change) => !['note', 'tag', 'source'].includes(change.kind),
					),
				});
			},
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
			trash: withTrash
				? {
						read: async () => structuredClone(device.trash),
						async apply(put, remove) {
							const gone = new Set([
								...remove,
								...put.map((entry) => entry.id),
							]);
							device.trash = [
								...structuredClone(put),
								...device.trash.filter((entry) => !gone.has(entry.id)),
							];
						},
					}
				: undefined,
			sources: withSources
				? {
						read: async () => structuredClone(device.sources),
						async apply(put, remove) {
							const gone = new Set([...remove, ...put.map(({id}) => id)]);
							device.sources = [
								...device.sources.filter(({id}) => !gone.has(id)),
								...structuredClone(put),
							];
						},
					}
				: undefined,
			async writeLibrary(next) {
				device.store = structuredClone(next);
				if (beforeNotes) {
					// Its normalizer rebuilds every bookmark from the fields it knows.
					device.store.bookmarks = device.store.bookmarks.map(
						({notes: _notes, tags: _tags, hiddenKinds: _hidden, ...rest}) =>
							rest,
					);
				}
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
	// A local change waits 1.5 s for its round, so the fake clock runs a minute of rounds by hand.
	vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
	try {
		await device.client.connect(URL_BASE, TOKEN);
		await vi.advanceTimersByTimeAsync(60_000);
	} finally {
		vi.useRealTimers();
	}

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

test('a server restored from an older backup gets back what it lost, and the device keeps its library', async () => {
	const server = makeServer();
	const device = makeDevice(server, {
		...emptyStore(),
		bookmarks: [bookmark('old')],
	});
	await device.client.connect(URL_BASE, TOKEN);
	const backup = await server.export();
	device.edit((store) => ({
		...store,
		bookmarks: [...store.bookmarks, bookmark('newer')],
	}));
	await device.client.syncNow();

	await server.restore(backup);
	await device.client.syncNow();
	assert.deepEqual(ids(device.store), ['old', 'newer']);
	const restored = await server.export();
	assert.ok(
		restored.some((line) => line.includes('"id":"newer"')),
		'the server has the newer bookmark again',
	);
	assert.equal((await device.client.status()).pending, 0);
});

test('settings sync by default and stay put when this device turns it off', async () => {
	const server = makeServer();
	const a = makeDevice(server);
	const b = makeDevice(server);
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);

	a.edit((store) => ({
		...store,
		settings: {...store.settings, sessionSort: 'name'},
	}));
	await until(() => b.store.settings.sessionSort === 'name');

	b.storage.set(SYNC_SETTINGS_KEY, false);
	a.edit((store) => ({
		...store,
		settings: {...store.settings, sessionSort: 'newest'},
	}));
	await a.client.syncNow();
	await b.client.syncNow();
	assert.equal(b.store.settings.sessionSort, 'name');

	b.edit((store) => ({
		...store,
		settings: {...store.settings, sessionSort: 'oldest'},
	}));
	await b.client.syncNow();
	await a.client.syncNow();
	assert.equal(a.store.settings.sessionSort, 'newest');
});

const trashEntry = (id: string, extra = ''): TrashEntry => ({
	id,
	kind: 'bookmark',
	deletedAt: Date.now(),
	label: id,
	origin: 'Links',
	count: 1,
	data: {bookmark: bookmark(id), columnId: 'col', prevId: null, extra},
});

const trashIds = (device: Device) => device.trash.map((entry) => entry.id);

test('the trash follows the library: a delete reaches the other device, a restore takes it back out', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withTrash: true});
	const b = makeDevice(server, emptyStore(), {withTrash: true});
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);

	a.trash = [trashEntry('gone-1'), trashEntry('gone-2')];
	a.client.localChanged();
	await until(() => trashIds(b).length === 2);
	assert.deepEqual(trashIds(b).toSorted(), ['gone-1', 'gone-2']);
	assert.equal(b.trash[0].label.startsWith('gone'), true);
	assert.deepEqual(b.trash[0].data.bookmark, bookmark(b.trash[0].id));

	// Restored on b: gone from the trash there, and from a's.
	b.trash = b.trash.filter((entry) => entry.id !== 'gone-1');
	b.client.localChanged();
	await until(() => trashIds(a).length === 1);
	assert.deepEqual(trashIds(a), ['gone-2']);

	// Emptied on a.
	a.trash = [];
	a.client.localChanged();
	await until(() => b.trash.length === 0);
});

test('a new device gets the trash along with the library', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withTrash: true});
	a.trash = [trashEntry('old')];
	await a.client.connect(URL_BASE, TOKEN);
	const b = makeDevice(server, emptyStore(), {withTrash: true});
	await b.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(trashIds(b), ['old']);
});

test('an entry too large for the server stays on the device and does not stop sync', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withTrash: true});
	const b = makeDevice(server, emptyStore(), {withTrash: true});
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);

	a.trash = [trashEntry('huge', 'x'.repeat(250_000)), trashEntry('small')];
	a.edit((store) => ({...store, bookmarks: [bookmark('b1')]}));
	await until(() => trashIds(b).length === 1 && ids(b.store).length === 1);
	assert.deepEqual(trashIds(b), ['small']);
	assert.deepEqual(trashIds(a).toSorted(), ['huge', 'small']);
	assert.equal((await a.client.status()).error, null);
});

test('a server without the trash feature keeps syncing the library and leaves the trash alone', async () => {
	const server = makeServer({legacy: true});
	const a = makeDevice(server, emptyStore(), {withTrash: true});
	const b = makeDevice(server, emptyStore(), {withTrash: true});
	a.trash = [trashEntry('local-only')];
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);

	a.edit((store) => ({...store, bookmarks: [bookmark('b1')]}));
	await until(() => ids(b.store).length === 1);
	assert.deepEqual(b.trash, []);
	assert.deepEqual(trashIds(a), ['local-only']);
	assert.equal((await a.client.status()).error, null);
	assert.equal((await a.client.status()).pending, 0);
});

test('a device without a trash keeps the library in step and never deletes the trash others made', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withTrash: true});
	const plain = makeDevice(server);
	await a.client.connect(URL_BASE, TOKEN);
	await plain.client.connect(URL_BASE, TOKEN);

	a.trash = [trashEntry('kept')];
	a.edit((store) => ({...store, bookmarks: [bookmark('b1')]}));
	await until(() => ids(plain.store).length === 1);
	plain.edit((store) => ({...store, bookmarks: []}));
	await until(() => a.store.bookmarks.length === 0);
	assert.deepEqual(trashIds(a), ['kept']);
});

const withNote = (id: string, notes: string) => ({...bookmark(id), notes});
const notesOf = (store: Store) =>
	store.bookmarks.map((entry) => entry.notes ?? '');

test('bookmark notes sync, and a version from before notes never sees or erases them', async () => {
	const server = makeServer();
	const a = makeDevice(server, {
		...emptyStore(),
		bookmarks: [withNote('b1', 'Why I saved this')],
	});
	const old = makeDevice(server, emptyStore(), {beforeNotes: true});
	await a.client.connect(URL_BASE, TOKEN);
	await old.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(ids(old.store), ['b1']);

	// The old version renames the bookmark: the rename reaches the others, the note stays.
	old.edit((store) => ({
		...store,
		bookmarks: store.bookmarks.map((entry) => ({...entry, title: 'Renamed'})),
	}));
	await until(() => a.store.bookmarks[0]?.title === 'Renamed');
	await old.client.syncNow();
	await a.client.syncNow();
	assert.deepEqual(notesOf(a.store), ['Why I saved this']);

	const fresh = makeDevice(server);
	await fresh.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(notesOf(fresh.store), ['Why I saved this']);
	assert.equal(fresh.store.bookmarks[0].title, 'Renamed');
});

test('a server without the notes feature keeps syncing the library and leaves the notes on the device', async () => {
	const server = makeServer({legacy: true});
	const a = makeDevice(server, {
		...emptyStore(),
		bookmarks: [withNote('b1', 'Stays here')],
	});
	const b = makeDevice(server);
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(ids(b.store), ['b1']);
	assert.deepEqual(notesOf(b.store), ['']);

	b.edit((store) => ({
		...store,
		bookmarks: store.bookmarks.map((entry) => ({...entry, title: 'Renamed'})),
	}));
	await until(() => a.store.bookmarks[0]?.title === 'Renamed');
	assert.deepEqual(notesOf(a.store), ['Stays here']);
	assert.equal((await a.client.status()).error, null);
	assert.equal((await a.client.status()).pending, 0);
});

test('a resync against a server without the notes feature keeps the notes this device already synced', async () => {
	const server = makeServer();
	const a = makeDevice(server, {
		...emptyStore(),
		bookmarks: [withNote('b1', 'Synced before')],
	});
	await a.client.connect(URL_BASE, TOKEN);
	assert.equal((await a.client.status()).pending, 0);

	// The server is rolled back to a version without notes, and asks for a full pull.
	server.setLegacy(true);
	// Past the ten minutes the client trusts the server's earlier list of features.
	vi.useFakeTimers({now: Date.now() + 11 * 60 * 1000, toFake: ['Date']});
	try {
		server.resyncOnce();
		await a.client.syncNow();
	} finally {
		vi.useRealTimers();
	}

	assert.deepEqual(notesOf(a.store), ['Synced before']);
	assert.equal((await a.client.status()).error, null);
});

test('a server from before versions connects and syncs, and shows no version', async () => {
	const server = makeServer();
	server.setStatus(({version: _dropped, ...body}) => body);
	const a = makeDevice(server, {...emptyStore(), bookmarks: [bookmark('b1')]});
	const b = makeDevice(server);
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(ids(b.store), ['b1']);
	const status = await b.client.status();
	assert.equal(status.error, null);
	assert.equal(status.server?.version, null);
	assert.equal(readCompat(status).incompatible, undefined);
});

test('a server on another protocol is refused at Connect with the side to update', async () => {
	const server = makeServer();
	const device = makeDevice(server);
	server.setStatus((body) => ({...body, protocol: 2}));
	await assert.rejects(device.client.connect(URL_BASE, TOKEN), (error) => {
		assert.ok(error instanceof SyncError);
		assert.equal(error.kind, 'incompatible');
		assert.match(
			error.message,
			/older than your sync server\. Update TabLodge/,
		);
		return true;
	});
	server.setStatus((body) => ({...body, protocol: 0}));
	await assert.rejects(
		device.client.connect(URL_BASE, TOKEN),
		/Update the server to 0\.2\.0 or later/,
	);
	assert.equal(device.storage.has(SYNC_CONFIG_KEY), false);
});

test('a connected device notices a new protocol on a later sync, stops, and keeps its library', async () => {
	const server = makeServer();
	const a = makeDevice(server, {...emptyStore(), bookmarks: [bookmark('b1')]});
	await a.client.connect(URL_BASE, TOKEN);
	await until(() => server.sockets.size === 1);

	server.setStatus((body) => ({...body, protocol: 2}));
	a.edit((store) => ({
		...store,
		bookmarks: [...store.bookmarks, bookmark('b2')],
	}));
	server.requests.length = 0;
	// Past the ten minutes the client trusts the server's last answer.
	vi.useFakeTimers({now: Date.now() + 11 * 60 * 1000, toFake: ['Date']});
	try {
		await a.client.syncNow();
	} finally {
		vi.useRealTimers();
	}

	const stopped = await a.client.status();
	assert.equal(stopped.phase, 'error');
	assert.equal(stopped.incompatible, 'app');
	assert.match(stopped.error ?? '', /Update TabLodge/);
	assert.deepEqual(ids(a.store), ['b1', 'b2']);
	assert.deepEqual(server.requests, ['/v1/status']);
	assert.equal(problemBanner(readCompat(stopped))?.stopped, true);

	// The answer that stopped sync is not kept: once the server is back on this protocol, the next round goes ahead.
	server.setStatus(undefined);
	await a.client.syncNow();
	const resumed = await a.client.status();
	assert.equal(resumed.phase, 'idle');
	assert.equal(resumed.incompatible, undefined);
	const b = makeDevice(server);
	await b.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(ids(b.store), ['b1', 'b2']);
});

test('a live reconnect asks the server again, so an update is noticed at once', async () => {
	const server = makeServer();
	const a = makeDevice(server, {...emptyStore(), bookmarks: [bookmark('b1')]});
	vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
	try {
		await a.client.connect(URL_BASE, TOKEN);
		await vi.advanceTimersByTimeAsync(100);
		assert.equal((await a.client.status()).live, true);

		// The server restarts on another protocol: the socket drops and comes back within the ten minutes.
		server.setStatus((body) => ({...body, protocol: 0}));
		for (const socket of server.sockets) {
			socket.close();
		}

		await vi.advanceTimersByTimeAsync(6000);
	} finally {
		vi.useRealTimers();
	}

	await until(() => server.sockets.size === 1);
	await a.client.syncNow();
	const status = await a.client.status();
	assert.equal(status.incompatible, 'server');
	assert.match(status.error ?? '', /Update the server to 0\.2\.0 or later/);
	assert.deepEqual(ids(a.store), ['b1']);
});

test('a server without some features keeps syncing and lists what stays on the device', async () => {
	const server = makeServer({legacy: true});
	const a = makeDevice(server, {...emptyStore(), bookmarks: [bookmark('b1')]});
	await a.client.connect(URL_BASE, TOKEN);
	const status = await a.client.status();
	assert.equal(status.phase, 'idle');
	assert.equal(status.error, null);
	const compat = readCompat(status);
	// This test server keeps no shared pages either.
	assert.deepEqual(
		compat.missing.map(({name}) => name),
		['notes', 'tags', 'sources', 'trash', 'shared-pages'],
	);
	assert.equal(problemBanner(compat)?.stopped, false);

	// Disconnecting forgets what the server said.
	const off = await a.client.disconnect();
	assert.equal(off.server, undefined);
});

const withTags = (id: string, tags: string[]) => ({
	...bookmark(id),
	tags,
	hiddenKinds: ['repo' as const],
});
const tagsOf = (store: Store) =>
	store.bookmarks.map((entry) => [entry.tags ?? [], entry.hiddenKinds ?? []]);

test('bookmark tags sync, and a version from before tags never sees or erases them', async () => {
	const server = makeServer();
	const a = makeDevice(server, {
		...emptyStore(),
		bookmarks: [withTags('b1', ['rust'])],
	});
	const old = makeDevice(server, emptyStore(), {beforeNotes: true});
	await a.client.connect(URL_BASE, TOKEN);
	await old.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(ids(old.store), ['b1']);

	old.edit((store) => ({
		...store,
		bookmarks: store.bookmarks.map((entry) => ({...entry, title: 'Renamed'})),
	}));
	await until(() => a.store.bookmarks[0]?.title === 'Renamed');
	await old.client.syncNow();
	await a.client.syncNow();
	assert.deepEqual(tagsOf(a.store), [[['rust'], ['repo']]]);

	const fresh = makeDevice(server);
	await fresh.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(tagsOf(fresh.store), [[['rust'], ['repo']]]);
	assert.equal(fresh.store.bookmarks[0].title, 'Renamed');
});

test('a server without the tags feature keeps syncing and leaves the tags on the device, through a resync too', async () => {
	const server = makeServer({legacy: true});
	const a = makeDevice(server, {
		...emptyStore(),
		bookmarks: [withTags('b1', ['stays'])],
	});
	const b = makeDevice(server);
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(tagsOf(b.store), [[[], []]]);

	b.edit((store) => ({
		...store,
		bookmarks: store.bookmarks.map((entry) => ({...entry, title: 'Renamed'})),
	}));
	await until(() => a.store.bookmarks[0]?.title === 'Renamed');
	assert.deepEqual(tagsOf(a.store), [[['stays'], ['repo']]]);
	assert.equal((await a.client.status()).pending, 0);

	vi.useFakeTimers({now: Date.now() + 11 * 60 * 1000, toFake: ['Date']});
	try {
		server.resyncOnce();
		await a.client.syncNow();
	} finally {
		vi.useRealTimers();
	}

	assert.deepEqual(tagsOf(a.store), [[['stays'], ['repo']]]);
	assert.equal((await a.client.status()).error, null);
});

test('a status request that fails ends the round, so the tags in that pull are not skipped for good', async () => {
	const server = makeServer();
	const a = makeDevice(server, {...emptyStore(), bookmarks: [bookmark('b1')]});
	const b = makeDevice(server);
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	// No live notice: b only pulls when asked to.
	for (const socket of server.sockets) {
		socket.close();
	}

	a.edit((store) => ({...store, bookmarks: [withTags('b1', ['later'])]}));
	await a.client.syncNow();
	server.setStatusFails(true);
	// Past the ten minutes the client trusts the server's earlier list of features.
	vi.useFakeTimers({now: Date.now() + 11 * 60 * 1000, toFake: ['Date']});
	try {
		await b.client.syncNow();
		assert.match((await b.client.status()).error ?? '', /error/);
		server.setStatusFails(false);
		await b.client.syncNow();
	} finally {
		vi.useRealTimers();
	}

	assert.deepEqual(tagsOf(b.store), [[['later'], ['repo']]]);
});

const sourceIds = (device: Device) =>
	device.sources.map(({id}) => id).toSorted();
const sourceOf = (device: Device, id: string) =>
	device.sources.find((source) => source.id === id)?.value;

test('Sources choices sync between browsers: on, a changed column and save mode, and a removal', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withSources: true});
	const b = makeDevice(server, emptyStore(), {withSources: true});
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);

	a.sources = [{id: 'reddit', value: {}}];
	a.client.localChanged();
	await until(() => sourceIds(b).includes('reddit'));

	a.sources = [{id: 'reddit', value: {columnId: 'col', keepOffSite: true}}];
	a.client.localChanged();
	await until(() => sourceOf(b, 'reddit')?.keepOffSite === true);
	assert.deepEqual(sourceOf(b, 'reddit'), {columnId: 'col', keepOffSite: true});

	a.sources = [];
	a.client.localChanged();
	await until(() => b.sources.length === 0);
	assert.equal((await b.client.status()).pending, 0);
});

test('a site or field this version does not know goes back to the server unchanged', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withSources: true});
	a.sources = [{id: 'mastodon', value: {columnId: 'col', later: {x: 1}}}];
	await a.client.connect(URL_BASE, TOKEN);
	const b = makeDevice(server, emptyStore(), {withSources: true});
	await b.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(sourceOf(b, 'mastodon'), {columnId: 'col', later: {x: 1}});
	// Device b edits the library; nothing it sends touches the choice.
	b.edit((store) => ({...store, bookmarks: [bookmark('b1')]}));
	await until(() => ids(a.store).length === 1);
	await a.client.syncNow();
	assert.deepEqual(sourceOf(a, 'mastodon'), {columnId: 'col', later: {x: 1}});
});

test('a version from 0.3.0 and the Android app sync with Sources choices present and never remove them', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withSources: true});
	a.sources = [{id: 'youtube', value: {columnId: 'col'}}];
	await a.client.connect(URL_BASE, TOKEN);
	const old = makeDevice(server, emptyStore(), {beforeNotes: true});
	// The Android app's host has no Sources.
	const phone = makeDevice(server, emptyStore(), {withTrash: true});
	await old.client.connect(URL_BASE, TOKEN);
	await phone.client.connect(URL_BASE, TOKEN);

	old.edit((store) => ({...store, bookmarks: [bookmark('b1')]}));
	await until(() => ids(phone.store).length === 1);
	phone.edit((store) => ({
		...store,
		bookmarks: store.bookmarks.map((entry) => ({...entry, title: 'Renamed'})),
	}));
	await until(() => a.store.bookmarks[0]?.title === 'Renamed');
	await old.client.syncNow();
	await phone.client.syncNow();
	await a.client.syncNow();
	assert.equal((await old.client.status()).error, null);
	assert.equal((await phone.client.status()).error, null);

	const fresh = makeDevice(server, emptyStore(), {withSources: true});
	await fresh.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(fresh.sources, [{id: 'youtube', value: {columnId: 'col'}}]);
	assert.equal(fresh.store.bookmarks[0].title, 'Renamed');
});

test('a server without the sources feature keeps syncing the library and leaves Sources in each browser', async () => {
	const server = makeServer({legacy: true});
	const a = makeDevice(server, emptyStore(), {withSources: true});
	a.sources = [{id: 'github', value: {}}];
	const b = makeDevice(server, emptyStore(), {withSources: true});
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	b.edit((store) => ({...store, bookmarks: [bookmark('b1')]}));
	await until(() => ids(a.store).length === 1);
	assert.deepEqual(b.sources, []);
	assert.deepEqual(sourceIds(a), ['github']);
	assert.equal((await a.client.status()).pending, 0);

	// Once the server is updated, the choices go out.
	server.setLegacy(false);
	vi.useFakeTimers({now: Date.now() + 11 * 60 * 1000, toFake: ['Date']});
	try {
		await a.client.syncNow();
		await b.client.syncNow();
	} finally {
		vi.useRealTimers();
	}

	assert.deepEqual(sourceIds(b), ['github']);
});

test('a browser that skipped Sources choices on 0.3.0 gets them once it updates, and keeps its own edits', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withSources: true});
	a.sources = [{id: 'youtube', value: {columnId: 'col'}}];
	await a.client.connect(URL_BASE, TOKEN);
	// Pages past one push, so the pull from the start runs over several of them.
	a.edit((store) => ({
		...store,
		bookmarks: Array.from({length: 600}, (_, index) => bookmark(`b${index}`)),
	}));
	await a.client.syncNow();

	const old = makeDevice(server, emptyStore(), {beforeNotes: true});
	await old.client.connect(URL_BASE, TOKEN);
	assert.equal(ids(old.store).length, 600);
	// An edit made on 0.3.0 that is still waiting when the browser updates.
	server.setOnline(false);
	old.edit((store) => ({
		...store,
		bookmarks: store.bookmarks.map((entry) =>
			entry.id === 'b0' ? {...entry, title: 'Edited on 0.3.0'} : entry,
		),
	}));
	await old.client.syncNow();
	old.client.stop();
	server.setOnline(true);

	// The same browser on this version: same storage, now with Sources.
	const updated = makeDevice(server, old.store, {
		withSources: true,
		storage: old.storage,
	});
	const before = server.pushes.length;
	await updated.client.wake();
	assert.deepEqual(updated.sources, [
		{id: 'youtube', value: {columnId: 'col'}},
	]);
	// One push with the waiting edit, not a restart that sends every record again as after a server reset.
	assert.deepEqual(server.pushes.slice(before), [1]);
	await a.client.syncNow();
	assert.equal(
		a.store.bookmarks.find((entry) => entry.id === 'b0')?.title,
		'Edited on 0.3.0',
	);
	assert.equal((await updated.client.status()).pending, 0);
});

test('a stored sync state with a malformed list of pulled kinds still syncs', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withSources: true});
	a.sources = [{id: 'github', value: {}}];
	await a.client.connect(URL_BASE, TOKEN);
	const b = makeDevice(server, emptyStore(), {withSources: true});
	await b.client.connect(URL_BASE, TOKEN);
	const key = 'tablodge.sync.state';
	b.storage.set(key, {...(b.storage.get(key) as object), pulled: {}});
	await b.client.syncNow();
	assert.equal((await b.client.status()).error, null);
	assert.deepEqual(sourceIds(b), ['github']);
});
