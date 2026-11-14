import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {pruneSelection, toggleSelection} from '../src/app/bookmark-selection';

const order = ['a', 'b', 'c', 'd'];

describe('toggleSelection', () => {
	test('a plain click adds a bookmark, and another click removes it', () => {
		const one = toggleSelection(new Set(), order, null, 'b', false);
		assert.deepEqual([...one], ['b']);
		assert.deepEqual([...toggleSelection(one, order, 'b', 'b', false)], []);
	});

	test('a range click adds everything between the anchor and the click, either way round', () => {
		assert.deepEqual(
			[...toggleSelection(new Set(), order, 'b', 'd', true)],
			['b', 'c', 'd'],
		);
		assert.deepEqual(
			[...toggleSelection(new Set(['a']), order, 'c', 'b', true)],
			['a', 'b', 'c'],
		);
	});

	test('a range click with no anchor on screen selects just that bookmark', () => {
		assert.deepEqual(
			[...toggleSelection(new Set(), order, 'gone', 'c', true)],
			['c'],
		);
		assert.deepEqual(
			[...toggleSelection(new Set(), order, null, 'c', true)],
			['c'],
		);
	});

	test('does not change the set it was given', () => {
		const old = new Set(['a']);
		toggleSelection(old, order, null, 'b', false);
		assert.deepEqual([...old], ['a']);
	});
});

describe('pruneSelection', () => {
	test('drops bookmarks that no longer exist', () => {
		assert.deepEqual(
			[...pruneSelection(new Set(['a', 'x']), [{id: 'a'}, {id: 'b'}])],
			['a'],
		);
	});

	test('returns the same set when nothing was dropped', () => {
		const selected = new Set(['a']);
		assert.equal(pruneSelection(selected, [{id: 'a'}]), selected);
	});
});
