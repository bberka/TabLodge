import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import {
	getPreferences,
	loadPreferences,
	subscribePreferences,
} from '../settings/preferences';
import {
	getSyncStatus,
	loadLibrary,
	refreshStatus,
	subscribeLibrary,
	subscribeSyncStatus,
	syncClient,
} from './library-store';
import {publishWidgetSnapshot} from './widget-sync';

const TASK = 'tablodge-background-sync';
const MINUTES = 15;

export async function runBackgroundSync(): Promise<void> {
	await loadPreferences();
	if (!getPreferences().backgroundSync) {
		return;
	}

	await loadLibrary();
	let changed = false;
	const stop = subscribeLibrary(() => {
		changed = true;
	});
	try {
		await syncClient.syncNow();
	} finally {
		stop();
	}

	if (changed) {
		publishWidgetSnapshot();
	}

	await refreshStatus();
}

export function defineBackgroundSync(): void {
	TaskManager.defineTask(TASK, async () => {
		try {
			await runBackgroundSync();
			return BackgroundTask.BackgroundTaskResult.Success;
		} catch {
			return BackgroundTask.BackgroundTaskResult.Failed;
		}
	});
}

let scheduled: boolean | undefined;
let queue: Promise<void> = Promise.resolve();

async function reconcile(): Promise<void> {
	const wanted = getSyncStatus().connected && getPreferences().backgroundSync;
	if (wanted === scheduled) {
		return;
	}

	try {
		const registered = await TaskManager.isTaskRegisteredAsync(TASK);
		if (wanted && !registered) {
			await BackgroundTask.registerTaskAsync(TASK, {minimumInterval: MINUTES});
		} else if (!wanted && registered) {
			await BackgroundTask.unregisterTaskAsync(TASK);
		}

		scheduled = wanted;
	} catch {
		scheduled = undefined;
	}
}

export function startBackgroundSync(): () => void {
	const update = () => {
		queue = queue.then(reconcile);
	};

	update();
	const stopStatus = subscribeSyncStatus(update);
	const stopPreferences = subscribePreferences(update);
	return () => {
		stopStatus();
		stopPreferences();
	};
}
