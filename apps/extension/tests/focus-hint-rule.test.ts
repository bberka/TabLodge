import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	FOCUS_HINT_COLUMNS,
	suggestsFocusView,
} from '../src/app/focus-hint-rule';

test('the hint starts past six columns in Board view', () => {
	assert.equal(suggestsFocusView(FOCUS_HINT_COLUMNS, 'board'), false);
	assert.equal(suggestsFocusView(FOCUS_HINT_COLUMNS + 1, 'board'), true);
});

test('the hint never shows in Focus view', () => {
	assert.equal(suggestsFocusView(20, 'focus'), false);
});
