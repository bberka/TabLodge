import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {createDevFixture, type DevStore} from '../scripts/dev-fixture.ts';

const baseStore = {
	schemaVersion: 9,
	groups: [],
	folders: [],
	bookmarkColumns: [],
	bookmarks: [],
	settings: {includePinnedTabs: true},
	updatedAt: 0,
} as DevStore;

test('the development fixture creates linked records and preserves settings', () => {
	const store = createDevFixture(baseStore);
	const folderIds = new Set(store.folders.map((folder) => folder.id));
	const columnIds = new Set(store.bookmarkColumns.map((column) => column.id));

	assert.equal(store.groups.length, 6);
	assert.ok(store.groups.every((group) => folderIds.has(group.folderId)));
	assert.deepEqual(
		store.groups.map((group) => group.tabs.length),
		[4, 3, 4, 2, 2, 1],
	);
	assert.equal(
		store.groups.find((group) => group.id === 'dev-archived-session')?.folderId,
		'archived-sessions',
	);
	assert.equal(store.bookmarks.length, 16);
	assert.ok(
		store.bookmarks.every((bookmark) => columnIds.has(bookmark.columnId)),
	);
	assert.equal(store.settings, baseStore.settings);
	assert.equal(store.schemaVersion, baseStore.schemaVersion);
});

test('the development fixture is deterministic', () => {
	assert.deepEqual(createDevFixture(baseStore), createDevFixture(baseStore));
});
