/*
The phone's copy of the library: loaded once, edited through `edit`, saved to SQLite, and synced by the shared
sync client. Screens read it with `useLibrary` and the sync state with `useSyncStatus`.
*/
import {randomUUID} from 'expo-crypto';
import {useSyncExternalStore} from 'react';
import type {Store} from '../../src/app/types';
import {
	createSyncClient,
	SYNC_OFF,
	SYNC_STATUS_KEY,
	type SyncStatus,
} from '../../src/shared/sync/client';
import {emptyStore} from './library';
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

let store = emptyStore(Date.now());
let loaded = false;
let sampleOn = false;
let queue: Promise<unknown> = Promise.resolve();
const storeListeners = new Set<() => void>();

let syncStatus: SyncStatus = SYNC_OFF;
const statusListeners = new Set<() => void>();

/**
Runs library reads and writes one after another, the way the extension's service worker does.
*/
function mutate<T>(work: () => Promise<T>): Promise<T> {
	const run = queue.then(work, work);
	queue = run.catch(() => undefined);
	return run;
}

function notifyStore() {
	for (const listener of storeListeners) {
		listener();
	}
}

async function write(next: Store): Promise<void> {
	store = next;
	await writeJson(LIBRARY_KEY, next);
	notifyStore();
}

const isStore = (value: unknown): value is Store =>
	typeof value === 'object' &&
	value !== null &&
	Array.isArray((value as Store).bookmarks) &&
	Array.isArray((value as Store).bookmarkColumns) &&
	Array.isArray((value as Store).groups) &&
	Array.isArray((value as Store).folders);

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
	readLibrary: async () => store,
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
		store = saved;
		notifyStore();
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
		const next = change(store);
		if (next !== store) {
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

export const useLibrary = (): Store =>
	useSyncExternalStore(subscribeTo(storeListeners), () => store);

export const useSyncStatus = (): SyncStatus =>
	useSyncExternalStore(subscribeTo(statusListeners), () => syncStatus);
