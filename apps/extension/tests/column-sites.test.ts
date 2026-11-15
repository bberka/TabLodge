import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {checkColumnSite, columnForUrl} from '../src/shared/column-sites';
import type {BookmarkColumn} from '../src/shared/types';

const column = (id: string, domains: string[]): BookmarkColumn => ({
	id,
	name: id,
	domains,
	createdAt: 0,
	isDefault: false,
});

test('a site entry covers its subdomains, a path entry covers that path and below, and the longest match wins', () => {
	const columns = [
		column('host', ['github.com']),
		column('path', ['github.com/bberka']),
		column('docs', ['docs.github.com']),
	];
	const idFor = (url: string) => columnForUrl(columns, url)?.id;
	assert.equal(idFor('https://github.com/other'), 'host');
	assert.equal(idFor('https://www.github.com/other'), 'host');
	assert.equal(idFor('https://gist.github.com/x'), 'host');
	assert.equal(idFor('https://github.com/bberka'), 'path');
	assert.equal(idFor('https://github.com/bberka/asdadsads'), 'path');
	assert.equal(idFor('https://github.com/bberkaa/x'), 'host');
	assert.equal(idFor('https://docs.github.com/x'), 'docs');
	assert.equal(idFor('https://notgithub.com/x'), undefined);
	assert.equal(idFor('not a url'), undefined);
});

test('a typed site is normalized, and an unusable, repeated, or surplus one is refused', () => {
	assert.deepEqual(
		checkColumnSite([], ' https://www.GitHub.com/bberka/?tab=x#y '),
		{
			site: 'github.com/bberka',
		},
	);
	assert.deepEqual(checkColumnSite([], '*.news.example'), {
		site: 'news.example',
	});
	assert.match(
		(checkColumnSite([], 'nope') as {error: string}).error,
		/Enter a website/,
	);
	assert.match(
		(checkColumnSite([], '  ') as {error: string}).error,
		/Enter a website/,
	);
	assert.match(
		(checkColumnSite(['github.com'], 'GitHub.com/') as {error: string}).error,
		/github\.com is already in this column/,
	);
	const full = Array.from({length: 50}, (_, index) => `site${index}.example`);
	assert.match(
		(checkColumnSite(full, 'one-more.example') as {error: string}).error,
		/at most 50/,
	);
	assert.deepEqual(checkColumnSite(full.slice(1), 'one-more.example'), {
		site: 'one-more.example',
	});
});
