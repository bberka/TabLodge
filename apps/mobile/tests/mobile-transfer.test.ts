import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, test} from 'vite-plus/test';
import {
	BACKUP_VERSION,
	BOOKMARKS_FORMAT_ID,
} from '../../extension/src/shared/backup-format';
import {buildExport} from '../../extension/src/shared/export-formats';
import {parseImportFile} from '../../extension/src/shared/import-formats';
import {emptyStore} from '../src/library/store-shape';
import type {SavedTab, Session} from '../../extension/src/shared/types';
import {addToTrash} from '../src/library/trash';
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

	test('a TabLodge bookmarks file keeps the device each bookmark was saved on through export and import', () => {
		const file = JSON.stringify({
			format: BOOKMARKS_FORMAT_ID,
			version: BACKUP_VERSION,
			bookmarks: [
				{
					url: 'https://a.example/',
					title: 'A',
					deviceName: 'Pixel 9',
					deviceKind: 'mobile',
				},
				{url: 'https://b.example/', title: 'B'},
			],
		});
		const first = importIntoStore(
			emptyStore(NOW),
			parseImportFile(file, 'tablodge-bookmarks.json'),
			{kind: 'bookmarks', now: NOW, newId},
		);
		const exported = buildExport(
			{
				kind: 'bookmarks',
				columns: first.store.bookmarkColumns,
				bookmarks: first.store.bookmarks,
			},
			'json',
			{appName: 'TabLodge'},
		);
		const again = importIntoStore(
			emptyStore(NOW),
			parseImportFile(exported.content, exported.filename),
			{kind: 'bookmarks', now: NOW, newId},
		);
		const [phone, old] = again.store.bookmarks;
		assert.equal(phone.deviceName, 'Pixel 9');
		assert.equal(phone.deviceKind, 'mobile');
		assert.equal('deviceName' in old, false);
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

	test('a source column keeps its id, known site or not, and joins the one already here', () => {
		const backup = JSON.stringify({
			format: BOOKMARKS_FORMAT_ID,
			version: BACKUP_VERSION,
			bookmarkColumns: [
				{id: 'source-reddit', name: 'My Reddit', createdAt: 1},
				{id: 'source-mastodon', name: 'Mastodon', createdAt: 2},
			],
			bookmarks: [
				{url: 'https://r.example/1', title: 'One', columnId: 'source-reddit'},
				{url: 'https://m.example/1', title: 'Two', columnId: 'source-mastodon'},
			],
		});
		const parsed = parseImportFile(backup, 'tablodge-bookmarks.json');
		const first = importIntoStore(emptyStore(NOW), parsed, {
			kind: 'bookmarks',
			now: NOW,
			newId,
		});
		const sources = first.store.bookmarkColumns.filter((column) =>
			column.id.startsWith('source-'),
		);
		assert.deepEqual(
			sources.map((column) => [column.id, column.name, column.icon]),
			[
				['source-reddit', 'My Reddit', 'message-circle'],
				['source-mastodon', 'Mastodon', undefined],
			],
		);
		assert.deepEqual(
			first.store.bookmarks.map((bookmark) => bookmark.columnId),
			['source-reddit', 'source-mastodon'],
		);

		const exported = buildExport(
			{
				kind: 'bookmarks',
				columns: first.store.bookmarkColumns,
				bookmarks: first.store.bookmarks,
			},
			'json',
			{appName: 'TabLodge'},
		);
		const roundTrip = importIntoStore(
			emptyStore(NOW),
			parseImportFile(exported.content, exported.filename),
			{kind: 'bookmarks', now: NOW, newId},
		);
		assert.deepEqual(
			roundTrip.store.bookmarks.map((bookmark) => bookmark.columnId),
			['source-reddit', 'source-mastodon'],
		);

		const more = parseImportFile(
			backup.replace('https://r.example/1', 'https://r.example/2'),
			'tablodge-bookmarks.json',
		);
		const second = importIntoStore(first.store, more, {
			kind: 'bookmarks',
			now: NOW,
			newId,
		});
		assert.equal(
			second.store.bookmarkColumns.filter(
				(column) => column.id === 'source-reddit',
			).length,
			1,
		);
		assert.equal(second.store.bookmarks.at(-1)?.columnId, 'source-reddit');
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

	test('bookmark notes come in from a file, and an export from the phone reads back with them', () => {
		const csv = 'url,title,note\nhttps://x.org/1,One,Why I saved it\n';
		const first = importIntoStore(
			emptyStore(NOW),
			parseImportFile(csv, 'links.csv'),
			{kind: 'bookmarks', now: NOW, newId},
		);
		assert.equal(first.store.bookmarks[0].notes, 'Why I saved it');

		for (const format of ['json', 'csv', 'markdown', 'html'] as const) {
			const file = buildExport(
				{
					kind: 'bookmarks',
					columns: first.store.bookmarkColumns,
					bookmarks: first.store.bookmarks,
				},
				format,
				{appName: 'TabLodge'},
			);
			const again = importIntoStore(
				emptyStore(NOW),
				parseImportFile(file.content, file.filename),
				{kind: 'bookmarks', now: NOW, newId},
			);
			assert.equal(again.store.bookmarks[0]?.notes, 'Why I saved it', format);
		}
	});

	test('bookmark tags come in from a file, and an export from the phone reads back with them', () => {
		const html =
			'<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p><DT><A HREF="https://x.org/1" TAGS="rust,web">One</A></DL>';
		const first = importIntoStore(
			emptyStore(NOW),
			parseImportFile(html, 'bookmarks.html'),
			{kind: 'bookmarks', now: NOW, newId},
		);
		assert.deepEqual(first.store.bookmarks[0].tags, ['rust', 'web']);

		for (const format of ['json', 'csv', 'html'] as const) {
			const file = buildExport(
				{
					kind: 'bookmarks',
					columns: first.store.bookmarkColumns,
					bookmarks: first.store.bookmarks,
				},
				format,
				{appName: 'TabLodge'},
			);
			const again = importIntoStore(
				emptyStore(NOW),
				parseImportFile(file.content, file.filename),
				{kind: 'bookmarks', now: NOW, newId},
			);
			assert.deepEqual(again.store.bookmarks[0]?.tags, ['rust', 'web'], format);
		}
	});

	test('the preview counts what an import would add', () => {
		const parsed = parseImportFile(ONETAB, 'onetab.txt');
		const preview = previewFor(emptyStore(NOW), parsed, 'sessions');
		assert.equal(preview.links, 3);
		assert.equal(preview.groups, 2);
	});
});

describe('exports from other bookmark tools', () => {
	for (const [file, label, links, columns] of [
		[
			'linkwarden-backup.json',
			'Linkwarden backup (JSON)',
			4,
			['Reading', 'Tools', 'Rust'],
		],
		[
			'karakeep-export.json',
			'Karakeep export (JSON)',
			3,
			['Bookmarks', 'Dev', 'Reading'],
		],
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

describe('the trash during an import', () => {
	const tab = (id: string, url: string): SavedTab => ({
		id,
		title: id,
		url,
		notes: '',
		pinned: false,
		nativeGroup: null,
		savedAt: NOW,
		originalIndex: 0,
	});
	const session: Session = {
		id: 's1',
		name: 'Old',
		folderId: 'unfiled',
		description: '',
		createdAt: NOW,
		updatedAt: NOW,
		sourceWindowName: '',
		sourceWindowId: null,
		tabs: [tab('t1', 'https://session.example/')],
	};
	const bookmark = (id: string, url: string) => ({
		id,
		title: id,
		url,
		columnId: 'col',
		createdAt: NOW,
		updatedAt: NOW,
	});
	const trash = addToTrash(
		[],
		[
			{kind: 'session', session},
			{
				kind: 'tab',
				tab: tab('t2', 'https://tab.example/'),
				index: 0,
				sessionId: 's2',
				sessionName: 'Other',
				folderId: 'unfiled',
			},
			{
				kind: 'bookmark',
				bookmark: bookmark('b1', 'https://bookmark.example/'),
				after: null,
			},
			{
				kind: 'column',
				column: {id: 'col', name: 'Gone', createdAt: NOW, isDefault: false},
				bookmarks: [bookmark('b2', 'https://column.example/')],
			},
		],
		['x1', 'x2', 'x3', 'x4'],
		NOW,
	);
	const file = [
		'https://session.example/',
		'https://tab.example/',
		'https://bookmark.example/',
		'https://column.example/',
		'https://new.example/',
	].join('\n');

	test('a bookmark import skips deleted bookmarks and columns, and the preview counts them', () => {
		const parsed = parseImportFile(file, 'links.txt');
		assert.equal(
			previewFor(emptyStore(NOW), parsed, 'bookmarks', trash).duplicates,
			2,
		);
		const result = importIntoStore(emptyStore(NOW), parsed, {
			kind: 'bookmarks',
			now: NOW,
			newId,
			trash,
		});
		assert.deepEqual(
			result.store.bookmarks.map((entry) => entry.url),
			[
				'https://session.example/',
				'https://tab.example/',
				'https://new.example/',
			],
		);
	});

	test('a session import skips deleted sessions and tabs', () => {
		const parsed = parseImportFile(file, 'links.txt');
		const result = importIntoStore(emptyStore(NOW), parsed, {
			kind: 'sessions',
			now: NOW,
			newId,
			trash,
		});
		assert.deepEqual(
			result.store.groups.flatMap((group) =>
				group.tabs.map((saved) => saved.url),
			),
			[
				'https://bookmark.example/',
				'https://column.example/',
				'https://new.example/',
			],
		);
	});

	test('with skipping off, links in the trash import again', () => {
		const parsed = parseImportFile(file, 'links.txt');
		const result = importIntoStore(emptyStore(NOW), parsed, {
			kind: 'bookmarks',
			now: NOW,
			newId,
			trash,
			skipDuplicates: false,
		});
		assert.equal(result.links, 5);
	});
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
