import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {ImportFormatError} from '../src/shared/import-formats';
import {importFromLink} from '../src/shared/import-link';
import {shareHtmlPage} from '../src/shared/share-formats';
import {isSharedPageUrl} from '../src/shared/sync/shared-pages';

const PAGE_URL = 'https://sync.example.test/p/AAAAAAAAAAAAAAAAAAAAAA';
const page = shareHtmlPage(
	'Trip',
	[
		{name: 'Day one', tabs: [{title: 'Map', url: 'https://maps.example/'}]},
		{
			name: 'Day two',
			tabs: [{title: 'Museum', url: 'https://museum.example/'}],
		},
	],
	'TabLodge',
	{kind: 'sessions', url: PAGE_URL},
);

test('a shared page read from its link comes back as its sessions, fetched without credentials', async () => {
	const calls: Array<[string, RequestInit | undefined]> = [];
	const parsed = await importFromLink(async (url, init) => {
		calls.push([url, init]);
		return new Response(page, {headers: {'Content-Type': 'text/html'}});
	}, ` ${PAGE_URL} `);

	assert.equal(calls.length, 1);
	assert.equal(calls[0][0], PAGE_URL);
	assert.equal(calls[0][1]?.credentials, 'omit');
	assert.equal(parsed.kind, 'sessions');
	assert.deepEqual(
		parsed.sessions.map((group) => group.name),
		['Day one', 'Day two'],
	);
});

test('a link that cannot be read says why and imports nothing', async () => {
	const fails = async (
		address: string,
		send: Parameters<typeof importFromLink>[0],
		message: RegExp,
	) =>
		assert.rejects(
			importFromLink(send, address),
			(error) =>
				error instanceof ImportFormatError && message.test(error.message),
		);
	const unused = async () => {
		throw new Error('fetched');
	};

	await fails('not a link', unused, /starts with https:\/\/ or http:\/\//);
	await fails('javascript:alert(1)', unused, /starts with https:\/\//);
	await fails(
		PAGE_URL,
		async () => {
			throw new TypeError('Failed to fetch');
		},
		/Could not read that link/,
	);
	await fails(
		PAGE_URL,
		async () => new Response('Not found', {status: 404}),
		/Nothing is at that link/,
	);
	await fails(
		PAGE_URL,
		async () => new Response('', {status: 503}),
		/error \(503\)/,
	);
	await fails(
		PAGE_URL,
		async () => new Response('<p>No links here</p>'),
		/has no links/,
	);
});

test('a body is cut off at the import size cap even without Content-Length, and a broken body is an error', async () => {
	const chunk = new Uint8Array(1024 * 1024).fill(97);
	let sent = 0;
	let cancelled = false;
	const endless = new ReadableStream<Uint8Array>({
		pull(controller) {
			sent += 1;
			controller.enqueue(chunk);
		},
		cancel() {
			cancelled = true;
		},
	});
	await assert.rejects(
		importFromLink(async () => new Response(endless), PAGE_URL),
		/larger than 45 MB/,
	);
	assert.ok(cancelled);
	assert.ok(sent < 50, `${sent} chunks read`);

	const broken = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.error(new TypeError('network'));
		},
	});
	await assert.rejects(
		importFromLink(async () => new Response(broken), PAGE_URL),
		/stopped loading before it finished/,
	);
});

test('a response turned away for its declared size is aborted, not left downloading', async () => {
	let signal: AbortSignal | undefined;
	const open = new ReadableStream<Uint8Array>();
	await assert.rejects(
		importFromLink(async (_url, init) => {
			signal = init?.signal ?? undefined;
			return new Response(open, {
				headers: {'Content-Length': String(46 * 1024 * 1024)},
			});
		}, PAGE_URL),
		/larger than 45 MB/,
	);
	assert.equal(signal?.aborted, true);
});

test('without a body stream the cap counts UTF-8 bytes, not characters', async () => {
	const wide = '界'.repeat(16 * 1024 * 1024);
	const noStream = {
		ok: true,
		status: 200,
		headers: new Headers(),
		body: null,
		text: async () => wide,
	} as unknown as Response;
	await assert.rejects(
		importFromLink(async () => noStream, PAGE_URL),
		/larger than 45 MB/,
	);
});

test('only an address ending in /p/ and a 22 character id looks like a shared page', () => {
	assert.ok(isSharedPageUrl(PAGE_URL));
	assert.ok(
		isSharedPageUrl('http://192.168.1.5:8787/p/abcdefghij-_KLMNOPQRS0'),
	);
	assert.ok(
		isSharedPageUrl('https://example.test/sync/p/AAAAAAAAAAAAAAAAAAAAAA'),
	);
	for (const address of [
		undefined,
		'',
		'https://sync.example.test/p/short',
		'https://sync.example.test/p/AAAAAAAAAAAAAAAAAAAAAA/more',
		'https://www.instagram.com/p/AAAAAAAAAAA/',
		'ftp://sync.example.test/p/AAAAAAAAAAAAAAAAAAAAAA',
		'chrome-extension://abc/p/AAAAAAAAAAAAAAAAAAAAAA',
	]) {
		assert.equal(isSharedPageUrl(address), false, String(address));
	}
});
