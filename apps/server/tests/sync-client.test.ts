import assert from 'node:assert/strict';
import {test, vi} from 'vite-plus/test';
import {toBase64} from '../../extension/src/shared/private-lock';
import {
	THUMB_MAX_BYTES,
	createImageStore,
	imageId,
	type ImageStore,
} from '../../extension/src/shared/image-store';
import {
	PNG,
	memoryStorage,
	picture,
} from '../../extension/tests/image-fixtures';
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
	type SyncCodec,
	SyncError,
	type SyncSocket,
} from '../../extension/src/shared/sync/client';
import {
	problemBanner,
	readCompat,
} from '../../extension/src/shared/sync/compat';
import type {SyncedSource} from '../../extension/src/shared/sync/library-records';
import {spreadKeys} from '../../extension/src/shared/sync/order-key';
import {startClock, tick} from '../../extension/src/shared/sync/clock';

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

function makeServer(options: {legacy?: boolean} = {}) {
	let legacy = options.legacy ?? false;
	let resyncNext = false;
	let rewriteStatus: ((body: Record<string, unknown>) => unknown) | undefined;
	const requests: string[] = [];
	const pushes: number[] = [];
	const pushed: string[] = [];
	const sockets = new Set<FakeSocket>();
	let currentLog = new ChangeLog();
	const createServerApi = () =>
		createApi({
			token: TOKEN,
			log: (() => {
				currentLog = new ChangeLog();
				const log = currentLog;
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
		setStatus(rewrite: typeof rewriteStatus) {
			rewriteStatus = rewrite;
		},
		setOnline(value: boolean) {
			online = value;
		},
		setStatusFails(value: boolean) {
			statusFails = value;
		},
		pushed,
		setLegacy(value: boolean) {
			legacy = value;
		},
		resyncOnce() {
			resyncNext = true;
		},
		purge(before: number) {
			currentLog.purge(before);
		},
		async fetch(url: string, init: RequestInit) {
			if (!online) {
				throw new TypeError('Failed to fetch');
			}

			requests.push(new URL(url).pathname);
			if (init.method === 'POST' && new URL(url).pathname === '/v1/changes') {
				pushed.push(String(init.body));
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

			if (new URL(url).pathname === '/v1/status') {
				const body = (await response.json()) as {features: string[]};
				return Response.json({
					...body,
					features: body.features.filter(
						(feature) =>
							![
								'trash',
								'notes',
								'tags',
								'sources',
								'settings',
								'thumbs',
							].includes(feature),
					),
				});
			}

			if (
				init.method === 'POST' &&
				/"kind":"(?:trash|note|tag|source|setting|thumb)"/.test(
					String(init.body),
				)
			) {
				return Response.json({error: 'bad_change'}, {status: 400});
			}

			return response;
		},
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
	trash: TrashEntry[];
	sources: SyncedSource[];
	editedDuringApply?: () => boolean;
	images: ImageStore;
	outside: Record<string, unknown>;
	storage: Map<string, unknown>;
	backups: string[];
	client: ReturnType<typeof createSyncClient>;
	edit(change: (store: Store) => Store): void;
};

const OUTSIDE_DEFAULTS = {
	uiTheme: 'system',
	uiAccent: 'default',
	privateAccent: 'teal',
};

function makeDevice(
	server: ReturnType<typeof makeServer>,
	store = emptyStore(),
	{
		withTrash = false,
		withSources = false,
		withImages = false,
		withOutside = false,
		beforeNotes = false,
		storage = new Map<string, unknown>(),
		codec = undefined as SyncCodec | undefined,
	} = {},
) {
	let queue = Promise.resolve();
	const backups: string[] = [];
	const images = createImageStore(memoryStorage().storage);
	const device: Device = {
		store,
		trash: [],
		sources: [],
		images,
		outside: {...OUTSIDE_DEFAULTS},
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
				if (beforeNotes && new URL(url).pathname === '/v1/status') {
					const body = (await response.json()) as {features?: string[]};
					return Response.json({
						...body,
						features: body.features?.filter(
							(feature) => feature !== 'settings',
						),
					});
				}

				if (!beforeNotes || new URL(url).pathname !== '/v1/changes') {
					return response;
				}

				const body = (await response.json()) as {
					changes?: Array<{kind: string}>;
				};
				return Response.json({
					...body,
					changes: body.changes?.filter(
						(change) =>
							!['note', 'tag', 'source', 'setting', 'thumb'].includes(
								change.kind,
							),
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
							if (device.editedDuringApply?.()) {
								return;
							}

							const gone = new Set([...remove, ...put.map(({id}) => id)]);
							device.sources = [
								...device.sources.filter(({id}) => !gone.has(id)),
								...structuredClone(put),
							];
						},
					}
				: undefined,
			thumbs: withImages
				? {
						read: async () => images.synced(),
						apply: async (put, remove) => images.applySynced(put, remove),
					}
				: undefined,
			outsideSettings: withOutside
				? {
						defaults: OUTSIDE_DEFAULTS,
						read: async () => structuredClone(device.outside),
						async apply(put, was) {
							for (const [id, value] of Object.entries(put)) {
								if (was[id] === undefined || was[id] === device.outside[id]) {
									device.outside[id] = value;
								}
							}
						},
					}
				: undefined,
			async writeLibrary(next) {
				device.store = structuredClone(next);
				if (beforeNotes) {
					device.store.bookmarks = device.store.bookmarks.map(
						({notes: _notes, tags: _tags, hiddenKinds: _hidden, ...rest}) =>
							rest,
					);
				}
			},
			async backup(_store, reason) {
				backups.push(reason);
			},
			codec,
			randomId() {
				deviceCount += 1;
				return `device-${deviceCount}`;
			},
			now: () => Date.now(),
		}),
		edit(change: (store: Store) => Store) {
			device.store = change(device.store);
			device.client.localChanged();
		},
	};
	return device;
}

vi.setConfig({testTimeout: 15_000});

async function until(check: () => boolean, ms = 8000) {
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

const withSettings = (settings: Partial<Settings>): Store => ({
	...emptyStore(),
	settings: {...emptyStore().settings, ...settings},
});

test('a setting added since 0.3.0 syncs like the others, and stays put while this device turns settings sync off', async () => {
	const server = makeServer();
	const a = makeDevice(server, withSettings({snapshotKeep: 25}));
	const b = makeDevice(server, withSettings({snapshotKeep: 25}));
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);

	a.edit((store) => ({
		...store,
		settings: {...store.settings, snapshotKeep: 50, siteIcons: 'browser'},
	}));
	await until(() => b.store.settings.snapshotKeep === 50);
	assert.equal(b.store.settings.siteIcons, 'browser');

	b.storage.set(SYNC_SETTINGS_KEY, false);
	a.edit((store) => ({
		...store,
		settings: {...store.settings, snapshotKeep: 10},
	}));
	await a.client.syncNow();
	await b.client.syncNow();
	assert.equal(b.store.settings.snapshotKeep, 50);
	b.edit((store) => ({
		...store,
		settings: {...store.settings, snapshotKeep: 25},
	}));
	await b.client.syncNow();
	await a.client.syncNow();
	assert.equal(a.store.settings.snapshotKeep, 10);
});

test('the theme and accents sync between browsers, and a phone holds them without taking them', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withOutside: true});
	const b = makeDevice(server, emptyStore(), {withOutside: true});
	const phoneLook = {theme: 'light', 'at.theme': 1};
	const phone = makeDevice(server, withSettings({mobileApp: phoneLook}));
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	await phone.client.connect(URL_BASE, TOKEN);

	a.outside = {uiTheme: 'dark', uiAccent: 'rose', privateAccent: 'same'};
	a.client.localChanged();
	await until(() => b.outside.uiTheme === 'dark');
	assert.deepEqual(b.outside, a.outside);

	await phone.client.syncNow();
	assert.deepEqual(
		phone.store.settings.mobileApp,
		phoneLook,
		"the phone's own look",
	);
	assert.equal(
		phone.store.settings.heldSettings?.uiTheme,
		'dark',
		'held, not read',
	);

	phone.edit((store) => ({...store, bookmarks: [bookmark('p1')]}));
	await phone.client.syncNow();
	await b.client.syncNow();
	assert.equal(b.outside.uiTheme, 'dark');
	assert.match((await settingLine(server, 'uiTheme')) ?? '', /"value":"dark"/);
});

test("the phone's look syncs between phones and leaves the browsers' theme alone", async () => {
	const server = makeServer();
	const browser = makeDevice(server, emptyStore(), {withOutside: true});
	browser.outside.uiTheme = 'light';
	const one = makeDevice(server);
	const two = makeDevice(server);
	await browser.client.connect(URL_BASE, TOKEN);
	await one.client.connect(URL_BASE, TOKEN);
	await two.client.connect(URL_BASE, TOKEN);

	const look = {theme: 'dark', 'at.theme': 5, look: 'ios', 'at.look': 5};
	one.edit((store) => ({
		...store,
		settings: {...store.settings, mobileApp: look},
	}));
	await until(() => two.store.settings.mobileApp?.theme === 'dark');
	assert.deepEqual(two.store.settings.mobileApp, look);
	await browser.client.syncNow();
	assert.equal(browser.outside.uiTheme, 'light');
});

test('a browser at the default theme that syncs first does not overwrite one another browser chose', async () => {
	const server = makeServer();
	const chose = makeDevice(server, emptyStore(), {withOutside: true});
	chose.outside.uiTheme = 'dark';
	await chose.client.connect(URL_BASE, TOKEN);
	const fresh = makeDevice(server, emptyStore(), {withOutside: true});
	await fresh.client.connect(URL_BASE, TOKEN);
	await fresh.client.syncNow();
	await chose.client.syncNow();
	assert.equal(fresh.outside.uiTheme, 'dark');
	assert.equal(chose.outside.uiTheme, 'dark');
});

test('the theme stays in each browser while Sync settings is off there, and on a 0.3.0 browser', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withOutside: true});
	const off = makeDevice(server, emptyStore(), {withOutside: true});
	const old = makeDevice(server, emptyStore(), {
		withOutside: true,
		beforeNotes: true,
	});
	off.storage.set(SYNC_SETTINGS_KEY, false);
	await a.client.connect(URL_BASE, TOKEN);
	await off.client.connect(URL_BASE, TOKEN);
	await old.client.connect(URL_BASE, TOKEN);
	a.outside.uiTheme = 'dark';
	a.client.localChanged();
	await a.client.syncNow();
	await off.client.syncNow();
	await old.client.syncNow();
	assert.equal(off.outside.uiTheme, 'system');
	assert.equal(old.outside.uiTheme, 'system');
	assert.match((await settingLine(server, 'uiTheme')) ?? '', /"value":"dark"/);
});

