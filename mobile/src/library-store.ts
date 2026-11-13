/*
The phone's copy of the library: loaded once, edited through `edit`, saved to SQLite, and synced by the shared
sync client. Screens read it with `useLibrary` and the sync state with `useSyncStatus`.
*/
import {randomUUID} from 'expo-crypto';
import {useSyncExternalStore} from 'react';
import type {Settings, Store} from '../../src/app/types';
import {
	createSyncClient,
	SYNC_OFF,
	SYNC_STATUS_KEY,
	type SyncStatus,
} from '../../src/shared/sync/client';
import {emptyStore, isStore} from './library';
import {createLibraryCore} from './library-core';
import {usePrivateStore} from './private-library';
import {useView} from './view';
import type * as SeedModuleNamespace from './seed';
import {readJson, removeKeys, writeJson} from './storage';

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
let loaded = false;
let sampleOn = false;

let syncStatus: SyncStatus = SYNC_OFF;
const statusListeners = new Set<() => void>();

export const syncClient = createSyncClient({
	get: readJson,
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
	if (loaded) {
		return;
	}

	loaded = true;
	const saved = await readJson(LIBRARY_KEY);
	if (isStore(saved)) {
		core.load(saved);
	}

	await refreshStatus();
	if (__DEV__) {
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

	await syncClient.wake().catch(() => undefined);
	await refreshStatus();
}

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

	return syncClient.connect(url, token);
}

/**
Changes the library and sends the change to the server after a short delay.
*/
export async function edit(change: (current: Store) => Store): Promise<void> {
	await mutate(async () => {
		const next = change(core.store);
		if (next !== core.store) {
			await write(next);
		}
	});
	syncClient.localChanged();
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
The regular library whichever view is on, for settings that belong to it.
*/
export const useRegularLibrary = (): Store =>
	useSyncExternalStore(core.subscribe, () => core.store);

export const useSyncStatus = (): SyncStatus =>
	useSyncExternalStore(subscribeTo(statusListeners), () => syncStatus);

/**
Changes one extension setting that travels with the library, and sends it on the next sync.
*/
export async function setSyncedSetting<Key extends keyof Settings>(
	key: Key,
	value: Settings[Key],
): Promise<void> {
	await edit((current) => ({
		...current,
		settings: {...current.settings, [key]: value},
		updatedAt: Date.now(),
	}));
}
