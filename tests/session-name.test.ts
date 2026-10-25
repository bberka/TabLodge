import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	baseSessionName,
	numberedSessionNames,
	promptGroupIds,
	typedSessionName,
} from '../src/app/session-name';

test('an empty or blank typed name means the default name', () => {
	assert.equal(typedSessionName(''), undefined);
	assert.equal(typedSessionName('   \t'), undefined);
	assert.equal(typedSessionName('  Trip  '), 'Trip');
	assert.equal(typedSessionName('x'.repeat(200))?.length, 120);
});

test('several sessions from one save are numbered, one keeps the name as typed', () => {
	assert.deepEqual(numberedSessionNames('Trip', 1), ['Trip']);
	assert.deepEqual(numberedSessionNames('Trip', 3), [
		'Trip (1/3)',
		'Trip (2/3)',
		'Trip (3/3)',
	]);
	assert.equal(numberedSessionNames('y'.repeat(120), 2)[0].length, 106);
	assert.equal(baseSessionName('Trip (2/3)'), 'Trip');
	assert.equal(baseSessionName('Trip (draft)'), 'Trip (draft)');
});

test('the prompt window reads its session ids from the address', () => {
	assert.deepEqual(promptGroupIds('?groupId=a&groupId=b&groupId=a&groupId='), [
		'a',
		'b',
	]);
	assert.deepEqual(promptGroupIds(''), []);
});
