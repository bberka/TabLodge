import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {suggestsFocusView} from '../src/app/focus-hint-rule';

test('the hint starts past six columns in Board view', () => {
	assert.equal(suggestsFocusView(6, 'board'), false);
	assert.equal(suggestsFocusView(7, 'board'), true);
});

test('the hint never shows in Focus view', () => {
	assert.equal(suggestsFocusView(20, 'focus'), false);
});
