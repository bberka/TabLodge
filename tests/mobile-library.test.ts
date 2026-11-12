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
	moveBookmark,
	removeBookmark,
	searchBookmarks,
	UNFILED_ID,
} from '../mobile/src/library';

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

	test('moves, finds, and removes a bookmark', () => {
		let store = addColumn(
			addColumn(emptyStore(NOW), 'One', 'c1', NOW),
			'Two',
			'c2',
			NOW,
		);
		store = addBookmark(
			store,
			{url: 'https://a.test/page', title: 'Alpha', columnId: 'c1'},
			'a',
			NOW,
		);
		store = moveBookmark(store, 'a', 'c2', NOW + 1);
		assert.deepEqual(ids(store, 'c2'), ['a']);
		assert.equal(searchBookmarks(store, 'alpha page').length, 1);
		assert.equal(searchBookmarks(store, 'missing').length, 0);
		assert.equal(removeBookmark(store, 'a', NOW + 2).bookmarks.length, 0);
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
