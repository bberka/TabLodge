import assert from 'node:assert/strict';
import {afterEach, beforeEach, describe, test, vi} from 'vite-plus/test';
import {SENT_COLUMN_ID} from '../../extension/src/shared/send-to-private';
import {SYNC_CONFIG_KEY} from '../../extension/src/shared/sync/client';
import {addBookmark, addColumn, deleteColumn} from '../src/library/board-edits';
import {addSession, renameSession} from '../src/library/session-edits';
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
	action?: {
		label: string;
		run: () => void | Promise<void>;
		closed?: () => void;
	};
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

const {memory, holds} = await import('./support/memory-storage');
const {prefs} = await import('./support/fake-preferences');

const PASSWORD = {value: 'correct horse battery'};
const SECRET = 'https://secret.example/';
const PENDING_KEY = 'tablodge.sendprivate.pending';
const PRIVATE_LIBRARY_KEY = 'tablodge.private.library';
const REGULAR_LIBRARY_KEY = 'tablodge.library';
const nextTurn = async () =>
	new Promise((resolve) => {
		setImmediate(resolve);
	});

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

		const undone = lastSnack()?.action?.run();
		lastSnack()?.action?.closed?.();
		await undone;
		await app.privateLibrary.takeInSent();
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
		await lastSnack()?.action?.run();
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

	test('Undo puts the sent link back into a session renamed meanwhile, and keeps the name', async () => {
		const app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		const regular = await withRegularLinks(app);
		const session = regular.groups[0];
		assert.equal(
			await app.send.sendToPrivate([
				{kind: 'tab', sessionId: session.id, tabId: session.tabs[0].id},
			]),
			true,
		);
		await app.regular.editRegular((store) =>
			renameSession(store, session.id, 'Renamed', Date.now()),
		);
		await lastSnack()?.action?.run();
		const back = app.regular
			.getLibrary()
			.groups.find((entry) => entry.id === session.id);
		assert.equal(back?.name, 'Renamed');
		assert.deepEqual(
			back?.tabs.map((tab) => tab.url),
			['https://tab-one.example/', 'https://tab-two.example/'],
		);
	});

	test('a link released while another is being taken in is not dropped', async () => {
		const app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		const first = await app.privateLibrary.queueSent({
			links: [{title: 'First', url: 'https://first.example/', createdAt: 1}],
			columns: [],
			sessions: [],
		});
		const second = await app.privateLibrary.queueSent({
			links: [{title: 'Second', url: 'https://second.example/', createdAt: 2}],
			columns: [],
			sessions: [],
		});
		const paused = Promise.withResolvers<void>();
		holds.write.set(PRIVATE_LIBRARY_KEY, paused.promise);
		const intake = app.privateLibrary.releaseSent(first);
		while (holds.write.has(PRIVATE_LIBRARY_KEY)) {
			await new Promise((resolve) => {
				setImmediate(resolve);
			});
		}

		const late = app.privateLibrary.releaseSent(second);
		paused.resolve();
		await intake;
		await late;
		assert.equal(pending(), undefined);
		assert.deepEqual(
			app.privateLibrary
				.getPrivateStore()
				.bookmarks.map((entry) => entry.url)
				.toSorted(),
			['https://first.example/', 'https://second.example/'],
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

	async function withColumns(app: App, bookmarkCount = 3) {
		await app.regular.editRegular((store) => {
			let next = addColumn(store, 'Work', 'work', 1, 'star', '#336699');
			next = addColumn(next, 'YouTube', 'source-youtube', 2);
			next = addColumn(next, 'Empty', 'empty', 3);
			for (let index = 0; index < bookmarkCount; index += 1) {
				next = addBookmark(
					next,
					{
						url: `https://work-${index}.example/`,
						title: `Work ${index}`,
						columnId: 'work',
						...(index === 0 && {notes: 'first note'}),
					},
					`w${index}`,
					10 + index,
				);
				if (index === 0) {
					next = addBookmark(
						next,
						{
							url: 'https://video.example/',
							title: 'Video',
							columnId: 'source-youtube',
						},
						'v0',
						9,
					);
				}
			}

			return next;
		});
		return app.regular.getLibrary();
	}

	test('a sent column arrives with its look, order, notes and merges into a private column of the same name', async () => {
		const app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		await app.privateLibrary.editPrivate((store) =>
			addBookmark(
				addColumn(store, 'work', 'mine', 1),
				{url: 'https://mine.example/', title: 'Mine', columnId: 'mine'},
				'm1',
				2,
			),
		);
		await withColumns(app);
		assert.equal(
			await app.send.sendToPrivate([{kind: 'column', columnId: 'work'}]),
			true,
		);
		assert.equal(lastSnack()?.message, '3 links sent to private storage');
		assert.equal(
			app.regular
				.getLibrary()
				.bookmarkColumns.some((entry) => entry.id === 'work'),
			false,
		);
		assert.equal(
			app.regular
				.getLibrary()
				.bookmarks.some((entry) => entry.columnId === 'work'),
			false,
		);
		lastSnack()?.action?.closed?.();
		await app.privateLibrary.takeInSent();
		assert.equal(pending(), undefined);
		const store = app.privateLibrary.getPrivateStore();
		assert.equal(
			store.bookmarkColumns.filter(
				(entry) => entry.name.toLowerCase() === 'work',
			).length,
			1,
		);
		assert.deepEqual(
			store.bookmarks
				.filter((entry) => entry.columnId === 'mine')
				.map((entry) => [entry.url, entry.notes]),
			[
				['https://mine.example/', undefined],
				['https://work-0.example/', 'first note'],
				['https://work-1.example/', undefined],
				['https://work-2.example/', undefined],
			],
		);

		await withColumns(app, 1);
		assert.equal(
			await app.send.sendToPrivate([{kind: 'column', columnId: 'work'}]),
			true,
		);
		lastSnack()?.action?.closed?.();
		await app.privateLibrary.takeInSent();
		const fresh = app.privateLibrary.getPrivateStore().bookmarkColumns;
		assert.equal(
			fresh.filter((entry) => entry.name.toLowerCase() === 'work').length,
			1,
		);
	});

	test('a sent column that is new in private storage keeps its name, icon and color', async () => {
		const app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		await withColumns(app);
		assert.equal(
			await app.send.sendToPrivate([{kind: 'column', columnId: 'work'}]),
			true,
		);
		lastSnack()?.action?.closed?.();
		await app.privateLibrary.takeInSent();
		const column = app.privateLibrary
			.getPrivateStore()
			.bookmarkColumns.find((entry) => entry.name === 'Work');
		assert.equal(column?.icon, 'star');
		assert.equal(column?.color, '#336699');
	});

	test('a column with a site source sends its bookmarks, stays, and the snackbar says so', async () => {
		const app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		await withColumns(app);
		assert.equal(
			await app.send.sendToPrivate([
				{kind: 'column', columnId: 'source-youtube'},
			]),
			true,
		);
		assert.equal(
			lastSnack()?.message,
			'1 link sent to private storage. The column “YouTube” stays here, empty, with its source on',
		);
		const store = app.regular.getLibrary();
		assert.ok(
			store.bookmarkColumns.some((entry) => entry.id === 'source-youtube'),
		);
		assert.equal(
			store.bookmarks.some((entry) => entry.columnId === 'source-youtube'),
			false,
		);
	});

	test('one Undo brings the whole column back exactly and takes it out of what was sent', async () => {
		const app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		const before = structuredClone(await withColumns(app));
		assert.equal(
			await app.send.sendToPrivate([{kind: 'column', columnId: 'work'}]),
			true,
		);
		await lastSnack()?.action?.run();
		lastSnack()?.action?.closed?.();
		await app.privateLibrary.takeInSent();
		const after = app.regular.getLibrary();
		assert.deepEqual(
			after.bookmarkColumns.map((entry) => entry.id),
			before.bookmarkColumns.map((entry) => entry.id),
		);
		assert.deepEqual(
			after.bookmarks.map((entry) => [
				entry.id,
				entry.columnId,
				entry.title,
				entry.notes,
			]),
			before.bookmarks.map((entry) => [
				entry.id,
				entry.columnId,
				entry.title,
				entry.notes,
			]),
		);
		assert.equal(pending(), undefined);
		assert.equal(
			app.privateLibrary
				.getPrivateStore()
				.bookmarks.some((entry) => entry.url.includes('work-')),
			false,
		);
	});

	test('a sent session arrives outside any folder with its name, link order and saved date, and Undo restores it', async () => {
		const app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		const regular = await withRegularLinks(app);
		const session = regular.groups[0];
		await app.regular.editRegular((store) => ({
			...store,
			folders: [
				...store.folders,
				{id: 'trips', name: 'Trips', createdAt: 1, isDefault: false},
			],
			groups: store.groups.map((group) => ({
				...group,
				folderId: 'trips',
				createdAt: 1_600_000_000_000,
			})),
		}));
		const before = structuredClone(app.regular.getLibrary().groups[0]);
		assert.equal(
			await app.send.sendToPrivate([{kind: 'session', sessionId: session.id}]),
			true,
		);
		assert.equal(lastSnack()?.message, '2 links sent to private storage');
		assert.equal(app.regular.getLibrary().groups.length, 0);
		const undone = lastSnack()?.action?.run();
		lastSnack()?.action?.closed?.();
		await undone;
		const back = app.regular.getLibrary().groups[0];
		assert.equal(back.id, before.id);
		assert.equal(back.folderId, 'trips');
		assert.deepEqual(
			back.tabs.map((tab) => tab.id),
			before.tabs.map((tab) => tab.id),
		);

		assert.equal(
			await app.send.sendToPrivate([{kind: 'session', sessionId: session.id}]),
			true,
		);
		lastSnack()?.action?.closed?.();
		await app.privateLibrary.takeInSent();
		const landed = app.privateLibrary
			.getPrivateStore()
			.groups.find((group) => group.name === 'Reading');
		assert.equal(landed?.createdAt, 1_600_000_000_000);
		assert.equal(landed?.folderId, 'unfiled');
		assert.deepEqual(
			landed?.tabs.map((tab) => tab.url),
			['https://tab-one.example/', 'https://tab-two.example/'],
		);
	});

	test('a column of 1,000 bookmarks and a session of 1,000 links each show one snackbar with one Undo', async () => {
		const app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		await app.regular.editRegular((store) => ({
			...addColumn(store, 'Big', 'big', 1),
			bookmarks: Array.from({length: 1000}, (_, index) => ({
				id: `b${index}`,
				title: `Link ${index}`,
				url: `https://link-${index}.example/`,
				columnId: 'big',
				createdAt: index + 1,
				updatedAt: index + 1,
			})),
			groups: [
				{
					id: 'big-session',
					name: 'Big session',
					folderId: 'unfiled',
					description: '',
					createdAt: 1,
					updatedAt: 1,
					sourceWindowName: '',
					sourceWindowId: null,
					tabs: Array.from({length: 1000}, (_, index) => ({
						id: `t${index}`,
						title: `Tab ${index}`,
						url: `https://tab-${index}.example/`,
						notes: '',
						pinned: false,
						nativeGroup: null,
						savedAt: 1,
						originalIndex: index,
					})),
				},
			],
		}));
		const shown = snacks.length;
		assert.equal(
			await app.send.sendToPrivate([{kind: 'column', columnId: 'big'}]),
			true,
		);
		assert.equal(snacks.length, shown + 1);
		assert.equal(lastSnack()?.message, '1000 links sent to private storage');
		assert.equal(
			await app.send.sendToPrivate([
				{kind: 'session', sessionId: 'big-session'},
			]),
			true,
		);
		assert.equal(snacks.length, shown + 2);
		assert.equal(lastSnack()?.message, '1000 links sent to private storage');
		await lastSnack()?.action?.run();
		assert.equal(app.regular.getLibrary().groups[0]?.tabs.length, 1000);
	});

	test('a bookmark added to the column while the send is queued is not lost', async () => {
		const app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		await withColumns(app);
		const paused = Promise.withResolvers<void>();
		holds.write.set(PENDING_KEY, paused.promise);
		const sending = app.send.sendToPrivate([
			{kind: 'column', columnId: 'work'},
		]);
		while (holds.write.has(PENDING_KEY)) {
			await new Promise((resolve) => {
				setImmediate(resolve);
			});
		}

		await app.regular.editRegular((store) =>
			addBookmark(
				store,
				{url: 'https://late.example/', title: 'Late', columnId: 'work'},
				'late',
				99,
			),
		);
		paused.resolve();
		assert.equal(await sending, false);
		assert.equal(lastSnack()?.message, 'Those links changed. Nothing was sent');
		const store = app.regular.getLibrary();
		assert.equal(
			store.bookmarks.filter((entry) => entry.columnId === 'work').length,
			4,
		);
		assert.equal(pending(), undefined);
	});

	test('an empty column sends nothing and says so', async () => {
		const app = await startApp();
		await app.privateLibrary.setupPrivate(PASSWORD);
		await withColumns(app);
		assert.equal(
			await app.send.sendToPrivate([{kind: 'column', columnId: 'empty'}]),
			false,
		);
		assert.equal(lastSnack()?.message, '“Empty” has no bookmarks to send.');
		assert.equal(pending(), undefined);
	});

	for (const [moment, heldKey] of [
		['the link is being queued', PENDING_KEY],
		['the regular library is being saved', REGULAR_LIBRARY_KEY],
	] as const) {
		test(`an erase that lands while ${moment} leaves the link in the regular library`, async () => {
			const app = await startApp();
			await app.privateLibrary.setupPrivate(PASSWORD);
			const regular = await withRegularLinks(app);
			const paused = Promise.withResolvers<void>();
			holds.write.set(heldKey, paused.promise);
			const sending = app.send.sendToPrivate([
				{kind: 'bookmark', bookmarkId: regular.bookmarks[0].id},
			]);
			while (holds.write.has(heldKey)) {
				await nextTurn();
			}

			const erasing = app.privateLibrary.removePrivate();
			for (let turn = 0; turn < 20; turn += 1) {
				await nextTurn();
			}

			paused.resolve();
			assert.equal(await sending, false);
			await erasing;
			assert.equal(
				lastSnack()?.message,
				'The private library was being erased. Nothing was sent',
			);
			assert.deepEqual(
				app.regular.getLibrary().bookmarks.map((entry) => entry.url),
				[SECRET],
			);
			assert.ok(memory.get(REGULAR_LIBRARY_KEY)?.includes(SECRET));
			assert.equal(pending(), undefined);
			assert.equal(app.privateLibrary.getPrivateState().exists, false);
		});
	}

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
