import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {columnForUrl} from '../src/app/column-sites';
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
