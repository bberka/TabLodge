/*
The phone's private library, run through its real logic with the native crypto module replaced by a Node stand-in
(tests/support/fake-crypto.ts). The server is the real sync API; the "extension side" is the extension's own sync client,
private codec, and key code. What these tests cannot show: that the Kotlin TablodgeCryptoModule behaves like its
stand-in, and anything on screen.
*/
import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, test, vi} from 'vite-plus/test';
import type * as PhoneModule from '../src/private/private-library';
import {isSealed} from '../../extension/src/shared/private-lock';
import {SYNC_CONFIG_KEY} from '../../extension/src/shared/sync/client';
import {
	addBookmark,
	removeBookmarks,
	updateBookmark,
} from '../src/library/board-edits';
import {
	connectGlobals,
	makeExtension,
	makeServer,
	TOKEN,
	URL_BASE,
	type Server,
} from './support/world';

const hooks = vi.hoisted(() => ({
	appState: undefined as undefined | ((state: string) => void),
	screenOff: undefined as undefined | (() => void),
}));
vi.mock('react-native', () => ({
	AppState: {
		addEventListener(_event: string, listener: (state: string) => void) {
			hooks.appState = listener;
			return {remove() {}};
		},
	},
}));
vi.mock('../modules/open-links', () => ({
	onScreenOff(listener: () => void) {
		hooks.screenOff = listener;
		return () => {};
	},
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

type Phone = typeof PhoneModule;

const {memory} = await import('./support/memory-storage');
const {prefs} = await import('./support/fake-preferences');

let phones: Phone[] = [];
let server: Server;
let counter = 0;
const newId = () => {
	counter += 1;
	return `id-${counter}`;
};

const PIN = {kind: 'pin' as const, value: '4821'};
const PASSWORD = {kind: 'password' as const, value: 'correct horse battery'};

/**
Loads the phone's modules afresh and starts them from what is saved, as an app start does.
*/
async function startPhone(): Promise<Phone> {
	vi.resetModules();
	const phone = await import('../src/private/private-library');
	phones.push(phone);
	await phone.startPrivate();
	return phone;
}

/**
What connecting a server does: the address is saved, and the private library starts using it.
*/
async function connectPhone(phone: Phone) {
	memory.set(SYNC_CONFIG_KEY, JSON.stringify({url: URL_BASE, token: TOKEN}));
	await phone.reconnectPrivate();
}

const addLink = async (phone: Phone, url: string, title = url) =>
	phone.editPrivate((store) =>
		addBookmark(store, {url, title, columnId: ''}, newId(), Date.now()),
	);
const urlsOf = (store: {bookmarks: Array<{url: string}>}) =>
	store.bookmarks.map((bookmark) => bookmark.url).toSorted();

/**
What the server holds for the private library, as the values on the wire.
*/
async function serverRecords(): Promise<Array<{kind: string; value: unknown}>> {
	const response = await server.fetch(
		`${URL_BASE}/private/v1/changes?cursor=0&limit=1000`,
		{
			headers: {Authorization: `Bearer ${TOKEN}`},
		},
	);
	const body = (await response.json()) as {
		changes: Array<{kind: string; value: unknown; deleted?: boolean}>;
	};
	return body.changes.filter((change) => !change.deleted);
}

beforeEach(() => {
	memory.clear();
	phones = [];
	server = makeServer();
	connectGlobals(server);
	prefs.syncPrivate = true;
	vi.stubGlobal('__DEV__', false);
});

afterEach(async () => {
	// Lets a round started by an unlock finish, then stops the live connections and timers of every phone this test
	// started, so none reaches the next test's server.
	await new Promise((resolve) => {
		setTimeout(resolve, 80);
	});
	prefs.syncPrivate = false;
	for (const phone of phones) {
		await phone.applyPrivateSyncSetting();
	}

	prefs.syncPrivate = true;
});

describe('without a server', () => {
	test('a library is made with a PIN, edited, and kept across a restart', async () => {
		let phone = await startPhone();
		assert.equal(phone.privateExists(), false);
		await phone.setupPrivate(PIN);
		assert.equal(phone.isPrivateOpen(), true);
		assert.equal(phone.canLockPrivate(), true);
		await addLink(phone, 'https://a.example/', 'A');
		await addLink(phone, 'https://b.example/', 'B');
		const [first] = phone.getPrivateStore().bookmarks;
		await phone.editPrivate((store) =>
			updateBookmark(
				store,
				first.id,
				{url: 'https://a2.example/', title: 'A2', columnId: first.columnId},
				Date.now(),
			),
		);
		await phone.editPrivate((store) =>
			removeBookmarks(
				store,
				new Set([phone.getPrivateStore().bookmarks[1].id]),
				Date.now(),
			),
		);
		assert.deepEqual(urlsOf(phone.getPrivateStore()), ['https://a2.example/']);

		phone = await startPhone();
		assert.equal(phone.isPrivateOpen(), false, 'a restart locks it');
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');
		assert.deepEqual(urlsOf(phone.getPrivateStore()), ['https://a2.example/']);
	});

	test('nothing in the private area waits on, or complains about, a server that is not there', async () => {
		const phone = await startPhone();
		await phone.setupPrivate();
		await addLink(phone, 'https://a.example/');
		await phone.syncPrivate();
		await phone.pausePrivate();
		await phone.wakePrivate();
		const result = await phone.openFromServer();
		assert.deepEqual(result, {ok: false, reason: 'not-connected'});
		// The status the private card reads: off, with no error and no key request.
		await phone.refreshPrivateStatus();
		const status = phone.getPrivateStatus();
		assert.equal(status.phase, 'off');
		assert.equal(status.error, null);
		assert.ok(!status.needsKey);
	});

	test('a library with a PIN locks, refuses a wrong PIN, and opens with the right one', async () => {
		let phone = await startPhone();
		await phone.setupPrivate(PIN);
		assert.equal(phone.canLockPrivate(), true);
		await addLink(phone, 'https://secret.example/');
		assert.equal(
			(JSON.parse(memory.get('tablodge.private.lock')!) as {kind: string}).kind,
			'pin',
		);
		assert.ok(!memory.get('tablodge.private.lock')!.includes(PIN.value));

		await phone.lockPrivate();
		assert.equal(phone.isPrivateOpen(), false);

		// A restart finds it locked, with its data on the phone.
		phone = await startPhone();
		assert.equal(phone.isPrivateOpen(), false);
		assert.equal(await phone.unlockPrivate('0000'), 'wrong');
		assert.equal(phone.isPrivateOpen(), false);
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');
		assert.equal(phone.isPrivateOpen(), true);
		assert.deepEqual(urlsOf(phone.getPrivateStore()), [
			'https://secret.example/',
		]);
	});

	test('a password works like a PIN', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PASSWORD);
		await phone.lockPrivate();
		assert.equal(await phone.unlockPrivate('correct horse'), 'wrong');
		assert.equal(await phone.unlockPrivate(PASSWORD.value), 'ok');
	});

	test('a PIN is added to a library that had none, and asked for after a restart', async () => {
		let phone = await startPhone();
		await phone.setupPrivate();
		await addLink(phone, 'https://a.example/');
		// A library from an earlier version has no PIN, and does not open until it gets one.
		assert.equal(phone.getPrivateState().needsPin, true);
		assert.equal(phone.isPrivateOpen(), false);
		await phone.protectPrivate(PIN);
		assert.equal(phone.getPrivateState().needsPin, false);
		assert.equal(phone.isPrivateOpen(), true);
		assert.equal(phone.canLockPrivate(), true);
		phone = await startPhone();
		assert.equal(phone.isPrivateOpen(), false);
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');
		assert.deepEqual(urlsOf(phone.getPrivateStore()), ['https://a.example/']);
	});

	test('changing the PIN needs the old one, and only the new one opens it afterwards', async () => {
		let phone = await startPhone();
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://a.example/');
		assert.equal(await phone.changePrivateLock('0000', PASSWORD), 'wrong');
		assert.equal(await phone.changePrivateLock(PIN.value, PASSWORD), 'ok');
		await phone.lockPrivate();
		phone = await startPhone();
		assert.equal(await phone.unlockPrivate(PIN.value), 'wrong');
		assert.equal(await phone.unlockPrivate(PASSWORD.value), 'ok');
		assert.deepEqual(urlsOf(phone.getPrivateStore()), ['https://a.example/']);
	});

	test('erasing removes the library, its lock, and its sync position, and starts over empty', async () => {
		let phone = await startPhone();
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://a.example/');
		await phone.removePrivate();
		assert.equal(phone.privateExists(), false);
		assert.equal(phone.getPrivateStore().bookmarks.length, 0);
		assert.deepEqual(
			[...memory.keys()].filter((key) => key.startsWith('tablodge.private.')),
			[],
		);
		phone = await startPhone();
		assert.equal(phone.privateExists(), false);
		// Starting over asks for a new PIN, and the old one no longer opens anything.
		await phone.setupPrivate(PASSWORD);
		assert.deepEqual(phone.getPrivateStore().bookmarks, []);
		await phone.lockPrivate();
		assert.equal(await phone.unlockPrivate(PIN.value), 'wrong');
		assert.equal(await phone.unlockPrivate(PASSWORD.value), 'ok');
	});
});

const sealedCount = async () =>
	(await serverRecords()).filter((record) => isSealed(record.value)).length;

describe('with the extension on the same server', () => {
	test('a phone library without a PIN syncs plain, and the extension reads it', async () => {
		const phone = await startPhone();
		await phone.setupPrivate();
		await addLink(phone, 'https://a.example/');
		await connectPhone(phone);
		await phone.syncPrivate();
		const extension = makeExtension(server);
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), ['https://a.example/']);
		assert.equal(await sealedCount(), 0);
	});

	test('a phone library with a PIN sends only sealed values, and the extension reads them after joining with the PIN', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://a.example/');
		await connectPhone(phone);
		await phone.syncPrivate();
		const records = await serverRecords();
		assert.ok(records.length > 0);
		assert.ok(records.every((record) => isSealed(record.value)));
		assert.ok(!JSON.stringify(records).includes('a.example'));

		const extension = makeExtension(server);
		await extension.sync();
		assert.equal((await extension.client.status()).needsKey, true);
		assert.deepEqual(extension.store.bookmarks, []);
		// A wrong PIN does not open the server's key.
		await assert.rejects(extension.enterCredential('0000'), Error);
		await extension.enterCredential(PIN.value);
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), ['https://a.example/']);

		// And what the extension adds comes back to the phone.
		extension.edit((store) =>
			addBookmark(
				store,
				{url: 'https://from-ext.example/', title: 'E', columnId: ''},
				'ext-1',
				Date.now(),
			),
		);
		await extension.sync();
		await phone.syncPrivate();
		assert.deepEqual(urlsOf(phone.getPrivateStore()), [
			'https://a.example/',
			'https://from-ext.example/',
		]);
	});

	test('joining a library the extension made asks for its PIN once: a wrong PIN changes nothing, the right one brings the data', async () => {
		const extension = makeExtension(server);
		await extension.protect(PIN);
		extension.edit((store) =>
			addBookmark(
				store,
				{url: 'https://ext.example/', title: 'E', columnId: ''},
				'ext-1',
				Date.now(),
			),
		);
		await extension.sync();

		const phone = await startPhone();
		await connectPhone(phone);
		assert.deepEqual(await phone.openFromServer(), {
			ok: false,
			reason: 'credential',
		});
		assert.equal(phone.privateExists(), false);
		assert.deepEqual(await phone.openFromServer('0000'), {
			ok: false,
			reason: 'wrong',
		});
		assert.equal(phone.privateExists(), false);

		assert.deepEqual(await phone.openFromServer(PIN.value), {ok: true});
		assert.equal(phone.isPrivateOpen(), true);
		assert.deepEqual(urlsOf(phone.getPrivateStore()), ['https://ext.example/']);

		// The phone now holds the extension's lock: the same PIN opens it after a restart.
		const restarted = await startPhone();
		assert.equal(restarted.isPrivateOpen(), false);
		assert.equal(await restarted.unlockPrivate(PIN.value), 'ok');
		assert.deepEqual(urlsOf(restarted.getPrivateStore()), [
			'https://ext.example/',
		]);

		// Edits made on the phone reach the extension, sealed.
		await addLink(restarted, 'https://phone.example/');
		await restarted.syncPrivate();
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), [
			'https://ext.example/',
			'https://phone.example/',
		]);
		assert.ok(
			(await serverRecords()).every((record) => isSealed(record.value)),
		);
	});

	test('the set-a-PIN screen learns what the server holds, and joining from an empty phone makes the server’s PIN its lock', async () => {
		const phone = await startPhone();
		assert.deepEqual(await phone.privateServerInfo(), {
			connected: false,
			hasKey: false,
		});
		await connectPhone(phone);
		assert.deepEqual(await phone.privateServerInfo(), {
			connected: true,
			hasKey: false,
		});

		const extension = makeExtension(server);
		await extension.protect(PIN);
		await extension.sync();
		assert.deepEqual(await phone.privateServerInfo(), {
			connected: true,
			hasKey: true,
		});

		assert.deepEqual(await phone.openFromServer(PIN.value), {ok: true});
		assert.equal(phone.getPrivateState().lockedWith, 'pin');
		assert.equal(phone.getPrivateState().needsPin, false);
		await phone.lockPrivate();
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');
	});

	test('keeping the library on the phone with its own PIN does not touch the server, and syncing later takes the server’s PIN and merges', async () => {
		const extension = makeExtension(server);
		await extension.protect(PIN);
		extension.edit((store) =>
			addBookmark(
				store,
				{url: 'https://ext.example/', title: 'E', columnId: ''},
				'ext-1',
				Date.now(),
			),
		);
		await extension.sync();

		// The device-only choice turns the private sync off before the library is made.
		const before = (await serverRecords()).length;
		prefs.syncPrivate = false;
		const phone = await startPhone();
		await connectPhone(phone);
		await phone.setupPrivate(PASSWORD);
		await addLink(phone, 'https://local.example/');
		assert.equal((await phone.privateServerInfo()).connected, false);
		assert.ok(!phone.getPrivateStatus().needsKey);
		assert.equal((await serverRecords()).length, before);

		prefs.syncPrivate = true;
		assert.deepEqual(await phone.openFromServer(PIN.value), {ok: true});
		assert.deepEqual(urlsOf(phone.getPrivateStore()), [
			'https://ext.example/',
			'https://local.example/',
		]);
	});

	test('joining a library the extension made with no PIN just brings the data', async () => {
		const extension = makeExtension(server);
		extension.edit((store) =>
			addBookmark(
				store,
				{url: 'https://ext.example/', title: 'E', columnId: ''},
				'ext-1',
				Date.now(),
			),
		);
		await extension.sync();
		const phone = await startPhone();
		await connectPhone(phone);
		assert.deepEqual(await phone.openFromServer(), {ok: true});
		assert.deepEqual(urlsOf(phone.getPrivateStore()), ['https://ext.example/']);
		assert.equal(phone.canLockPrivate(), false);
	});

	test('both sides already have data: the union arrives on both, each record once, and edits of one record resolve to one', async () => {
		const extension = makeExtension(server);
		await extension.protect(PIN);
		extension.edit((store) =>
			addBookmark(
				store,
				{url: 'https://ext-1.example/', title: 'E1', columnId: ''},
				'ext-1',
				1000,
			),
		);
		extension.edit((store) =>
			addBookmark(
				store,
				{url: 'https://ext-2.example/', title: 'E2', columnId: ''},
				'ext-2',
				1001,
			),
		);
		await extension.sync();

		// The phone already has a library with its own links, and has never synced it.
		const phone = await startPhone();
		await phone.setupPrivate();
		await addLink(phone, 'https://phone-1.example/');
		await addLink(phone, 'https://phone-2.example/');
		await connectPhone(phone);
		assert.deepEqual(await phone.openFromServer(PIN.value), {ok: true});

		const all = [
			'https://ext-1.example/',
			'https://ext-2.example/',
			'https://phone-1.example/',
			'https://phone-2.example/',
		];
		assert.deepEqual(urlsOf(phone.getPrivateStore()), all);
		const ids = phone
			.getPrivateStore()
			.bookmarks.map((bookmark) => bookmark.id);
		assert.equal(new Set(ids).size, ids.length);
		const columns = phone
			.getPrivateStore()
			.bookmarkColumns.map((column) => column.id);
		assert.equal(new Set(columns).size, columns.length);

		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), all);
		assert.equal(extension.store.bookmarks.length, 4);
		assert.ok(
			(await serverRecords()).every((record) => isSealed(record.value)),
		);

		// The same record edited on both sides ends the same on both.
		const shared = phone
			.getPrivateStore()
			.bookmarks.find((bookmark) => bookmark.id === 'ext-1')!;
		extension.edit((store) =>
			updateBookmark(
				store,
				'ext-1',
				{
					url: 'https://ext-1.example/',
					title: 'from extension',
					columnId: shared.columnId,
				},
				Date.now(),
			),
		);
		await phone.editPrivate((store) =>
			updateBookmark(
				store,
				'ext-1',
				{
					url: 'https://ext-1.example/',
					title: 'from phone',
					columnId: shared.columnId,
				},
				Date.now() + 5000,
			),
		);
		await extension.sync();
		await phone.syncPrivate();
		await extension.sync();
		const titleOn = (store: {bookmarks: Array<{id: string; title: string}>}) =>
			store.bookmarks.find((bookmark) => bookmark.id === 'ext-1')!.title;
		assert.equal(titleOn(phone.getPrivateStore()), titleOn(extension.store));
	});

	test('a phone with its own PIN joins the extension’s library and takes its lock; its own data stays', async () => {
		const extension = makeExtension(server);
		await extension.protect(PASSWORD);
		extension.edit((store) =>
			addBookmark(
				store,
				{url: 'https://ext.example/', title: 'E', columnId: ''},
				'ext-1',
				1000,
			),
		);
		await extension.sync();

		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://phone.example/');
		await connectPhone(phone);
		// Its own lock does not match the server's key.
		assert.equal(phone.getPrivateStatus().needsKey, true);
		assert.deepEqual(await phone.openFromServer(PIN.value), {
			ok: false,
			reason: 'wrong',
		});
		assert.deepEqual(await phone.openFromServer(PASSWORD.value), {ok: true});
		assert.deepEqual(urlsOf(phone.getPrivateStore()), [
			'https://ext.example/',
			'https://phone.example/',
		]);
		assert.ok(!phone.getPrivateStatus().needsKey);
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), [
			'https://ext.example/',
			'https://phone.example/',
		]);
	});

	test('a network blip on the set-a-PIN drawer cannot replace or fork the server’s key, and joining stays possible later', async () => {
		const extension = makeExtension(server);
		await extension.protect(PASSWORD);
		extension.edit((store) =>
			addBookmark(
				store,
				{url: 'https://ext.example/', title: 'E', columnId: ''},
				'ext-1',
				1000,
			),
		);
		await extension.sync();
		const keyBefore = server.privateLog.key;
		const recordsBefore = (await serverRecords()).length;

		const phone = await startPhone();
		await connectPhone(phone);
		// The drawer asked while the network was out, so it reads as "nothing on the server" and offers its own PIN.
		server.setOnline(false);
		assert.deepEqual(await phone.privateServerInfo(), {
			connected: true,
			hasKey: false,
		});
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://phone.example/');
		server.setOnline(true);

		// Back online, the round finds the server's key. The phone's own key is not stored over it (the server only
		// takes a key when it has none), and nothing the phone holds is sent.
		await phone.syncPrivate();
		assert.equal(server.privateLog.key, keyBefore);
		assert.equal((await serverRecords()).length, recordsBefore);
		assert.equal(phone.getPrivateStatus().needsKey, true);

		// The way back is the same as for a device-only library: the server's PIN, entered from Settings.
		assert.deepEqual(await phone.openFromServer(PASSWORD.value), {ok: true});
		assert.equal(server.privateLog.key, keyBefore);
		assert.deepEqual(urlsOf(phone.getPrivateStore()), [
			'https://ext.example/',
			'https://phone.example/',
		]);
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), [
			'https://ext.example/',
			'https://phone.example/',
		]);
	});

	test('a PIN added after the library has synced seals what is already on the server, and the extension can still read it', async () => {
		const phone = await startPhone();
		await phone.setupPrivate();
		await addLink(phone, 'https://a.example/');
		await addLink(phone, 'https://b.example/');
		await connectPhone(phone);
		await phone.syncPrivate();
		assert.equal(await sealedCount(), 0);
		const before = (await serverRecords()).length;

		await phone.protectPrivate(PIN);
		const records = await serverRecords();
		assert.equal(records.length, before);
		assert.ok(
			records.every((record) => isSealed(record.value)),
			'every record on the server is sealed now',
		);
		assert.ok(!JSON.stringify(records).includes('a.example'));

		const extension = makeExtension(server);
		await extension.enterCredential(PIN.value);
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), [
			'https://a.example/',
			'https://b.example/',
		]);

		// New edits stay sealed, and a restart unlocks with the same PIN and keeps syncing.
		await phone.lockPrivate();
		const restarted = await startPhone();
		assert.equal(await restarted.unlockPrivate(PIN.value), 'ok');
		await addLink(restarted, 'https://c.example/');
		await restarted.syncPrivate();
		await extension.sync();
		assert.equal(extension.store.bookmarks.length, 3);
		assert.ok(
			(await serverRecords()).every((record) => isSealed(record.value)),
		);
	});

	test('a PIN added while the server is out of reach is sent sealed once it is back', async () => {
		const phone = await startPhone();
		await phone.setupPrivate();
		await addLink(phone, 'https://a.example/');
		await connectPhone(phone);
		await phone.syncPrivate();
		server.setOnline(false);
		await phone.protectPrivate(PIN);
		server.setOnline(true);
		await phone.syncPrivate();
		assert.ok(
			(await serverRecords()).every((record) => isSealed(record.value)),
		);
		const extension = makeExtension(server);
		await extension.enterCredential(PIN.value);
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), ['https://a.example/']);
	});

	test('the extension protects a library the phone synced plain: the phone asks for the PIN, then carries on', async () => {
		const phone = await startPhone();
		await phone.setupPrivate();
		await addLink(phone, 'https://phone.example/');
		await connectPhone(phone);
		await phone.syncPrivate();

		const extension = makeExtension(server);
		await extension.sync();
		await extension.protect(PIN);
		await extension.client.resendAll();
		assert.ok(
			(await serverRecords()).every((record) => isSealed(record.value)),
		);

		await phone.syncPrivate();
		assert.equal(phone.getPrivateStatus().needsKey, true);
		assert.deepEqual(await phone.openFromServer(PIN.value), {ok: true});
		await addLink(phone, 'https://more.example/');
		await phone.syncPrivate();
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), [
			'https://more.example/',
			'https://phone.example/',
		]);
	});

	test('changing the PIN on the phone keeps the extension working, and a new join needs the new PIN', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://a.example/');
		await connectPhone(phone);
		await phone.syncPrivate();
		const extension = makeExtension(server);
		await extension.enterCredential(PIN.value);
		await extension.sync();

		assert.equal(await phone.changePrivateLock(PIN.value, PASSWORD), 'ok');
		await addLink(phone, 'https://b.example/');
		await phone.syncPrivate();
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), [
			'https://a.example/',
			'https://b.example/',
		]);

		const second = makeExtension(server);
		await assert.rejects(second.enterCredential(PIN.value), Error);
		await second.enterCredential(PASSWORD.value);
		await second.sync();
		assert.equal(second.store.bookmarks.length, 2);
	});

	test('a PIN changed while offline is not undone by the next sync', async () => {
		let phone = await startPhone();
		await phone.setupPrivate(PIN);
		await connectPhone(phone);
		await phone.syncPrivate();
		server.setOnline(false);
		assert.equal(await phone.changePrivateLock(PIN.value, PASSWORD), 'ok');
		server.setOnline(true);
		await phone.syncPrivate();
		await phone.lockPrivate();
		phone = await startPhone();
		assert.equal(await phone.unlockPrivate(PIN.value), 'wrong');
		assert.equal(await phone.unlockPrivate(PASSWORD.value), 'ok');
		const extension = makeExtension(server);
		await extension.enterCredential(PASSWORD.value);
	});

	test('the extension changing its PIN carries over to the phone', async () => {
		const extension = makeExtension(server);
		await extension.protect(PIN);
		extension.edit((store) =>
			addBookmark(
				store,
				{url: 'https://ext.example/', title: 'E', columnId: ''},
				'ext-1',
				1000,
			),
		);
		await extension.sync();
		let phone = await startPhone();
		await connectPhone(phone);
		await phone.openFromServer(PIN.value);
		await extension.rewrap(PASSWORD);
		await phone.syncPrivate();
		await phone.lockPrivate();
		phone = await startPhone();
		assert.equal(await phone.unlockPrivate(PIN.value), 'wrong');
		assert.equal(await phone.unlockPrivate(PASSWORD.value), 'ok');
		assert.deepEqual(urlsOf(phone.getPrivateStore()), ['https://ext.example/']);
	});

	test('edits made while the server is away are kept and sent when it returns', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await connectPhone(phone);
		await phone.syncPrivate();
		server.setOnline(false);
		await addLink(phone, 'https://offline.example/');
		await phone.syncPrivate();
		assert.deepEqual(urlsOf(phone.getPrivateStore()), [
			'https://offline.example/',
		]);
		server.setOnline(true);
		await phone.syncPrivate();
		const extension = makeExtension(server);
		await extension.enterCredential(PIN.value);
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), ['https://offline.example/']);
	});
});

