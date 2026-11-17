import {useEffect, useEffectEvent} from 'react';
import {
	problemKey,
	problemNotice,
	readCompat,
	SYNC_NOTICED_KEY,
} from '../../../extension/src/shared/sync/compat';
import {readJson, removeKeys, writeJson} from '../platform/storage';
import {showSnack} from '../ui/snackbar';
import {useSyncStatus} from './library-store';

/**
Shows a snackbar the first time the connected server stops sync or lacks a feature, and again only after that
problem went away and came back. Settings › Sync keeps the details.
*/
export function useSyncProblemNotice(openSettings: () => void): void {
	const status = useSyncStatus();
	const compat = status.connected ? readCompat(status) : undefined;
	const key = compat && problemKey(compat);
	const check = useEffectEvent(async () => {
		if (!compat || key === undefined) {
			await removeKeys([SYNC_NOTICED_KEY]);
			return;
		}

		if ((await readJson(SYNC_NOTICED_KEY)) === key) {
			return;
		}

		await writeJson(SYNC_NOTICED_KEY, key);
		showSnack(problemNotice(compat), {label: 'Settings', run: openSettings});
	});
	// Waits for a connected status, so the moment before it loads does not count as the problem going away.
	const known = status.connected;
	useEffect(() => {
		if (known) {
			void check();
		}
	}, [known, key]);
}
