import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {createApi} from '../../server/src/api';
import {
	addBookmark,
	addColumn,
	emptyStore,
	removeBookmarks,
} from '../src/library';
import type {Session, Store} from '../../extension/src/shared/types';
import {ChangeLog} from '../../extension/src/shared/sync/change-log';
import {
	createSyncClient,
	type SyncSocket,
} from '../../extension/src/shared/sync/client';

const TOKEN = 'mobile-test-token-0123456789-abcdefghijk';
const URL_BASE = 'https://sync.example.test';
const NOW = 1000;

type Device = {
	store: Store;
	client: ReturnType<typeof createSyncClient>;
};

function makeDevice(
	name: string,
	app: ReturnType<typeof createApi>,
	store: Store,
	openSocket?: (url: string) => SyncSocket,
	readOnly = false,
) {
	const storage = new Map<string, unknown>();
	let queue = Promise.resolve();
	let count = 0;
	const device: Device = {
		store,
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
			openSocket,
			readOnly,
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
			now: () => NOW + count,
		}),
	};
	return device;
}

const session: Session = {
	id: 's1',
	name: 'Research',
	folderId: 'f1',
	description: '',
	createdAt: NOW,
	updatedAt: NOW,
	sourceWindowName: '',
	sourceWindowId: null,
	tabs: [
		{
			id: 't1',
			title: 'Docs',
			url: 'https://example.com/docs',
			notes: '',
			pinned: false,
			nativeGroup: null,
			savedAt: NOW,
			originalIndex: 0,
		},
	],
};

test('a phone starting empty receives the extension library and sends back its own links', async () => {
	const log = new ChangeLog();
	const app = createApi({token: TOKEN, log: () => log});
	const desktopStore: Store = {
		...emptyStore(NOW),
		folders: [{id: 'f1', name: 'Work', createdAt: NOW, isDefault: true}],
		groups: [session],
		bookmarkColumns: [
			{id: 'c1', name: 'Read later', createdAt: NOW, isDefault: true},
		],
		bookmarks: [
			{
				id: 'b1',
				title: 'First',
				url: 'https://example.com/first',
				columnId: 'c1',
				createdAt: NOW,
				updatedAt: NOW,
			},
		],
	};
	const desktop = makeDevice('desktop', app, desktopStore);
	const phone = makeDevice('phone', app, emptyStore(NOW));

	await desktop.client.connect(URL_BASE, TOKEN);
	await phone.client.connect(URL_BASE, TOKEN);

	assert.deepEqual(
		phone.store.bookmarks.map((bookmark) => bookmark.id),
		['b1'],
	);
	assert.equal(phone.store.groups[0]?.tabs[0]?.url, 'https://example.com/docs');
	assert.equal(phone.store.bookmarkColumns[0]?.name, 'Read later');

	phone.store = addBookmark(
		phone.store,
		{url: 'https://example.com/shared', title: 'Shared', columnId: 'c1'},
		'b2',
		NOW + 10,
	);
	await phone.client.syncNow();
	await desktop.client.syncNow();
	assert.deepEqual(
		desktop.store.bookmarks.map((bookmark) => bookmark.id),
		['b2', 'b1'],
	);

	phone.store = removeBookmarks(phone.store, new Set(['b1']), NOW + 20);
	await phone.client.syncNow();
	await desktop.client.syncNow();
	assert.deepEqual(
		desktop.store.bookmarks.map((bookmark) => bookmark.id),
		['b2'],
	);
	assert.equal(desktop.store.groups.length, 1);
});

