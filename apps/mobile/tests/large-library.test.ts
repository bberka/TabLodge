import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {createApi} from '../../server/src/api';
import {buildExport} from '../../extension/src/shared/export-formats';
import {buildFinderIndex} from '../../extension/src/shared/global-search';
import {ChangeLog} from '../../extension/src/shared/sync/change-log';
import {createSyncClient} from '../../extension/src/shared/sync/client';
import type {Bookmark, Store} from '../../extension/src/shared/types';
import {buildScenario} from '../scripts/perf/scenarios';
import {
	allBookmarks,
	searchBookmarks,
	updateBookmark,
} from '../src/library/board-edits';
import {
	searchSessions,
	sessionFolders,
	sessionsIn,
} from '../src/library/session-edits';
import {
	nextTabWindow,
	TAB_WINDOW,
	visibleTabCount,
} from '../src/library/tab-window';
import {buildWidgetSnapshot} from '../src/library/widget-snapshot';

function counting<T extends object>(
	items: readonly T[],
	watched: string,
): {items: T[]; reads: () => number; reset: () => void} {
	let reads = 0;
	return {
		items: items.map(
			(item) =>
				new Proxy(item, {
					get(target, key, receiver) {
						if (key === watched) {
							reads += 1;
						}

						return Reflect.get(target, key, receiver) as unknown;
					},
				}),
		),
		reads: () => reads,
		reset() {
			reads = 0;
		},
	};
}

describe('lists at many columns', () => {
	const store = buildScenario('columns-120x120');
	const total = store.bookmarks.length;
	assert.equal(total, 14_400);

	test('the All column reads each bookmark a few times, not once per column', () => {
		const watched = counting(store.bookmarks, 'columnId');
		const all = allBookmarks({...store, bookmarks: watched.items});
		assert.equal(all.length, total);
		assert.ok(watched.reads() <= 4 * total, `${watched.reads()} reads`);
	});

	test('the widget snapshot reads each bookmark a few times, not once per column', () => {
		const watched = counting(store.bookmarks, 'columnId');
		const snapshot = buildWidgetSnapshot(
			{...store, bookmarks: watched.items},
			{how: 'default' as never, app: ''},
		);
		assert.equal(snapshot?.columns.length, 51);
		assert.ok(watched.reads() <= 8 * total, `${watched.reads()} reads`);
	});

	test('the All column keeps the columns order and each column its own order', () => {
		const all = allBookmarks(store);
		assert.deepEqual(
			all.map((bookmark) => bookmark.id),
			store.bookmarks.map((bookmark) => bookmark.id),
		);
	});
});

describe('session folders', () => {
	const store = buildScenario('folders-100');

	test('the folder counts read each session once for all 100 folders', () => {
		const watched = counting(store.groups, 'folderId');
		const views = sessionFolders({...store, groups: watched.items});
		assert.equal(views.length, 101);
		assert.equal(
			views.slice(1).reduce((sum, view) => sum + view.count, 0),
			store.groups.length,
		);
		assert.ok(
			watched.reads() <= 5 * store.groups.length,
			`${watched.reads()} reads`,
		);
	});

	test('a folder lists its own sessions', () => {
		const first = sessionsIn(store, 'perf-folder-0', 'newest');
		assert.ok(first.length > 0);
		assert.ok(first.every((session) => session.folderId === 'perf-folder-0'));
	});
});

describe('search on every key', () => {
	test('typing a second letter does not lowercase the 10,000 bookmarks again', () => {
		const store = buildScenario('bookmarks-10000');
		const watched = counting(store.bookmarks, 'title');
		const library: Store = {...store, bookmarks: watched.items};
		const first = searchBookmarks(library, 'g');
		assert.ok(first.length > 0);
		assert.equal(watched.reads(), 10_000);
		watched.reset();
		const second = searchBookmarks(library, 'gu');
		assert.equal(watched.reads(), 0);
		assert.deepEqual(
			second.map((bookmark: Bookmark) => bookmark.id),
			store.bookmarks
				.filter((bookmark) =>
					[
						bookmark.title,
						bookmark.url,
						bookmark.notes ?? '',
						...(bookmark.tags ?? []),
					]
						.join(' ')
						.toLowerCase()
						.includes('gu'),
				)
				.map((bookmark) => bookmark.id),
		);
	});

	test('a search through one session of 10,000 links lowercases it once', () => {
		const store = buildScenario('links-10000');
		const watched = counting(store.groups, 'tabs');
		searchSessions(watched.items, 'link 1', store.folders);
		const afterFirst = watched.reads();
		searchSessions(watched.items, 'link 12', store.folders);
		assert.equal(watched.reads(), afterFirst);
	});

	test('an edit to one bookmark searches the same as before', () => {
		const store = buildScenario('bookmarks-1000');
		searchBookmarks(store, 'guide');
		const first = store.bookmarks[0];
		const edited = updateBookmark(
			store,
			first.id,
			{title: 'zebra crossing', url: first.url, columnId: first.columnId},
			1,
		);
		assert.deepEqual(
			searchBookmarks(edited, 'zebra').map((bookmark) => bookmark.id),
			[first.id],
		);
		assert.equal(
			searchBookmarks(edited, 'zebra crossing').length,
			1,
			'the edited bookmark is found by its new title',
		);
	});
});

