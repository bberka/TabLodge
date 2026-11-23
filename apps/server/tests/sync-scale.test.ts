import assert from 'node:assert/strict';
import {appendFileSync} from 'node:fs';
import process from 'node:process';
import {test, vi} from 'vite-plus/test';
import {createApi} from '../src/api';
import {ChangeLog} from '../../extension/src/shared/sync/change-log';
import {
	createSyncClient,
	SYNC_CONFIG_KEY,
} from '../../extension/src/shared/sync/client';
import {createLibraryState} from '../../extension/src/shared/library-state';
import {normalizeStore} from '../../extension/src/shared/library-normalize';
import type {Raw} from '../../extension/src/shared/library-values';
import type {Store} from '../../extension/src/shared/types';

const TOKEN = 'scale-test-token-0123456789-abcdefghijklm';
const URL_BASE = 'https://sync.example.test';
const SESSIONS = Number(process.env.SYNC_SCALE_SESSIONS ?? 10_000);
const LINKS_PER_SESSION = 3;
const REPORT = process.env.SYNC_SCALE_REPORT;

const link = (prefix: string, index: number) => ({
	id: `${prefix}-t${index}`,
	title: `Link ${index}`,
	url: `https://example.com/${prefix}/${index}`,
	notes: '',
	pinned: false,
	nativeGroup: null,
	savedAt: 1,
	originalIndex: index,
});

function bigLibrary(): Raw {
	return {
		schemaVersion: 10,
		folders: [{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true}],
		bookmarkColumns: [
			{id: 'col', name: 'Links', createdAt: 0, isDefault: true},
		],
		bookmarks: Array.from({length: 1000}, (_, index) => ({
			id: `b${index}`,
			title: `Bookmark ${index}`,
			url: `https://example.com/b/${index}`,
			columnId: 'col',
			createdAt: 1,
			updatedAt: 1,
		})),
		settings: {sessionSort: 'manual'},
		updatedAt: 1,
		groups: Array.from({length: SESSIONS}, (_, session) => ({
			id: `s${session}`,
			name: `Session ${session}`,
			folderId: 'unfiled',
			createdAt: 2 + session,
			updatedAt: 2 + session,
			tabs: Array.from({length: LINKS_PER_SESSION}, (__, index) =>
				link(`s${session}`, index),
			),
		})),
	};
}

function makeBackend() {
	const data = new Map<string, unknown>();
	return {
		data,
		async get(keys: string[]) {
			return Object.fromEntries(
				keys
					.filter((key) => data.has(key))
					.map((key) => [key, structuredClone(data.get(key))]),
			);
		},
		async set(values: Raw) {
			for (const [key, value] of Object.entries(values)) {
				data.set(key, structuredClone(value));
			}
		},
		async remove(keys: string[]) {
			for (const key of keys) {
				data.delete(key);
			}
		},
	};
}

function makeServer() {
	const log = new ChangeLog();
	const app = createApi({token: TOKEN, log: () => log});
	const pushes: number[] = [];
	const hooks: {
		beforePush?: (index: number) => Promise<void> | void;
		offlineAfterPushes?: number;
	} = {};
	return {
		pushes,
		hooks,
		async fetch(url: string, init: RequestInit) {
			if (init.method === 'POST' && new URL(url).pathname === '/v1/changes') {
				if (pushes.length === hooks.offlineAfterPushes) {
					throw new TypeError('Failed to fetch');
				}

				await hooks.beforePush?.(pushes.length);
				pushes.push(
					(JSON.parse(String(init.body)) as {changes: unknown[]}).changes
						.length,
				);
			}

			return app.request(url, init);
		},
	};
}

let deviceCount = 0;

