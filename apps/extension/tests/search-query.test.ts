import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	hasOperators,
	literalQuery,
	parseSearchQuery,
	passesOperators,
	type SearchFacets,
} from '../src/shared/search-query';

const day = (year: number, month: number, date: number) =>
	new Date(year, month - 1, date).getTime();

const bookmark = (
	url: string,
	column: string,
	date = day(2026, 3, 1),
): SearchFacets => ({places: ['bookmarks'], urls: [url], column, date});

test('a query without operators is returned unchanged', () => {
	for (const input of ['react  hooks', ' Tabs ', 'localhost:3000', 'e-mail']) {
		const query = parseSearchQuery(input);
		assert.equal(query.text, input);
		assert.equal(hasOperators(query), false);
	}
});

test('a quoted phrase must appear as written and is not a plain word', () => {
	const query = parseSearchQuery('react "custom hooks" guide');
	assert.deepEqual(query.phrases, ['custom hooks']);
	assert.equal(query.text, 'react guide');
	assert.ok(passesOperators(query, ['Writing custom hooks'], bookmark('', '')));
	assert.ok(!passesOperators(query, ['Hooks, custom'], bookmark('', '')));
});

test('curly quotes and a colon inside a phrase', () => {
	assert.deepEqual(parseSearchQuery('“Note: Read”').phrases, ['note: read']);
});

test('-word and -"phrase" leave results out', () => {
	const query = parseSearchQuery('docs -beta -"old api"');
	assert.deepEqual(query.exclude, ['beta', 'old api']);
	assert.equal(query.text, 'docs');
	assert.ok(passesOperators(query, ['Docs'], bookmark('https://a.dev', '')));
	assert.ok(!passesOperators(query, ['Docs Beta'], bookmark('', '')));
	assert.ok(
		!passesOperators(query, ['Docs'], bookmark('https://old-api.dev', '')),
		'the address counts too, with hyphens folded like spaces',
	);
});

test('site: matches the host and its subdomains', () => {
	const query = parseSearchQuery('Site:https://www.GitHub.com/bberka');
	assert.deepEqual(query.sites, ['github.com']);
	assert.equal(query.text, '');
	const on = (url: string) => passesOperators(query, [], bookmark(url, ''));
	assert.ok(on('https://github.com/x'));
	assert.ok(on('https://gist.github.com/x'));
	assert.ok(!on('https://notgithub.com/'));
	assert.ok(!on('https://example.com/?q=github.com'));
});

test('in: limits the kind of result, and leaves out results without one', () => {
	const query = parseSearchQuery('in:bookmarks in:open');
	assert.deepEqual(query.places, ['bookmarks', 'open']);
	assert.ok(passesOperators(query, [], bookmark('', '')));
	assert.ok(
		!passesOperators(query, [], {places: ['sessions', 'tabs'], urls: []}),
	);
	assert.ok(!passesOperators(query, [], {places: [], urls: []}));
});

test('col: and folder: match part of the name, quoted for spaces', () => {
	const query = parseSearchQuery('col:"read later" tips');
	assert.deepEqual(query.columns, ['read later']);
	assert.equal(query.text, 'tips');
	assert.ok(passesOperators(query, [], bookmark('', 'Read Later 2026')));
	assert.ok(!passesOperators(query, [], bookmark('', 'Work')));
	assert.ok(
		!passesOperators(parseSearchQuery('folder:work'), [], bookmark('', 'Work')),
		'a bookmark is in a column, not a folder',
	);
});

test('after: includes its day and before: leaves its day out', () => {
	const query = parseSearchQuery('after:2026-01-01 before:2026-06-01');
	assert.equal(query.after, day(2026, 1, 1));
	assert.equal(query.before, day(2026, 6, 1));
	const saved = (date: number) =>
		passesOperators(query, [], bookmark('', '', date));
	assert.ok(saved(day(2026, 1, 1)));
	assert.ok(saved(day(2026, 5, 31) + 1000));
	assert.ok(!saved(day(2026, 6, 1)));
	assert.ok(!saved(day(2025, 12, 31)));
	assert.ok(!passesOperators(query, [], {places: ['open'], urls: []}));
});

test('malformed operators fall back to plain words', () => {
	const cases: Array<[string, string]> = [
		['- react', '- react'],
		['"unclosed phrase', 'unclosed phrase'],
		['col:"unclosed name', 'col:unclosed name'],
		['site: github', 'site: github'],
		['col: x', 'col: x'],
		['in:everything', 'in:everything'],
		['after:2026-02-30', 'after:2026-02-30'],
		['before:yesterday', 'before:yesterday'],
		['note:todo', 'note:todo'],
		['""', ''],
	];
	for (const [input, text] of cases) {
		const query = parseSearchQuery(input);
		assert.equal(query.text, text, input);
		assert.equal(hasOperators(query), false, input);
	}
});

test('literalQuery keeps a selection as plain words, quoting it when it would read as operators', () => {
	assert.equal(literalQuery('react  hooks '), 'react hooks');
	assert.equal(literalQuery('localhost:3000 docs'), 'localhost:3000 docs');
	const quoted = literalQuery('pre-release -beta site:example.com');
	assert.equal(quoted, '"pre-release -beta site:example.com"');
	const parsed = parseSearchQuery(quoted);
	assert.deepEqual(parsed.phrases, ['pre release  beta site:example.com']);
	assert.deepEqual(parsed.exclude, []);
	assert.deepEqual(parsed.sites, []);
	assert.equal(literalQuery('say “hi” -now'), '"say hi -now"');
	assert.equal(literalQuery('"a"'), 'a');
	const long = literalQuery(`-x ${'a'.repeat(300)}`);
	assert.equal(long.length, 200);
	assert.ok(long.startsWith('"-x '));
	assert.ok(long.endsWith('"'));
	assert.equal(
		literalQuery(`${'a '.repeat(92)}after:2026-01-011`, 200).includes('"'),
		true,
		'a cut that leaves a valid operator is quoted',
	);
});
