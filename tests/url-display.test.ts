import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {displayUrl, isInsecureLink} from '../src/app/url-display';

test('displayUrl drops https://, www. and a lone trailing slash', () => {
	assert.equal(displayUrl('https://www.icloud.com/mail'), 'icloud.com/mail');
	assert.equal(displayUrl('https://github.com/'), 'github.com');
	assert.equal(displayUrl('https://github.com'), 'github.com');
	assert.equal(displayUrl('https://www.a.com/x/'), 'a.com/x/');
	assert.equal(displayUrl('https://a.com/?q=1'), 'a.com?q=1');
	assert.equal(displayUrl('https://a.com/#top'), 'a.com#top');
});

test('displayUrl keeps http:// and shows the exact address when simplifying is off', () => {
	const insecure = ['http', '//www.a.com/'].join(':');
	assert.equal(displayUrl(insecure), insecure);
	assert.equal(
		displayUrl('https://www.icloud.com/mail', false),
		'https://www.icloud.com/mail',
	);
});

const http = (rest: string) => ['http', rest].join('://');

test('isInsecureLink marks http links to public hosts only', () => {
	assert.equal(isInsecureLink(http('example.com/a')), true);
	assert.equal(isInsecureLink(http('EXAMPLE.com:8080/')), true);
	assert.equal(isInsecureLink('https://example.com/'), false);
	assert.equal(isInsecureLink('not a url'), false);
	assert.equal(isInsecureLink('ftp://example.com/'), false);
});

test('isInsecureLink trusts local addresses unless asked to mark them', () => {
	const local = [
		'localhost:3000',
		'LOCALHOST',
		'app.localhost',
		'localhost.',
		'127.0.0.1',
		'127.8.9.10:80',
		'0.0.0.0',
		'[::1]:8080',
		'10.1.2.3',
		'192.168.1.20',
		'172.16.0.1',
		'172.31.255.1',
		'printer.local',
		'Printer.LOCAL.',
	];
	for (const host of local) {
		assert.equal(isInsecureLink(http(host)), false, host);
		assert.equal(isInsecureLink(http(host), {markLocal: true}), true, host);
	}

	for (const host of [
		'172.15.0.1',
		'172.32.0.1',
		'192.169.1.1',
		'11.0.0.1',
		'localhost.example.com',
		'notlocal',
		'[2001:db8::1]',
	]) {
		assert.equal(isInsecureLink(http(host)), true, host);
	}
});
