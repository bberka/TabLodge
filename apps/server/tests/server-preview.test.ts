import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {createApi} from '../src/api';
import {
	allowedUrl,
	fetchIcon,
	fetchPreview,
	isPrivateAddress,
	readPageMeta,
} from '../src/preview';
import {sqlite} from '../src/node-sqlite';
import {SqlChangeLog} from '../src/sql-change-log';

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function site(
	pages: Record<
		string,
		{
			type: string;
			body: string | Uint8Array;
			status?: number;
			location?: string;
		}
	>,
) {
	const asked: string[] = [];
	const fake = (async (input: URL | string) => {
		const url = String(input);
		asked.push(url);
		const page = pages[url];
		if (!page) {
			return new Response('', {status: 404});
		}

		return new Response(page.body as BodyInit, {
			status: page.status ?? 200,
			headers: {
				'content-type': page.type,
				...(page.location && {location: page.location}),
			},
		});
	}) as typeof fetch;
	return {fake, asked};
}

test('addresses on a private network are refused', () => {
	for (const address of [
		'127.0.0.1',
		'10.1.2.3',
		'172.16.0.1',
		'192.168.1.1',
		'169.254.169.254',
		'100.64.0.1',
		'::1',
		'fd00::1',
		'fe80::1',
		'::ffff:10.0.0.1',
	]) {
		assert.equal(isPrivateAddress(address), true, address);
	}

	for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) {
		assert.equal(isPrivateAddress(address), false, address);
	}
});

test('only plain public web addresses may be fetched', async () => {
	for (const text of [
		'file:///etc/passwd',
		'ftp://example.com/',
		'http://localhost/',
		'http://127.0.0.1/',
		'http://[::1]/',
		'https://nas.local/',
		'http://intranet/',
		'https://user:pass@example.com/',
		'not a url',
	]) {
		assert.equal(await allowedUrl(text), undefined, text);
	}

	assert.ok(await allowedUrl('https://example.com/a'));
	const resolve = async () => ['10.0.0.5'];
	assert.equal(
		await allowedUrl('https://rebind.example.com/', {resolve}),
		undefined,
	);
});

test('a page head gives its title, description, image and icon', () => {
	const meta = readPageMeta(
		`<head><title>Plain</title><meta property="og:title" content="Fancy &amp; fine">
		<meta name="description" content="Words"><meta property="og:image" content="/card.png">
		<link rel="shortcut icon" href="/f.ico"><link rel="apple-touch-icon" href="/a.png"></head><body>x`,
		new URL('https://example.com/post/1'),
	);
	assert.deepEqual(meta, {
		title: 'Fancy & fine',
		description: 'Words',
		image: 'https://example.com/card.png',
		icon: 'https://example.com/f.ico',
	});
});

test('a preview carries the share image inline', async () => {
	const {fake} = site({
		'https://example.com/post': {
			type: 'text/html',
			body: '<head><title>Post</title><meta property="og:image" content="/c.png"></head>',
		},
		'https://example.com/c.png': {type: 'image/png', body: PNG},
	});
	const preview = await fetchPreview('https://example.com/post', {fetch: fake});
	assert.equal(preview?.title, 'Post');
	assert.match(preview?.image ?? '', /^data:image\/png;base64,/);
});

test('a redirect into a private network is not followed', async () => {
	const {fake, asked} = site({
		'https://example.com/go': {
			type: 'text/html',
			body: '',
			status: 302,
			location: 'http://169.254.169.254/latest/meta-data',
		},
	});
	assert.equal(
		await fetchPreview('https://example.com/go', {fetch: fake}),
		undefined,
	);
	assert.deepEqual(asked, ['https://example.com/go']);
});

test('an icon comes from the linked file, else from /favicon.ico', async () => {
	const linked = site({
		'https://example.com/': {
			type: 'text/html',
			body: '<head><link rel="icon" href="/i.png"></head>',
		},
		'https://example.com/i.png': {type: 'image/png', body: PNG},
	});
	assert.equal(
		(await fetchIcon('example.com', {fetch: linked.fake}))?.type,
		'image/png',
	);

	const plain = site({
		'https://example.com/': {type: 'text/html', body: '<head></head>'},
		'https://example.com/favicon.ico': {type: 'image/x-icon', body: PNG},
	});
	assert.equal(
		(await fetchIcon('example.com', {fetch: plain.fake}))?.type,
		'image/x-icon',
	);

	const none = site({});
	assert.equal(await fetchIcon('example.com', {fetch: none.fake}), undefined);
});

test('the icon and preview routes need the token and answer from the site', async () => {
	const {fake} = site({
		'https://example.com/': {type: 'text/html', body: '<head></head>'},
		'https://example.com/favicon.ico': {type: 'image/x-icon', body: PNG},
		'https://example.com/post': {
			type: 'text/html',
			body: '<head><title>Hi</title></head>',
		},
	});
	const token = 'test-token-0123456789-abcdefghijklmnop';
	const app = createApi({
		token,
		log: () => new SqlChangeLog(sqlite(':memory:')),
		preview: {fetch: fake},
	});
	const auth = {Authorization: `Bearer ${token}`};
	assert.equal((await app.request('/v1/icon?host=example.com')).status, 401);
	const icon = await app.request('/v1/icon?host=example.com', {headers: auth});
	assert.equal(icon.status, 200);
	assert.equal(icon.headers.get('content-type'), 'image/x-icon');
	assert.equal(
		(await app.request('/v1/icon?host=localhost', {headers: auth})).status,
		404,
	);
	assert.equal(
		(await app.request('/v1/icon?host=a%2Fb', {headers: auth})).status,
		400,
	);
	const page = await app.request(
		'/v1/preview?url=https%3A%2F%2Fexample.com%2Fpost',
		{headers: auth},
	);
	assert.deepEqual(await page.json(), {title: 'Hi'});
	assert.equal(
		(
			await app.request('/v1/preview?url=http%3A%2F%2F127.0.0.1%2F', {
				headers: auth,
			})
		).status,
		404,
	);
});
