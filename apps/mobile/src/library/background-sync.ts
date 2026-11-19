/*
Background sync: Android's WorkManager runs one sync round about every 15 minutes while a server is connected and the
setting is on, even with the app closed, and the Bookmarks widgets redraw when it brought something in. A round is the
same pull and push the app does when it opens; it opens no live connection and holds no wake lock, and WorkManager
waits for a network and for Doze's maintenance windows. Only the regular library syncs here: the private library's key
is in memory only while it is unlocked, so it catches up when it is opened.
*/
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
// Android's floor for periodic work; it may wait longer to batch the run with other apps.
const MINUTES = 15;

/**
One background round: reads the saved library if this process has not, syncs it, and redraws the widgets when the round
changed the library.
*/
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

/**
Tells the task manager what the background task runs. Call when the bundle loads, before the app mounts: Android may
start the app only to run the task, and finds it this way.
*/
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

/**
Registers or cancels the task to match the current state. Runs one at a time and reads the state when it starts, so a
quick off and on cannot end with the task cancelled.
*/
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
		// Tried again on the next change.
		scheduled = undefined;
	}
}

/**
Keeps the background round scheduled while a server is connected and the setting is on, and cancels it when either
stops. Call once after `startLibrary`, which reads whether a server is connected.
*/
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
