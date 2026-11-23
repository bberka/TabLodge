import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	paletteUndoToast,
	sessionRestoreMessage,
} from '../src/app/session-restore-message';
import type {RestoreResult} from '../src/shared/types';

const restored = (fields: Partial<RestoreResult> = {}): RestoreResult => ({
	count: 2,
	skipped: 0,
	failed: 0,
	failures: [],
	removed: true,
	splits: 0,
	splitsSeparated: 0,
	trashId: 'trash-1',
	...fields,
});

test('the restore message is the one the side panel and popup show', () => {
	assert.equal(
		sessionRestoreMessage(restored(), 'Research'),
		'Restored “Research”. Removed it from your sessions.',
	);
});

test('a restore that only emptied part of the session keeps its summary and warnings', () => {
	assert.equal(
		sessionRestoreMessage(
			restored({
				removed: false,
				skipped: 1,
				failed: 1,
				failures: [{title: 'Page', url: 'https://a.example/', error: 'x'}],
			}),
			'Research',
		),
		'Restored 2 tabs · skipped 1 duplicate · 1 failed · Page: x.',
	);
});

test('a restore that removed nothing offers no Undo toast', () => {
	assert.equal(
		paletteUndoToast(restored({trashId: undefined, removed: false}), 'R', 7),
		undefined,
	);
});

test('without the tab the palette was opened over there is nowhere to show Undo', () => {
	assert.equal(paletteUndoToast(restored(), 'Research', undefined), undefined);
});

test('a restore that moved the session to the trash asks for the Undo toast on that tab', () => {
	assert.deepEqual(paletteUndoToast(restored(), 'Research', 7), {
		tabId: 7,
		message: 'Restored “Research”. Removed it from your sessions.',
		trashId: 'trash-1',
	});
});
