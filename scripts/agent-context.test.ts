import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'vite-plus/test';
import {grown, measure} from './agent-context.ts';

test('the committed budget matches the instruction files', () => {
	const budget = JSON.parse(readBudget()) as unknown;
	assert.deepEqual(budget, measure());
});

test('only a size above the base counts as growth', () => {
	const base = {a: 10, b: 10, c: 10};
	assert.deepEqual(grown({a: 11, b: 10, c: 9}, base), [
		'a: 10 -> 11 bytes (+1)',
	]);
	assert.deepEqual(grown({a: 5, d: 99}, base), []);
});

function readBudget(): string {
	return readFileSync('scripts/agent-context-budget.json', 'utf8');
}
