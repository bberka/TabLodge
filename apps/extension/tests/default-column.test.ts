import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {defaultBookmarkColumnId} from '../src/app/default-column';
import type {Bookmark, BookmarkColumn} from '../src/shared/types';

const column = (id: string): BookmarkColumn => ({
	id,
	name: id,
	createdAt: 0,
	isDefault: false,
});
const bookmark = (columnId: string, createdAt: number): Bookmark => ({
	id: `${columnId}-${createdAt}`,
	title: 'Example',
	url: 'https://example.com',
	columnId,
	createdAt,
	updatedAt: createdAt,
});

test('the default is the column of the newest bookmark', () => {
	const columns = [column('a'), column('b')];
	assert.equal(
		defaultBookmarkColumnId(columns, [bookmark('a', 1), bookmark('b', 2)]),
		'b',
	);
});

test('a deleted column falls back to the next newest, then to the first column', () => {
	const columns = [column('a'), column('b')];
	assert.equal(
		defaultBookmarkColumnId(columns, [bookmark('a', 1), bookmark('gone', 5)]),
		'a',
	);
	assert.equal(defaultBookmarkColumnId(columns, [bookmark('gone', 5)]), 'a');
	assert.equal(defaultBookmarkColumnId(columns, []), 'a');
	assert.equal(defaultBookmarkColumnId([], []), undefined);
});
