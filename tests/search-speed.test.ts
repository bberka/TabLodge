import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {fold, scoreFolded, scoreQuery, searchTerms} from '../src/app/fuzzy';
import {buildFinderIndex, searchFinder} from '../src/app/global-search';

const folded = (...texts: string[]) => texts.map((text) => fold(text));

test('scoreFolded matches scoreQuery for real matches, with or without typo matching', () => {
	const texts = ['Bookmarks', 'Show bookmark dock', 'extras'];
	for (const query of ['book', 'bookmarks', 'dock show']) {
		const expected = scoreQuery(query, texts);
		assert.ok(expected > 0);
		assert.equal(scoreFolded(searchTerms(query), folded(...texts)), expected);
		assert.equal(
			scoreFolded(searchTerms(query), folded(...texts), false),
			expected,
		);
	}
});

test('typo-only matches need typo matching', () => {
	const texts = folded('Bookmarks');
	assert.equal(scoreFolded(['bookmraks'], texts, false), 0);
	assert.ok(scoreFolded(['bookmraks'], texts, true) > 0);
});

const bookmarks = Array.from({length: 40}, (_, index) => ({
	id: `b${index}`,
	title: index === 7 ? 'Weather forecast' : `Reading list ${index}`,
	url: `https://example.com/${index}`,
	columnId: 'c1',
	createdAt: index,
	updatedAt: index,
}));
const sources = {
	groups: [],
	folders: [],
	bookmarks,
	columns: [],
	tabs: [],
	commands: [],
};

test('the finder index reuses bookmark items while the bookmarks are unchanged', () => {
	const first = buildFinderIndex(sources);
	const second = buildFinderIndex(sources);
	assert.equal(
		second.find((item) => item.id === 'bookmark:b1'),
		first.find((item) => item.id === 'bookmark:b1'),
	);
});

test('the finder still finds typos when nothing matches exactly', () => {
	const sections = searchFinder('wheater', buildFinderIndex(sources));
	assert.equal(
		sections.find((section) => section.kind === 'bookmark')?.items[0].ref,
		'b7',
	);
});

test('a group lists only its best matches', () => {
	const section = searchFinder('reading', buildFinderIndex(sources)).find(
		(entry) => entry.kind === 'bookmark',
	);
	assert.equal(section?.items.length, 8);
});
