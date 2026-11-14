import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	ARCHIVED_FOLDER_NAME,
	normalizeStore,
	SCHEMA_VERSION,
} from '../src/shared/library-normalize';

describe('normalizeStore', () => {
	test('turns nothing into an empty library with the default column and folder', () => {
		const store = normalizeStore(null);
		assert.equal(store.schemaVersion, SCHEMA_VERSION);
		assert.deepEqual(store.groups, []);
		assert.equal(store.bookmarks.length, 0);
		assert.ok(store.bookmarkColumns.some((column) => column.isDefault));
		assert.ok(store.folders.length > 0);
	});

	test('drops what it cannot read and keeps the rest', () => {
		const store = normalizeStore({
			bookmarkColumns: [{id: 'c1', name: ' Reading '}, 'junk', null],
			bookmarks: [
				{id: 'b1', title: 'Ok', url: 'https://example.com', columnId: 'c1'},
				{id: 'b2', title: 'Bad', url: 'javascript:alert(1)', columnId: 'c1'},
				42,
			],
			settings: {closeOnSave: 'yes', unknownSetting: true},
		});
		assert.deepEqual(
			store.bookmarks.map((bookmark) => bookmark.id),
			['b1'],
		);
		assert.ok(
			store.bookmarkColumns.some((column) => column.name === 'Reading'),
		);
		assert.equal(typeof store.settings.closeOnSave, 'boolean');
		assert.equal('unknownSetting' in store.settings, false);
	});

	test('keeps a folder named like the archive as the archive', () => {
		const store = normalizeStore({
			folders: [{id: 'x', name: ARCHIVED_FOLDER_NAME.toUpperCase()}],
		});
		assert.equal(
			store.folders.filter(
				(folder) =>
					folder.name.toLocaleLowerCase() ===
					ARCHIVED_FOLDER_NAME.toLocaleLowerCase(),
			).length,
			1,
		);
	});
});
