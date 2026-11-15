import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {elsewhereIntro, resultCount} from '../src/library/search-count';

describe('search count', () => {
	test('says none, one, and many', () => {
		assert.equal(resultCount(0), 'No results');
		assert.equal(resultCount(1), '1 result');
		assert.equal(resultCount(12), '12 results');
	});

	test('says what was found elsewhere when this screen has nothing', () => {
		assert.equal(
			elsewhereIntro('Sessions', 0, 3),
			'Nothing in Sessions matches. 3 results found elsewhere:',
		);
		assert.equal(
			elsewhereIntro('Sessions', 0, 1),
			'Nothing in Sessions matches. 1 result found elsewhere:',
		);
	});

	test('says "more" when this screen has results of its own', () => {
		assert.equal(
			elsewhereIntro('Bookmarks', 2, 1),
			'1 more result found elsewhere:',
		);
		assert.equal(
			elsewhereIntro('Bookmarks', 2, 4),
			'4 more results found elsewhere:',
		);
	});

	test('says so when nothing is found elsewhere either', () => {
		assert.equal(elsewhereIntro('Bookmarks', 2, 0), 'Nothing found elsewhere.');
		assert.equal(
			elsewhereIntro('Bookmarks', 0, 0),
			'Nothing in Bookmarks matches, and nothing else does either.',
		);
	});
});
