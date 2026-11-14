import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {radioTargetIndex} from '../src/shared/radio-keys';

test('radioTargetIndex moves with the arrow keys and wraps at the ends', () => {
	assert.equal(radioTargetIndex('ArrowRight', 0, 3), 1);
	assert.equal(radioTargetIndex('ArrowDown', 2, 3), 0);
	assert.equal(radioTargetIndex('ArrowLeft', 1, 3), 0);
	assert.equal(radioTargetIndex('ArrowUp', 0, 3), 2);
});

test('radioTargetIndex jumps to the ends with Home and End', () => {
	assert.equal(radioTargetIndex('Home', 2, 3), 0);
	assert.equal(radioTargetIndex('End', 0, 3), 2);
});

test('radioTargetIndex ignores other keys and empty groups', () => {
	assert.equal(radioTargetIndex('Enter', 0, 3), null);
	assert.equal(radioTargetIndex('ArrowRight', 0, 0), null);
});
