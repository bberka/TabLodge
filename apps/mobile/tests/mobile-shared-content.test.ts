import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {cacheCopies, readShare} from '../src/library/shared-content';

const cache = 'file:///data/user/0/com.bberka.tablodge/cache/';

describe('readShare', () => {
	test('a browser share becomes a link with the words around it as the title', () => {
		assert.deepEqual(readShare({text: 'A cat https://cdn.example/cat.jpg'}), {
			kind: 'link',
			text: 'https://cdn.example/cat.jpg',
			title: 'A cat',
			urls: ['https://cdn.example/cat.jpg'],
		});
	});

	test('a shared image file is refused', () => {
		assert.deepEqual(
			readShare({text: null, files: [{path: `${cache}IMG_1.jpg`}]}),
			{kind: 'files'},
		);
		assert.deepEqual(
			readShare({text: 'Look at this', files: [{path: `${cache}IMG_1.jpg`}]}),
			{kind: 'files'},
			'words without a link do not make a link',
		);
	});

	test('a link that comes with a file is still saved', () => {
		const outcome = readShare({
			text: 'https://photos.example/p/1',
			files: [{path: `${cache}IMG_1.jpg`}],
		});
		assert.equal(outcome.kind, 'link');
	});
});

describe('cacheCopies', () => {
	test('lists only copies inside the cache folder', () => {
		assert.deepEqual(
			cacheCopies(
				{
					files: [
						{path: `${cache}IMG_1.jpg`},
						{path: 'content://media/external/images/1'},
						{path: `${cache}../files/library.db`},
						{path: null},
					],
				},
				cache,
			),
			[`${cache}IMG_1.jpg`],
		);
		assert.deepEqual(cacheCopies({text: 'x'}, cache), []);
	});
});
