import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {displayUrl} from '../src/app/url-display';

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