test('a setting that stays on each device never leaves it', async () => {
	const server = makeServer();
	const a = makeDevice(server, withSettings({autoBackupToDownloads: true}));
	await a.client.connect(URL_BASE, TOKEN);
	const b = makeDevice(server, withSettings({autoBackupToDownloads: false}));
	await b.client.connect(URL_BASE, TOKEN);
	assert.equal(b.store.settings.autoBackupToDownloads, false);
	assert.ok(
		(await server.export()).every(
			(line) => !line.includes('autoBackupToDownloads'),
		),
	);
});

test('when settings start to sync, the server wins over values that never synced: the first browser to sync sets them', async () => {
	const server = makeServer({legacy: true});
	const a = makeDevice(server, withSettings({autoBackup: 'daily'}));
	const b = makeDevice(server, withSettings({autoBackup: 'off'}));
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	assert.equal(b.store.settings.autoBackup, 'off', 'kept local until now');

	server.setLegacy(false);
	vi.useFakeTimers({now: Date.now() + 11 * 60 * 1000, toFake: ['Date']});
	try {
		await a.client.syncNow();
		await b.client.syncNow();
		await a.client.syncNow();
	} finally {
		vi.useRealTimers();
	}

	assert.equal(b.store.settings.autoBackup, 'daily');
	assert.equal(a.store.settings.autoBackup, 'daily');
	assert.equal((await b.client.status()).pending, 0);
});

