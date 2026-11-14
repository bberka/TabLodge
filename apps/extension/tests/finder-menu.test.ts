import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {filterItemActions, itemActions} from '../src/app/finder-menu';
import type {FinderItem} from '../src/app/global-search';

const item = (kind: FinderItem['kind']): FinderItem => ({
	id: kind,
	kind,
	title: kind,
	texts: [kind],
});
const ids = (kind: FinderItem['kind'], standalone: boolean) =>
	itemActions(item(kind), standalone).map((action) => action.id);

test('a session offers restore here, a new window and reveal', () => {
	assert.deepEqual(ids('session', false), [
		'restore',
		'restore-new-window',
		'reveal',
	]);
});

test('the palette window cannot reveal a session on a dashboard it does not show', () => {
	assert.deepEqual(ids('session', true), ['restore', 'restore-new-window']);
});

test('links offer tab, window and copy', () => {
	for (const kind of ['bookmark', 'saved-tab'] as const) {
		assert.deepEqual(ids(kind, false), [
			'open',
			'open-new-tab',
			'open-new-window',
			'copy-link',
		]);
	}
});

test('an open tab can be switched to or closed', () => {
	assert.deepEqual(ids('tab', true), ['switch', 'close-tab']);
});

test('results with one obvious action have no actions menu', () => {
	for (const kind of ['command', 'folder', 'column', 'web', 'url'] as const) {
		assert.deepEqual(ids(kind, false), []);
	}
});

test('typing filters the actions by label', () => {
	const actions = itemActions(item('bookmark'), false);
	assert.deepEqual(
		filterItemActions(actions, 'WIN').map((action) => action.id),
		['open-new-window'],
	);
	assert.equal(filterItemActions(actions, '  ').length, actions.length);
});
