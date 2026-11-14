import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {hexToHsl, hslToHex} from '../src/shared/color-math';

test('hue, saturation and lightness make the right hex', () => {
	assert.equal(hslToHex(0, 1, 0.5), '#ff0000');
	assert.equal(hslToHex(120, 1, 0.5), '#00ff00');
	assert.equal(hslToHex(240, 1, 0.5), '#0000ff');
	assert.equal(hslToHex(0, 0, 1), '#ffffff');
	assert.equal(hslToHex(360, 1, 0.5), '#ff0000');
});

test('a hex reads back as the hue, saturation and lightness it was made from', () => {
	for (const [h, s, l] of [
		[200, 0.7, 0.4],
		[310, 0.7, 0.6],
		[45, 0.7, 0.3],
	] as const) {
		const [hue, saturation, lightness] = hexToHsl(hslToHex(h, s, l));
		assert.ok(Math.abs(hue - h) < 1.5, `hue ${hue} vs ${h}`);
		assert.ok(Math.abs(saturation - s) < 0.02);
		assert.ok(Math.abs(lightness - l) < 0.01);
	}

	assert.deepEqual(hexToHsl('#808080'), [0, 0, 128 / 255]);
});