test("a new install that never changed a setting takes the server's values instead of sending its defaults", async () => {
	const server = makeServer();
	const a = makeDevice(
		server,
		withSettings({snapshotKeep: 50, browserBookmarkAction: 'ask'}),
	);
	await a.client.connect(URL_BASE, TOKEN);
	const fresh = makeDevice(
		server,
		withSettings({snapshotKeep: 25, browserBookmarkAction: 'off'}),
	);
	await fresh.client.connect(URL_BASE, TOKEN);
	await fresh.client.syncNow();
	await a.client.syncNow();
	assert.equal(fresh.store.settings.snapshotKeep, 50);
	assert.equal(fresh.store.settings.browserBookmarkAction, 'ask');
	assert.equal(a.store.settings.snapshotKeep, 50);
	assert.equal(a.store.settings.browserBookmarkAction, 'ask');
});

test('a device at the defaults that syncs first sends none of them, so the values another browser chose win', async () => {
	const server = makeServer({legacy: true});
	const a = makeDevice(server, withSettings({autoBackup: 'daily'}));
	const phone = makeDevice(
		server,
		withSettings({autoBackup: 'off', snapshotKeep: 25}),
	);
	await a.client.connect(URL_BASE, TOKEN);
	await phone.client.connect(URL_BASE, TOKEN);

	server.setLegacy(false);
	vi.useFakeTimers({now: Date.now() + 11 * 60 * 1000, toFake: ['Date']});
	try {
		await phone.client.syncNow();
		assert.ok(
			(await server.export()).every((line) => !line.includes('"setting"')),
			'no defaults went out',
		);
		await a.client.syncNow();
		await phone.client.syncNow();
	} finally {
		vi.useRealTimers();
	}

	assert.equal(a.store.settings.autoBackup, 'daily');
	assert.equal(phone.store.settings.autoBackup, 'daily');

	phone.edit((store) => ({
		...store,
		settings: {...store.settings, autoBackup: 'off'},
	}));
	await phone.client.syncNow();
	await a.client.syncNow();
	assert.equal(a.store.settings.autoBackup, 'off');
});

