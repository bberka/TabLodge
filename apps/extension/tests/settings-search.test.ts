import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {sortByQuery} from '../src/shared/fuzzy';

test('sortByQuery keeps equal matches in their order and non-matching rows last', () => {
	const same = ['Tab aa', 'Tab bb', 'Tab cc'];
	assert.deepEqual(
		sortByQuery('tab', same, (item) => [item]),
		same,
	);
	assert.deepEqual(
		sortByQuery('b', ['Zeta', 'Bee', 'Alpha'], (item) => [item]),
		['Bee', 'Zeta', 'Alpha'],
	);
});
