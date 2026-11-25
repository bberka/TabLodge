import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {CHIP_EDGE_GAP, chipScrollX} from '../src/ui/chip-scroll';

const ROW = 400;

describe('the sideways chip row keeps the selected chip in sight', () => {
	test('a chip inside the row leaves the row at its start', () => {
		assert.equal(chipScrollX({x: 0, width: 120}, ROW), 0);
		assert.equal(chipScrollX({x: 150, width: 120}, ROW), 0);
		assert.equal(chipScrollX({x: 280, width: 120}, ROW), 0);
	});

	test('a chip past the row scrolls in, with a gap before its left edge', () => {
		assert.equal(chipScrollX({x: 900, width: 120}, ROW), 900 - CHIP_EDGE_GAP);
		assert.equal(
			chipScrollX({x: ROW + 4, width: 120}, ROW),
			ROW + 4 - CHIP_EDGE_GAP,
		);
	});

	test('a chip cut by the right edge is brought into the row', () => {
		assert.equal(chipScrollX({x: 340, width: 200}, ROW), 340 - CHIP_EDGE_GAP);
	});

	test('a row that has not been measured yet, or a chip wider than it, stays at the start', () => {
		assert.equal(chipScrollX({x: 900, width: 120}, 0), 0);
		assert.equal(chipScrollX({x: 5, width: 500}, ROW), 0);
	});
});
