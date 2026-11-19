import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	filterItemActions,
	itemActions,
	leavesActionMenu,
} from '../src/app/finder-menu';
import type {FinderItem} from '../src/shared/global-search';

const item = (kind: FinderItem['kind']): FinderItem => ({
	id: kind,
	kind,
	title: kind,
	texts: [kind],
});
const ids = (kind: FinderItem['kind'], standalone: boolean) =>
	itemActions(item(kind), {standalone}).map((action) => action.id);

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

test('page copies: an open tab can be kept, a link with a copy opened', () => {
	assert.deepEqual(
		itemActions(item('tab'), {standalone: true, keepCopies: true}).map(
			(action) => action.id,
		),
		['switch', 'keep-copy', 'close-tab'],
	);
	const link = {...item('bookmark'), url: 'https://example.com/'};
	const copies = new Set(['https://example.com/']);
	assert.ok(
		itemActions(link, {standalone: false, copies}).some(
			(action) => action.id === 'open-copy',
		),
	);
	assert.ok(
		itemActions(
			{...link, url: 'https://other.example/'},
			{standalone: false, copies},
		).every((action) => action.id !== 'open-copy'),
	);
});

test('← leaves the actions menu only from the start of the filter', () => {
	const left = {
		key: 'ArrowLeft',
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
	};
	const field = (value: string, start: number, end = start) => ({
		value,
		selectionStart: start,
		selectionEnd: end,
	});
	assert.ok(leavesActionMenu(left, field('', 0)));
	assert.ok(leavesActionMenu(left, field('win', 0)));
	assert.ok(!leavesActionMenu(left, field('win', 3)), 'moves the caret');
	assert.ok(
		!leavesActionMenu(left, field('win', 0, 3)),
		'collapses a selection',
	);
	assert.ok(!leavesActionMenu({...left, shiftKey: true}, field('', 0)));
	const backspace = {...left, key: 'Backspace'};
	assert.ok(leavesActionMenu(backspace, field('', 0)));
	assert.ok(!leavesActionMenu(backspace, field('w', 1)));
	assert.ok(leavesActionMenu({...left, key: 'Escape'}, field('win', 2)));
});

test('results with one obvious action have no actions menu', () => {
	for (const kind of ['command', 'folder', 'column', 'web', 'url'] as const) {
		assert.deepEqual(ids(kind, false), []);
	}
});

test('typing filters the actions by label', () => {
	const actions = itemActions(item('bookmark'), {standalone: false});
	assert.deepEqual(
		filterItemActions(actions, 'WIN').map((action) => action.id),
		['open-new-window'],
	);
	assert.equal(filterItemActions(actions, '  ').length, actions.length);
});
