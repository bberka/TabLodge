import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	addBookmark,
	addColumn,
	bookmarksIn,
	columnViews,
	DEFAULT_COLUMN_ID,
	emptyStore,
	extractUrl,
	moveBookmarks,
	removeBookmarks,
	restoreBookmarks,
	splitShared,
	searchBookmarks,
	UNFILED_ID,
} from '../mobile/src/library';
import {sampleStore} from '../mobile/src/seed';

const NOW = 1000;
const ids = (store: ReturnType<typeof emptyStore>, columnId: string) =>
	bookmarksIn(store, columnId).map((bookmark) => bookmark.id);

describe('extractUrl', () => {
	test('finds the link in shared text and drops trailing punctuation', () => {
		assert.equal(
			extractUrl('Look at this (https://example.com/a?b=1).'),
			'https://example.com/a?b=1',
		);
	});

	test('refuses text without a web link', () => {
		assert.equal(extractUrl('javascript:alert(1)'), undefined);
		assert.equal(extractUrl('no link here'), undefined);
	});
});

describe('bookmarks', () => {
	test('creates the default column for the first saved link', () => {
		const store = addBookmark(
			emptyStore(NOW),
			{url: 'https://example.com', title: '', columnId: ''},
			'b1',
			NOW,
		);
		assert.equal(store.bookmarkColumns.length, 1);
		assert.equal(store.bookmarkColumns[0].id, DEFAULT_COLUMN_ID);
		assert.equal(store.bookmarkColumns[0].isDefault, true);
		assert.equal(store.bookmarks[0].title, 'example.com');
		assert.equal(store.bookmarks[0].columnId, DEFAULT_COLUMN_ID);
	});

	test('puts a new bookmark first in the chosen column', () => {
		let store = addColumn(emptyStore(NOW), 'Read', 'c1', NOW);
		store = addBookmark(
			store,
			{url: 'https://a.test', title: 'A', columnId: 'c1'},
			'a',
			NOW,
		);
		store = addBookmark(
			store,
			{url: 'https://b.test', title: 'B', columnId: 'c1'},
			'b',
			NOW,
		);
		assert.deepEqual(ids(store, 'c1'), ['b', 'a']);
	});

	test('ignores a link that is not a web address', () => {
		const store = emptyStore(NOW);
		assert.equal(
			addBookmark(
				store,
				{url: 'ftp://x.test', title: '', columnId: ''},
				'x',
				NOW,
			),
			store,
		);
	});

	test('finds a bookmark by words in its title or address', () => {
		let store = addColumn(emptyStore(NOW), 'One', 'c1', NOW);
		store = addBookmark(
			store,
			{url: 'https://a.test/page', title: 'Alpha', columnId: 'c1'},
			'a',
			NOW,
		);
		assert.equal(searchBookmarks(store, 'alpha page').length, 1);
		assert.equal(searchBookmarks(store, 'missing').length, 0);
	});

	test('shows bookmarks of a missing column under Unfiled', () => {
		const store = {
			...emptyStore(NOW),
			bookmarks: [
				{
					id: 'a',
					title: 'A',
					url: 'https://a.test',
					columnId: 'gone',
					createdAt: NOW,
					updatedAt: NOW,
				},
			],
		};
		assert.deepEqual(columnViews(store), [{id: UNFILED_ID, name: 'Unfiled'}]);
		assert.deepEqual(ids(store, UNFILED_ID), ['a']);
	});
});

describe('sample data', () => {
	test('matches the extension dev fixture and groups bookmarks into real columns', () => {
		const store = sampleStore(NOW);
		assert.equal(store.groups.length, 6);
		assert.equal(store.bookmarks.length, 16);
		assert.equal(
			columnViews(store).some((view) => view.id === UNFILED_ID),
			false,
		);
		const sessionIds = store.groups.map((session) => session.id);
		assert.equal(new Set(sessionIds).size, sessionIds.length);
	});
});

describe('several bookmarks', () => {
	const build = () => {
		let store = addColumn(
			addColumn(emptyStore(NOW), 'One', 'c1', NOW),
			'Two',
			'c2',
			NOW,
		);
		for (const id of ['a', 'b', 'c']) {
			store = addBookmark(
				store,
				{url: `https://${id}.test`, title: id, columnId: 'c1'},
				id,
				NOW,
			);
		}

		return store;
	};

	test('removes and moves a selection, keeping the rest', () => {
		const store = build();
		assert.deepEqual(
			ids(removeBookmarks(store, new Set(['a', 'c']), NOW), 'c1'),
			['b'],
		);
		const moved = moveBookmarks(store, new Set(['a', 'b']), 'c2', NOW + 1);
		assert.deepEqual(ids(moved, 'c2'), ['b', 'a']);
		assert.deepEqual(ids(moved, 'c1'), ['c']);
		assert.equal(moveBookmarks(store, new Set(['a']), 'missing', NOW), store);
	});

	test('restores removed bookmarks under new ids', () => {
		const store = build();
		const gone = store.bookmarks.filter((bookmark) => bookmark.id === 'b');
		const without = removeBookmarks(store, new Set(['b']), NOW);
		const back = restoreBookmarks(without, gone, ['b2'], NOW + 1);
		assert.deepEqual(ids(back, 'c1'), ['b2', 'c', 'a']);
		assert.equal(back.bookmarks[0].title, 'b');
	});
});

describe('splitShared', () => {
	test('uses the words around a shared link as the title', () => {
		assert.deepEqual(splitShared('Great read https://example.com/post'), {
			url: 'https://example.com/post',
			title: 'Great read',
		});
		assert.deepEqual(splitShared('https://example.com'), {
			url: 'https://example.com/',
			title: '',
		});
		assert.deepEqual(splitShared('just words'), {title: ''});
	});
});
