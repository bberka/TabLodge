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
import {readJson, removeKeys, writeJson} from './storage';

const LIBRARY_KEY = 'tablodge.library';

let store = emptyStore(Date.now());
let loaded = false;
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

async function write(next: Store): Promise<void> {
	store = next;
	await writeJson(LIBRARY_KEY, next);
	for (const listener of storeListeners) {
		listener();
	}
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
		for (const listener of storeListeners) {
			listener();
		}
	}

	await refreshStatus();
	await syncClient.wake().catch(() => undefined);
	await refreshStatus();
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
