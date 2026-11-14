import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	BOOKMARK_UNFILED_ID,
	cleanColumnName,
	columnNameProblem,
	DEFAULT_BOOKMARK_COLUMN_ID,
	landingColumnId,
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
