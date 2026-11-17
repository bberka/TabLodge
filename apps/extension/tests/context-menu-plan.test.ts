import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	contextMenuPlan,
	contextMenuSignature,
	menuSessions,
} from '../src/shared/context-menu-plan';
import {DEFAULT_SETTINGS} from '../src/shared/library-normalize';

const env = {
	appName: 'TabLodge',
	hasSidePanel: true,
	hasTabContext: false,
	hasAmpersandAccessKeys: false,
};
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

	test('every context has one root, and the link switch also covers images and media', () => {
		const roots = (plan: ReturnType<typeof contextMenuPlan>) =>
			plan
				.filter((item) => !item.parentId)
				.flatMap((item) => item.contexts ?? [])
				.toSorted();
		assert.deepEqual(roots(contextMenuPlan(on, columns, [], env)), [
			'action',
			'action',
			'action',
			'action',
			'action',
			'action',
			'audio',
			'frame',
			'image',
			'link',
			'page',
			'selection',
			'video',
		]);
		const titlesUnder = (
			plan: ReturnType<typeof contextMenuPlan>,
			id: string,
		) =>
			plan
				.filter((item) => item.parentId === id)
				.map((item) => item.title ?? '---');
		const plan = contextMenuPlan(on, columns, [], env);
		assert.deepEqual(titlesUnder(plan, 'tablodge-image-root'), [
			'Bookmark image to',
		]);
		assert.deepEqual(titlesUnder(plan, 'tablodge-image-bookmark'), [
			'Read',
			'---',
			'New column',
		]);
		assert.deepEqual(titlesUnder(plan, 'tablodge-media-root'), [
			'Bookmark video to',
		]);
		assert.deepEqual(titlesUnder(plan, 'tablodge-media-bookmark'), [
			'Read',
			'---',
			'New column',
		]);

		const linksOff = roots(
			contextMenuPlan(
				{...on, contextMenuLinksEnabled: false},
				columns,
				[],
				env,
			),
		);
		for (const context of ['link', 'image', 'video', 'audio'] as const) {
			assert.ok(
				!linksOff.includes(context),
				`${context} goes with the Links switch`,
			);
		}
	});

	test('only Firefox puts the page items, and nothing else, on the tab strip', () => {
		const sessions = [{id: 's1', name: 'One'}];
		const chromium = contextMenuPlan(on, columns, sessions, env);
		assert.ok(chromium.every((item) => !item.contexts?.includes('tab')));

		const firefox = contextMenuPlan(on, columns, sessions, {
			...env,
			hasTabContext: true,
		});
		const pageIds = chromium
			.filter((item) => item.contexts?.includes('page'))
			.map((item) => item.id);
		assert.deepEqual(
			firefox
				.filter((item) => item.contexts?.includes('tab'))
				.map((item) => item.id),
			pageIds,
		);
		assert.deepEqual(
			firefox.map((item) => item.id),
			chromium.map((item) => item.id),
			'the tab strip reuses the page ids',
		);
	});

	test('Firefox shows an ampersand in every title, built in or named by the user', () => {
		const names = [{id: 'rd', name: 'R&D', createdAt: 0, isDefault: false}];
		const sessions = [{id: 's1', name: 'Q&A'}];
		const titles = (hasAmpersandAccessKeys: boolean) =>
			new Map(
				contextMenuPlan(on, names, sessions, {
					...env,
					appName: 'Tab&Lodge',
					hasAmpersandAccessKeys,
				}).map((item) => [item.id, item.title]),
			);

		const chromium = titles(false);
		assert.equal(
			chromium.get('tablodge-selection-search'),
			'Search saved tabs & bookmarks for “%s”',
		);
		assert.equal(chromium.get('tablodge-page-bookmark:rd'), 'R&D');

		const firefox = titles(true);
		assert.equal(
			firefox.get('tablodge-selection-search'),
			'Search saved tabs && bookmarks for “%s”',
		);
		for (const id of [
			'tablodge-link-bookmark:rd',
			'tablodge-image-bookmark:rd',
			'tablodge-media-bookmark:rd',
			'tablodge-page-bookmark:rd',
		]) {
			assert.equal(firefox.get(id), 'R&&D', id);
		}

		assert.equal(firefox.get('tablodge-page-send:s1'), 'Q&&A');
		assert.equal(firefox.get('tablodge-page-root'), 'Tab&&Lodge');
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
