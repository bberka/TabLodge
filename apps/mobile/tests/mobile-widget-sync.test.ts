/*
The widget snapshot writer, run against the app's real regular and private libraries with the native widget module
replaced by a recorder. What these tests cannot show: that the Kotlin widget draws what it is given.
*/
import assert from 'node:assert/strict';
import {beforeEach, describe, test, vi} from 'vite-plus/test';
import {addBookmark, addColumn} from '../src/library/board-edits';
import {addSession} from '../src/library/session-edits';
import type {WidgetSnapshot} from '../src/library/widget-snapshot';

const written = vi.hoisted(() => [] as Array<string | null>);
vi.mock('../modules/bookmarks-widget', () => ({
	writeWidgetSnapshot(json: string | null) {
		written.push(json);
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

let counter = 0;
const newId = () => {
	counter += 1;
	return `id-${counter}`;
};

/**
Starts the app's libraries the way app.tsx does: the regular library loads, then the writer starts, then the private
library.
*/
async function startApp() {
	vi.resetModules();
	const regular = await import('../src/library/library-store');
	const privateLibrary = await import('../src/private/private-library');
	const {startWidgetSnapshot} = await import('../src/library/widget-sync');
	await regular.startLibrary();
	const stop = startWidgetSnapshot();
	await privateLibrary.startPrivate();
	return {regular, privateLibrary, stop};
}

/**
The last snapshot handed to the widget, parsed, or undefined when the last write deleted it.
*/
const last = (): WidgetSnapshot | undefined => {
	const json = written.at(-1);
	return json ? (JSON.parse(json) as WidgetSnapshot) : undefined;
};

beforeEach(() => {
	memory.clear();
	written.length = 0;
	setPreferences({openWith: 'system', openApp: ''});
	vi.stubGlobal('__DEV__', false);
});

describe('the widget snapshot writer', () => {
	test('never writes the private library, open or not', async () => {
		const {regular, privateLibrary, stop} = await startApp();
		await regular.editRegular((store) =>
			addBookmark(
				addColumn(store, 'Reading', 'reading', 1),
				{
					url: 'https://regular.example/',
					title: 'Regular',
					columnId: 'reading',
				},
				newId(),
				2,
			),
		);
		await privateLibrary.setupPrivate();
		await privateLibrary.editPrivate((store) =>
			addBookmark(
				addColumn(store, 'Secret column', 'secret', 1),
				{url: 'https://secret.example/', title: 'Secret', columnId: 'secret'},
				newId(),
				2,
			),
		);
		const {setView} = await import('../src/library/view');
		setView('private');
		await regular.editRegular((store) =>
			addBookmark(
				store,
				{url: 'https://second.example/', title: 'Second', columnId: 'reading'},
				newId(),
				3,
			),
		);
		stop();

		assert.ok(written.length > 0);
		for (const json of written) {
			assert.ok(!json?.includes('secret'), `private data was written: ${json}`);
			assert.ok(!json?.includes('Secret'), `private data was written: ${json}`);
		}

		assert.deepEqual(
			last()?.columns[0]?.links.map((link) => link.url),
			['https://regular.example/', 'https://second.example/'],
		);
	});

	test('writes the saved library at startup instead of deleting the copy', async () => {
		const first = await startApp();
		await first.regular.editRegular((store) =>
			addBookmark(
				store,
				{url: 'https://kept.example/', title: 'Kept', columnId: ''},
				newId(),
				2,
			),
		);
		first.stop();
		written.length = 0;

		const second = await startApp();
		second.stop();
		assert.equal(written[0]?.includes('https://kept.example/'), true);
		assert.ok(!written.includes(null), 'the copy was deleted while loading');
	});

	test('deletes the copy when the bookmarks are erased', async () => {
		const {regular, stop} = await startApp();
		await regular.editRegular((store) =>
			addBookmark(
				store,
				{url: 'https://a.example/', title: 'A', columnId: ''},
				newId(),
				2,
			),
		);
		await regular.editRegular((store) => ({
			...store,
			bookmarks: [],
			updatedAt: 3,
		}));
		stop();
		assert.equal(written.at(-1), null);
	});

	test('rewrites when the Open links choice changes, not when only sessions change', async () => {
		const {regular, stop} = await startApp();
		await regular.editRegular((store) =>
			addBookmark(
				store,
				{url: 'https://a.example/', title: 'A', columnId: ''},
				newId(),
				2,
			),
		);
		const before = written.length;
		await regular.editRegular((store) =>
			addSession(
				store,
				{name: 'Trip', urls: ['https://b.example/']},
				newId(),
				[newId()],
				4,
			),
		);
		assert.equal(written.length, before, 'a session edit redrew the widgets');

		setPreferences({openWith: 'app', openApp: 'org.mozilla.firefox'});
		stop();
		assert.equal(written.length, before + 1);
		assert.deepEqual(last()?.open, {how: 'app', app: 'org.mozilla.firefox'});
	});
});
