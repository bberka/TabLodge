import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {resolveAccent} from '../src/accent';

const SYSTEM = {light: '#6750a4', dark: '#d0bcff'};
const LIGHT = {page: '#faf9f7', surface: '#ffffff'};
const DARK = {page: '#16151b', surface: '#1f1e26'};
const resolve = (
	choice: string,
	scheme: 'light' | 'dark',
	{page, surface} = scheme === 'dark' ? DARK : LIGHT,
	ios = false,
	system?: typeof SYSTEM,
) => resolveAccent(choice, scheme, ios, page, surface, system);

describe('the accent color', () => {
	test('the default leaves the look alone', () => {
		assert.equal(resolve('default', 'light', LIGHT, false, SYSTEM), undefined);
	});

	test("the system choice takes the phone's color for the theme, and nothing where there is none", () => {
		const light = resolve('system', 'light', LIGHT, false, SYSTEM);
		assert.equal(light?.accent, '#6750a4');
		assert.equal(
			resolve('system', 'dark', DARK, false, SYSTEM)?.accent,
			'#d0bcff',
		);
		assert.equal(resolve('system', 'light', LIGHT), undefined);
		assert.equal(resolve('system', 'light', LIGHT, true, SYSTEM), undefined);
	});

	test('a preset or a hex gives a legible accent, a pale fill, and readable text on a filled button', () => {
		for (const [choice, scheme, page] of [
			['teal', 'light', LIGHT],
			['#f5e642', 'light', LIGHT],
			['#112233', 'dark', DARK],
			['blue', 'dark', DARK],
		] as const) {
			const found = resolve(choice, scheme, page);
			assert.ok(found, choice);
			assert.match(found.accent, /^#[\da-f]{6}$/);
			assert.match(found.accentSoft, /^#[\da-f]{6}$/);
			assert.match(found.onAccent, /^#[\da-f]{6}$/);
		}

		// A pale yellow on a light page is moved toward black until it can be read.
		const yellow = resolve('#f5e642', 'light', LIGHT);
		assert.notEqual(yellow?.accent, '#f5e642');
		assert.equal(resolve('nonsense', 'light', LIGHT), undefined);
	});
});
