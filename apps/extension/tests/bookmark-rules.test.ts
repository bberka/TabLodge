import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	BOOKMARK_UNFILED_ID,
	cleanColumnName,
	columnNameProblem,
	DEFAULT_BOOKMARK_COLUMN_ID,
	landingColumnId,
	sortBookmarks,
} from '../src/shared/bookmark-rules';

const columns = [
	{id: 'one', name: 'One'},
	{id: DEFAULT_BOOKMARK_COLUMN_ID, name: 'Bookmarks'},
	{id: 'two', name: 'Two'},
];

describe('landingColumnId', () => {
	test('takes the asked for column when it exists', () => {
		assert.equal(landingColumnId(columns, 'two'), 'two');
	});

	test('falls back to the site column, the default column, the first column, then Unfiled', () => {
		assert.equal(landingColumnId(columns, 'gone', {claimedId: 'one'}), 'one');
		assert.equal(landingColumnId(columns, 'gone'), DEFAULT_BOOKMARK_COLUMN_ID);
		assert.equal(landingColumnId([{id: 'a'}, {id: 'b'}], undefined), 'a');
		assert.equal(landingColumnId([], 'gone'), BOOKMARK_UNFILED_ID);
	});

	test('accepts Unfiled only when asked to', () => {
		assert.equal(
			landingColumnId(columns, BOOKMARK_UNFILED_ID),
			DEFAULT_BOOKMARK_COLUMN_ID,
		);
		assert.equal(
			landingColumnId(columns, BOOKMARK_UNFILED_ID, {allowUnfiled: true}),
			BOOKMARK_UNFILED_ID,
		);
	});
});

describe('column names', () => {
	test('are cleaned of control characters and long tails', () => {
		assert.equal(cleanColumnName('  A\u0000B\n '), 'A B');
		assert.equal(cleanColumnName('x'.repeat(80)).length, 60);
		assert.equal(cleanColumnName(5), '');
	});

	test('are refused when empty, reserved, or taken by another column', () => {
		assert.match(columnNameProblem(columns, ' ') ?? '', /different/);
		assert.match(
			columnNameProblem(columns, 'All Bookmarks') ?? '',
			/different/,
		);
		assert.match(columnNameProblem(columns, 'two') ?? '', /already exists/);
		assert.equal(columnNameProblem(columns, 'Two', 'two'), undefined);
		assert.equal(columnNameProblem(columns, 'Fresh'), undefined);
	});
});

describe('sortBookmarks', () => {
	const list = [
		{title: 'Beta', url: 'https://www.zed.example/b', createdAt: 20},
		{title: '', url: 'https://alpha.example/a', createdAt: 30},
		{title: 'Gamma', url: 'https://mid.example/g', createdAt: 10},
		{title: 'Delta', url: 'https://alpha.example/d', createdAt: 10},
	];
	const titles = (sort: Parameters<typeof sortBookmarks>[1]) =>
		sortBookmarks(list, sort).map((entry) => entry.title);

	test('manual returns the stored list itself', () => {
		assert.equal(sortBookmarks(list, 'manual'), list);
	});

	test('newest and oldest go by creation time and keep ties in stored order', () => {
		assert.deepEqual(titles('newest'), ['', 'Beta', 'Gamma', 'Delta']);
		assert.deepEqual(titles('oldest'), ['Gamma', 'Delta', 'Beta', '']);
	});

	test('title falls back to the site, and site ignores www', () => {
		assert.deepEqual(titles('title'), ['', 'Beta', 'Delta', 'Gamma']);
		assert.deepEqual(titles('site'), ['', 'Delta', 'Gamma', 'Beta']);
	});

	test('a sort never reorders the list it was given', () => {
		const before = list.map((entry) => entry.url);
		sortBookmarks(list, 'title');
		assert.deepEqual(
			list.map((entry) => entry.url),
			before,
		);
	});
});
