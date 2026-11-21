import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	layoutSheet,
	MAX_EDGE,
	type Size,
	type Tile,
} from '../scripts/proof-sheet.ts';

const requiredSet: Size[] = [
	{width: 1320, height: 2868},
	{width: 1320, height: 2868},
	{width: 768, height: 1024},
	{width: 768, height: 1024},
	{width: 1440, height: 900},
	{width: 1440, height: 900},
	{width: 1920, height: 1080},
	{width: 1920, height: 1080},
];

function overlaps(a: Tile, b: Tile) {
	return (
		a.x < b.x + b.width &&
		b.x < a.x + a.width &&
		a.y < b.y + b.height &&
		b.y < a.y + a.height
	);
}

for (const sizes of [requiredSet, [...requiredSet, ...requiredSet]]) {
	test(`${sizes.length} mixed screenshots fit in ${MAX_EDGE} px without overlapping or stretching`, () => {
		const sheet = layoutSheet(sizes);
		assert.ok(Math.max(sheet.width, sheet.height) <= MAX_EDGE);
		for (const [index, tile] of sheet.tiles.entries()) {
			assert.ok(tile.x + tile.width <= sheet.width);
			assert.ok(tile.y + tile.height <= sheet.height);
			const {width, height} = sizes[index];
			assert.ok(Math.abs(tile.width - (tile.height * width) / height) <= 1);
			for (const other of sheet.tiles.slice(index + 1)) {
				assert.ok(!overlaps(tile, other));
			}
		}
	});
}

test('small screenshots keep their size', () => {
	const sheet = layoutSheet([
		{width: 400, height: 300},
		{width: 400, height: 300},
	]);
	assert.deepEqual(
		sheet.tiles.map(({width, height}) => [width, height]),
		[
			[400, 300],
			[400, 300],
		],
	);
});
