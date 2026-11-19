/*
Background sync, run against the app's real library and sync client and an in-process sync server, with WorkManager,
the widget module, and the socket replaced by recorders. What these tests cannot show: that Android runs the task with
the app closed; the pull request shows that on an emulator.
*/
import assert from 'node:assert/strict';
import {beforeEach, describe, test, vi} from 'vite-plus/test';
import {createApi} from '../../server/src/api';
import {ChangeLog} from '../../extension/src/shared/sync/change-log';
import {createSyncClient} from '../../extension/src/shared/sync/client';
import type {Store} from '../../extension/src/shared/types';
import {addBookmark} from '../src/library/board-edits';
import {emptyStore} from '../src/library/store-shape';

const TOKEN = 'background-test-token-0123456789-abcdefg';
const URL_BASE = 'https://sync.example.test';

const recorded = vi.hoisted(() => ({
	written: [] as Array<string | null>,
	tasks: new Map<string, () => Promise<unknown>>(),
	registered: new Set<string>(),
	registrations: 0,
	checks: 0,
	hold: undefined as Promise<void> | undefined,
	requests: [] as string[],
	sockets: 0,
}));
vi.mock('../modules/bookmarks-widget', () => ({
	writeWidgetSnapshot(json: string | null) {
		recorded.written.push(json);
	},
}));
vi.mock('expo-task-manager', () => ({
	defineTask(name: string, run: () => Promise<unknown>) {
		recorded.tasks.set(name, run);
	},
	async isTaskRegisteredAsync(name: string) {
		recorded.checks += 1;
		// A test can hold the answer, so a change arrives while the check is still out.
		await recorded.hold;
		return recorded.registered.has(name);
	},
}));
vi.mock('expo-background-task', () => ({
	BackgroundTaskResult: {Success: 1, Failed: 2},
	async registerTaskAsync(name: string) {
		recorded.registrations += 1;
		recorded.registered.add(name);
	},
	async unregisterTaskAsync(name: string) {
		recorded.registered.delete(name);
	},
}));
vi.mock('react-native', () => ({
	AppState: {
		addEventListener() {
			return {remove() {}};
		},
	},
}));
vi.mock('../modules/open-links', () => ({
	onScreenOff: () => () => {},
}));
vi.mock('../src/ui/snackbar', () => ({showSnack() {}}));
vi.mock('expo-crypto', () => ({
	randomUUID: () => globalThis.crypto.randomUUID(),
}));
vi.mock(
	'../modules/tablodge-crypto',
	async () => import('./support/fake-crypto'),
);
vi.mock(
	'../src/platform/storage',
	async () => import('./support/memory-storage'),
);
vi.mock(
	'../src/settings/preferences',
	async () => import('./support/fake-preferences'),
);

const {memory} = await import('./support/memory-storage');
const {setPreferences} = await import('./support/fake-preferences');

let server: ReturnType<typeof createApi>;

/**
The extension's side: its own sync client, adding one bookmark and sending it.
*/
async function extensionSaves(url: string) {
	const storage = new Map<string, unknown>();
	let store: Store = emptyStore(1);
	const client = createSyncClient({
		get: async (key) => structuredClone(storage.get(key)),
		async set(key, value) {
			storage.set(key, structuredClone(value));
		},
		async remove(keys) {
			for (const key of keys) {
				storage.delete(key);
			}
		},
		fetch: async (target, init) => server.request(target, init),
		mutate: async (work) => work(),
		readLibrary: async () => structuredClone(store),
		async writeLibrary(next) {
			store = structuredClone(next);
		},
		async backup() {},
		randomId: () => globalThis.crypto.randomUUID(),
		now: Date.now,
	});
	await client.connect(URL_BASE, TOKEN);
	store = addBookmark(
		store,
		{url, title: 'From the extension', columnId: ''},
		'from-extension',
		Date.now(),
	);
	await client.syncNow();
	client.stop();
}

/**
Loads the app's modules again, as Android does when it starts the process only to run the task.
*/
async function freshProcess() {
	vi.resetModules();
	recorded.tasks.clear();
	const library = await import('../src/library/library-store');
	const background = await import('../src/library/background-sync');
	background.defineBackgroundSync();
	const task = recorded.tasks.get('tablodge-background-sync');
	assert.ok(task, 'the task was not defined');
	return {library, background, task};
}

