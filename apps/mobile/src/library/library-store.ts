/*
The phone's copy of the library: loaded once, edited through `edit`, saved to SQLite, and synced by the shared
sync client. Screens read it with `useLibrary` and the sync state with `useSyncStatus`.
*/
import {randomUUID} from 'expo-crypto';
import {useSyncExternalStore} from 'react';
import type {Settings, Store} from '../../../extension/src/shared/types';
import {
	createSyncClient,
	SYNC_OFF,
	SYNC_SETTINGS_KEY,
	SYNC_STATUS_KEY,
	type SyncStatus,
} from '../../../extension/src/shared/sync/client';
import {
	disconnectPrivate,
	editPrivate,
	reconnectPrivate,
	usePrivateStore,
} from '../private/private-library';
import {getPreferences} from '../settings/preferences';
import {readJson, removeKeys, writeJson} from '../platform/storage';
import {emptyStore, isStore} from './store-shape';
import {DEFAULTS as LINK_DEFAULTS, type LinkSettings} from './links';
import {createLibraryCore} from './library-core';
import {syncedTrash} from './trash-storage';
import {archiveStale} from './session-edits';
import {isPrivateView, useView} from './view';
import type * as SeedModuleNamespace from './seed';

// The sample data is required inside a `__DEV__` conditional, which Metro removes from release bundles.
const sampleModule = __DEV__
	? // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module
		(require('./seed') as typeof SeedModuleNamespace)
	: undefined;

const LIBRARY_KEY = 'tablodge.library';
// Dev builds only: 'on' while the library holds sample data, 'off' once it was cleared or a server was connected.
const SEED_KEY = 'tablodge.dev.seed';

const core = createLibraryCore(LIBRARY_KEY);
const {mutate, write, notify: notifyStore} = core;
const regularRetention = () => core.store.settings.trashRetentionDays;
let loaded = false;
/*
A save that arrives before the saved library has been read would be written over it, or would start from an empty
library and send a delete for everything. An edit made that early, such as a link shared into a cold start, waits.
*/
const {promise: libraryLoaded, resolve: finishLoading} =
	Promise.withResolvers<void>();
let sampleOn = false;

let syncStatus: SyncStatus = SYNC_OFF;
const statusListeners = new Set<() => void>();

export const syncClient = createSyncClient({
	// One switch on this phone decides whether settings, the app's own and the extension's, travel through sync.
	get: async (key) =>
		key === SYNC_SETTINGS_KEY ? getPreferences().syncSettings : readJson(key),
	async set(key, value) {
		await writeJson(key, value);
		if (key === SYNC_STATUS_KEY) {
			void refreshStatus();
		}
	},
	remove: removeKeys,
	fetch: async (url, init) => fetch(url, init),
	openSocket: (url) => new WebSocket(url),
	mutate,
	readLibrary: async () => core.store,
	trash: syncedTrash('regular', regularRetention),
	writeLibrary: write,
	// Every write here is either the user's edit or a merge of the server's records; the extension keeps its own
	// copy, so the phone has no backup to restore from.
	async backup() {},
	randomId: () => randomUUID(),
	now: Date.now,
});

export async function refreshStatus(): Promise<void> {
	syncStatus = await syncClient.status();
	for (const listener of statusListeners) {
		listener();
	}
}

/**
Loads the saved library and starts syncing when a server is connected. Call once at startup.
*/
export async function startLibrary(): Promise<void> {
	await loadLibrary();
	await syncClient.wake().catch(() => undefined);
	await refreshStatus();
	await archiveIdleSessions();
}

export async function archiveIdleSessions(): Promise<void> {
	const now = Date.now();
	if (archiveStale(core.store, now) !== core.store) {
		await editRegular((current) => archiveStale(current, now));
	}
}

/**
Reads the saved library once, without opening the live connection. Background sync starts here, since the app may not
be running.
*/
export async function loadLibrary(): Promise<void> {
	if (loaded) {
		return libraryLoaded;
	}

	loaded = true;
	try {
		await loadSaved();
	} finally {
		finishLoading();
	}
}

async function loadSaved(): Promise<void> {
	const saved = await readJson(LIBRARY_KEY);
	if (isStore(saved)) {
		await mutate(async () => {
			core.load(saved);
		});
	}

	await refreshStatus();
	if (!__DEV__) {
		return;
	}

	const seed = await readJson(SEED_KEY);
	sampleOn = seed === 'on';
	// A fresh dev install starts with sample data, unless a server is connected or EXPO_PUBLIC_SEED_DATA=0.
	if (
		seed === undefined &&
		// eslint-disable-next-line n/prefer-global/process -- Expo inlines the literal `process.env.EXPO_PUBLIC_*` at bundle time
		process.env.EXPO_PUBLIC_SEED_DATA !== '0' &&
		!syncStatus.connected &&
		!isStore(saved)
	) {
		await loadSampleData();
	}
}

/**
Resolves once the saved library has been read (startLibrary).
*/
export const whenLibraryLoaded = async (): Promise<void> => libraryLoaded;

export const isSampleData = (): boolean => __DEV__ && sampleOn;

