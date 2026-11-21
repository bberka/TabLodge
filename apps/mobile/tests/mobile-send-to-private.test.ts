import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, test, vi} from 'vite-plus/test';
import {SENT_COLUMN_ID} from '../../extension/src/shared/send-to-private';
import {SYNC_CONFIG_KEY} from '../../extension/src/shared/sync/client';
import {addBookmark, deleteColumn} from '../src/library/board-edits';
import {addSession} from '../src/library/session-edits';
import type * as RegularModule from '../src/library/library-store';
import type * as PrivateModule from '../src/private/private-library';
import type * as SendModule from '../src/private/send-to-private';
import {
	connectGlobals,
	makeServer,
	TOKEN,
	URL_BASE,
	type Server,
} from './support/world';

type Snack = {
	message: string;
	action?: {label: string; run: () => void; closed?: () => void};
};
const snacks = vi.hoisted(() => [] as Snack[]);
vi.mock('../src/ui/snackbar', () => ({
	showSnack(message: string, action?: Snack['action']) {
		snacks.at(-1)?.action?.closed?.();
		snacks.push({message, action});
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
vi.mock('../modules/bookmarks-widget', () => ({
	writeWidgetSnapshot() {},
}));
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
const {prefs} = await import('./support/fake-preferences');

const PASSWORD = {value: 'correct horse battery'};
const SECRET = 'https://secret.example/';
const PENDING_KEY = 'tablodge.sendprivate.pending';
const PRIVATE_LIBRARY_KEY = 'tablodge.private.library';

type App = {
	regular: typeof RegularModule;
	privateLibrary: typeof PrivateModule;
	send: typeof SendModule;
};

let server: Server;
let started: App[] = [];

async function startApp(): Promise<App> {
	vi.resetModules();
	const regular = await import('../src/library/library-store');
	const privateLibrary = await import('../src/private/private-library');
	const send = await import('../src/private/send-to-private');
	await regular.startLibrary();
	await privateLibrary.startPrivate();
	const app = {regular, privateLibrary, send};
	started.push(app);
	return app;
}

async function withRegularLinks(app: App) {
	await app.regular.editRegular((store) =>
		addBookmark(
			addSession(
				store,
				{
					name: 'Reading',
					urls: ['https://tab-one.example/', 'https://tab-two.example/'],
					titles: ['Tab one', 'Tab two'],
				},
				'session-1',
				['tab-1', 'tab-2'],
				1,
			),
			{url: SECRET, title: 'Secret', columnId: '', notes: 'a private note'},
			'bookmark-1',
			1,
		),
	);
	return app.regular.getLibrary();
}

const pending = () => memory.get(PENDING_KEY);

async function sentColumnOnServer(): Promise<boolean> {
	const response = await server.fetch(
		`${URL_BASE}/private/v1/changes?cursor=0&limit=1000`,
		{headers: {Authorization: `Bearer ${TOKEN}`}},
	);
	const body = (await response.json()) as {
		changes: Array<{kind: string; id: string; deleted?: boolean}>;
	};
	return body.changes.some(
		(change) => change.id === SENT_COLUMN_ID && !change.deleted,
	);
}

const lastSnack = () => snacks.at(-1);

beforeEach(() => {
	memory.clear();
	snacks.length = 0;
	started = [];
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
	for (const app of started) {
		await app.privateLibrary.applyPrivateSyncSetting();
	}

	prefs.syncPrivate = true;
});

describe('Send to private storage on the phone', () => {
	test('is offered only in the regular view of a phone with a private library', async () => {
		const app = await startApp();
		const none = app.privateLibrary.getPrivateState();
		assert.equal(app.send.canSendToPrivate('regular', none), false);
		await app.privateLibrary.setupPrivate(PASSWORD);
		const ready = app.privateLibrary.getPrivateState();
		assert.equal(app.send.canSendToPrivate('regular', ready), true);
		assert.equal(app.send.canSendToPrivate('private', ready), false);
	});

	test('a link sent while the library is locked is held outside the private library and taken in when it opens', async () => {
		let app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		app = await startApp();
		assert.equal(app.privateLibrary.isPrivateOpen(), false);
		const privateBefore = memory.get(PRIVATE_LIBRARY_KEY);
		const regular = await withRegularLinks(app);
		const bookmarkId = regular.bookmarks[0].id;

		assert.equal(
			await app.send.sendToPrivate([{kind: 'bookmark', bookmarkId}]),
			true,
		);
		assert.equal(lastSnack()?.message, '1 link sent to private storage');
		assert.equal(
			app.regular.getLibrary().bookmarks.some((entry) => entry.url === SECRET),
			false,
		);
		assert.equal(
			memory.get('tablodge.trash')?.includes('secret.example') ?? false,
			false,
			'the trash syncs, so it is skipped',
		);
		assert.equal(
			memory.get(PRIVATE_LIBRARY_KEY),
			privateBefore,
			'a locked library is not touched',
		);
		assert.ok(pending()?.includes('secret.example'));

		lastSnack()?.action?.closed?.();
		await app.privateLibrary.takeInSent();
		assert.ok(pending(), 'still locked, so it waits');

		assert.equal(await app.privateLibrary.unlockPrivate(PASSWORD.value), 'ok');
		await app.privateLibrary.takeInSent();
		assert.equal(pending(), undefined);
		const sent = app.privateLibrary
			.getPrivateStore()
			.bookmarks.filter((entry) => entry.columnId === SENT_COLUMN_ID);
		assert.deepEqual(
			sent.map(({url, notes}) => ({url, notes})),
			[{url: SECRET, notes: 'a private note'}],
		);
		assert.equal(
			app.privateLibrary
				.getPrivateStore()
				.bookmarkColumns.find((column) => column.id === SENT_COLUMN_ID)?.name,
			'Sent from regular windows',
		);
		assert.equal(
			JSON.stringify(
				[...memory].filter(([key]) => !key.startsWith('tablodge.private.')),
			).includes('secret.example'),
			false,
			'only the private library holds it now',
		);
	});

	test('an open private library waits while Undo is offered, and Undo brings the link back', async () => {
		const app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		const regular = await withRegularLinks(app);
		const session = regular.groups[0];
		const target = {
			kind: 'tab' as const,
			sessionId: session.id,
			tabId: session.tabs[0].id,
		};

		assert.equal(await app.send.sendToPrivate([target]), true);
		await app.privateLibrary.takeInSent();
		assert.ok(pending(), 'held while the snackbar offers Undo');
		assert.equal(
			app.privateLibrary
				.getPrivateStore()
				.bookmarks.some((entry) => entry.url === 'https://tab-one.example/'),
			false,
		);

		lastSnack()?.action?.run();
		lastSnack()?.action?.closed?.();
		await app.privateLibrary.takeInSent();
		await new Promise((resolve) => {
			setTimeout(resolve, 20);
		});
		assert.equal(pending(), undefined);
		assert.deepEqual(
			app.regular
				.getLibrary()
				.groups.find((entry) => entry.id === session.id)
				?.tabs.map((tab) => tab.url),
			['https://tab-one.example/', 'https://tab-two.example/'],
		);
		assert.equal(
			app.privateLibrary
				.getPrivateStore()
				.bookmarks.some((entry) => entry.url === 'https://tab-one.example/'),
			false,
		);

		assert.equal(await app.send.sendToPrivate([target]), true);
		lastSnack()?.action?.closed?.();
		await app.privateLibrary.takeInSent();
		assert.equal(pending(), undefined);
		assert.ok(
			app.privateLibrary
				.getPrivateStore()
				.bookmarks.some((entry) => entry.url === 'https://tab-one.example/'),
		);
		lastSnack()?.action?.run();
		await new Promise((resolve) => {
			setTimeout(resolve, 20);
		});
		assert.equal(lastSnack()?.message, 'It is already in the private library');
		assert.equal(
			app.regular
				.getLibrary()
				.groups.find((entry) => entry.id === session.id)
				?.tabs.some((tab) => tab.url === 'https://tab-one.example/'),
			false,
			'no copy comes back once the private library has it',
		);
	});

	test('a synced private library sends the link to the server sealed', async () => {
		const app = await startApp();
		memory.set(SYNC_CONFIG_KEY, JSON.stringify({url: URL_BASE, token: TOKEN}));
		await app.privateLibrary.setupPrivate(PASSWORD);
		await app.privateLibrary.reconnectPrivate();
		const regular = await withRegularLinks(app);
		assert.equal(
			await app.send.sendToPrivate([
				{kind: 'bookmark', bookmarkId: regular.bookmarks[0].id},
			]),
			true,
		);
		lastSnack()?.action?.closed?.();
		await app.privateLibrary.takeInSent();
		await app.privateLibrary.syncPrivate();
		const response = await server.fetch(
			`${URL_BASE}/private/v1/changes?cursor=0&limit=1000`,
			{headers: {Authorization: `Bearer ${TOKEN}`}},
		);
		const text = await response.text();
		assert.ok(text.includes('"tlock"'), 'values are sealed');
		assert.equal(text.includes('secret.example'), false);
		assert.equal(text.includes('a private note'), false);

		await app.privateLibrary.editPrivate((store) =>
			deleteColumn(store, SENT_COLUMN_ID, null, Date.now()),
		);
		await app.privateLibrary.syncPrivate();
		assert.equal(await sentColumnOnServer(), false);

		await app.regular.editRegular((store) =>
			addBookmark(
				store,
				{url: 'https://later.example/', title: 'Later', columnId: ''},
				'bookmark-2',
				Date.now(),
			),
		);
		assert.equal(
			await app.send.sendToPrivate([
				{kind: 'bookmark', bookmarkId: 'bookmark-2'},
			]),
			true,
		);
		lastSnack()?.action?.closed?.();
		await app.privateLibrary.takeInSent();
		await app.privateLibrary.syncPrivate();
		assert.equal(
			await sentColumnOnServer(),
			true,
			'a column deleted earlier comes back on the server',
		);
	});

	test('erasing the private library drops links waiting for it', async () => {
		let app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		app = await startApp();
		const regular = await withRegularLinks(app);
		await app.send.sendToPrivate([
			{kind: 'bookmark', bookmarkId: regular.bookmarks[0].id},
		]);
		assert.ok(pending());
		await app.privateLibrary.removePrivate();
		assert.equal(pending(), undefined);
	});
});
