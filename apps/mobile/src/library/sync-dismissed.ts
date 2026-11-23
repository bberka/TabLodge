import {useSyncExternalStore} from 'react';
import {SYNC_DISMISSED_KEY} from '../../../extension/src/shared/sync/compat';
import {readJson, writeJson} from '../platform/storage';

let dismissed: {value: unknown} | undefined;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

function notify() {
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	loading ??= readJson(SYNC_DISMISSED_KEY)
		.catch(() => undefined)
		.then((value) => {
			dismissed ??= {value};
			notify();
		});
	return () => {
		listeners.delete(listener);
	};
}

export const useSyncDismissed = (): {value: unknown} | undefined =>
	useSyncExternalStore(subscribe, () => dismissed);

export function dismissSyncBanner(key: string): void {
	dismissed = {value: key};
	notify();
	void writeJson(SYNC_DISMISSED_KEY, key).catch(() => undefined);
}
