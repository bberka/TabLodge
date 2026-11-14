import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	contextMenuPlan,
	contextMenuSignature,
	menuSessions,
} from '../src/shared/context-menu-plan';
import {DEFAULT_SETTINGS} from '../src/shared/library-normalize';

const env = {appName: 'TabLodge', hasSidePanel: true};
const columns = [{id: 'c1', name: 'Read', createdAt: 0, isDefault: false}];
const on = {
	...DEFAULT_SETTINGS,
	contextMenusEnabled: true,
	contextMenuLinksEnabled: true,
	contextMenuPageEnabled: true,
	contextMenuSelectionEnabled: true,
	contextMenuActionEnabled: true,
};

describe('contextMenuPlan', () => {
	test('lists a parent before its children and never repeats an id', () => {
		const plan = contextMenuPlan(on, columns, [{id: 's1', name: 'One'}], env);
		const seen = new Set<string>();
		for (const item of plan) {
			const id = String(item.id);
			assert.ok(item.id, 'every entry has an id');
			assert.ok(!seen.has(id), `${id} appears once`);
			if (item.parentId) {
				assert.ok(seen.has(String(item.parentId)), `${id} follows its parent`);
			}

			seen.add(id);
		}

		assert.ok(plan.length > 0);
	});

	test('builds nothing while the menus are off', () => {
		const plan = contextMenuPlan(
			{...on, contextMenusEnabled: false},
			columns,
			[],
			env,
		);
		assert.deepEqual(plan, []);
	});
});

describe('menu sessions and signature', () => {
	test('the newest sessions are offered, and not the archived ones', () => {
		const sessions = menuSessions(
			[
				{id: 'old', name: 'Old', updatedAt: 1, folderId: 'f'},
				{id: 'new', name: 'New', updatedAt: 5, folderId: 'f'},
				{id: 'gone', name: 'Gone', updatedAt: 9, folderId: 'arch'},
			],
			[{id: 'arch', name: 'Archived'}],
		);
		assert.deepEqual(
			sessions.map((session) => session.id),
			['new', 'old'],
		);
	});

	test('the signature changes when a column is renamed', () => {
		const a = contextMenuSignature(on, columns, [{id: 's', name: 'S'}]);
		const b = contextMenuSignature(
			on,
			[{...columns[0], name: 'Later'}],
			[{id: 's', name: 'S'}],
		);
		assert.notEqual(a, b);
	});
});
