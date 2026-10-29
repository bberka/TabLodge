import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {neighborId} from '../src/app/reorder';

const ids = ['a', 'b', 'c'];

test('neighborId steps to the adjacent item in either direction', () => {
	assert.equal(neighborId(ids, 'b', 'earlier'), 'a');
	assert.equal(neighborId(ids, 'b', 'later'), 'c');
});

test('neighborId returns null at the ends of the list', () => {
	assert.equal(neighborId(ids, 'a', 'earlier'), null);
	assert.equal(neighborId(ids, 'c', 'later'), null);
});

test('neighborId returns null for an id that is not in the list', () => {
	assert.equal(neighborId(ids, 'z', 'later'), null);
});
