import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {plan} from './check-changed.ts';

test('a markdown-only change runs nothing', () => {
	assert.deepEqual(plan(['docs/agents/ui.md', 'AGENTS.md']), {
		lint: [],
		typecheck: false,
		test: false,
	});
});

test('a code change lints that file, type checks, and tests', () => {
	assert.deepEqual(plan(['apps/server/src/api.ts', 'docs/x.md']), {
		lint: ['apps/server/src/api.ts'],
		typecheck: true,
		test: true,
	});
});

test('a tsconfig change type checks without running tests', () => {
	assert.deepEqual(plan(['tsconfig/base.json']), {
		lint: [],
		typecheck: true,
		test: false,
	});
});
