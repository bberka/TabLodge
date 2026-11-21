import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {upButtonShows} from '../src/ui/scroll-top-rule';

const SCREEN = 800;

test('the Up button stays hidden until a screen height of scrolling', () => {
	assert.equal(upButtonShows(0, SCREEN, false), false);
	assert.equal(upButtonShows(SCREEN - 1, SCREEN, false), false);
	assert.equal(upButtonShows(SCREEN, SCREEN, false), true);
});

test('once shown it stays through a scroll back, and hides again near the top', () => {
	assert.equal(upButtonShows(SCREEN - 100, SCREEN, true), true);
	assert.equal(upButtonShows(SCREEN * 0.5, SCREEN, true), true);
	assert.equal(upButtonShows(SCREEN * 0.3, SCREEN, true), false);
	assert.equal(upButtonShows(0, SCREEN, true), false);
});
