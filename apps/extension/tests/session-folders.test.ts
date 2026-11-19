import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	FOLDER_LIMIT_MESSAGE,
	folderLimitReached,
	folderNameProblem,
	normalizeFolderName,
	visibleSessionFolders,
} from '../src/shared/session-folders';

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

test('a folder name is trimmed, cleaned of control characters, and cut to 60 characters', () => {
	assert.equal(normalizeFolderName('  Work\tlist\n '), 'Work list');
	assert.equal(normalizeFolderName('x'.repeat(80)).length, 60);
	assert.equal(normalizeFolderName(42), '');
});

test('folderNameProblem rejects empty, reserved, duplicate, and over-limit names', () => {
	const folders = [{id: 'a', name: 'Work'}];
	const unfit = 'Choose a different folder name.';

	assert.equal(folderNameProblem(folders, '  '), unfit);
	assert.equal(folderNameProblem(folders, undefined), unfit);
	assert.equal(folderNameProblem(folders, ' all SESSIONS '), unfit);
	assert.equal(
		folderNameProblem(folders, 'WORK'),
		'A folder with that name already exists.',
	);
	assert.equal(folderNameProblem(folders, 'Work', 'a'), undefined);
	assert.equal(folderNameProblem(folders, 'Play'), undefined);
});

test('a new folder stops at 200 folders, and Archived does not count', () => {
	const folders = Array.from({length: 199}, (_, index) => ({
		id: `f${index}`,
		name: `Folder ${index}`,
	}));
	folders.push({id: 'archived', name: 'Archived'});

	assert.equal(folderLimitReached(folders), false);
	assert.equal(folderNameProblem(folders, 'One more'), undefined);

	folders.push({id: 'last', name: 'Last'});
	assert.equal(folderLimitReached(folders), true);
	assert.equal(folderNameProblem(folders, 'Another'), FOLDER_LIMIT_MESSAGE);
	assert.equal(folderNameProblem(folders, 'Renamed', 'last'), undefined);
});
