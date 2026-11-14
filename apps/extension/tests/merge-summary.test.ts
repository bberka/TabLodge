import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {mergeSummary} from '../src/app/merge-summary';

const none = {
	groups: 0,
	count: 0,
	bookmarks: 0,
	columns: 0,
	skipped: 0,
	updatedTitles: 0,
};

test('reports what was added, then what was skipped', () => {
	assert.equal(
		mergeSummary({
			...none,
			groups: 2,
			count: 9,
			bookmarks: 14,
			columns: 1,
			skipped: 3,
		}),
		'Added 9 tabs in 2 sessions · 14 bookmarks · 1 new column · skipped 3 duplicates.',
	);
	assert.equal(
		mergeSummary({...none, bookmarks: 1, updatedTitles: 1}),
		'Added 1 bookmark · updated 1 title.',
	);
});

test('says so plainly when everything was already there', () => {
	assert.equal(
		mergeSummary({...none, skipped: 5}),
		'Nothing new to add · skipped 5 duplicates.',
	);
});
