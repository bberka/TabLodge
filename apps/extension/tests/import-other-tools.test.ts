import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'vite-plus/test';
import {
	bookmarkImportPayload,
	parseImportFile,
	type ParsedImport,
} from '../src/shared/import-formats';

const fixture = (name: string) =>
	readFileSync(new URL(`fixtures/imports/${name}`, import.meta.url), 'utf8');
const read = (name: string) => parseImportFile(fixture(name), name);
const columns = (parsed: ParsedImport) =>
	Object.fromEntries(
		parsed.bookmarks.map((entry) => [
			entry.name,
			entry.links.map((link) => link.url),
		]),
	);
const allLinks = (parsed: ParsedImport) =>
	parsed.bookmarks.flatMap((entry) => entry.links);

test('a Linkwarden backup: collections become columns, links keep their saved or original date and description', () => {
	const parsed = read('linkwarden-backup.json');
	assert.equal(parsed.format, 'linkwarden');
	assert.equal(parsed.label, 'Linkwarden backup (JSON)');
	assert.equal(parsed.confidence, 'best-effort');
	assert.deepEqual(columns(parsed), {
		Reading: [
			'https://reading.example/article',
			'https://reading.example/older',
		],
		Tools: ['https://tools.example/'],
		Rust: ['https://rust.example/book'],
	});
	assert.equal(parsed.invalid, 1);
	const [article, older] = parsed.bookmarks[0].links;
	assert.equal(article.title, 'An article');
	assert.equal(article.createdAt, Date.parse('2025-02-01T08:00:00.000Z'));
	assert.equal(article.notes, 'Read on the train');
	assert.equal(older.notes, undefined);
	assert.equal(older.createdAt, Date.parse('2021-06-15T12:00:00.000Z'));
	assert.deepEqual(
		parsed.sessions.map((entry) => entry.name),
		['Reading', 'Tools', 'Rust'],
	);
});

test('a Karakeep export: a bookmark joins its first list and keeps its note, text notes are skipped', () => {
	const parsed = read('karakeep-export.json');
	assert.equal(parsed.format, 'karakeep');
	assert.equal(parsed.label, 'Karakeep export (JSON)');
	assert.equal(parsed.confidence, 'best-effort');
	assert.deepEqual(columns(parsed), {
		'': ['https://loose.example/'],
		Dev: ['https://dev.example/guide'],
		Reading: ['https://read.example/post'],
	});
	assert.equal(parsed.invalid, 1);
	const guide = allLinks(parsed).find(
		(link) => link.url === 'https://dev.example/guide',
	);
	assert.equal(guide?.title, 'In a list');
	assert.equal(guide?.createdAt, 1_735_725_600_000);
	assert.equal(guide?.notes, 'My note');
});

test('an Omnivore metadata file: saved dates are kept, non-web links are skipped', () => {
	const parsed = read('omnivore-metadata_0_to_3.json');
	assert.equal(parsed.format, 'omnivore');
	assert.equal(parsed.label, 'Omnivore export (JSON)');
	assert.equal(parsed.confidence, 'best-effort');
	assert.deepEqual(
		allLinks(parsed).map((link) => [link.url, link.title, link.createdAt]),
		[
			[
				'https://news.example/article',
				'An article',
				Date.parse('2024-03-01T09:30:00.000Z'),
			],
			[
				'https://blog.example/post',
				'Archived post',
				Date.parse('2024-04-10T18:00:00.000Z'),
			],
		],
	);
	assert.equal(parsed.invalid, 1);
});

test('a wallabag JSON export: titles and creation dates with a colonless offset', () => {
	const parsed = read('wallabag-export.json');
	assert.equal(parsed.format, 'wallabag');
	assert.equal(parsed.label, 'wallabag export (JSON)');
	assert.equal(parsed.confidence, 'best-effort');
	assert.deepEqual(
		allLinks(parsed).map((link) => [link.url, link.title, link.createdAt]),
		[
			[
				'https://press.example/story',
				'Starred article',
				Date.parse('2016-09-08T09:55:58Z'),
			],
			[
				'https://docs.example/page',
				'Read already',
				Date.parse('2016-09-09T05:00:00Z'),
			],
		],
	);
});