function makeDevice(server: ReturnType<typeof makeServer>) {
	const backend = makeBackend();
	const state = createLibraryState(backend);
	const meter = {
		libraryReads: 0,
		libraryWrites: 0,
		syncStateWrites: 0,
		syncStateChars: 0,
		readMs: 0,
		stateGetMs: 0,
		stateSetMs: 0,
		fetchMs: 0,
		writeMs: 0,
	};
	let queue = Promise.resolve();
	const client = createSyncClient({
		async get(key) {
			const started = performance.now();
			const value = structuredClone(backend.data.get(key));
			meter.stateGetMs += performance.now() - started;
			return value;
		},
		async set(key, value) {
			const started = performance.now();
			if (key === 'tablodge.sync.state') {
				meter.syncStateWrites += 1;
				meter.syncStateChars += JSON.stringify(value).length;
			}

			backend.data.set(key, structuredClone(value));
			meter.stateSetMs += performance.now() - started;
		},
		async remove(keys) {
			for (const key of keys) {
				backend.data.delete(key);
			}
		},
		async fetch(url, init) {
			const started = performance.now();
			const response = await server.fetch(url, init);
			meter.fetchMs += performance.now() - started;
			return response;
		},
		mutate<T>(work: () => Promise<T>) {
			const result = queue.then(work);
			queue = result.then(
				() => undefined,
				() => undefined,
			);
			return result;
		},
		async readLibrary() {
			meter.libraryReads += 1;
			const started = performance.now();
			const store = ((await state.read()) ?? normalizeStore({})) as Store;
			meter.readMs += performance.now() - started;
			return store;
		},
		async writeLibrary(store) {
			meter.libraryWrites += 1;
			const started = performance.now();
			await state.write(normalizeStore(store));
			meter.writeMs += performance.now() - started;
		},
		async backup() {},
		randomId() {
			deviceCount += 1;
			return `scale-device-${deviceCount}`;
		},
		now: () => Date.now(),
	});
	return {
		backend,
		state,
		client,
		meter,
		async seed(raw: Raw) {
			await state.write(normalizeStore(raw));
		},
		async read() {
			return (await state.read()) as unknown as Store;
		},
		async edit(change: (store: Store) => Store) {
			await state.write(change((await state.read()) as unknown as Store));
		},
	};
}

const sessionCount = (store: Store) => store.groups.length;
const linkCount = (store: Store) =>
	store.groups.reduce((sum, group) => sum + group.tabs.length, 0);

vi.setConfig({testTimeout: 600_000});

test(`a library of ${SESSIONS} sessions syncs whole to a second device, and one edit after costs one record`, async () => {
	const server = makeServer();
	const a = makeDevice(server);
	await a.seed(bigLibrary());

	const firstStart = performance.now();
	await a.client.connect(URL_BASE, TOKEN);
	const firstPushMs = Math.round(performance.now() - firstStart);
	const firstPushes = [...server.pushes];
	const firstMeter = {...a.meter};
	assert.ok(a.backend.data.has(SYNC_CONFIG_KEY));

	const b = makeDevice(server);
	const pullStart = performance.now();
	await b.client.connect(URL_BASE, TOKEN);
	const pullMs = Math.round(performance.now() - pullStart);
	const pulled = await b.read();
	assert.equal(sessionCount(pulled), SESSIONS);
	assert.equal(linkCount(pulled), SESSIONS * LINKS_PER_SESSION);
	assert.equal(pulled.bookmarks.length, 1000);
	const original = await a.read();
	assert.deepEqual(
		pulled.groups.map((group) => [
			group.id,
			group.name,
			group.tabs.map((tab) => tab.id),
		]),
		original.groups.map((group) => [
			group.id,
			group.name,
			group.tabs.map((tab) => tab.id),
		]),
	);

	await a.client.syncNow();
	server.pushes.length = 0;
	a.meter.syncStateWrites = 0;
	a.meter.libraryReads = 0;
	await a.edit((store) => ({
		...store,
		groups: store.groups.map((group, index) =>
			index === 7 ? {...group, name: 'Renamed'} : group,
		),
	}));
	const editStart = performance.now();
	await a.client.syncNow();
	const editRoundMs = Math.round(performance.now() - editStart);
	const editPushes = [...server.pushes];
	const editMeter = {...a.meter};
	assert.deepEqual(editPushes, [1]);
	assert.ok(
		firstPushes.reduce((sum, count) => sum + count, 0) >=
			SESSIONS * (1 + LINKS_PER_SESSION) + 1000,
	);
	assert.ok(
		firstMeter.syncStateWrites <= 10,
		String(firstMeter.syncStateWrites),
	);
	assert.ok(firstMeter.libraryReads <= 6, String(firstMeter.libraryReads));
	assert.ok(editMeter.libraryReads <= 3, String(editMeter.libraryReads));
	assert.ok(editMeter.syncStateWrites <= 2, String(editMeter.syncStateWrites));

	const pullAgain = performance.now();
	await b.client.syncNow();
	const pullEditMs = Math.round(performance.now() - pullAgain);
	assert.equal(
		(await b.read()).groups.find((group) => group.id === 's7')?.name,
		'Renamed',
	);

	if (REPORT) {
		appendFileSync(
			REPORT,
			`${JSON.stringify({
				sessions: SESSIONS,
				records: SESSIONS * (1 + LINKS_PER_SESSION) + 1000,
				firstPushMs,
				firstPushRequests: firstPushes.length,
				firstSyncStateWrites: firstMeter.syncStateWrites,
				firstSyncStateMB: Math.round(firstMeter.syncStateChars / 10_486) / 100,
				firstLibraryReads: firstMeter.libraryReads,
				firstReadMs: Math.round(firstMeter.readMs),
				firstStateGetMs: Math.round(firstMeter.stateGetMs),
				firstStateSetMs: Math.round(firstMeter.stateSetMs),
				firstFetchMs: Math.round(firstMeter.fetchMs),
				secondDevicePullMs: pullMs,
				editRoundMs,
				editLibraryReads: editMeter.libraryReads,
				editSyncStateWrites: editMeter.syncStateWrites,
				pullEditMs,
			})}\n`,
		);
	}
});

