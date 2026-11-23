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
import {SHARED_PAGE_LIVE_PASSWORD_FEATURE} from '../../../extension/src/shared/sync/shared-pages';
import {
	disconnectPrivate,
	editPrivate,
	reconnectPrivate,
	usePrivateStore,
} from '../private/private-library';
import {getPreferences} from '../settings/preferences';
import {readJson, removeKeys, writeJson} from '../platform/storage';
import {syncLiveSharedPages} from './shared-pages';
import {emptyStore, isStore} from './store-shape';
import {DEFAULTS as LINK_DEFAULTS, type LinkSettings} from './links';
import {createLibraryCore} from './library-core';
import {syncedTrash} from './trash-storage';
import {archiveStale} from './session-edits';
import {isPrivateView, useView} from './view';
import type * as SeedModuleNamespace from './seed';

const sampleModule = __DEV__
	? // eslint-disable-next-line @typescript-eslint/no-require-imports, unicorn/prefer-module -- the sample data is required only in dev builds, which Metro strips from release bundles
		(require('./seed') as typeof SeedModuleNamespace)
	: undefined;

const LIBRARY_KEY = 'tablodge.library';
const SEED_KEY = 'tablodge.dev.seed';

const core = createLibraryCore(LIBRARY_KEY);
const {mutate, write, notify: notifyStore} = core;
const regularRetention = () => core.store.settings.trashRetentionDays;
let loaded = false;
const {promise: libraryLoaded, resolve: finishLoading} =
	Promise.withResolvers<void>();
let sampleOn = false;

let syncStatus: SyncStatus = SYNC_OFF;
const statusListeners = new Set<() => void>();

export const syncClient = createSyncClient({
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
	async backup() {},
	async onSynced(target, server) {
		if (server?.features.includes(SHARED_PAGE_LIVE_PASSWORD_FEATURE)) {
			await syncLiveSharedPages(target, core.store);
		}
	},
	randomId: () => randomUUID(),
	now: Date.now,
});

export async function refreshStatus(): Promise<void> {
	syncStatus = await syncClient.status();
	for (const listener of statusListeners) {
		listener();
	}
}

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

export const whenLibraryLoaded = async (): Promise<void> => libraryLoaded;

export const isSampleData = (): boolean => __DEV__ && sampleOn;

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

export async function connectServer(
	url: string,
	token: string,
): Promise<SyncStatus> {
	if (sampleOn) {
		await clearLibrary();
	}

	const status = await syncClient.connect(url, token);
	void reconnectPrivate();
	return status;
}

export async function disconnectServer(): Promise<SyncStatus> {
	const status = await syncClient.disconnect();
	await disconnectPrivate();
	return status;
}

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

export const nudgeRegular = (): void => {
	syncClient.localChanged();
};

export type LibraryName = 'regular' | 'private';

export async function editIn(
	name: LibraryName,
	change: (current: Store) => Store,
): Promise<void> {
	await (name === 'private' ? editPrivate(change) : editRegular(change));
}

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

export const useLibrary = (): Store => {
	const regular = useSyncExternalStore(core.subscribe, () => core.store);
	const priv = usePrivateStore();
	return useView() === 'private' ? priv : regular;
};

export const useLibraryOf = (name: LibraryName): Store => {
	const regular = useSyncExternalStore(core.subscribe, () => core.store);
	const priv = usePrivateStore();
	return name === 'private' ? priv : regular;
};

export const useRegularLibrary = (): Store =>
	useSyncExternalStore(core.subscribe, () => core.store);

export const useSyncStatus = (): SyncStatus =>
	useSyncExternalStore(subscribeTo(statusListeners), () => syncStatus);

export const subscribeSyncStatus = subscribeTo(statusListeners);

export const getSyncStatus = (): SyncStatus => syncStatus;

export async function pauseSync(): Promise<void> {
	await syncClient.pause().catch(() => undefined);
	await refreshStatus();
}

export async function wakeSync(): Promise<void> {
	await syncClient.wake().catch(() => undefined);
	await refreshStatus();
}

export const subscribeLibrary = core.subscribe;

export const getLibrary = (): Store => core.store;

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
