import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {parseColumnRoute, parseTileRoute} from '../src/platform/app-route';

describe('Quick Settings tile addresses', () => {
	test('reads the two tiles', () => {
		assert.equal(parseTileRoute('tablodge://save'), 'save');
		assert.equal(parseTileRoute('tablodge://search'), 'search');
	});

	test('allows a trailing slash, an empty host, a query, and any case', () => {
		assert.equal(parseTileRoute('tablodge://save/'), 'save');
		assert.equal(parseTileRoute('tablodge:///search'), 'search');
		assert.equal(parseTileRoute('tablodge://search?from=tile'), 'search');
		assert.equal(parseTileRoute('TabLodge://SAVE'), 'save');
	});

	test('ignores anything that is not a tile address', () => {
		for (const url of [
			undefined,
			null,
			'',
			'tablodge://',
			'tablodge://private',
			'tablodge://save/more',
			'tablodge://expo-development-client/?url=x',
			'https://save',
			'other://save',
			'tablodge:save',
		]) {
			assert.equal(parseTileRoute(url), undefined, String(url));
		}
	});
});

describe('the Bookmarks widget header address', () => {
	test('gives the column id, decoded', () => {
		assert.equal(parseColumnRoute('tablodge://column/reading'), 'reading');
		assert.equal(
			parseColumnRoute(`tablodge://column/${encodeURIComponent('a b/ç?')}`),
			'a b/ç?',
		);
		assert.equal(parseColumnRoute('tablodge://column/x1/'), 'x1');
	});

	test('ignores other addresses and a broken id', () => {
		for (const url of [
			undefined,
			'tablodge://column/',
			'tablodge://column',
			'tablodge://save',
			'tablodge://column/a/b',
			'https://column/reading',
			'tablodge://column/%E0%A4%A',
		]) {
			assert.equal(parseColumnRoute(url), undefined, String(url));
		}
	});

	test('is not taken for a tile address, and a tile address is not taken for it', () => {
		assert.equal(parseTileRoute('tablodge://column/reading'), undefined);
		assert.equal(parseColumnRoute('tablodge://search'), undefined);
	});
});