/**
Dev builds only: replaces the library with sample data. Refused while a server is connected, because the sample
records would be sent to it.
*/
export async function loadSampleData(): Promise<void> {
	if (!sampleModule || syncStatus.connected) {
		return;
	}

	const next = sampleModule.sampleStore(Date.now());
	await mutate(async () => {
		await write(next);
	});
	sampleOn = true;
	await writeJson(SEED_KEY, 'on');
	notifyStore();
}

/**
Empties the library on this phone without telling the server, so only while no server is connected: a connected
library would send the deletes.
*/
export async function clearLibrary(): Promise<void> {
	if (syncStatus.connected) {
		return;
	}

	await mutate(async () => {
		await write(emptyStore(Date.now()));
	});
	sampleOn = false;
	if (__DEV__) {
		await writeJson(SEED_KEY, 'off');
	}

	notifyStore();
}

/**
Connects to a server. Sample data is removed first, so it never reaches the real library.
*/
export async function connectServer(
	url: string,
	token: string,
): Promise<SyncStatus> {
	if (sampleOn) {
		await clearLibrary();
	}

	const status = await syncClient.connect(url, token);
	// A private library on this phone starts syncing through the same connection.
	void reconnectPrivate();
	return status;
}

/**
Disconnects from the server. The private library stops syncing with it too; both libraries stay on the phone.
*/
export async function disconnectServer(): Promise<SyncStatus> {
	const status = await syncClient.disconnect();
	await disconnectPrivate();
	return status;
}

/**
Changes the regular library and sends the change to the server after a short delay.
*/
export async function editRegular(
	change: (current: Store) => Store,
): Promise<void> {
	await libraryLoaded;
	await mutate(async () => {
		const next = change(core.store);
		if (next !== core.store) {
			await write(next);
		}
	});
	syncClient.localChanged();
}

/**
Sends what changed in the regular trash with the next sync.
*/
export const nudgeRegular = (): void => {
	syncClient.localChanged();
};

export type LibraryName = 'regular' | 'private';

/**
Changes the library with this name, whichever view is on.
*/
export async function editIn(
	name: LibraryName,
	change: (current: Store) => Store,
): Promise<void> {
	await (name === 'private' ? editPrivate(change) : editRegular(change));
}

/**
Changes the library on screen: the regular one, or the private one while that view is on.
*/
export async function edit(change: (current: Store) => Store): Promise<void> {
	await editIn(isPrivateView() ? 'private' : 'regular', change);
}

export function newId(): string {
	return randomUUID();
}

function subscribeTo(listeners: Set<() => void>) {
	return (listener: () => void) => {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	};
}

/**
The library on screen: the regular one, or the private one while that view is on.
*/
export const useLibrary = (): Store => {
	const regular = useSyncExternalStore(core.subscribe, () => core.store);
	const priv = usePrivateStore();
	return useView() === 'private' ? priv : regular;
};

/**
The library with this name, whichever view is on.
*/
export const useLibraryOf = (name: LibraryName): Store => {
	const regular = useSyncExternalStore(core.subscribe, () => core.store);
	const priv = usePrivateStore();
	return name === 'private' ? priv : regular;
};

/**
The regular library whichever view is on, for settings that belong to it.
*/
export const useRegularLibrary = (): Store =>
	useSyncExternalStore(core.subscribe, () => core.store);

export const useSyncStatus = (): SyncStatus =>
	useSyncExternalStore(subscribeTo(statusListeners), () => syncStatus);

/**
Runs `listener` whenever the sync status changes, such as on connect and disconnect.
*/
export const subscribeSyncStatus = subscribeTo(statusListeners);

export const getSyncStatus = (): SyncStatus => syncStatus;

/**
For the app going to the background: sends what is waiting and closes the live connection, so nothing keeps the
radio awake. `wakeSync` reopens it when the app returns.
*/
export async function pauseSync(): Promise<void> {
	await syncClient.pause().catch(() => undefined);
	await refreshStatus();
}

export async function wakeSync(): Promise<void> {
	await syncClient.wake().catch(() => undefined);
	await refreshStatus();
}

/**
Runs `listener` whenever the regular library changes, including what sync brings in.
*/
export const subscribeLibrary = core.subscribe;

export const getLibrary = (): Store => core.store;

/**
Puts extension settings that travel with the library back to the extension's defaults, all of them or just `keys`, and
sends that on the next sync.
*/
export async function resetSyncedSettings(
	keys: ReadonlyArray<keyof LinkSettings> = Object.keys(LINK_DEFAULTS) as Array<
		keyof LinkSettings
	>,
): Promise<void> {
	await editRegular((current) => ({
		...current,
		settings: {
			...current.settings,
			...Object.fromEntries(keys.map((key) => [key, LINK_DEFAULTS[key]])),
		},
		updatedAt: Date.now(),
	}));
}

/**
Changes one extension setting that travels with the library, and sends it on the next sync.
*/
export async function setSyncedSetting<Key extends keyof Settings>(
	key: Key,
	value: Settings[Key],
): Promise<void> {
	await editRegular((current) => ({
		...current,
		settings: {...current.settings, [key]: value},
		updatedAt: Date.now(),
	}));
}
