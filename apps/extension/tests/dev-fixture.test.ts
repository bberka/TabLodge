import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {createDevFixture, type DevStore} from '../src/shared/dev-fixture.ts';

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

	assert.ok(store.groups.every((group) => folderIds.has(group.folderId)));
	assert.equal(
		store.groups.find((group) => group.id === 'dev-archived-session')?.folderId,
		'archived-sessions',
	);
	assert.ok(
		store.bookmarks.every((bookmark) => columnIds.has(bookmark.columnId)),
	);
	assert.equal(store.settings, baseStore.settings);
	assert.equal(store.schemaVersion, baseStore.schemaVersion);
});
