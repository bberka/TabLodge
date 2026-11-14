import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {bookmarkGridTemplate} from '../src/app/bookmark-layout';

test('the default width with automatic columns keeps the Dashboard width grid', () => {
	assert.equal(bookmarkGridTemplate('default', 0, 'comfortable'), undefined);
	assert.equal(bookmarkGridTemplate('default', 0, 'compact'), undefined);
});

test('a width sets the minimum column size', () => {
	assert.equal(
		bookmarkGridTemplate('narrow', 0, 'comfortable'),
		'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
	);
	assert.equal(
		bookmarkGridTemplate('wide', 0, 'comfortable'),
		'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))',
	);
	assert.equal(
		bookmarkGridTemplate('extra-wide', 0, 'comfortable'),
		'repeat(auto-fit, minmax(min(100%, 32rem), 1fr))',
	);
});

test('columns per row is a cap that still lets small screens use fewer', () => {
	assert.equal(
		bookmarkGridTemplate('default', 3, 'comfortable'),
		'repeat(auto-fit, minmax(min(100%, max(18rem, calc((100% - 2rem) / 3))), 1fr))',
	);
	assert.equal(
		bookmarkGridTemplate('narrow', 1, 'comfortable'),
		'repeat(auto-fit, minmax(min(100%, max(14rem, calc((100% - 0rem) / 1))), 1fr))',
	);
});

test('compact density uses its narrower gap when working out the cap', () => {
	assert.equal(
		bookmarkGridTemplate('default', 4, 'compact'),
		'repeat(auto-fit, minmax(min(100%, max(18rem, calc((100% - 1.5rem) / 4))), 1fr))',
	);
});
