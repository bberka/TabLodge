import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {fold, scoreFolded} from '../src/shared/fuzzy';
import {buildFinderIndex, searchFinder} from '../src/shared/global-search';

const folded = (...texts: string[]) => texts.map((text) => fold(text));

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
