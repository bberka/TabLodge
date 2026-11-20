import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	bookmarkFacets,
	hasOperators,
	literalQuery,
	parseSearchQuery,
	passesOperators,
	type SearchFacets,
	toggleTagFilter,
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

test('from: matches a phone, a computer, or part of the device name, and leaves out results without one', () => {
	const saved = (name?: string, kind?: 'desktop' | 'mobile'): SearchFacets => ({
		...bookmark('', ''),
		device: {name, kind},
	});
	const on = (input: string, facets: SearchFacets) =>
		passesOperators(parseSearchQuery(input), [], facets);
	const pixel = saved('Pixel 9', 'mobile');
	const laptop = saved('Work laptop', 'desktop');
	assert.ok(on('from:phone', pixel));
	assert.ok(!on('from:phone', laptop));
	assert.ok(on('from:Computer', laptop));
	assert.ok(!on('from:computer', pixel));
	assert.ok(on('from:"work lap"', laptop));
	assert.ok(!on('from:"work lap"', pixel));
	assert.ok(!on('from:phone', saved()), 'an older bookmark has no device');
	assert.ok(
		!on('from:phone', saved('Phone testing laptop', 'desktop')),
		'phone and computer name the kind, not a part of the name',
	);
	assert.ok(!on('from:phone', bookmark('', '')));
	const query = parseSearchQuery('docs from:pixel');
	assert.deepEqual(query.devices, ['pixel']);
	assert.equal(query.text, 'docs');
	assert.equal(hasOperators(parseSearchQuery('from:phone')), true);
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

test('kind: keeps links to images, PDFs, or videos, read from the address', () => {
	const query = parseSearchQuery('Kind:PDF kind:video');
	assert.deepEqual(query.kinds, ['pdf', 'video']);
	assert.equal(query.text, '');
	const of = (url: string) => passesOperators(query, [], bookmark(url, ''));
	assert.ok(of('https://example.com/report.PDF?x=1'));
	assert.ok(of('https://www.youtube.com/watch?v=abc'));
	assert.ok(!of('https://example.com/photo.png'));
	assert.ok(!of('https://example.com/article'));
	assert.ok(
		passesOperators(parseSearchQuery('kind:image'), [], {
			places: ['sessions', 'tabs'],
			urls: ['https://example.com/', 'https://example.com/cat.webp'],
		}),
		'a session matches when one of its tabs is that kind',
	);
	assert.ok(
		!passesOperators(parseSearchQuery('kind:page'), [], {places: [], urls: []}),
		'a result without an address has no kind',
	);
	const unknown = parseSearchQuery('kind:doc');
	assert.equal(hasOperators(unknown), false);
	assert.equal(unknown.text, 'kind:doc');
});

const tagged = (
	url: string,
	fields: {tags?: string[]; hiddenKinds?: Array<'movie' | 'repo'>} = {},
) =>
	bookmarkFacets(
		{
			id: 'b',
			title: '',
			url,
			columnId: 'c',
			createdAt: 0,
			updatedAt: 0,
			...fields,
		},
		'Column',
	);

test('tag: keeps bookmarks that show every tag asked for, automatic or typed', () => {
	const query = parseSearchQuery('tag:Movie tag:"to watch"');
	assert.deepEqual(query.tags, ['movie', 'to watch']);
	assert.equal(query.text, '');
	const film = 'https://www.imdb.com/title/tt0111161/';
	assert.ok(passesOperators(query, [], tagged(film, {tags: ['to watch']})));
	assert.ok(
		!passesOperators(query, [], tagged(film)),
		'every tag must be shown',
	);
	assert.ok(
		passesOperators(
			parseSearchQuery('tag:#rust'),
			[],
			tagged('https://x.example/', {tags: ['rust']}),
		),
	);
	assert.ok(
		!passesOperators(parseSearchQuery('tag:movie'), [], {
			places: ['sessions'],
			urls: [film],
		}),
		'a session has no tags',
	);
});

test('a removed kind leaves tag: but not kind:', () => {
	const repo = tagged('https://github.com/bberka/TabLodge', {
		hiddenKinds: ['repo'],
	});
	assert.ok(!passesOperators(parseSearchQuery('tag:repo'), [], repo));
	assert.ok(passesOperators(parseSearchQuery('kind:repo'), [], repo));
	assert.ok(
		passesOperators(
			parseSearchQuery('kind:repo'),
			[],
			tagged('https://gitlab.com/a/b'),
		),
	);
	assert.deepEqual(parseSearchQuery('kind:recipe kind:discussion').kinds, [
		'recipe',
		'discussion',
	]);
});

test('a tag filter switches on and off without touching the rest of the search', () => {
	assert.equal(toggleTagFilter('', 'movie'), 'tag:movie');
	assert.equal(toggleTagFilter('rust', 'to read'), 'rust tag:"to read"');
	assert.equal(
		toggleTagFilter('rust tag:"To Read" site:x.com', 'to read'),
		'rust site:x.com',
	);
	assert.equal(toggleTagFilter('tag:movie tag:scifi', 'movie'), 'tag:scifi');
});

test('switching a tag filter off leaves the same words inside a quoted phrase alone', () => {
	assert.equal(
		toggleTagFilter('"watch tag:movie later" tag:movie', 'movie'),
		'"watch tag:movie later"',
	);
	assert.equal(
		toggleTagFilter('col:"tag:movie" tag:movie', 'movie'),
		'col:"tag:movie"',
	);
});
