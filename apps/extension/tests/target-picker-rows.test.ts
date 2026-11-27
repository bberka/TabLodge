import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	filterPickerRows,
	indexPickerTargets,
	stepPickerRow,
} from '../src/app/target-picker-rows';

const sample = indexPickerTargets([
	{id: 'a', name: 'Daily Reading'},
	{id: 'b', name: 'Work Tabs'},
	{id: 'c', name: 'Archive Notes'},
]);

test('filterPickerRows matches case-insensitively and marks the current target', () => {
	const rows = filterPickerRows(sample, '  WORK ', 'b', false);
	assert.deepEqual(rows, [
		{type: 'target', target: {id: 'b', name: 'Work Tabs'}, current: true},
	]);
});

test('filterPickerRows returns a create row when nothing matches and creation is allowed', () => {
	assert.deepEqual(
		filterPickerRows(sample, '  New Folder  ', undefined, true),
		[{type: 'create', name: 'New Folder'}],
	);
	assert.deepEqual(
		filterPickerRows(sample, '  New Folder  ', undefined, false),
		[],
	);
	assert.equal(filterPickerRows(sample, ' ', undefined, true).length, 3);
});

test('stepPickerRow skips the current target and stops at the list bounds', () => {
	const rows = filterPickerRows(sample, '', 'b', false);
	assert.equal(stepPickerRow(rows, 0, 1), 2);
	assert.equal(stepPickerRow(rows, 2, -1), 0);
	assert.equal(stepPickerRow(rows, 2, 1), null);
	assert.equal(stepPickerRow(rows, 0, -1), null);
});
