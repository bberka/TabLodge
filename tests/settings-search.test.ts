import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	highlightSegments,
	matchesAnyTerm,
	matchesQuery,
	rankByQuery,
	scoreQuery,
	searchTerms,
} from '../src/app/settings-search';
import {withSearchParam} from '../src/app/page-params';

test('a blank query matches everything and every word must match', () => {
	assert.equal(matchesQuery('', ['Anything']), true);
	assert.equal(matchesQuery(' '.repeat(3), []), true);
	assert.equal(
		matchesQuery('pinned tabs', [
			'Include pinned tabs',
			'Pinned tabs are ignored',
		]),
		true,
	);
	assert.equal(
		matchesQuery('pinned bookmarks', ['Include pinned tabs']),
		false,
	);
	assert.equal(
		matchesQuery('TABS pinned', ['Include pinned tabs']),
		true,
		'order and case do not matter',
	);
});

test('words match only at the start of a word', () => {
	assert.equal(matchesQuery('book', ['Bookmarks']), true);
	assert.equal(matchesQuery('mark', ['Bookmarks']), false);
	assert.equal(matchesQuery('up', ['Load a backup']), false);
	assert.equal(matchesQuery('click', ['Right-click menus']), true);
	assert.equal(matchesAnyTerm('mark', 'Bookmarks'), false);
});

test('words may match across different texts, and missing texts are ignored', () => {
	assert.equal(
		matchesQuery('erase sessions', [
			'Erase all',
			undefined,
			null,
			'Deletes 3 sessions',
		]),
		true,
	);
	assert.equal(matchesQuery('zebra', [undefined, '']), false);
});

test('hyphens, spaces and curly quotes are interchangeable', () => {
	assert.equal(matchesQuery('right click', ['Right-click menus']), true);
	assert.equal(matchesQuery("browser's", ['the browser’s new tab']), true);
	assert.deepEqual(searchTerms('  Back-up   Sessions '), [
		'back',
		'up',
		'sessions',
	]);
});

test('matchesAnyTerm needs only one word', () => {
	assert.equal(matchesAnyTerm('newest zebra', 'Newest first'), true);
	assert.equal(matchesAnyTerm('zebra', 'Newest first'), false);
});

test('highlightSegments marks every word and merges overlaps', () => {
	assert.deepEqual(highlightSegments('Back up bookmarks', 'bookmark'), [
		{text: 'Back up ', match: false},
		{text: 'bookmark', match: true},
		{text: 's', match: false},
	]);
	assert.deepEqual(highlightSegments('Include pinned tabs', 'pin tab'), [
		{text: 'Include ', match: false},
		{text: 'pin', match: true},
		{text: 'ned ', match: false},
		{text: 'tab', match: true},
		{text: 's', match: false},
	]);
	assert.deepEqual(highlightSegments('abcd abx', 'ab abc'), [
		{text: 'abc', match: true},
		{text: 'd ', match: false},
		{text: 'ab', match: true},
		{text: 'x', match: false},
	]);
	assert.deepEqual(highlightSegments('Nothing here', 'zzz'), [
		{text: 'Nothing here', match: false},
	]);
	assert.deepEqual(highlightSegments('Right-click', 'right click'), [
		{text: 'Right', match: true},
		{text: '-', match: false},
		{text: 'click', match: true},
	]);
});

test('withSearchParam sets or removes one parameter and keeps the rest', () => {
	const at = (search: string) => ({
		pathname: '/options.html',
		search,
		hash: '#data',
	});
	assert.equal(
		withSearchParam(at(''), 'q', 'back up'),
		'/options.html?q=back+up#data',
	);
	assert.equal(
		withSearchParam(at('?x=1&q=old'), 'q', 'new'),
		'/options.html?x=1&q=new#data',
	);
	assert.equal(
		withSearchParam(at('?x=1&q=old'), 'q', null),
		'/options.html?x=1#data',
	);
	assert.equal(withSearchParam(at('?q=old'), 'q', null), '/options.html#data');
});

test('typos, missing letters and abbreviations still match', () => {
	assert.equal(matchesQuery('bokmarks', ['Show bookmarks']), true);
	assert.equal(matchesQuery('sesions', ['Keep sessions expanded']), true);
	assert.equal(matchesQuery('bkmrk', ['Bookmark board']), true);
	assert.equal(matchesQuery('sbd', ['Show bookmark dock']), true);
	assert.equal(matchesQuery('zebra', ['Show bookmarks']), false);
	assert.equal(
		matchesQuery('bz', ['Bookmarks']),
		false,
		'short words stay strict',
	);
});

test('results rank exact words above prefixes above fuzzy matches', () => {
	const exact = scoreQuery('tab', ['Pinned tab']);
	const prefix = scoreQuery('tab', ['Pinned tabs']);
	const fuzzy = scoreQuery('tbs', ['Pinned tabs']);
	assert.ok(exact > prefix, 'exact word beats word prefix');
	assert.ok(prefix > fuzzy, 'prefix beats fuzzy subsequence');
	assert.ok(fuzzy > 0);
	assert.ok(
		scoreQuery('tab', ['Tab', 'x']) > scoreQuery('tab', ['x', 'Tab']),
		'a label hit beats a help hit',
	);
	assert.deepEqual(
		rankByQuery(
			'tabs',
			['Open restored tabs', 'Close tabs', 'Bookmarks'],
			(item) => [item],
		),
		['Open restored tabs', 'Close tabs'],
	);
	assert.deepEqual(
		rankByQuery('book', ['Bookmark', 'Book'], (item) => [item]),
		['Book', 'Bookmark'],
	);
});

test('fuzzy matches highlight only the matched characters', () => {
	assert.deepEqual(highlightSegments('Bookmark', 'bkmrk'), [
		{text: 'B', match: true},
		{text: 'oo', match: false},
		{text: 'km', match: true},
		{text: 'a', match: false},
		{text: 'rk', match: true},
	]);
	assert.deepEqual(highlightSegments('Show bookmark dock', 'sbd'), [
		{text: 'S', match: true},
		{text: 'how ', match: false},
		{text: 'b', match: true},
		{text: 'ookmark ', match: false},
		{text: 'd', match: true},
		{text: 'ock', match: false},
	]);
});
