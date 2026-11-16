import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	SESSION_FOLDER_LIST_MIN,
	isFolderListShown,
} from '../src/app/session-folder-list-rule';

test('session folders become a vertical list only past the threshold', () => {
	assert.equal(isFolderListShown(SESSION_FOLDER_LIST_MIN), false);
	assert.equal(isFolderListShown(SESSION_FOLDER_LIST_MIN + 1), true);
});
