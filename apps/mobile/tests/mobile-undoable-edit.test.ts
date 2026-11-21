import assert from 'node:assert/strict';
import {beforeEach, test, vi} from 'vite-plus/test';
import type {Store} from '../../extension/src/shared/types';

const snacks: Array<{message: string; run?: () => void}> = [];
let held = {name: 'start'} as unknown as Store;

vi.mock('../src/ui/snackbar', () => ({
	showSnack(message: string, action?: {run: () => void}) {
		snacks.push({message, run: action?.run});
	},
}));
vi.mock('../src/library/library-store', () => ({
	async edit(change: (current: Store) => Store) {
		held = change(held);
	},
	async editIn(_name: string, change: (current: Store) => Store) {
		held = change(held);
	},
}));

const {editDone, editWithUndo} = await import('../src/library/undoable-edit');

beforeEach(() => {
	snacks.length = 0;
	held = {name: 'start'} as unknown as Store;
});

test('an edit shows the shared wording and Undo puts back the exact store', async () => {
	const start = held;
	await editWithUndo(
		editDone('REORDER_BOOKMARK_COLUMN'),
		() => ({name: 'moved'}) as unknown as Store,
	);
	assert.equal(snacks[0].message, 'Column moved.');
	assert.notEqual(held, start);
	snacks[0].run?.();
	await Promise.resolve();
	assert.equal(held, start);
});

test('Undo is refused when the library changed after the edit', async () => {
	await editWithUndo('Moved.', () => ({name: 'moved'}) as unknown as Store);
	held = {name: 'synced'} as unknown as Store;
	const synced = held;
	snacks[0].run?.();
	await Promise.resolve();
	assert.equal(held, synced);
	assert.match(snacks[1].message, /changed since/);
});

test('an edit that changes nothing shows no toast', async () => {
	await editWithUndo('Moved.', (current) => current);
	assert.equal(snacks.length, 0);
});
