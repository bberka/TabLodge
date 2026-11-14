import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {savedUrlSet} from '../src/app/saved-urls';
import type {Bookmark, Session} from '../src/app/types';

test('savedUrlSet collects bookmark and session tab URLs with exact matching', () => {
	const urls = savedUrlSet(
		[{url: 'https://a.test/'}] as Bookmark[],
		[{tabs: [{url: 'https://b.test/x'}]}] as Session[],
	);
	assert.equal(urls.has('https://a.test/'), true);
	assert.equal(urls.has('https://b.test/x'), true);
	assert.equal(urls.has('https://b.test/'), false);
});
