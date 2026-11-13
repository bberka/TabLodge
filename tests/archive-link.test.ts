import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {archiveUrl} from '../src/app/archive-link';

describe('archiveUrl', () => {
	test('points at the newest capture of a web page', () => {
		assert.equal(
			archiveUrl('https://example.com/a/b?id=7#top'),
			'https://web.archive.org/web/https://example.com/a/b?id=7#top',
		);
		assert.equal(
			// eslint-disable-next-line unicorn/prefer-https -- an insecure link must be kept as it is
			archiveUrl('http://example.com'),
			'https://web.archive.org/web/http://example.com/',
		);
	});

	test('drops tracking parameters first only when asked', () => {
		const link = 'https://example.com/a?id=7&utm_source=x&fbclid=y';
		assert.match(archiveUrl(link) ?? '', /fbclid=y/);
		const cleaned = archiveUrl(link, true) ?? '';
		assert.doesNotMatch(cleaned, /fbclid|utm_source/);
		assert.match(cleaned, /id=7/);
	});

	test('has nothing to open for an address that is not a web page', () => {
		for (const link of [
			'',
			'chrome://extensions',
			'javascript:alert(1)',
			'about:blank',
			'file:///tmp/a',
			'not a url',
		]) {
			assert.equal(archiveUrl(link), null, link);
		}
	});
});
