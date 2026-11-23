import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {test} from 'vite-plus/test';
import {
	COPY_ERRORS,
	COPY_INDEX_KEY,
	COPY_MAX_CHARS,
	copyLinkUrls,
	copySize,
	createCopyStore,
	parsePageCopy,
	type CopyStorage,
	type PageCopy,
} from '../src/shared/page-copy';
import {extractPageCopy} from '../src/shared/page-extract';
import type {TrashEntry} from '../src/shared/trash';

const fixture = (name: string) =>
	readFileSync(new URL(`fixtures/page-copy/${name}`, import.meta.url), 'utf8');
const parse = (html: string) => parseHTML(html).document;

test('an article keeps its headings, paragraphs, items, quote, and code as text', () => {
	const copy = extractPageCopy(
		parse(fixture('article.html')),
		'https://notes.example/links',
		1000,
	);
	assert.equal(copy.title, 'Why links rot | Field Notes');
	assert.equal(copy.url, 'https://notes.example/links');
	assert.equal(copy.savedAt, 1000);
	const kinds = new Set(copy.blocks.map((block) => block.type));
	assert.ok(kinds.has('heading'));
	assert.ok(kinds.has('quote'));
	assert.ok(kinds.has('code'));
	assert.deepEqual(
		copy.blocks
			.filter((block) => block.type === 'item')
			.map((block) => block.text),
		[
			'Keep a copy of the text you care about.',
			'Check the Internet Archive for older captures.',
			'Search by the exact address.',
		],
	);
	assert.deepEqual(
		copy.blocks.find((block) => block.type === 'heading'),
		{type: 'heading', text: 'What you can do'},
	);
	assert.equal(
		copy.blocks.find((block) => block.type === 'code')?.text,
		'curl -I https://example.com/old-page\nHTTP/1.1 404 Not Found',
	);
	assert.ok(
		copy.blocks.some(
			(block) =>
				block.text ===
				'None of this needs an account, and none of it needs the page to still exist once the copy is made.\nKeep the copies close.',
		),
		'a line break inside a paragraph stays',
	);
});

test('script, style, and noscript content never reaches a copy', () => {
	for (const name of ['article.html', 'listing.html']) {
		const text = JSON.stringify(
			extractPageCopy(parse(fixture(name)), 'https://a.example/').blocks,
		);
		for (const marker of [
			'SCRIPT_HEAD_TEXT',
			'SCRIPT_BODY_TEXT',
			'SCRIPT_LISTING_TEXT',
			'STYLE_RULE_TEXT',
			'STYLE_CONTENT_TEXT',
			'NOSCRIPT_TEXT',
			'color: red',
		]) {
			assert.ok(!text.includes(marker), `${name} leaked ${marker}`);
		}
	}
});

test('article navigation, sidebars, and footers are left out', () => {
	const text = JSON.stringify(
		extractPageCopy(parse(fixture('article.html')), 'https://a.example/'),
	);
	assert.ok(!text.includes('Subscribe'));
	assert.ok(!text.includes('All rights reserved'));
	assert.ok(!text.includes('Ten tips'));
});

test('blocks are plain text, so markup in the page stays text', () => {
	const copy = extractPageCopy(
		parse(
			'<html><head><title>T</title></head><body><article><p>Use &lt;img src=x onerror=alert(1)&gt; carefully, and the &amp; sign too, in a paragraph long enough to count as an article for the reader.</p></article></body></html>',
		),
		'https://a.example/',
	);
	assert.equal(
		copy.blocks[0]?.text,
		'Use <img src=x onerror=alert(1)> carefully, and the & sign too, in a paragraph long enough to count as an article for the reader.',
	);
});

test('an empty page gives a copy with no blocks', () => {
	const copy = extractPageCopy(
		parse(
			'<html><head><title>Blank</title></head><body><script>x()</script></body></html>',
		),
		'https://a.example/',
	);
	assert.deepEqual(copy.blocks, []);
	assert.equal(copy.title, 'Blank');
});

test('a stored copy is checked field by field', () => {
	const good: PageCopy = {
		v: 1,
		url: 'https://a.example/',
		title: 'A',
		savedAt: 5,
		blocks: [{type: 'paragraph', text: 'Hello'}],
	};
	assert.deepEqual(parsePageCopy(good), good);
	assert.deepEqual(
		parsePageCopy({
			...good,
			blocks: [
				{type: 'script', text: 'alert(1)'},
				{type: 'paragraph', text: ' '.repeat(3)},
				{type: 'heading', text: 'Kept'},
			],
		})?.blocks,
		[{type: 'heading', text: 'Kept'}],
	);
	assert.equal(parsePageCopy({...good, url: 'javascript:alert(1)'}), undefined);
	assert.equal(parsePageCopy({...good, v: 2}), undefined);
	assert.equal(parsePageCopy({...good, blocks: 'x'}), undefined);
});

function memoryStorage() {
	const data = new Map<string, unknown>();
	const storage: CopyStorage = {
		async get(keys) {
			return Object.fromEntries(
				keys.filter((key) => data.has(key)).map((key) => [key, data.get(key)]),
			);
		},
		async set(items) {
			for (const [key, value] of Object.entries(items)) {
				data.set(key, structuredClone(value));
			}
		},
		async remove(keys) {
			for (const key of keys) {
				data.delete(key);
			}
		},
	};
	return {data, storage};
}