describe('disconnecting and locking by itself', () => {
	test('disconnecting stops the private sync, and a server connected later gets the whole library', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://a.example/');
		await connectPhone(phone);
		await phone.syncPrivate();
		const before = (await serverRecords()).length;
		assert.ok(before > 0);

		memory.delete(SYNC_CONFIG_KEY);
		await phone.disconnectPrivate();
		assert.equal(phone.getPrivateStatus().phase, 'off');
		await addLink(phone, 'https://while-away.example/');
		await phone.syncPrivate();
		assert.equal((await serverRecords()).length, before);

		const fresh = makeServer();
		connectGlobals(fresh);
		server = fresh;
		await connectPhone(phone);
		await phone.syncPrivate();
		const extension = makeExtension(fresh);
		await extension.enterCredential(PIN.value);
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), [
			'https://a.example/',
			'https://while-away.example/',
		]);
	});

	test('a library with a PIN locks when the app leaves the screen, when the screen turns off, and after a while idle', async () => {
		let phone = await startPhone();
		const autolock = await import('../src/private/private-autolock');
		const stop = autolock.startPrivateAutoLock();
		await phone.setupPrivate(PIN);
		assert.ok(phone.isPrivateOpen());

		// Never: nothing locks it.
		prefs.privateLockMode = 'manual';
		hooks.appState!('background');
		hooks.screenOff!();
		await vi.waitFor(() => undefined);
		assert.ok(phone.isPrivateOpen());

		prefs.privateLockMode = 'leave';
		hooks.appState!('background');
		await vi.waitFor(() => assert.equal(phone.isPrivateOpen(), false));
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');

		prefs.privateLockMode = 'screen';
		hooks.screenOff!();
		await vi.waitFor(() => assert.equal(phone.isPrivateOpen(), false));
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');

		prefs.privateLockMode = 'timeout';
		prefs.privateLockMinutes = 5;
		vi.useFakeTimers({toFake: ['Date']});
		try {
			autolock.markActive();
			vi.setSystemTime(Date.now() + 4 * 60_000);
			hooks.appState!('active');
			await vi.waitFor(() => undefined);
			assert.ok(phone.isPrivateOpen(), 'four minutes is not yet five');
			// Coming back to the app counts as a touch, so the wait starts over.
			vi.setSystemTime(Date.now() + 6 * 60_000);
			hooks.appState!('active');
		} finally {
			vi.useRealTimers();
		}

		await vi.waitFor(() => assert.equal(phone.isPrivateOpen(), false));
		stop();
		prefs.privateLockMode = 'manual';
		phone = await startPhone();
	});
});
