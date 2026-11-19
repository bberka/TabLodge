import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	isFolderListShown,
	suggestsFolderList,
} from '../src/app/session-folder-list-rule';

test('auto lists session folders only past the threshold', () => {
	assert.equal(isFolderListShown(9, 'auto'), false);
	assert.equal(isFolderListShown(10, 'auto'), true);
});

test('an explicit choice ignores the folder count', () => {
	assert.equal(isFolderListShown(1, 'list'), true);
	assert.equal(isFolderListShown(14, 'chips'), false);
});

test('the hint shows for nine or more folders while the chips are showing', () => {
	assert.equal(suggestsFolderList(8, false), false);
	assert.equal(suggestsFolderList(9, false), true);
	assert.equal(suggestsFolderList(20, true), false);
});
