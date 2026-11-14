import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {visibleSessionFolders} from '../src/app/session-folders';

test('hides the Archived folder when it has no sessions', () => {
	const folders = [
		{id: 'work', name: 'Work'},
		{id: 'archived', name: 'Archived'},
	];

	assert.deepEqual(visibleSessionFolders(folders, []), [folders[0]]);
});

test('keeps the Archived folder visible while it contains a session', () => {
	const folders = [
		{id: 'work', name: 'Work'},
		{id: 'archived', name: 'Archived'},
	];

	assert.deepEqual(
		visibleSessionFolders(folders, [{folderId: 'archived'}]),
		folders,
	);
});
