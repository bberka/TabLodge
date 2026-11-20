import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	ARCHIVED_FOLDER_NAME,
	normalizeBookmark,
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

test('a bookmark keeps a cleaned note and drops a blank one', () => {
	const columns = new Set(['c']);
	const raw = {url: 'https://example.com/', title: 'Example', columnId: 'c'};
	assert.equal(
		normalizeBookmark({...raw, notes: '  Why\u0000 I saved it \n'}, columns)
			?.notes,
		'Why I saved it',
	);
	assert.equal(
		normalizeBookmark({...raw, notes: 'x'.repeat(20_000)}, columns)?.notes
			?.length,
		10_000,
	);
	for (const notes of [' '.repeat(3), '', 42, undefined]) {
		assert.equal(
			'notes' in normalizeBookmark({...raw, notes}, columns)!,
			false,
			String(notes),
		);
	}
});

test('a bookmark keeps cleaned tags and removed kinds, drops malformed ones, and an old bookmark gains no field', () => {
	const columns = new Set(['c']);
	const raw = {url: 'https://github.com/a/b', title: 'A repo', columnId: 'c'};
	const tagged = normalizeBookmark(
		{
			...raw,
			tags: [' Rust ', '#rust', 7, 'Web'],
			hiddenKinds: ['repo', 'nonsense'],
		},
		columns,
	)!;
	assert.deepEqual(tagged.tags, ['rust', 'web']);
	assert.deepEqual(tagged.hiddenKinds, ['repo']);
	assert.deepEqual(
		normalizeBookmark(tagged, columns),
		tagged,
		'normalizing again changes nothing',
	);

	for (const value of [undefined, 'rust', {}, [], [null, '']]) {
		const bookmark = normalizeBookmark(
			{...raw, tags: value, hiddenKinds: value},
			columns,
		)!;
		assert.equal(
			'tags' in bookmark || 'hiddenKinds' in bookmark,
			false,
			String(value),
		);
	}

	assert.deepEqual(Object.keys(normalizeBookmark(raw, columns)!).toSorted(), [
		'columnId',
		'createdAt',
		'id',
		'title',
		'updatedAt',
		'url',
	]);
});