const wrapCodec: SyncCodec = {
	async prepare() {},
	async seal(change) {
		return change.deleted ? change : {...change, value: {sealed: change.value}};
	},
	async open(change) {
		const value = change.value as {sealed?: unknown} | undefined;
		return value && typeof value === 'object' && 'sealed' in value
			? {change: {...change, value: value.sealed}, reseal: false}
			: {change, reseal: true};
	},
};

const settingLine = async (server: ReturnType<typeof makeServer>, id: string) =>
	(await server.export()).find(
		(line) =>
			line.includes('"kind":"setting"') && line.includes(`"id":"${id}"`),
	);

test('a setting that synced and went back to its default is still resent, and resealed', async () => {
	const server = makeServer();
	const plain = makeDevice(server, withSettings({snapshotKeep: 50}));
	await plain.client.connect(URL_BASE, TOKEN);
	plain.edit((store) => ({
		...store,
		settings: {...store.settings, snapshotKeep: 25},
	}));
	await plain.client.syncNow();
	const sealer = makeDevice(server, withSettings({snapshotKeep: 25}), {
		codec: wrapCodec,
	});
	await sealer.client.connect(URL_BASE, TOKEN);
	await sealer.client.syncNow();
	assert.match(
		(await settingLine(server, 'snapshotKeep')) ?? '',
		/"sealed":25/,
	);

	const lost = makeServer();
	const a = makeDevice(lost, withSettings({snapshotKeep: 50}));
	await a.client.connect(URL_BASE, TOKEN);
	a.edit((store) => ({
		...store,
		settings: {...store.settings, snapshotKeep: 25},
	}));
	await a.client.syncNow();
	await lost.restore(await makeServer().export());
	await a.client.resendAll();
	assert.match((await settingLine(lost, 'snapshotKeep')) ?? '', /"value":25/);
});

