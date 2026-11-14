import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	cleanPageTitle,
	linkSettings,
	linkToOpen,
	rowText,
} from '../mobile/src/links';

const defaults = linkSettings({});

describe('link settings', () => {
	test('fall back to the extension defaults and take what the library sets', () => {
		assert.equal(defaults.cleanTitles, true);
		assert.equal(defaults.removeTrackingParameters, false);
		assert.equal(
			linkSettings({urlDisplayMode: 'domain'}).urlDisplayMode,
			'domain',
		);
	});
});

describe('titles and links', () => {
	test('drops a leading notification counter only when asked', () => {
		assert.equal(cleanPageTitle('(3) Inbox', true), 'Inbox');
		assert.equal(cleanPageTitle('(3) Inbox', false), '(3) Inbox');
		assert.equal(cleanPageTitle('(3)', true), '(3)');
	});

	test('removes tracking parameters only when the setting is on', () => {
		const url = 'https://example.com/a?id=7&utm_source=x&fbclid=y';
		assert.equal(linkToOpen(url, defaults), url);
		const cleaned = linkToOpen(url, {
			...defaults,
			removeTrackingParameters: true,
		});
		assert.equal(new URL(cleaned).searchParams.get('fbclid'), null);
		assert.equal(new URL(cleaned).searchParams.get('id'), '7');
	});
});

describe('row text', () => {
	const bookmark = {
		title: 'A page',
		url: 'http://www.example.com/path/', // eslint-disable-line unicorn/prefer-https -- needs an insecure link
	};

	test('shows the simplified address, the domain, the address alone, or nothing', () => {
		assert.deepEqual(rowText(bookmark, defaults), {
			main: 'A page',
			sub: 'example.com/path/',
			insecure: true,
		});
		assert.equal(
			rowText(bookmark, {...defaults, urlDisplayMode: 'domain'}).sub,
			'example.com',
		);
		const only = rowText(bookmark, {...defaults, urlDisplayMode: 'url-only'});
		assert.equal(only.main, 'example.com/path/');
		assert.equal(only.sub, undefined);
		assert.equal(
			rowText(bookmark, {...defaults, urlDisplayMode: 'none'}).sub,
			undefined,
		);
	});

	test('marks insecure links only when the setting allows it', () => {
		assert.equal(
			rowText(bookmark, {...defaults, markInsecureLinks: false}).insecure,
			false,
		);
		assert.equal(
			rowText({title: 't', url: 'https://example.com'}, defaults).insecure,
			false,
		);
	});
});
