import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	bookmarkTags,
	hiddenKinds,
	MAX_TAG_LENGTH,
	MAX_TAGS,
	normalizeTag,
	parseTagInput,
	removedByEdit,
	shownTags,
	tagCounts,
	tagFields,
} from '../src/shared/bookmark-tags';

const FILM = 'https://letterboxd.com/film/arrival-2016/';

test('a tag is stored in lower case, tidied, without a leading # or commas', () => {
	assert.equal(normalizeTag('  #To   Read '), 'to read');
	assert.equal(normalizeTag('a,b'), 'a b');
	assert.equal(
		normalizeTag('read|later'),
		'read later',
		'a bar would split it on import',
	);
	assert.equal(
		normalizeTag('say "hi"'),
		'say hi',
		'a quote would end a tag:"…" search',
	);
	assert.equal(normalizeTag('İSTANBUL'), 'i̇stanbul');
	assert.equal(
		normalizeTag('IRAK'),
		'irak',
		'the same on every device, whatever its language',
	);
	assert.equal(normalizeTag('###'), undefined);
	assert.equal(normalizeTag(''), undefined);
	assert.equal(normalizeTag(42), undefined);
	assert.equal(normalizeTag('x'.repeat(100))?.length, MAX_TAG_LENGTH);
	assert.equal(
		normalizeTag(normalizeTag(' A  b ')),
		'a b',
		'normalizing twice changes nothing',
	);
});

test('a bookmark keeps the first of equal tags, in order, up to the limit, and none means no field', () => {
	assert.deepEqual(bookmarkTags(['Rust', 'web', 'rust', '#Web', '']), [
		'rust',
		'web',
	]);
	assert.equal(bookmarkTags([]), undefined);
	assert.equal(bookmarkTags('rust'), undefined);
	assert.equal(bookmarkTags([1, null, {}]), undefined);
	assert.equal(
		bookmarkTags(Array.from({length: 30}, (_, index) => `t${index}`))?.length,
		MAX_TAGS,
	);
	assert.deepEqual(parseTagInput('rust, Web ,, #async'), [
		'rust',
		'web',
		'async',
	]);
});

test('removed kinds keep only known kinds, in one order, so every device stores the same', () => {
	assert.deepEqual(hiddenKinds(['repo', 'movie', 'page', 'nope', 'movie']), [
		'movie',
		'repo',
	]);
	assert.equal(hiddenKinds('movie'), undefined);
	assert.deepEqual(tagFields({tags: ['A'], hiddenKinds: []}), {tags: ['a']});
	assert.deepEqual(tagFields({}), {});
});

test('a bookmark shows its kind first and each tag once, and a removed kind stays away', () => {
	assert.deepEqual(shownTags({url: FILM, tags: ['scifi', 'movie']}), [
		'movie',
		'scifi',
	]);
	assert.deepEqual(shownTags({url: FILM, hiddenKinds: ['movie']}), []);
	assert.deepEqual(
		shownTags({url: 'https://example.com/'}),
		[],
		'a plain page has none',
	);
});

test('tag counts list the most used first', () => {
	assert.deepEqual(
		tagCounts([
			{url: FILM, tags: ['scifi']},
			{url: 'https://www.imdb.com/title/tt0111161/'},
			{url: 'https://example.com/', tags: ['scifi', 'later']},
		]),
		[
			{tag: 'movie', count: 2},
			{tag: 'scifi', count: 2},
			{tag: 'later', count: 1},
		],
	);
});

test('an edit that drops a tag or removes the kind is a removal; one that only adds is not', () => {
	assert.deepEqual(removedByEdit({tags: ['a', 'b']}, {tags: ['b']}), ['a']);
	assert.deepEqual(removedByEdit({}, {hiddenKinds: ['movie']}), ['movie']);
	assert.equal(removedByEdit({tags: ['a']}, {tags: ['a', 'b']}), undefined);
	assert.equal(removedByEdit({hiddenKinds: ['movie']}, {}), undefined);
});