test('a setting from a newer version is held and goes back unchanged', async () => {
	const server = makeServer();
	const newer = makeDevice(
		server,
		withSettings({heldSettings: {fromNewer: {mode: 'x'}}}),
	);
	await newer.client.connect(URL_BASE, TOKEN);
	const b = makeDevice(server);
	await b.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(b.store.settings.heldSettings, {fromNewer: {mode: 'x'}});

	const before = server.pushes.length;
	b.edit((store) => ({...store, bookmarks: [bookmark('b1')]}));
	await until(() => ids(newer.store).length === 1);
	await b.client.syncNow();
	await b.client.syncNow();
	assert.deepEqual(server.pushes.slice(before), [1], 'only the bookmark');

	const fresh = makeDevice(server);
	await fresh.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(fresh.store.settings.heldSettings, {
		fromNewer: {mode: 'x'},
	});
});

test('a version from 0.3.0 and a server without the feature keep newer settings where they are', async () => {
	const server = makeServer();
	const a = makeDevice(server, withSettings({snapshotKeep: 50}));
	await a.client.connect(URL_BASE, TOKEN);
	const old = makeDevice(server, withSettings({snapshotKeep: 10}), {
		beforeNotes: true,
	});
	await old.client.connect(URL_BASE, TOKEN);
	old.edit((store) => ({...store, bookmarks: [bookmark('b1')]}));
	await until(() => ids(a.store).length === 1);
	await old.client.syncNow();
	await a.client.syncNow();
	assert.equal(old.store.settings.snapshotKeep, 10);
	assert.equal(a.store.settings.snapshotKeep, 50);
	assert.equal((await old.client.status()).error, null);

	const legacy = makeServer({legacy: true});
	const c = makeDevice(legacy, withSettings({snapshotKeep: 50}));
	const d = makeDevice(legacy, withSettings({snapshotKeep: 25}));
	await c.client.connect(URL_BASE, TOKEN);
	await d.client.connect(URL_BASE, TOKEN);
	assert.equal(d.store.settings.snapshotKeep, 25);
	assert.equal((await c.client.status()).error, null);
	assert.equal((await c.client.status()).pending, 0);
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

	b.trash = b.trash.filter((entry) => entry.id !== 'gone-1');
	b.client.localChanged();
	await until(() => trashIds(a).length === 1);
	assert.deepEqual(trashIds(a), ['gone-2']);

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

test('an oversized trash entry already on the server stays on every device until one removes it', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withTrash: true});
	await a.client.connect(URL_BASE, TOKEN);
	const huge = trashEntry('older', '€'.repeat(80_000));
	const pushed = await server.app.request('/v1/changes', {
		method: 'POST',
		headers: {authorization: `Bearer ${TOKEN}`},
		body: JSON.stringify({
			changes: [
				{
					kind: 'trash',
					id: huge.id,
					h: tick(startClock(), Date.now()).h,
					d: 'older-version',
					value: huge,
				},
			],
		}),
	});
	assert.equal(pushed.status, 200);

	await a.client.syncNow();
	assert.deepEqual(trashIds(a), ['older']);
	a.edit((store) => ({...store, bookmarks: [bookmark('b1')]}));
	await a.client.syncNow();
	await a.client.syncNow();
	const b = makeDevice(server, emptyStore(), {withTrash: true});
	await b.client.connect(URL_BASE, TOKEN);
	await b.client.syncNow();
	assert.deepEqual(trashIds(b), ['older']);

	b.trash = [];
	b.client.localChanged();
	await until(() => a.trash.length === 0);
	assert.equal((await a.client.status()).error, null);
});

