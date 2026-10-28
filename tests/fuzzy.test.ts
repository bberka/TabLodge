import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	highlightSegments,
	matchesAnyTerm,
	matchesQuery,
	rankByQuery,
	scoreQuery,
	searchTerms,
} from '../src/app/fuzzy';
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

test('a word matches at the start of a word, or inside one from three letters', () => {
	assert.equal(matchesQuery('book', ['Bookmarks']), true);
	assert.equal(
		matchesQuery('mark', ['Bookmarks']),
		true,
		'inside a word counts, ranked lower',
	);
	assert.equal(matchesQuery('ok', ['Bookmarks']), false);
	assert.equal(matchesQuery('up', ['Load a backup']), false);
	assert.equal(matchesQuery('click', ['Right-click menus']), true);
	assert.equal(matchesAnyTerm('ok', 'Bookmarks'), false);
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

const rank = (query: string, items: string[]) =>
	rankByQuery(query, items, (item) => [item]);

test('match types rank in a strict order', () => {
	const ordered = [
		'Side', // Whole text
		'Show side', // Whole word
		'Sidebar', // Word prefix
		'Inside', // Inside a word
		'Show it directly everywhere', // Initials
		'Sunrise dock', // Letters in order in one word
		'Hide', // Typo
	];
	assert.deepEqual(rank('side', ordered.toReversed()), [
		'Side',
		'Show side',
		'Sidebar',
		'Inside',
		'Show it directly everywhere',
		'Hide',
	]);
	const scores = [
		scoreQuery('side', ['Side']),
		scoreQuery('side', ['Show side']),
		scoreQuery('side', ['Sidebar']),
		scoreQuery('side', ['Inside']),
		scoreQuery('sde', ['Show dock extra']),
		scoreQuery('sdbr', ['Sidebar']),
		scoreQuery('side', ['Hide']),
	];
	assert.ok(scores.every((score) => score > 0));
	for (let i = 1; i < scores.length; i++) {
		assert.ok(scores[i - 1] > scores[i], `rank ${i}`);
	}
});

test('a typo never outranks a real match, even in a weaker field', () => {
	assert.ok(
		scoreQuery('side', ['Hide', 'x', 'x', 'x', 'x', 'Inside']) >
			scoreQuery('side', ['Hide']),
	);
	assert.deepEqual(rank('side', ['Hide addresses', 'Panel on the side']), [
		'Panel on the side',
		'Hide addresses',
	]);
	assert.equal(matchesQuery('sid', ['Hide']), false, 'short: no typos');
	assert.equal(matchesQuery('hid', ['Side']), false);
	assert.equal(matchesQuery('bokmarkz', ['Bookmarks']), true);
	assert.equal(
		matchesQuery('bokmakz', ['Bookmarks']),
		false,
		'two edits need 7+',
	);
});

test('a label hit beats a help hit beats an option or keyword hit', () => {
	const label = scoreQuery('dock', ['Dock', 'x', 'x']);
	const help = scoreQuery('dock', ['x', 'Dock', 'x']);
	const other = scoreQuery('dock', ['x', 'x', 'Dock']);
	assert.ok(label > help);
	assert.ok(help > other);
	assert.ok(other > 0);
	assert.ok(
		scoreQuery('dock', ['x', 'x', 'Dock']) >
			scoreQuery('dock', ['Docking', 'x']) - 100,
	);
});

test('wide letter gaps rank below tight ones', () => {
	assert.ok(scoreQuery('bkm', ['Bookmark']) < scoreQuery('boo', ['Bookmark']));
	assert.ok(scoreQuery('bmk', ['Bmark']) > scoreQuery('bmk', ['Bookmark']));
});

test('multi-word queries sum word scores and reward order', () => {
	assert.equal(scoreQuery('right zebra', ['Right-click menus']), 0);
	assert.ok(
		scoreQuery('right click', ['Right-click menus']) >
			scoreQuery('click right', ['Right-click menus']),
	);
	assert.ok(
		scoreQuery('right click', ['Right click']) >
			scoreQuery('right click', ['Right and then click']),
	);
});

test('ties go to the shorter label, then the original order', () => {
	assert.deepEqual(rank('tab', ['Tab list', 'Tab', 'Tab one', 'Tab two']), [
		'Tab',
		'Tab one',
		'Tab two',
		'Tab list',
	]);
	assert.deepEqual(rank('tab', ['Tab aa', 'Tab bb', 'Tab cc']), [
		'Tab aa',
		'Tab bb',
		'Tab cc',
	]);
});

test('highlighting marks only the best kind of match', () => {
	assert.deepEqual(highlightSegments('Inside sidebar', 'side'), [
		{text: 'Inside ', match: false},
		{text: 'side', match: true},
		{text: 'bar', match: false},
	]);
});