/**
A phone that connected once and was then closed.
*/
async function connectedThenClosed() {
	const {library} = await freshProcess();
	await library.startLibrary();
	await library.connectServer(URL_BASE, TOKEN);
	await library.pauseSync();
}

beforeEach(() => {
	memory.clear();
	recorded.written.length = 0;
	recorded.registered.clear();
	recorded.registrations = 0;
	recorded.checks = 0;
	recorded.hold = undefined;
	recorded.requests.length = 0;
	recorded.sockets = 0;
	setPreferences({backgroundSync: true});
	vi.stubGlobal('__DEV__', false);
	const log = new ChangeLog();
	server = createApi({token: TOKEN, log: () => log});
	vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
		recorded.requests.push(url);
		return server.request(url, init);
	});
	vi.stubGlobal(
		'WebSocket',
		class {
			constructor() {
				recorded.sockets += 1;
			}

			addEventListener() {}
			send() {}
			close() {}
		},
	);
});

describe('background sync', () => {
	test('a closed app pulls a bookmark saved in the extension and redraws the widget, without a live connection', async () => {
		await connectedThenClosed();
		await extensionSaves('https://extension.example/');
		const {task, library} = await freshProcess();
		recorded.written.length = 0;
		recorded.sockets = 0;

		assert.equal(await task(), 1);
		assert.deepEqual(
			library.getLibrary().bookmarks.map((bookmark) => bookmark.url),
			['https://extension.example/'],
		);
		assert.equal(recorded.written.length, 1);
		assert.ok(recorded.written[0]?.includes('https://extension.example/'));
		assert.equal(recorded.sockets, 0, 'the round opened a live connection');
	});

	test('a round that brings nothing in leaves the widgets alone', async () => {
		await connectedThenClosed();
		const {task} = await freshProcess();
		recorded.written.length = 0;

		assert.equal(await task(), 1);
		assert.deepEqual(recorded.written, []);
	});

	test('with the setting off a round asks the server nothing', async () => {
		await connectedThenClosed();
		setPreferences({backgroundSync: false});
		const {task} = await freshProcess();
		recorded.requests.length = 0;

		assert.equal(await task(), 1);
		assert.deepEqual(recorded.requests, []);
	});

	test('is scheduled only while a server is connected and the setting is on', async () => {
		const {library, background} = await freshProcess();
		await library.startLibrary();
		const stop = background.startBackgroundSync();
		// Scheduling finishes after the change that asked for it.
		const settlesAt = async (expected: boolean) =>
			vi.waitFor(() => {
				assert.equal(
					recorded.registered.has('tablodge-background-sync'),
					expected,
				);
			});

		await settlesAt(false);
		await library.connectServer(URL_BASE, TOKEN);
		await library.refreshStatus();
		await settlesAt(true);
		setPreferences({backgroundSync: false});
		await settlesAt(false);
		setPreferences({backgroundSync: true});
		await settlesAt(true);
		await library.disconnectServer();
		await library.refreshStatus();
		await settlesAt(false);
		stop();
		library.syncClient.stop();
	});

	test('switched off and on again before scheduling finishes, the task stays scheduled', async () => {
		const {library, background} = await freshProcess();
		await library.startLibrary();
		await library.connectServer(URL_BASE, TOKEN);
		const stop = background.startBackgroundSync();
		await vi.waitFor(() => {
			assert.ok(recorded.registered.has('tablodge-background-sync'));
		});

		const {promise, resolve} = Promise.withResolvers<void>();
		recorded.hold = promise;
		const {checks} = recorded;
		setPreferences({backgroundSync: false});
		await vi.waitFor(() => {
			assert.ok(recorded.checks > checks, 'switching off checked nothing');
		});
		setPreferences({backgroundSync: true});
		resolve();
		// Off cancels the task and on registers it again.
		await vi.waitFor(() => {
			assert.equal(recorded.registrations, 2);
		});
		assert.ok(
			recorded.registered.has('tablodge-background-sync'),
			'the task was left cancelled',
		);
		stop();
		library.syncClient.stop();
	});
});