const sealedTooLargeCodec: SyncCodec = {
	...wrapCodec,
	async seal(change) {
		const sealed = await wrapCodec.seal(change);
		return change.id === 'older' && !change.deleted
			? {...sealed, value: {...(sealed.value as object), pad: PADDING}}
			: sealed;
	},
};
const PADDING = 'x'.repeat(100_000);

test('resealing a trash entry the server holds, too large once sealed, neither deletes it nor stops sync', async () => {
	const server = makeServer();
	const plain = makeDevice(server, emptyStore(), {withTrash: true});
	await plain.client.connect(URL_BASE, TOKEN);
	plain.trash = [trashEntry('older', 'x'.repeat(190_000))];
	await plain.client.syncNow();

	const sealer = makeDevice(server, emptyStore(), {
		withTrash: true,
		codec: sealedTooLargeCodec,
	});
	await sealer.client.connect(URL_BASE, TOKEN);
	await sealer.client.resendAll();
	sealer.edit((store) => ({...store, bookmarks: [bookmark('b1')]}));
	await sealer.client.syncNow();
	await plain.client.syncNow();

	assert.deepEqual(trashIds(sealer), ['older']);
	assert.deepEqual(trashIds(plain), ['older']);
	const lines = await server.export();
	assert.ok(lines.some((line) => line.includes('"id":"b1"')));
	const kept = lines.find((line) => line.includes('"id":"older"'));
	assert.doesNotMatch(kept ?? '', /"deleted"|"sealed"/);
	const status = await sealer.client.status();
	assert.deepEqual([status.error, status.pending], [null, 0]);
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

	server.setLegacy(true);
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
	assert.deepEqual(
		compat.missing.map(({name}) => name),
		[
			'notes',
			'tags',
			'thumbs',
			'sources',
			'settings',
			'trash',
			'shared-pages',
			'shared-page-import',
			'shared-page-live-password',
		],
	);
	assert.equal(problemBanner(compat)?.stopped, false);

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
	for (const socket of server.sockets) {
		socket.close();
	}

	a.edit((store) => ({...store, bookmarks: [withTags('b1', ['later'])]}));
	await a.client.syncNow();
	server.setStatusFails(true);
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
	a.edit((store) => ({
		...store,
		bookmarks: Array.from({length: 600}, (_, index) => bookmark(`b${index}`)),
	}));
	await a.client.syncNow();

	const old = makeDevice(server, emptyStore(), {beforeNotes: true});
	await old.client.connect(URL_BASE, TOKEN);
	assert.equal(ids(old.store).length, 600);
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

	const updated = makeDevice(server, old.store, {
		withSources: true,
		storage: old.storage,
	});
	const before = server.pushes.length;
	await updated.client.wake();
	assert.deepEqual(updated.sources, [
		{id: 'youtube', value: {columnId: 'col'}},
	]);
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

test('a Settings edit made while sync applies choices is kept and sent in the same round', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withSources: true});
	const b = makeDevice(server, emptyStore(), {withSources: true});
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	a.sources = [{id: 'reddit', value: {}}];
	a.client.localChanged();
	await until(() => sourceIds(b).includes('reddit'));

	b.editedDuringApply = () => {
		b.editedDuringApply = undefined;
		b.sources = [];
		return true;
	};

	a.sources = [{id: 'reddit', value: {columnId: 'col'}}];
	await a.client.syncNow();
	await b.client.syncNow();
	assert.deepEqual(b.sources, []);
	assert.equal((await b.client.status()).pending, 0);
	await a.client.syncNow();
	assert.deepEqual(a.sources, [], 'the removal went out and won');
});

