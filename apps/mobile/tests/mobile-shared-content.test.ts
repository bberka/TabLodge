import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	cacheCopies,
	readShare,
	shouldCloseAfterShare,
} from '../src/library/shared-content';

const cache = 'file:///data/user/0/com.bberka.tablodge/cache/';

describe('readShare', () => {
	test('a browser share becomes a link with the words around it as the title', () => {
		assert.deepEqual(readShare({text: 'A cat https://cdn.example/cat.jpg'}), {
			kind: 'link',
			text: 'https://cdn.example/cat.jpg',
			title: 'A cat',
			urls: ['https://cdn.example/cat.jpg'],
			quote: 'A cat',
		});
	});

	test('a link alone, with the page title beside it, offers no quote', () => {
		assert.deepEqual(
			readShare({
				text: 'https://example.com/post',
				meta: {title: 'A post'},
			}),
			{
				kind: 'link',
				text: 'https://example.com/post',
				title: 'A post',
				urls: ['https://example.com/post'],
			},
		);
	});

	test('a selection Chrome shared without a link is a quote with no page', () => {
		assert.deepEqual(
			readShare({
				text: '"Lisbon is a city of hills"',
				meta: {title: 'Including link:'},
			}),
			{kind: 'quote', quote: 'Lisbon is a city of hills'},
		);
	});

	test('a selection shared with a link to the passage is a quote on that page', () => {
		assert.deepEqual(
			readShare({
				text: '"Lisbon is a city\nof hills"\nhttps://example.com/post#:~:text=Lisbon%20is,of%20hills',
			}),
			{
				kind: 'quote',
				quote: 'Lisbon is a city\nof hills',
				url: 'https://example.com/post',
			},
		);
	});

	test('several links stay a list of links', () => {
		const outcome = readShare({
			text: 'https://a.example/ https://b.example/#:~:text=x',
		});
		assert.equal(outcome.kind, 'link');
		assert.equal(outcome.kind === 'link' && outcome.quote, undefined);
	});

	test('a shared image is refused', () => {
		const image = {
			path: `${cache}IMG_1.jpg`,
			fileName: 'IMG_1.jpg',
			mimeType: 'image/jpeg',
		};
		assert.deepEqual(readShare({text: null, files: [image]}), {
			kind: 'refused',
		});
		assert.deepEqual(
			readShare({text: 'Look at this', files: [image]}),
			{kind: 'refused'},
			'words without a link do not make a link',
		);
	});

	test('a link that comes with an image is still saved', () => {
		const outcome = readShare({
			text: 'https://photos.example/p/1',
			files: [{path: `${cache}IMG_1.jpg`, mimeType: 'image/jpeg'}],
		});
		assert.equal(outcome.kind, 'link');
	});

	test('words without a link still open Save link', () => {
		const outcome = readShare({text: 'just some words'});
		assert.equal(outcome.kind, 'link');
		assert.equal(
			outcome.kind === 'link' && outcome.quote,
			'just some words',
			'and offers them as a quote',
		);
	});

	test('an export file opens the import preview', () => {
		for (const [fileName, mimeType] of [
			['tablodge-sessions.json', 'application/json'],
			['bookmarks.csv', 'text/comma-separated-values'],
			['bookmarks.html', 'text/html'],
			['links.md', 'text/markdown'],
			['links.txt', 'text/plain'],
		]) {
			assert.deepEqual(
				readShare({
					files: [{path: `${cache}${fileName}`, fileName, mimeType, size: 120}],
				}),
				{
					kind: 'import',
					path: `${cache}${fileName}`,
					name: fileName,
					size: 120,
				},
				fileName,
			);
		}
	});

	test('a backup opens Restore, by name or by type', () => {
		const backup = (fileName: string, mimeType: string) =>
			readShare({files: [{path: `${cache}${fileName}`, fileName, mimeType}]})
				.kind;
		assert.equal(backup('tablodge-backup.zip', 'application/zip'), 'backup');
		assert.equal(
			backup('tablodge-backup.zip.enc', 'application/octet-stream'),
			'backup',
		);
		assert.equal(backup('FILE_1', 'application/x-zip-compressed'), 'backup');
	});

	test('the name wins over a wrong type, and an unknown file is refused', () => {
		const kind = (fileName: string, mimeType: string) =>
			readShare({files: [{path: `${cache}${fileName}`, fileName, mimeType}]})
				.kind;
		assert.equal(kind('export.json', 'application/octet-stream'), 'import');
		assert.equal(kind('notes', 'text/plain'), 'import');
		assert.equal(kind('report.pdf', 'application/pdf'), 'refused');
		assert.equal(kind('blob.bin', 'application/octet-stream'), 'refused');
	});

	test('a file the share library could not copy is unreadable', () => {
		assert.deepEqual(
			readShare({
				files: [
					{
						path: 'content://downloads/1',
						fileName: 'links.json',
						mimeType: 'application/json',
					},
				],
			}),
			{kind: 'unreadable'},
		);
		assert.deepEqual(
			readShare({files: [{path: 'content://gone/1', mimeType: ''}]}),
			{kind: 'unreadable'},
			'no type means Android could not describe it',
		);
	});
});

describe('cacheCopies', () => {
	test('lists only copies inside the cache folder', () => {
		assert.deepEqual(
			cacheCopies(
				{
					files: [
						{path: `${cache}IMG_1.jpg`},
						{path: 'content://media/external/images/1'},
						{path: `${cache}../files/library.db`},
						{path: null},
					],
				},
				cache,
			),
			[`${cache}IMG_1.jpg`],
		);
		assert.deepEqual(cacheCopies({text: 'x'}, cache), []);
	});
});

describe('shouldCloseAfterShare', () => {
	test('closes only when the share started the app and afterShare is close', () => {
		assert.equal(shouldCloseAfterShare(true, 'close'), true);
		assert.equal(shouldCloseAfterShare(true, 'stay'), false);
		assert.equal(shouldCloseAfterShare(false, 'close'), false);
		assert.equal(shouldCloseAfterShare(false, 'stay'), false);
	});
});
