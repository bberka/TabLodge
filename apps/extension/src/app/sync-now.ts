import type {ActionResult} from '../shared/types';

export function syncNowOutcome(result: ActionResult<'SYNC_NOW'>): {
	message: string;
	failed: boolean;
} {
	if (!result.ok) {
		return {message: result.error, failed: true};
	}

	const {status} = result;
	if (!status.connected) {
		return {
			message: 'Sync is not set up. Connect a server in Settings › Sync.',
			failed: true,
		};
	}

	if (status.phase === 'error' || status.phase === 'offline') {
		return {
			message: status.error || 'Could not reach the sync server.',
			failed: true,
		};
	}

	return {message: 'Synced.', failed: false};
}