test('a browser that updates from 0.3.0 still drops a record deleted elsewhere whose delete was purged meanwhile', async () => {
	const server = makeServer();
	const a = makeDevice(
		server,
		{...emptyStore(), bookmarks: [bookmark('b1')]},
		{
			withSources: true,
		},
	);
	await a.client.connect(URL_BASE, TOKEN);
	const old = makeDevice(server, emptyStore(), {beforeNotes: true});
	await old.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(ids(old.store), ['b1']);
	old.client.stop();

	a.edit((store) => ({...store, bookmarks: [bookmark('b2')]}));
	await a.client.syncNow();
	server.purge(Date.now() + 1000);

	const local = {
		...old.store,
		bookmarks: [...old.store.bookmarks, bookmark('mine')],
	};
	const updated = makeDevice(server, local, {
		withSources: true,
		storage: old.storage,
	});
	vi.useFakeTimers({now: Date.now() + 1000, toFake: ['Date']});
	try {
		await updated.client.wake();
		assert.deepEqual(ids(updated.store).toSorted(), ['b2', 'mine']);
		await a.client.syncNow();
	} finally {
		vi.useRealTimers();
	}

	assert.deepEqual(ids(a.store).toSorted(), ['b2', 'mine']);
});

test('a local change waits 2.5 s after the last write, and a steady stream still syncs within 10 s', async () => {
	const server = makeServer();
	const device = makeDevice(server);
	await device.client.connect(URL_BASE, TOKEN);
	const sent = () => server.pushes.length;
	const letRoundFinish = async (pushes: number) => {
		for (let turn = 0; turn < 5000 && sent() < pushes; turn += 1) {
			await new Promise((resolve) => {
				setImmediate(resolve);
			});
		}
	};

	const before = sent();
	const edit = (id: string) => {
		device.edit((store) => ({
			...store,
			bookmarks: [...store.bookmarks, bookmark(id)],
		}));
	};

	vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
	try {
		edit('first');
		await vi.advanceTimersByTimeAsync(2400);
		assert.equal(sent(), before, 'still waiting at 2.4 s');
		edit('second');
		await vi.advanceTimersByTimeAsync(2400);
		assert.equal(sent(), before, 'restarted by the second write');
		await vi.advanceTimersByTimeAsync(1000);
		await letRoundFinish(before + 1);
		assert.equal(sent(), before + 1, 'sent 2.5 s after the last write');

		await vi.advanceTimersByTimeAsync(500);
		await letRoundFinish(Infinity);
		const settled = sent();

		edit('steady-0');
		for (let index = 1; index < 5; index += 1) {
			await vi.advanceTimersByTimeAsync(2000);
			edit(`steady-${index}`);
		}

		assert.equal(sent(), settled, 'held at 8 s');
		await vi.advanceTimersByTimeAsync(1900);
		assert.equal(sent(), settled, 'held until 10 s');
		await vi.advanceTimersByTimeAsync(200);
		await letRoundFinish(settled + 1);
		assert.equal(sent(), settled + 1, 'sent at 10 s');
	} finally {
		vi.useRealTimers();
	}
});

const pictured = (id: string): Store['bookmarks'][number] => ({
	...bookmark(id),
	url: 'https://cdn.example/cat.png',
});

test('a saved image sends its thumbnail and never its bytes, and the other device names who holds the original', async () => {
	const server = makeServer();
	const a = makeDevice(
		server,
		{...emptyStore(), bookmarks: [pictured('b1')]},
		{withImages: true},
	);
	const b = makeDevice(server, emptyStore(), {withImages: true});
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	const sent = server.pushed;
	sent.length = 0;

	assert.ok((await a.images.keep(picture())).ok);
	a.client.localChanged();
	await until(() => sent.length > 0);
	await b.client.syncNow();

	const [thumb] = await b.images.thumbs();
	assert.deepEqual(
		{url: thumb.url, device: thumb.device, held: thumb.held},
		{url: 'https://cdn.example/cat.png', device: 'Desk', held: false},
	);
	assert.equal(await b.images.read(thumb.url), undefined);
	assert.equal((await b.images.usage()).size, 0);
	assert.ok(sent.join('').includes('"kind":"thumb"'));
	assert.ok(
		!sent.join('').includes(PNG),
		'the original never leaves the device',
	);
	assert.equal((await a.images.read(thumb.url))?.data, PNG);

	await b.client.syncNow();
	await a.client.syncNow();
	assert.equal((await a.client.status()).pending, 0);
	assert.equal((await b.client.status()).pending, 0, 'nothing is sent back');
});