test('the app settings travel between two phones and the extension keeps them', async () => {
	const log = new ChangeLog();
	const app = createApi({token: TOKEN, log: () => log});
	const first = makeDevice('first', app, emptyStore(NOW));
	const second = makeDevice('second', app, emptyStore(NOW));
	const desktop = makeDevice('desktop', app, emptyStore(NOW));
	await first.client.connect(URL_BASE, TOKEN);
	await second.client.connect(URL_BASE, TOKEN);
	await desktop.client.connect(URL_BASE, TOKEN);

	first.store = {
		...first.store,
		settings: {
			...first.store.settings,
			mobileApp: {look: 'ios', swipeLeft: 'delete', floatingBar: true},
		},
		updatedAt: NOW + 5,
	};
	await first.client.syncNow();
	await second.client.syncNow();
	await desktop.client.syncNow();

	const expected = {look: 'ios', swipeLeft: 'delete', floatingBar: true};
	assert.deepEqual(second.store.settings.mobileApp, expected);
	assert.deepEqual(desktop.store.settings.mobileApp, expected);

	// The second phone changes one value and the first follows.
	second.store = {
		...second.store,
		settings: {
			...second.store.settings,
			mobileApp: {...expected, swipeLeft: 'edit'},
		},
		updatedAt: NOW + 10,
	};
	await second.client.syncNow();
	await first.client.syncNow();
	assert.equal(first.store.settings.mobileApp.swipeLeft, 'edit');
});

class FakeSocket implements SyncSocket {
	closed = false;
	send() {}
	close() {
		this.closed = true;
	}

	addEventListener() {}
}

test('pausing sends a waiting change and closes the live socket, and waking opens it again', async () => {
	const log = new ChangeLog();
	const app = createApi({token: TOKEN, log: () => log});
	const sockets: FakeSocket[] = [];
	const phone = makeDevice('phone', app, emptyStore(NOW), () => {
		const socket = new FakeSocket();
		sockets.push(socket);
		return socket;
	});
	const desktop = makeDevice('desktop', app, emptyStore(NOW));
	await phone.client.connect(URL_BASE, TOKEN);
	await desktop.client.connect(URL_BASE, TOKEN);
	assert.equal(sockets.length, 1);
	assert.equal(sockets[0]?.closed, false);

	// A change made just before the app goes to the background is not left waiting for the delay.
	phone.store = addBookmark(
		emptyStore(NOW),
		{url: 'https://example.com/late', title: 'Late', columnId: 'c1'},
		'late',
		NOW + 5,
	);
	phone.client.localChanged();
	await phone.client.pause();
	assert.equal(sockets[0]?.closed, true);
	await desktop.client.syncNow();
	assert.deepEqual(
		desktop.store.bookmarks.map((bookmark) => bookmark.id),
		['late'],
	);

	await phone.client.wake();
	assert.equal(sockets.length, 2);
	assert.equal(sockets[1]?.closed, false);
});

describe('a read only device', () => {
	const recordsOn = async (app: ReturnType<typeof createApi>) => {
		const response = await app.request(`${URL_BASE}/v1/status`, {
			headers: [['Authorization', `Bearer ${TOKEN}`]],
		});
		return ((await response.json()) as {records: number}).records;
	};

	// The server is replaced after the device has pulled: it is empty and behind, so a device that sends would send
	// every record it holds all over again.
	const afterServerReplaced = async (readOnly: boolean) => {
		const firstLog = new ChangeLog();
		const secondLog = new ChangeLog();
		const original = createApi({token: TOKEN, log: () => firstLog});
		const replacement = createApi({token: TOKEN, log: () => secondLog});
		let current = original;
		const proxy = {
			request: async (url: string, init?: RequestInit) =>
				current.request(url, init),
		} as unknown as ReturnType<typeof createApi>;
		const desktop = makeDevice(
			'desktop',
			original,
			addBookmark(
				addColumn(emptyStore(NOW), 'Column', 'c1', NOW),
				{url: 'https://example.com/one', title: 'One', columnId: 'c1'},
				'b1',
				NOW,
			),
		);
		const reader = makeDevice(
			'reader',
			proxy,
			emptyStore(NOW),
			undefined,
			readOnly,
		);
		await desktop.client.connect(URL_BASE, TOKEN);
		await reader.client.connect(URL_BASE, TOKEN);
		assert.equal(reader.store.bookmarks.length, 1);
		current = replacement;
		await reader.client.syncNow();
		return recordsOn(replacement);
	};

	test('never sends a record, even to a server that was replaced', async () => {
		assert.equal(await afterServerReplaced(true), 0);
	});

	test('a device that may send does send them again, so the test above can fail', async () => {
		assert.ok((await afterServerReplaced(false)) > 0);
	});
});
