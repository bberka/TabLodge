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

const {memory, failRemoval, failWrite, holds} =
	await import('./support/memory-storage');
const {prefs} = await import('./support/fake-preferences');

let phones: Phone[] = [];
let server: Server;
let counter = 0;
const newId = () => {
	counter += 1;
	return `id-${counter}`;
};

const PIN = {value: '4821'};
const PASSWORD = {value: 'correct horse battery'};

async function startPhone(): Promise<Phone> {
	vi.resetModules();
	const phone = await import('../src/private/private-library');
	phones.push(phone);
	await phone.startPrivate();
	return phone;
}

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
	failRemoval.clear();
	failWrite.clear();
	holds.read.clear();
	holds.write.clear();
	phones = [];
	server = makeServer();
	connectGlobals(server);
	prefs.syncPrivate = true;
	vi.stubGlobal('__DEV__', false);
});

afterEach(async () => {
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
	test('a library is made with a password, edited, and kept across a restart', async () => {
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
		await phone.refreshPrivateStatus();
		const status = phone.getPrivateStatus();
		assert.equal(status.phase, 'off');
		assert.equal(status.error, null);
		assert.ok(!status.needsKey);
	});

	test('a library with a password locks, refuses a wrong password, and opens with the right one', async () => {
		let phone = await startPhone();
		await phone.setupPrivate(PIN);
		assert.equal(phone.canLockPrivate(), true);
		await addLink(phone, 'https://secret.example/');
		assert.ok(!memory.get('tablodge.private.lock')!.includes(PIN.value));

		await phone.lockPrivate();
		assert.equal(phone.isPrivateOpen(), false);

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

	test('a lock an older version made with a 4 digit PIN, stored with kind pin, still unlocks and still joins the server’s key', async () => {
		let phone = await startPhone();
		await phone.setupPrivate({value: '2468'});
		await addLink(phone, 'https://a.example/');
		await phone.lockPrivate();
		const stored = JSON.parse(memory.get('tablodge.private.lock')!) as object;
		memory.set(
			'tablodge.private.lock',
			JSON.stringify({...stored, kind: 'pin'}),
		);

		phone = await startPhone();
		assert.equal(phone.getPrivateState().hasLock, true);
		assert.equal(await phone.unlockPrivate('1357'), 'wrong');
		assert.equal(await phone.unlockPrivate('2468'), 'ok');
		assert.deepEqual(urlsOf(phone.getPrivateStore()), ['https://a.example/']);

		const extension = makeExtension(server);
		await extension.protect({value: '2468'});
		extension.edit((store) =>
			addBookmark(
				store,
				{url: 'https://ext.example/', title: 'E', columnId: ''},
				'ext-1',
				1,
			),
		);
		await extension.sync();
		memory.clear();
		const other = await startPhone();
		await connectPhone(other);
		assert.deepEqual(await other.openFromServer('2468'), {ok: true});
		assert.equal(other.getPrivateState().hasLock, true);
		assert.deepEqual(urlsOf(other.getPrivateStore()), ['https://ext.example/']);
	});

	test('a password is added to a library that had none, and asked for after a restart', async () => {
		let phone = await startPhone();
		await phone.setupPrivate();
		await addLink(phone, 'https://a.example/');
		assert.equal(phone.getPrivateState().needsPassword, true);
		assert.equal(phone.isPrivateOpen(), false);
		await phone.protectPrivate(PIN);
		assert.equal(phone.getPrivateState().needsPassword, false);
		assert.equal(phone.isPrivateOpen(), true);
		assert.equal(phone.canLockPrivate(), true);
		phone = await startPhone();
		assert.equal(phone.isPrivateOpen(), false);
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');
		assert.deepEqual(urlsOf(phone.getPrivateStore()), ['https://a.example/']);
	});

	test('changing the password needs the old one, and only the new one opens it afterwards', async () => {
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

	test('an erase that fails part way leaves the library out of reach, and finishes at the next start', async () => {
		let phone = await startPhone();
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://a.example/');
		failRemoval.add('tablodge.private.lock');
		await assert.rejects(async () => phone.removePrivate(), /storage failed/);
		assert.equal(phone.privateExists(), false);
		assert.equal(phone.isPrivateOpen(), false);
		assert.equal(phone.getPrivateState().needsPassword, false);

		phone = await startPhone();
		assert.equal(phone.privateExists(), false);
		assert.equal(phone.isPrivateOpen(), false);

		failRemoval.clear();
		phone = await startPhone();
		assert.equal(phone.privateExists(), false);
		assert.deepEqual(
			[...memory.keys()].filter((key) => key.startsWith('tablodge.private.')),
			[],
		);
	});

	test('an erase that cannot even start changes nothing and says so', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://a.example/');
		failWrite.add('tablodge.private.erasing');
		await assert.rejects(
			async () => phone.removePrivate(),
			phone.EraseNotStartedError,
		);
		assert.equal(phone.privateExists(), true);
		await phone.lockPrivate();
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');
		assert.deepEqual(urlsOf(phone.getPrivateStore()), ['https://a.example/']);

		failWrite.clear();
		await phone.removePrivate();
		assert.equal(phone.privateExists(), false);
		assert.deepEqual(
			[...memory.keys()].filter((key) => key.startsWith('tablodge.private.')),
			[],
		);
	});

	test('setting up after a failed erase finishes it first, so nothing of the old library comes back', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://a.example/');
		failRemoval.add('tablodge.private.lock');
		await assert.rejects(async () => phone.removePrivate(), /storage failed/);
		failRemoval.clear();

		await phone.setupPrivate(PASSWORD);
		assert.deepEqual(phone.getPrivateStore().bookmarks, []);
		await phone.lockPrivate();
		assert.equal(await phone.unlockPrivate(PIN.value), 'wrong');
		assert.equal(await phone.unlockPrivate(PASSWORD.value), 'ok');
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
	test('a library with no password does not sync, so nothing leaves it unsealed, until it has one', async () => {
		const phone = await startPhone();
		await phone.setupPrivate();
		await addLink(phone, 'https://a.example/');
		await connectPhone(phone);
		await phone.syncPrivate();
		assert.equal((await serverRecords()).length, 0, 'nothing was sent');
		const extension = makeExtension(server);
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), []);

		await phone.protectPrivate(PIN);
		await phone.syncPrivate();
		assert.ok((await serverRecords()).length > 0);
		assert.ok(
			(await serverRecords()).every((record) => isSealed(record.value)),
		);
		await extension.enterCredential(PIN.value);
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), ['https://a.example/']);
	});

	test('a phone library with a password sends only sealed values, and the extension reads them after joining with the password', async () => {
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
		await assert.rejects(extension.enterCredential('0000'), Error);
		await extension.enterCredential(PIN.value);
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), ['https://a.example/']);

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

	test('tags in the private library travel sealed, and come through to the extension', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await phone.editPrivate((store) =>
			addBookmark(
				store,
				{
					url: 'https://github.com/a/secret-repo',
					title: 'Secret',
					columnId: '',
					tags: ['Hidden Project'],
					hiddenKinds: ['repo'],
				},
				'tagged',
				Date.now(),
			),
		);
		await connectPhone(phone);
		await phone.syncPrivate();
		const records = await serverRecords();
		assert.ok(records.some((record) => record.kind === 'tag'));
		assert.ok(records.every((record) => isSealed(record.value)));
		assert.ok(!JSON.stringify(records).includes('hidden project'));

		const extension = makeExtension(server);
		await extension.sync();
		await extension.enterCredential(PIN.value);
		await extension.sync();
		const [bookmark] = extension.store.bookmarks;
		assert.deepEqual(bookmark.tags, ['hidden project']);
		assert.deepEqual(bookmark.hiddenKinds, ['repo']);
	});

	test('joining a library the extension made asks for its password once: a wrong password changes nothing, the right one brings the data', async () => {
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

		const restarted = await startPhone();
		assert.equal(restarted.isPrivateOpen(), false);
		assert.equal(await restarted.unlockPrivate(PIN.value), 'ok');
		assert.deepEqual(urlsOf(restarted.getPrivateStore()), [
			'https://ext.example/',
		]);

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

	test('the set-a-password screen learns what the server holds, and joining from an empty phone makes the server’s password its lock', async () => {
		const phone = await startPhone();
		assert.deepEqual(await phone.privateServerInfo(), {
			connected: false,
			hasKey: false,
			failed: false,
		});
		await connectPhone(phone);
		assert.deepEqual(await phone.privateServerInfo(), {
			connected: true,
			hasKey: false,
			failed: false,
		});

		const extension = makeExtension(server);
		await extension.protect(PIN);
		await extension.sync();
		assert.deepEqual(await phone.privateServerInfo(), {
			connected: true,
			hasKey: true,
			failed: false,
		});

		assert.deepEqual(await phone.openFromServer(PIN.value), {ok: true});
		assert.equal(phone.getPrivateState().hasLock, true);
		assert.equal(phone.getPrivateState().needsPassword, false);
		await phone.lockPrivate();
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');
	});

	test('keeping the library on the phone with its own password does not touch the server, and syncing later takes the server’s password and merges', async () => {
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

	test('a library with no key on the server is not made from the server: a password comes first', async () => {
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
		const result = await phone.openFromServer();
		assert.equal(result.ok, false);
		assert.equal(phone.privateExists(), false);
	});

	test('a library that kept the server’s key without a lock takes the lock only from a credential that opens the server’s key', async () => {
		const extension = makeExtension(server);
		await extension.protect(PIN);
		await extension.sync();
		const held = extension.key;
		assert.ok(held);
		memory.set('tablodge.private.on', 'true');
		memory.set(
			'tablodge.private.keptKey',
			JSON.stringify({id: held.id, wrapped: held.wrapped, raw: held.raw}),
		);
		const phone = await startPhone();
		await connectPhone(phone);
		assert.equal(phone.getPrivateState().needsPassword, true);
		assert.deepEqual(await phone.openFromServer('0000'), {
			ok: false,
			reason: 'wrong',
		});
		assert.equal(phone.getPrivateState().needsPassword, true);
		assert.deepEqual(await phone.openFromServer(PIN.value), {ok: true});
		assert.equal(phone.getPrivateState().needsPassword, false);
		assert.equal(phone.getPrivateState().hasLock, true);
	});

	test('with private sync off, joining says so instead of asking to connect', async () => {
		const phone = await startPhone();
		await connectPhone(phone);
		prefs.syncPrivate = false;
		assert.deepEqual(await phone.openFromServer(), {
			ok: false,
			reason: 'sync-off',
		});
		memory.delete(SYNC_CONFIG_KEY);
		assert.deepEqual(await phone.openFromServer(), {
			ok: false,
			reason: 'not-connected',
		});
	});

	test('a join that fails while installing the lock leaves the server’s lock and its key together, and what the phone sends stays readable', async () => {
		const extension = makeExtension(server);
		await extension.protect(PASSWORD);
		await extension.sync();
		const phone = await startPhone();
		await connectPhone(phone);
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://phone.example/');
		failRemoval.add('tablodge.private.keptKey');
		const result = await phone.openFromServer(PASSWORD.value);
		assert.equal(result.ok, false);
		failRemoval.clear();

		assert.deepEqual(await phone.openFromServer('0000'), {
			ok: false,
			reason: 'wrong',
		});
		assert.deepEqual(await phone.openFromServer(PASSWORD.value), {ok: true});

		await phone.syncPrivate();
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), ['https://phone.example/']);
	});

	test('a join whose drawer was dismissed while it waited installs nothing', async () => {
		const extension = makeExtension(server);
		await extension.protect(PASSWORD);
		await extension.sync();
		const keyBefore = server.privateLog.key;
		const phone = await startPhone();
		await connectPhone(phone);

		const {promise: gate, resolve: release} = Promise.withResolvers<void>();
		const {promise: reached, resolve: markReached} =
			Promise.withResolvers<void>();
		const real = globalThis.fetch;
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			if (String(url).endsWith('/private/v1/key') && !init?.method) {
				markReached();
				await gate;
			}

			return real(url, init);
		});
		let dismissed = false;
		const joining = phone.openFromServer(PASSWORD.value, () => dismissed);
		await reached;
		dismissed = true;
		release();
		const result = await joining;
		assert.equal(result.ok, false);
		assert.equal(phone.privateExists(), false);
		assert.equal(server.privateLog.key, keyBefore);
	});

	test('a join waits for a password change that is already running, so the server’s lock is the last word', async () => {
		const extension = makeExtension(server);
		await extension.protect(PASSWORD);
		await extension.sync();
		const phone = await startPhone();
		await connectPhone(phone);
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://phone.example/');

		const {unwrapHold} = await import('./support/fake-crypto');
		const {promise: hold, resolve: release} = Promise.withResolvers<void>();
		unwrapHold.next = hold;
		const order: string[] = [];
		const changing = phone
			.changePrivateLock(PIN.value, {
				value: 'a brand new password',
			})
			.then((result) => {
				order.push(`change:${result}`);
			});
		const joining = phone.openFromServer(PASSWORD.value).then((result) => {
			order.push(`join:${result.ok}`);
		});
		await new Promise((resolve) => {
			setTimeout(resolve, 200);
		});
		assert.deepEqual(
			order,
			[],
			'the join has not committed ahead of the change',
		);
		release();
		await Promise.all([changing, joining]);
		assert.deepEqual(order, ['change:ok', 'join:true']);

		await phone.lockPrivate();
		assert.equal(await phone.unlockPrivate(PASSWORD.value), 'ok');
		await phone.syncPrivate();
		await extension.sync();
		assert.deepEqual(urlsOf(extension.store), ['https://phone.example/']);
	});

	test('the dialog text for a failed erase tells a start that changed nothing from one that stopped part way', async () => {
		const {EraseNotStartedError, eraseFailureNotice} =
			await import('../src/private/private-library');
		assert.match(
			eraseFailureNotice(new EraseNotStartedError('x')).message,
			/Nothing was changed/,
		);
		assert.match(
			eraseFailureNotice(new Error('storage failed')).message,
			/finishes the next time the app starts/,
		);
	});

	test('a join and a phone-only setup that overlap leave one consistent library, whichever commits first', async () => {
		const extension = makeExtension(server);
		await extension.protect(PASSWORD);
		await extension.sync();
		const keyBefore = server.privateLog.key;
		const phone = await startPhone();
		await connectPhone(phone);

		const {promise: gate, resolve: release} = Promise.withResolvers<void>();
		const {promise: reached, resolve: markReached} =
			Promise.withResolvers<void>();
		const real = globalThis.fetch;
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			if (String(url).endsWith('/private/v1/key') && !init?.method) {
				markReached();
				await gate;
			}

			return real(url, init);
		});
		const joining = phone.openFromServer(PASSWORD.value);
		await reached;
		release();
		await Promise.all([joining, phone.setupPrivate(PIN)]);

		assert.equal(phone.getPrivateState().needsPassword, false);
		assert.equal(server.privateLog.key, keyBefore);
		await phone.lockPrivate();
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');
	});

	test('a sync round that outlives the key, because the library locked, sends nothing unsealed', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await connectPhone(phone);
		await addLink(phone, 'https://one.example/');
		await phone.syncPrivate();
		await phone.syncPrivate();
		assert.ok(
			(await serverRecords()).every((record) => isSealed(record.value)),
			'what is sent before the lock is sealed',
		);

		await addLink(phone, 'https://two.example/');
		const {promise: gate, resolve: release} = Promise.withResolvers<void>();
		const {promise: reached, resolve: markReached} =
			Promise.withResolvers<void>();
		const real = globalThis.fetch;
		let held = false;
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			if (
				!held &&
				String(url).includes('/private/v1/changes') &&
				!init?.method
			) {
				held = true;
				markReached();
				await gate;
			}

			return real(url, init);
		});
		const round = phone.syncPrivate();
		await reached;
		await phone.lockPrivate();
		release();
		await round;
		const records = await serverRecords();
		assert.ok(
			records.every((record) => isSealed(record.value)),
			'nothing plain reached the server',
		);
	});

	test('setting up while an erase is still running waits for it and keeps the new library', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://old.example/');
		const erasing = phone.removePrivate();
		await Promise.all([erasing, phone.setupPrivate(PASSWORD)]);
		assert.equal(phone.privateExists(), true);
		await phone.lockPrivate();
		assert.equal(await phone.unlockPrivate(PASSWORD.value), 'ok');
		assert.deepEqual(phone.getPrivateStore().bookmarks, []);
	});

	test('a join does not install the server’s lock after private sync was turned off while it waited', async () => {
		const extension = makeExtension(server);
		await extension.protect(PASSWORD);
		await extension.sync();
		const phone = await startPhone();
		await connectPhone(phone);
		await phone.setupPrivate(PIN);

		const {promise: gate, resolve: release} = Promise.withResolvers<void>();
		const {promise: reached, resolve: markReached} =
			Promise.withResolvers<void>();
		const real = globalThis.fetch;
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			if (String(url).endsWith('/private/v1/key') && !init?.method) {
				markReached();
				await gate;
			}

			return real(url, init);
		});
		const joining = phone.openFromServer(PASSWORD.value);
		await reached;
		prefs.syncPrivate = false;
		release();
		assert.equal((await joining).ok, false);
		await phone.lockPrivate();
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');
		assert.equal(await phone.unlockPrivate(PASSWORD.value), 'wrong');
	});

	test('a phone-only password on a library that kept the server’s key does not become the server’s credential', async () => {
		const extension = makeExtension(server);
		await extension.protect(PASSWORD);
		await extension.sync();
		const held = extension.key;
		assert.ok(held);
		const keyBefore = server.privateLog.key;
		memory.set('tablodge.private.on', 'true');
		memory.set(
			'tablodge.private.keptKey',
			JSON.stringify({id: held.id, wrapped: held.wrapped, raw: held.raw}),
		);
		const phone = await startPhone();
		await connectPhone(phone);
		await phone.protectPrivate(PIN);
		await phone.syncPrivate();
		assert.equal(
			server.privateLog.key,
			keyBefore,
			'the server’s key is untouched',
		);
		assert.equal(phone.getPrivateStatus().needsKey, true);
		assert.deepEqual(await phone.openFromServer(PIN.value), {
			ok: false,
			reason: 'wrong',
		});
		assert.deepEqual(await phone.openFromServer(PASSWORD.value), {ok: true});
	});

	test('a sync round that outlives an erase sends nothing and writes nothing back', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await connectPhone(phone);
		await addLink(phone, 'https://one.example/');
		await phone.syncPrivate();
		await phone.syncPrivate();
		await addLink(phone, 'https://two.example/');

		const {promise: gate, resolve: release} = Promise.withResolvers<void>();
		const {promise: reached, resolve: markReached} =
			Promise.withResolvers<void>();
		const real = globalThis.fetch;
		let held = false;
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			if (
				!held &&
				String(url).includes('/private/v1/changes') &&
				!init?.method
			) {
				held = true;
				markReached();
				await gate;
			}

			return real(url, init);
		});
		const round = phone.syncPrivate();
		await reached;
		await phone.removePrivate();
		const recordsAtErase = (await serverRecords()).length;
		release();
		await round;
		assert.equal(
			(await serverRecords()).length,
			recordsAtErase,
			'the round sent nothing after the erase',
		);
		assert.deepEqual(
			[...memory.keys()].filter((key) => key.startsWith('tablodge.private.')),
			[],
			'and wrote nothing back',
		);
	});

	test('a key update held through an erase leaves no lock behind', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await connectPhone(phone);
		await addLink(phone, 'https://a.example/');
		await phone.syncPrivate();
		server.setOnline(false);
		assert.equal(await phone.changePrivateLock(PIN.value, PASSWORD), 'ok');
		server.setOnline(true);

		const {promise: gate, resolve: release} = Promise.withResolvers<void>();
		const {promise: reached, resolve: markReached} =
			Promise.withResolvers<void>();
		const real = globalThis.fetch;
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			if (String(url).endsWith('/private/v1/key') && init?.method === 'POST') {
				markReached();
				await gate;
			}

			return real(url, init);
		});
		const round = phone.syncPrivate();
		await reached;
		await phone.removePrivate();
		release();
		await round;
		assert.deepEqual(
			[...memory.keys()].filter((key) => key.startsWith('tablodge.private.')),
			[],
			'the stopped round wrote no lock back',
		);
	});

	test('an unlock that is still running when the library is erased leaves nothing open', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await phone.lockPrivate();
		const unlocking = phone.unlockPrivate(PIN.value);
		await phone.removePrivate();
		await unlocking;
		assert.equal(phone.privateExists(), false);
		assert.equal(phone.isPrivateOpen(), false);
	});

	test('a trash change queued before an erase finishes first, so no trash is left behind', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		const {changeTrash} = await import('../src/library/trash-storage');
		const {promise: hold, resolve: release} = Promise.withResolvers<void>();
		holds.read.set('tablodge.private.trash', hold);
		const changing = changeTrash('private', 30, () => [
			{
				id: 't1',
				kind: 'bookmark',
				deletedAt: 1,
				label: 'Deleted',
				origin: 'test',
				count: 1,
				data: {},
			},
		]);
		const erasing = phone.removePrivate();
		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});
		release();
		await Promise.all([changing, erasing]);
		assert.deepEqual(
			[...memory.keys()].filter((key) => key.startsWith('tablodge.private.')),
			[],
		);
	});

	test('a lock write started by a round before an erase finishes before the erase runs', async () => {
		const phone = await startPhone();
		await phone.setupPrivate(PIN);
		await connectPhone(phone);
		await addLink(phone, 'https://a.example/');
		await phone.syncPrivate();
		server.setOnline(false);
		assert.equal(await phone.changePrivateLock(PIN.value, PASSWORD), 'ok');
		server.setOnline(true);

		const {promise: hold, resolve: release} = Promise.withResolvers<void>();
		holds.write.set('tablodge.private.lock', hold);
		const round = phone.syncPrivate();
		await new Promise((resolve) => {
			setTimeout(resolve, 150);
		});
		const erasing = phone.removePrivate();
		await new Promise((resolve) => {
			setTimeout(resolve, 150);
		});
		release();
		await Promise.all([round, erasing]);
		assert.deepEqual(
			[...memory.keys()].filter((key) => key.startsWith('tablodge.private.')),
			[],
			'the held lock write did not outlive the erase',
		);
	});

	test('a key the phone cannot read is a failed lookup, not an empty server', async () => {
		const phone = await startPhone();
		await connectPhone(phone);
		await server.fetch(`${URL_BASE}/private/v1/key`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({key: 'a newer format', previous: null}),
		});
		assert.deepEqual(await phone.privateServerInfo(), {
			connected: true,
			hasKey: false,
			failed: true,
		});
	});

	test('a server that never answers is given up on after a few seconds, for the drawer and for a join', async () => {
		const phone = await startPhone();
		await connectPhone(phone);
		vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
		try {
			vi.stubGlobal(
				'fetch',
				async (_url: string, init?: RequestInit) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => {
							reject(new DOMException('aborted', 'AbortError'));
						});
					}),
			);
			const info = phone.privateServerInfo();
			await vi.advanceTimersByTimeAsync(9000);
			assert.deepEqual(await info, {
				connected: true,
				hasKey: false,
				failed: true,
			});
			const join = phone.openFromServer(PIN.value);
			await vi.advanceTimersByTimeAsync(9000);
			assert.deepEqual(await join, {
				ok: false,
				reason: 'error',
				message: 'The sync server did not answer.',
			});
		} finally {
			vi.useRealTimers();
		}
	});

	test('a join that finishes after the library got a password of its own does not replace it', async () => {
		const extension = makeExtension(server);
		await extension.protect(PASSWORD);
		await extension.sync();
		const phone = await startPhone();
		await connectPhone(phone);

		const {promise: gate, resolve: release} = Promise.withResolvers<void>();
		const {promise: reached, resolve: markReached} =
			Promise.withResolvers<void>();
		const real = globalThis.fetch;
		vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
			if (String(url).endsWith('/private/v1/key') && !init?.method) {
				markReached();
				await gate;
			}

			return real(url, init);
		});
		const joining = phone.openFromServer(PASSWORD.value);
		await reached;
		await phone.setupPrivate(PIN);
		release();
		const result = await joining;
		assert.deepEqual(result, {
			ok: false,
			reason: 'error',
			message:
				'The private library changed while the server was checked. Try again.',
		});
		assert.equal(phone.getPrivateState().hasLock, true);
		await phone.lockPrivate();
		assert.equal(await phone.unlockPrivate(PASSWORD.value), 'wrong');
		assert.equal(await phone.unlockPrivate(PIN.value), 'ok');
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

	test('a phone with its own password joins the extension’s library and takes its lock; its own data stays', async () => {
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

	test('a phone set up while the server could not be read keeps the server’s key as it was, and joining from Settings merges later', async () => {
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
		server.setOnline(false);
		assert.deepEqual(await phone.privateServerInfo(), {
			connected: true,
			hasKey: false,
			failed: true,
		});
		await phone.setupPrivate(PIN);
		await addLink(phone, 'https://phone.example/');
		server.setOnline(true);

		await phone.syncPrivate();
		assert.equal(server.privateLog.key, keyBefore);
		assert.equal((await serverRecords()).length, recordsBefore);
		assert.equal(phone.getPrivateStatus().needsKey, true);

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

	test('a password added to a library from an earlier version seals what is already plain on the server, and the extension can still read it', async () => {
		const older = makeExtension(server);
		older.edit((store) =>
			addBookmark(
				addBookmark(
					store,
					{url: 'https://a.example/', title: 'A', columnId: ''},
					'a',
					1,
				),
				{url: 'https://b.example/', title: 'B', columnId: ''},
				'b',
				2,
			),
		);
		await older.sync();
		assert.equal(await sealedCount(), 0);
		const before = (await serverRecords()).length;

		const phone = await startPhone();
		await phone.setupPrivate();
		await connectPhone(phone);
		await phone.protectPrivate(PIN);
		await phone.syncPrivate();
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

	test('a password added while the server is out of reach is sent sealed once it is back', async () => {
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

	test('changing the password on the phone keeps the extension working, and a new join needs the new password', async () => {
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

	test('a password changed while offline is not undone by the next sync', async () => {
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

	test('the extension changing its password carries over to the phone', async () => {
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

	test('a library with a password locks when the app leaves the screen, when the screen turns off, and after a while idle', async () => {
		let phone = await startPhone();
		const autolock = await import('../src/private/private-autolock');
		const stop = autolock.startPrivateAutoLock();
		await phone.setupPrivate(PIN);
		assert.ok(phone.isPrivateOpen());

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

	describe('private erase notice', () => {
		const BASE =
			'Erasing deletes the private library from this phone, with its password, and asks for a new one.';
		const NO_SERVER = `${BASE} This cannot be undone.`;
		const CONFIRMED = `${BASE} Your server keeps its copy.`;
		const MAY_HAVE_COPY = `${BASE} Your server may have a copy; check it before erasing.`;

		test('no server says erasing cannot be undone', async () => {
			const phone = await startPhone();
			await phone.setupPrivate(PIN);
			await phone.lockPrivate();

			assert.equal(
				phone.privateEraseNotice(await phone.privateEraseCopy()),
				NO_SERVER,
			);
		});

		test('server connected with private sync off hedges', async () => {
			const phone = await startPhone();
			await connectPhone(phone);
			await phone.setupPrivate(PIN);
			await phone.syncPrivate();
			prefs.syncPrivate = false;
			await phone.applyPrivateSyncSetting();
			await phone.lockPrivate();

			assert.equal(
				phone.privateEraseNotice(await phone.privateEraseCopy()),
				MAY_HAVE_COPY,
			);
		});

		test('server connected with private sync on and last push complete promises a server copy', async () => {
			const phone = await startPhone();
			await connectPhone(phone);
			await phone.setupPrivate(PIN);
			await addLink(phone, 'https://synced.example/');
			await phone.syncPrivate();
			await phone.lockPrivate();

			assert.equal(
				phone.privateEraseNotice(await phone.privateEraseCopy()),
				CONFIRMED,
			);

			const restarted = await startPhone();
			assert.equal(
				restarted.privateEraseNotice(await restarted.privateEraseCopy()),
				CONFIRMED,
			);
		});

		test('server connected with private sync on and a push pending hedges', async () => {
			const phone = await startPhone();
			await connectPhone(phone);
			await phone.setupPrivate(PIN);
			await phone.syncPrivate();
			await addLink(phone, 'https://unsynced.example/');
			await phone.lockPrivate();

			assert.equal(
				phone.privateEraseNotice(await phone.privateEraseCopy()),
				MAY_HAVE_COPY,
			);
		});

		test('server connected with private sync on and a failed push hedges even when the key is stored', async () => {
			const phone = await startPhone();
			await connectPhone(phone);
			await phone.setupPrivate(PIN);
			await addLink(phone, 'https://failed.example/');

			const baseFetch = globalThis.fetch;
			vi.stubGlobal(
				'fetch',
				async (input: string | URL | Request, init?: RequestInit) => {
					const url =
						typeof input === 'string'
							? input
							: input instanceof URL
								? input.href
								: input.url;
					return url.endsWith('/private/v1/changes') && init?.method === 'POST'
						? Response.json({error: 'server'}, {status: 500})
						: baseFetch(input, init);
				},
			);
			try {
				await phone.syncPrivate();
			} finally {
				vi.stubGlobal('fetch', baseFetch);
			}

			await phone.lockPrivate();
			assert.equal((await phone.privateServerInfo()).hasKey, true);
			assert.equal(
				phone.privateEraseNotice(await phone.privateEraseCopy()),
				MAY_HAVE_COPY,
			);
		});

		test('key lookup failed hedges', async () => {
			const phone = await startPhone();
			await connectPhone(phone);
			await phone.setupPrivate(PIN);
			await addLink(phone, 'https://offline.example/');
			await phone.syncPrivate();
			await phone.lockPrivate();
			server.setOnline(false);

			assert.equal(
				phone.privateEraseNotice(await phone.privateEraseCopy()),
				MAY_HAVE_COPY,
			);
		});
	});
});