test('a Pinboard JSON export: the description field is the title, extended is the note', () => {
	const parsed = read('pinboard-export.json');
	assert.equal(parsed.format, 'pinboard');
	assert.equal(parsed.label, 'Pinboard export (JSON)');
	assert.equal(parsed.confidence, 'best-effort');
	assert.deepEqual(
		allLinks(parsed).map((link) => [
			link.url,
			link.title,
			link.createdAt,
			link.notes,
		]),
		[
			[
				'https://example.org/essay',
				'An essay worth keeping',
				Date.parse('2023-05-14T17:20:00Z'),
				'Quoted passage from the essay',
			],
			[
				'https://example.net/tool',
				'A handy tool',
				Date.parse('2023-06-01T08:05:00Z'),
				undefined,
			],
		],
	);
	assert.equal(parsed.invalid, 1);
});

test('the new readers leave look-alike files to the readers they belong to', () => {
	const backup = parseImportFile(
		JSON.stringify({
			format: 'tablodge-bookmarks',
			bookmarkColumns: [{id: 'c1', name: 'Work'}],
			bookmarks: [{url: 'https://a.example/', title: 'A', columnId: 'c1'}],
		}),
		'backup.json',
	);
	assert.equal(backup.format, 'backup');
	const sessionBuddy = parseImportFile(
		JSON.stringify({
			format: 'nxs.json.v2',
			collections: [
				{title: 'S', folders: [{links: [{url: 'https://b.example/'}]}]},
			],
		}),
		'sb.json',
	);
	assert.equal(sessionBuddy.format, 'session-buddy');
	const plain = parseImportFile(
		JSON.stringify([{url: 'https://c.example/', title: 'C'}]),
		'links.json',
	);
	assert.equal(plain.format, 'json-links');
});

test('a Karakeep import keeps its lists as bookmark columns', () => {
	const payload = bookmarkImportPayload(read('karakeep-export.json')) as {
		bookmarkColumns: Array<{id: string; name: string}>;
		bookmarks: Array<{url: string; columnId?: string}>;
	};
	assert.deepEqual(
		payload.bookmarkColumns.map((column) => column.name),
		['Dev', 'Reading'],
	);
	const column = (url: string) =>
		payload.bookmarkColumns.find(
			(entry) =>
				entry.id ===
				payload.bookmarks.find((bookmark) => bookmark.url === url)?.columnId,
		)?.name;
	assert.equal(column('https://read.example/post'), 'Reading');
	assert.equal(column('https://loose.example/'), 'Dev');
});

test('a Mastodon bookmarks.csv: one post address per row, no header', () => {
	const parsed = read('mastodon-bookmarks.csv');
	assert.equal(parsed.format, 'mastodon');
	assert.equal(parsed.label, 'Mastodon bookmarks (CSV)');
	assert.equal(parsed.confidence, 'best-effort');
	assert.deepEqual(
		allLinks(parsed).map((link) => link.url),
		[
			'https://mastodon.example/users/alice/statuses/113000000000000001',
			'https://other.example/users/bob/statuses/113000000000000002',
			'https://misskey.example/notes/9xk2abcd',
		],
	);
	assert.throws(
		() => parseImportFile('https://a.example/\nhttps://b.example/\n', 'x.csv'),
		/header row/,
	);
});

test('tags come along from Linkwarden, Karakeep, wallabag, and Pinboard', () => {
	const tagsOf = (name: string) =>
		Object.fromEntries(
			allLinks(read(name))
				.filter((link) => link.tags)
				.map((link) => [link.url, link.tags]),
		);
	assert.deepEqual(Object.values(tagsOf('linkwarden-backup.json')), [
		['longread'],
	]);
	assert.deepEqual(tagsOf('karakeep-export.json'), {
		'https://dev.example/guide': ['dev'],
	});
	assert.deepEqual(Object.values(tagsOf('wallabag-export.json')), [
		['news', 'press'],
	]);
	assert.deepEqual(tagsOf('pinboard-export.json'), {
		'https://example.org/essay': ['essays', 'reading'],
	});
	const payload = bookmarkImportPayload(read('pinboard-export.json')) as {
		bookmarks: Array<{url: string; tags?: string[]}>;
	};
	assert.deepEqual(
		payload.bookmarks.find((entry) => entry.url === 'https://example.org/essay')
			?.tags,
		['essays', 'reading'],
	);
});