test('deleting a saved image on one device removes it on the others, original included', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withImages: true});
	const b = makeDevice(server, emptyStore(), {withImages: true});
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	await a.images.keep(picture());
	a.client.localChanged();
	await a.client.syncNow();
	await b.client.syncNow();
	assert.equal((await b.images.list()).length, 1);

	await b.images.remove('https://cdn.example/cat.png');
	b.client.localChanged();
	await b.client.syncNow();
	await a.client.syncNow();
	assert.deepEqual(await a.images.list(), []);
	assert.equal(await a.images.read('https://cdn.example/cat.png'), undefined);
});

test('a server without the thumbs feature keeps syncing and the images stay on the device', async () => {
	const server = makeServer({legacy: true});
	const a = makeDevice(
		server,
		{...emptyStore(), bookmarks: [pictured('b1')]},
		{withImages: true},
	);
	const b = makeDevice(server, emptyStore(), {withImages: true});
	await a.images.keep(picture());
	await a.client.connect(URL_BASE, TOKEN);
	await b.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(ids(b.store), ['b1']);
	assert.deepEqual(await b.images.list(), []);
	assert.equal((await a.client.status()).error, null);
	assert.equal((await a.client.status()).pending, 0);
	assert.equal((await a.images.list()).length, 1);
});

test('a version from before thumbnails never sees or erases them', async () => {
	const server = makeServer();
	const a = makeDevice(
		server,
		{...emptyStore(), bookmarks: [pictured('b1')]},
		{withImages: true},
	);
	const old = makeDevice(server, emptyStore(), {beforeNotes: true});
	await a.images.keep(picture());
	await a.client.connect(URL_BASE, TOKEN);
	await old.client.connect(URL_BASE, TOKEN);
	old.edit((store) => ({
		...store,
		bookmarks: store.bookmarks.map((entry) => ({...entry, title: 'Renamed'})),
	}));
	await until(() => a.store.bookmarks[0]?.title === 'Renamed');
	await old.client.syncNow();
	await a.client.syncNow();
	assert.equal((await a.images.list()).length, 1);

	const fresh = makeDevice(server, emptyStore(), {withImages: true});
	await fresh.client.connect(URL_BASE, TOKEN);
	assert.deepEqual(
		(await fresh.images.synced()).map((record) => record.id),
		[imageId('https://cdn.example/cat.png')],
	);
});

test('more thumbnails than one request can carry go up in several pushes', async () => {
	const server = makeServer();
	const a = makeDevice(server, emptyStore(), {withImages: true});
	const b = makeDevice(server, emptyStore(), {withImages: true});
	await a.client.connect(URL_BASE, TOKEN);
	const {data: _data, thumb: _thumb, ...meta} = picture();
	const thumb = toBase64(
		Uint8Array.from({length: THUMB_MAX_BYTES}, (_, index) =>
			'RIFF....WEBP'.codePointAt(index % 12)!,
		),
	);
	const count = 450;
	await a.images.applySynced(
		Array.from({length: count}, (_, index) => ({
			...meta,
			thumb,
			url: `https://cdn.example/${index}/${'p'.repeat(14_000)}.png`,
		})),
		[],
	);
	server.pushed.length = 0;
	a.client.localChanged();
	await a.client.syncNow();

	assert.equal((await a.client.status()).error, null);
	assert.equal((await a.client.status()).pending, 0);
	assert.ok(server.pushed.length > 1, 'one request would be over 8 MB');
	for (const body of server.pushed) {
		assert.ok(body.length < 8 * 1024 * 1024);
		for (const change of (JSON.parse(body) as {changes: unknown[]}).changes) {
			assert.ok(JSON.stringify(change).length < 256 * 1024);
		}
	}

	await b.client.connect(URL_BASE, TOKEN);
	assert.equal((await b.images.list()).length, count);
});
