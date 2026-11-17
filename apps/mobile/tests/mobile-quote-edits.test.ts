import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {emptyStore} from '../src/library/store-shape';
import {addBookmark, addColumn} from '../src/library/board-edits';
import {saveQuote, undoQuote} from '../src/library/quote-edits';
import {NOTES_MAX} from '../../extension/src/shared/library-normalize';
import type {Store} from '../../extension/src/shared/types';

const NOW = 1_700_000_000_000;
const page = 'https://example.com/post';
const board = () => addColumn(emptyStore(NOW), 'Read', 'c1', NOW);
const input = (quote: string, url = page) => ({
	url,
	quote,
	title: 'Post',
	columnId: 'c1',
});

describe('saveQuote', () => {
	test('a new page becomes a bookmark whose note holds the quote and its link', () => {
		const result = saveQuote(board(), input('Hello there'), 'b1', NOW);
		assert.ok(result.ok);
		assert.equal(result.placed, 'Read');
		const [bookmark] = result.store.bookmarks;
		assert.equal(bookmark?.url, page);
		assert.equal(
			bookmark?.notes,
			`> Hello there\n${page}#:~:text=Hello%20there`,
		);
		assert.deepEqual(result.undo, {kind: 'created', bookmarkId: 'b1'});
	});

	test('a second quote is appended to the same bookmark', () => {
		const first = saveQuote(board(), input('One'), 'b1', NOW);
		assert.ok(first.ok);
		const second = saveQuote(
			first.store,
			input('Two', `${page}#:~:text=One`),
			'b2',
			NOW,
		);
		assert.ok(second.ok);
		assert.equal(second.store.bookmarks.length, 1);
		assert.equal(
			second.store.bookmarks[0]?.notes,
			`> One\n${page}#:~:text=One\n\n> Two\n${page}#:~:text=Two`,
		);

		const undone = undoQuote(second.store, second.undo, NOW);
		assert.equal(undone.bookmarks[0]?.notes, `> One\n${page}#:~:text=One`);
	});

	test('a saved tab of the page takes the quote, in every copy', () => {
		const tab = {id: 't1', url: page, title: 'Post', notes: ''};
		const store = {
			...board(),
			groups: [
				{id: 's1', name: 'Trip', tabs: [tab]},
				{id: 's2', name: 'Other', tabs: [{...tab, id: 't2'}]},
			],
		} as unknown as Store;
		const result = saveQuote(store, input('Hi'), 'b1', NOW);
		assert.ok(result.ok);
		assert.equal(result.placed, 'Trip');
		assert.equal(result.store.bookmarks.length, 0);
		for (const group of result.store.groups) {
			assert.equal(group.tabs[0]?.notes, `> Hi\n${page}#:~:text=Hi`);
		}

		const undone = undoQuote(result.store, result.undo, NOW);
		assert.ok(undone.groups.every((group) => group.tabs[0]?.notes === ''));
	});

	test('a full note refuses the quote and stays as it was', () => {
		const store = addBookmark(
			board(),
			{
				url: page,
				title: 'Post',
				columnId: 'c1',
				notes: 'x'.repeat(NOTES_MAX - 5),
			},
			'b1',
			NOW,
		);
		const result = saveQuote(store, input('More'), 'b2', NOW);
		assert.equal(result.ok, false);
		assert.match(result.ok ? '' : result.error, /full/);
	});

	test('undo leaves a note that was edited after the quote', () => {
		const first = saveQuote(board(), input('One'), 'b1', NOW);
		assert.ok(first.ok);
		const second = saveQuote(first.store, input('Two'), 'b2', NOW);
		assert.ok(second.ok);
		const edited = {
			...second.store,
			bookmarks: second.store.bookmarks.map((bookmark) => ({
				...bookmark,
				notes: 'Rewritten',
			})),
		};
		assert.equal(
			undoQuote(edited, second.undo, NOW).bookmarks[0]?.notes,
			'Rewritten',
		);
	});

	test('a missing link is refused', () => {
		assert.equal(
			saveQuote(board(), input('Hi', 'not a link'), 'b1', NOW).ok,
			false,
		);
	});
});
