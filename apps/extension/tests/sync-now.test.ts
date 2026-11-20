import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {syncNowOutcome} from '../src/app/sync-now';
import type {SyncStatus} from '../src/shared/sync/client';

const status = (patch: Partial<SyncStatus>): SyncStatus => ({
	connected: true,
	url: 'https://sync.example',
	phase: 'idle',
	live: false,
	lastSyncAt: 1,
	pending: 0,
	refused: 0,
	error: null,
	...patch,
});

test('Sync now says when no server is set up instead of claiming it synced', () => {
	const outcome = syncNowOutcome({
		ok: true,
		status: status({connected: false, phase: 'off'}),
	});
	assert.equal(outcome.failed, true);
	assert.match(outcome.message, /not set up/);
});

test('Sync now passes on a failed round', () => {
	assert.deepEqual(
		syncNowOutcome({
			ok: true,
			status: status({phase: 'error', error: 'Bad token.'}),
		}),
		{message: 'Bad token.', failed: true},
	);
	assert.deepEqual(syncNowOutcome({ok: true, status: status({})}), {
		message: 'Synced.',
		failed: false,
	});
});
