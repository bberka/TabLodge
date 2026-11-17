import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, test} from 'vite-plus/test';
import {parseImportFile} from '../../extension/src/shared/import-formats';
import {emptyStore} from '../src/library/store-shape';
import {
	importIntoStore,
	previewFor,
	shareGroupsOf,
} from '../src/transfer/transfer';

let counter = 0;
const newId = () => {
	counter += 1;
	return `id-${counter}`;
};

const NOW = 1_700_000_000_000;

const ONETAB = [
	'https://example.com/a | Example A',
	'https://example.com/b | Example B',
	'',
	'https://other.org/ | Other',
].join('\n');

describe('importing a file into the library', () => {
	test('a OneTab export becomes sessions with the titles it gave', () => {
		const parsed = parseImportFile(ONETAB, 'onetab.txt');
		const result = importIntoStore(emptyStore(NOW), parsed, {
			kind: 'sessions',
			now: NOW,
			newId,
		});
		assert.equal(result.groups, 2);
		assert.equal(result.links, 3);
		const [first, second] = result.store.groups;
		assert.equal(first.tabs.length, 2);
		assert.equal(first.tabs[0].title, 'Example A');
		assert.equal(second.tabs[0].url, 'https://other.org/');
	});

	test('links already saved are skipped, and so are repeats in the file', () => {
		const parsed = parseImportFile(
			'https://a.com\nhttps://a.com\nhttps://b.com',
			'links.txt',
		);
		const once = importIntoStore(emptyStore(NOW), parsed, {
			kind: 'bookmarks',
			now: NOW,
			newId,
		});
		assert.equal(once.links, 2);
		assert.equal(once.duplicates, 1);
		const again = importIntoStore(once.store, parsed, {
			kind: 'bookmarks',
			now: NOW,
			newId,
		});
		assert.equal(again.links, 0);
		assert.equal(again.store, once.store);
	});

	test('a bookmark folder reuses a column of the same name', () => {
		const html =
			'<DL><DT><H3>Reading</H3><DL><DT><A HREF="https://x.org/1">One</A></DL></DL>';
		const parsed = parseImportFile(html, 'bookmarks.html');
		const first = importIntoStore(emptyStore(NOW), parsed, {
			kind: 'bookmarks',
			now: NOW,
			newId,
		});
		const columns = first.store.bookmarkColumns;
		assert.equal(
			columns.filter((column) => column.name === 'Reading').length,
			1,
		);
		const html2 =
			'<DL><DT><H3>reading</H3><DL><DT><A HREF="https://x.org/2">Two</A></DL></DL>';
		const second = importIntoStore(
			first.store,
			parseImportFile(html2, 'more.html'),
			{kind: 'bookmarks', now: NOW, newId},
		);
		assert.equal(second.store.bookmarkColumns.length, columns.length);
		assert.equal(second.store.bookmarks.length, 2);
	});

	test('the preview counts what an import would add', () => {
		const parsed = parseImportFile(ONETAB, 'onetab.txt');
		const preview = previewFor(emptyStore(NOW), parsed, 'sessions');
		assert.equal(preview.links, 3);
		assert.equal(preview.groups, 2);
	});
});

// The phone reads exports from other bookmark tools with the extension's reader.
describe('exports from other bookmark tools', () => {
	for (const [file, label, links, columns] of [
		[
			'linkwarden-backup.json',
			'Linkwarden backup (JSON)',
			4,
			['Reading', 'Tools', 'Rust'],
		],
		// Bookmarks in no list go to the phone's default column.
		[
			'karakeep-export.json',
			'Karakeep export (JSON)',
			3,
			['Bookmarks', 'Dev', 'Reading'],
		],
		[
			'omnivore-metadata_0_to_3.json',
			'Omnivore export (JSON)',
			2,
			['Bookmarks'],
		],
		['wallabag-export.json', 'wallabag export (JSON)', 2, ['Bookmarks']],
		['pinboard-export.json', 'Pinboard export (JSON)', 2, ['Bookmarks']],
		['mastodon-bookmarks.csv', 'Mastodon bookmarks (CSV)', 3, ['Bookmarks']],
	] as const) {
		test(`a ${label} becomes bookmark columns`, () => {
			const text = readFileSync(
				new URL(
					`../../extension/tests/fixtures/imports/${file}`,
					import.meta.url,
				),
				'utf8',
			);
			const parsed = parseImportFile(text, file);
			assert.equal(parsed.label, label);
			const result = importIntoStore(emptyStore(NOW), parsed, {
				kind: 'bookmarks',
				now: NOW,
				newId,
			});
			assert.equal(result.links, links);
			assert.deepEqual(
				result.store.bookmarkColumns
					.filter((column) =>
						result.store.bookmarks.some(
							(bookmark) => bookmark.columnId === column.id,
						),
					)
					.map((column) => column.name),
				columns,
			);
		});
	}
});

describe('sessions as share groups', () => {
	test('keep each tab with its title and address', () => {
		const parsed = parseImportFile(ONETAB, 'onetab.txt');
		const {store} = importIntoStore(emptyStore(NOW), parsed, {
			kind: 'sessions',
			now: NOW,
			newId,
		});
		const groups = shareGroupsOf(store.groups);
		assert.equal(groups.length, 2);
		assert.equal(groups[0].tabs[0].url.startsWith('https://'), true);
	});
});
