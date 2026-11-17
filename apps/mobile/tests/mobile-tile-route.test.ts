import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {parseTileRoute} from '../src/platform/tile-route';

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