const SMALL = 1200;

function smallLibrary(): Raw {
	const library = bigLibrary();
	return {...library, groups: (library.groups as unknown[]).slice(0, SMALL)};
}

test('a session renamed while a long push runs reaches the server by the end of the next round', async () => {
	const server = makeServer();
	const a = makeDevice(server);
	await a.seed(smallLibrary());
	let edited = false;
	server.hooks.beforePush = async (index) => {
		if (index !== 3 || edited) {
			return;
		}

		edited = true;
		await a.edit((store) => ({
			...store,
			groups: store.groups.map((group) =>
				group.id === 's5' ? {...group, name: 'Renamed mid push'} : group,
			),
		}));
	};

	await a.client.connect(URL_BASE, TOKEN);
	assert.equal(edited, true);
	await a.client.syncNow();

	const b = makeDevice(server);
	await b.client.connect(URL_BASE, TOKEN);
	const pulled = await b.read();
	assert.equal(sessionCount(pulled), SMALL);
	assert.equal(linkCount(pulled), SMALL * LINKS_PER_SESSION);
	assert.equal(
		pulled.groups.find((group) => group.id === 's5')?.name,
		'Renamed mid push',
	);
	assert.equal((await a.client.status()).pending, 0);
});

test('a push cut off by the network resumes with the records not yet sent, and loses none', async () => {
	const server = makeServer();
	const a = makeDevice(server);
	await a.seed(smallLibrary());
	server.hooks.offlineAfterPushes = 4;
	await a.client.connect(URL_BASE, TOKEN);
	assert.equal((await a.client.status()).phase, 'offline');
	assert.equal(server.pushes.length, 4);
	assert.ok((await a.client.status()).pending > 0);

	server.hooks.offlineAfterPushes = undefined;
	await a.client.syncNow();
	assert.equal((await a.client.status()).pending, 0);
	const total = server.pushes.reduce((sum, count) => sum + count, 0);
	assert.ok(total >= SMALL * (1 + LINKS_PER_SESSION) + 1000);
	assert.ok(total <= SMALL * (1 + LINKS_PER_SESSION) + 1000 + 100);

	const b = makeDevice(server);
	await b.client.connect(URL_BASE, TOKEN);
	const pulled = await b.read();
	assert.equal(sessionCount(pulled), SMALL);
	assert.equal(linkCount(pulled), SMALL * LINKS_PER_SESSION);
	assert.equal(pulled.bookmarks.length, 1000);
});