describe('one edit in a large library', () => {
	const SYNC_STATE_KEY = 'tablodge.sync.state';
	const TOKEN = 'mobile-test-token-0123456789-abcdefghijk';

	async function device(scenario: Parameters<typeof buildScenario>[0]) {
		const log = new ChangeLog();
		const app = createApi({token: TOKEN, log: () => log});
		const state = {
			store: buildScenario(scenario),
			reads: 0,
			stateWrites: 0,
			posted: 0,
		};
		const storage = new Map<string, unknown>();
		const client = createSyncClient({
			get: async (key) => structuredClone(storage.get(key)),
			async set(key, value) {
				if (key === SYNC_STATE_KEY) {
					state.stateWrites += 1;
				}

				storage.set(key, structuredClone(value));
			},
			async remove() {},
			async fetch(url, init) {
				if (init?.method === 'POST') {
					state.posted += (
						JSON.parse(String(init.body)) as {changes: unknown[]}
					).changes.length;
				}

				return app.request(url, init);
			},
			async mutate(work) {
				return work();
			},
			async readLibrary() {
				state.reads += 1;
				return state.store;
			},
			async writeLibrary(next) {
				state.store = next;
			},
			async backup() {},
			randomId: () => crypto.randomUUID(),
			now: Date.now,
		});
		await client.connect('https://sync.example.test', TOKEN);
		await client.syncNow();
		const reset = () => {
			state.reads = 0;
			state.stateWrites = 0;
			state.posted = 0;
		};

		return {state, client, reset};
	}

	test('sends one record, reads the library a few times, and saves the sync state a few times', async () => {
		const {state, client, reset} = await device('bookmarks-1000');
		reset();
		const first = state.store.bookmarks[0];
		state.store = updateBookmark(
			state.store,
			first.id,
			{title: 'Edited', url: first.url, columnId: first.columnId},
			Date.now(),
		);
		await client.syncNow();
		assert.equal(state.posted, 1);
		assert.ok(state.reads <= 5, `${state.reads} library reads`);
		assert.ok(state.stateWrites <= 3, `${state.stateWrites} state writes`);
	}, 60_000);

	test('a round with nothing to send saves no sync state', async () => {
		const {state, client, reset} = await device('bookmarks-1000');
		await client.syncNow();
		reset();
		await client.syncNow();
		assert.equal(state.posted, 0);
		assert.equal(state.stateWrites, 0);
		assert.ok(state.reads <= 3, `${state.reads} library reads`);
	}, 60_000);
});

describe('a session with 10,000 links', () => {
	test('an expanded card draws a window of links and the button adds the next window', () => {
		const total = buildScenario('links-10000').groups[0].tabs.length;
		assert.equal(total, 10_000);
		assert.equal(visibleTabCount(TAB_WINDOW, total), TAB_WINDOW);
		assert.equal(visibleTabCount(nextTabWindow(TAB_WINDOW), total), 200);
		let drawn = TAB_WINDOW;
		let presses = 0;
		while (drawn < total) {
			drawn = visibleTabCount(nextTabWindow(drawn), total);
			presses += 1;
		}

		assert.equal(drawn, total);
		assert.equal(presses, 99);
	});

	test('a short session is drawn whole', () => {
		assert.equal(visibleTabCount(TAB_WINDOW, 8), 8);
	});
});

describe('lists with more than 100,000 entries', () => {
	const [session] = buildScenario('links-10000').groups;
	const tabs = Array.from({length: 150_000}, (_, index) => ({
		...session.tabs[index % session.tabs.length],
		id: `big-${index}`,
	}));

	test('the search index of the other places holds 150,000 saved links', () => {
		const index = buildFinderIndex({
			groups: [{...session, tabs}],
			folders: [],
			bookmarks: [],
			columns: [],
			tabs: [],
			commands: [],
		});
		assert.equal(
			index.filter((item) => item.kind === 'saved-tab').length,
			150_000,
		);
	});

	test('a column of 150,000 bookmarks exports as a bookmark file', () => {
		const [column] = buildScenario('bookmarks-100').bookmarkColumns;
		const bookmarks = tabs.map((tab, index) => ({
			id: tab.id,
			title: tab.title,
			url: `${tab.url}/${index}`,
			columnId: column.id,
			createdAt: 1,
			updatedAt: 1,
		}));
		const file = buildExport(
			{kind: 'bookmarks', columns: [column], bookmarks},
			'html',
			{appName: 'TabLodge'},
		);
		assert.equal(file.content.split('<DT><A ').length - 1, 150_000);
	});
});
