import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	SESSION_FOLDER_LIST_MIN,
	isFolderListShown,
	suggestsFolderList,
} from '../src/app/session-folder-list-rule';

test('auto lists session folders only past the threshold', () => {
	assert.equal(isFolderListShown(SESSION_FOLDER_LIST_MIN, 'auto'), false);
	assert.equal(isFolderListShown(SESSION_FOLDER_LIST_MIN + 1, 'auto'), true);
});

test('an explicit choice ignores the folder count', () => {
	assert.equal(isFolderListShown(1, 'list'), true);
	assert.equal(isFolderListShown(SESSION_FOLDER_LIST_MIN + 5, 'chips'), false);
});

test('the hint shows for nine or more folders while the chips are showing', () => {
	assert.equal(suggestsFolderList(SESSION_FOLDER_LIST_MIN - 1, false), false);
	assert.equal(suggestsFolderList(SESSION_FOLDER_LIST_MIN, false), true);
	assert.equal(suggestsFolderList(20, true), false);
});