const copyOf = (url: string, text = 'Some text'): PageCopy => ({
	v: 1,
	url,
	title: url,
	savedAt: 1,
	blocks: [{type: 'paragraph', text}],
});

test('keeping a copy again replaces the older one for that address', async () => {
	const copies = createCopyStore(memoryStorage().storage);
	assert.equal(
		(await copies.keep(copyOf('https://a.example/', 'old'))).ok,
		true,
	);
	assert.equal(
		(await copies.keep(copyOf('https://a.example/', 'new'))).ok,
		true,
	);
	assert.equal((await copies.list()).length, 1);
	assert.equal(
		(await copies.read('https://a.example/'))?.blocks[0]?.text,
		'new',
	);
});

test('a copy over the text cap and an empty copy are refused with a message', async () => {
	const copies = createCopyStore(memoryStorage().storage);
	assert.deepEqual(
		await copies.keep({
			...copyOf('https://a.example/'),
			blocks: [{type: 'paragraph', text: 'x'.repeat(COPY_MAX_CHARS + 1)}],
		}),
		{ok: false, reason: 'too-large', error: COPY_ERRORS['too-large']},
	);
	assert.deepEqual(
		await copies.keep({...copyOf('https://a.example/'), blocks: []}),
		{ok: false, reason: 'empty', error: COPY_ERRORS.empty},
	);
	assert.deepEqual(await copies.list(), []);
});

test('the device budget refuses a copy that would not fit, and a replacement counts only the difference', async () => {
	const one = copyOf('https://a.example/', 'a'.repeat(400));
	const budget = copySize(one) * 2 + 10;
	const copies = createCopyStore(memoryStorage().storage, budget);
	assert.equal((await copies.keep(one)).ok, true);
	assert.equal(
		(await copies.keep(copyOf('https://b.example/', 'b'.repeat(400)))).ok,
		true,
	);
	const full = await copies.keep(copyOf('https://c.example/', 'c'.repeat(400)));
	assert.deepEqual(full, {ok: false, reason: 'full', error: COPY_ERRORS.full});
	assert.match(COPY_ERRORS.full, /Copies are full/);
	assert.equal(
		(await copies.keep(copyOf('https://a.example/', 'z'.repeat(400)))).ok,
		true,
	);
	assert.deepEqual(await copies.usage(), {
		count: 2,
		size: copySize(one) * 2,
		budget,
	});
	assert.equal(await copies.remove('https://b.example/'), true);
	assert.equal(
		(await copies.keep(copyOf('https://c.example/', 'c'.repeat(400)))).ok,
		true,
	);
});

const session = (urls: string[]) => ({
	id: 's',
	tabs: urls.map((url, index) => ({id: `t${index}`, url})),
});

test('a copy lives while its address is in the library or the trash, and the sweep drops the rest', async () => {
	const copies = createCopyStore(memoryStorage().storage);
	for (const url of [
		'https://saved-tab.example/',
		'https://bookmark.example/',
		'https://trashed-bookmark.example/',
		'https://trashed-session.example/',
		'https://trashed-tab.example/',
		'https://deleted.example/',
	]) {
		await copies.keep(copyOf(url));
	}

	const trash = [
		{
			kind: 'bookmark',
			data: {bookmark: {url: 'https://trashed-bookmark.example/'}},
		},
		{
			kind: 'session',
			data: {session: session(['https://trashed-session.example/'])},
		},
		{
			kind: 'tabs',
			data: {items: [{tab: {url: 'https://trashed-tab.example/'}}]},
		},
	] as unknown as TrashEntry[];
	const live = copyLinkUrls(
		{
			groups: [session(['https://saved-tab.example/'])],
			bookmarks: [{url: 'https://bookmark.example/'}],
		} as unknown as Parameters<typeof copyLinkUrls>[0],
		trash,
	);
	assert.equal(await copies.sweep(live), 1);
	assert.equal(await copies.read('https://deleted.example/'), undefined);
	assert.equal((await copies.list()).length, 5);

	const afterPurge = copyLinkUrls(
		{
			groups: [session(['https://saved-tab.example/'])],
			bookmarks: [{url: 'https://bookmark.example/'}],
		} as unknown as Parameters<typeof copyLinkUrls>[0],
		[],
	);
	assert.equal(await copies.sweep(afterPurge), 3);
	assert.deepEqual((await copies.list()).map((entry) => entry.url).toSorted(), [
		'https://bookmark.example/',
		'https://saved-tab.example/',
	]);
});

test('a backup carries every copy and a restore checks them and keeps the caps', async () => {
	const source = createCopyStore(memoryStorage().storage);
	await source.keep(copyOf('https://a.example/'));
	await source.keep(copyOf('https://b.example/'));
	const backup = await source.all();
	assert.equal(backup.length, 2);

	const target = createCopyStore(
		memoryStorage().storage,
		copySize(copyOf('https://a.example/')) + 5,
	);
	assert.equal(
		await target.restore([...backup, {v: 1, url: 'nope', blocks: []}, 'junk']),
		1,
	);
	assert.deepEqual(
		(await target.list()).map((entry) => entry.url),
		['https://a.example/'],
	);
});

test('a damaged index reads as no copies rather than failing', async () => {
	const {storage} = memoryStorage();
	await storage.set({[COPY_INDEX_KEY]: {items: [{url: 1}, 'x', null]}});
	assert.deepEqual(await createCopyStore(storage).list(), []);
});
