/*
The private windows' library, read only. The extension keeps it apart and syncs it to the same server under
`/private` (docs/adr/0002-private-window-sync.md). When it has a PIN or password, every value is sealed with a random
sync key, and the server holds only that key wrapped with the PIN or password. This phone asks for the PIN or
password once, keeps the unwrapped key in the Android keystore, and opens values as they arrive. It never sends a
change, so it cannot alter or re-encrypt what the extension keeps there.
*/
import {randomUUID} from 'expo-crypto';
import {useSyncExternalStore} from 'react';
import {isSealed, type SealedValue} from '../../src/app/private-lock';
import {
	NEEDS_KEY_MESSAGE,
	parsePrivateSyncKey,
	parseServerKey,
	type PrivateSyncKey,
} from '../../src/app/private-sync';
import {isRecord} from '../../src/shared/library-values';
import {recordKey} from '../../src/shared/sync/changes';
import {
	createSyncClient,
	SYNC_CONFIG_KEY,
	SYNC_OFF,
	SYNC_STATUS_KEY,
	SyncError,
	type SyncCodec,
	type SyncStatus,
} from '../../src/shared/sync/client';
import {openSealed, unwrapKey} from '../modules/tablodge-crypto';
import {emptyStore, isStore} from './library';
import {createLibraryCore} from './library-core';
import {PRIVATE_KEY_KEY, readJson, removeKeys, writeJson} from './storage';
import {setView} from './view';

const LIBRARY_KEY = 'tablodge.private.library';
const ON_KEY = 'tablodge.private.on';
const prefix = (key: string) => `tablodge.private.${key}`;

const core = createLibraryCore(LIBRARY_KEY);
let status: SyncStatus = SYNC_OFF;
const statusListeners = new Set<() => void>();
let client: ReturnType<typeof createSyncClient> | undefined;
let enabled = false;

const UNREADABLE =
	'Some private data on the sync server cannot be read with this key. Lock the private library here and open it again.';

const loadKey = async () =>
	parsePrivateSyncKey(await readJson(PRIVATE_KEY_KEY));

/**
The regular connection with `/private` added, or nothing while no server is connected.
*/
async function target(): Promise<{url: string; token: string} | undefined> {
	const regular = await readJson(SYNC_CONFIG_KEY);
	return isRecord(regular) &&
		typeof regular.url === 'string' &&
		typeof regular.token === 'string'
		? {url: `${regular.url}/private`, token: regular.token}
		: undefined;
}

let syncKey: string | undefined;

const codec: SyncCodec = {
	async prepare(call) {
		const body = await call('/v1/key');
		const stored = isRecord(body) ? body.key : undefined;
		const server = parseServerKey(stored);
		if (stored !== null && !server) {
			throw new SyncError(
				'server',
				'The sync server sent an answer this version does not understand.',
			);
		}

		const local = await loadKey();
		if (!server) {
			syncKey = undefined;
			return;
		}

		if (local?.id !== server.id) {
			throw new SyncError('key', NEEDS_KEY_MESSAGE);
		}

		// Another device changed its PIN or password and rewrapped the same key.
		if (local.wrapped !== server.wrapped) {
			await writeJson(PRIVATE_KEY_KEY, {...local, wrapped: server.wrapped});
		}

		syncKey = local.raw;
	},
	// This phone never sends a change, so there is nothing to seal.
	async seal(change) {
		return change;
	},
	async open(change) {
		if (!isSealed(change.value)) {
			return {change, reseal: false};
		}

		if (!syncKey) {
			throw new SyncError('key', NEEDS_KEY_MESSAGE);
		}

		const {iv, ct}: SealedValue = change.value;
		const text = await openSealed(syncKey, iv, ct, recordKey(change));
		if (text === null) {
			throw new SyncError('key', UNREADABLE);
		}

		return {
			change: {...change, value: JSON.parse(text) as unknown},
			reseal: false,
		};
	},
};

function createClient() {
	return createSyncClient({
		async get(key) {
			if (key === SYNC_CONFIG_KEY) {
				return enabled ? target() : undefined;
			}

			return readJson(prefix(key));
		},
		async set(key, value) {
			if (key === SYNC_CONFIG_KEY) {
				return;
			}

			await writeJson(prefix(key), value);
			if (key === SYNC_STATUS_KEY) {
				void refreshPrivateStatus();
			}
		},
		async remove(keys) {
			await removeKeys(
				keys.filter((key) => key !== SYNC_CONFIG_KEY).map((key) => prefix(key)),
			);
		},
		fetch: async (url, init) => fetch(url, init),
		openSocket: (url) => new WebSocket(url),
		mutate: core.mutate,
		readLibrary: async () => core.store,
		writeLibrary: core.write,
		async backup() {},
		codec,
		randomId: () => randomUUID(),
		now: Date.now,
	});
}

export async function refreshPrivateStatus(): Promise<void> {
	status = client ? await client.status() : SYNC_OFF;
	for (const listener of statusListeners) {
		listener();
	}
}

/**
Loads what an earlier visit saved and resumes syncing when the private library was opened before. Call at startup.
*/
export async function startPrivate(): Promise<void> {
	enabled = (await readJson(ON_KEY)) === true;
	const saved = await readJson(LIBRARY_KEY);
	if (isStore(saved)) {
		core.load(saved);
	}

	if (!enabled) {
		return;
	}

	client = createClient();
	await refreshPrivateStatus();
	void client.wake().then(refreshPrivateStatus, () => undefined);
}

export type OpenResult =
	| {ok: true}
	| {
			ok: false;
			/**
			`not-connected`: no server. `credential`: the library is protected and needs its PIN or password. `wrong`: that
			one did not open it. `unavailable`: the server has no private library or is too old. `error`: anything else.
			*/
			reason:
				'not-connected' | 'credential' | 'wrong' | 'unavailable' | 'error';
			message?: string;
	  };

async function serverKey(to: {
	url: string;
	token: string;
}): Promise<
	| {state: 'none'}
	| {state: 'key'; id: string; wrapped: string}
	| {state: 'unavailable'}
> {
	const response = await fetch(`${to.url}/v1/key`, {
		headers: [['Authorization', `Bearer ${to.token}`]],
	});
	if (response.status === 404) {
		return {state: 'unavailable'};
	}

	if (!response.ok) {
		throw new Error(
			`The sync server answered with an error (${response.status}).`,
		);
	}

	const body: unknown = await response.json();
	const stored = isRecord(body) ? body.key : undefined;
	const parsed = parseServerKey(stored);
	if (parsed) {
		return {state: 'key', id: parsed.id, wrapped: parsed.wrapped};
	}

	// No key on the server means the library is not protected. Anything else is a shape this version cannot read.
	const state =
		stored === null || stored === undefined ? 'none' : 'unavailable';
	return {state};
}

/**
Opens the private library: checks the server, asks for the PIN or password when the library is protected and this
phone has no key yet, then pulls it. Pass `credential` after a `credential` result.
*/
export async function openPrivate(credential?: string): Promise<OpenResult> {
	const to = await target();
	if (!to) {
		return {ok: false, reason: 'not-connected'};
	}

	try {
		const server = await serverKey(to);
		if (server.state === 'unavailable') {
			return {ok: false, reason: 'unavailable'};
		}

		if (server.state === 'key') {
			const local = await loadKey();
			if (local?.id !== server.id) {
				if (credential === undefined) {
					return {ok: false, reason: 'credential'};
				}

				const raw = await unwrapKey(server.wrapped, credential);
				if (raw === null) {
					return {ok: false, reason: 'wrong'};
				}

				const key: PrivateSyncKey = {
					id: server.id,
					raw,
					wrapped: server.wrapped,
				};
				await writeJson(PRIVATE_KEY_KEY, key);
			}
		}

		enabled = true;
		await writeJson(ON_KEY, true);
		client ??= createClient();
		await client.wake();
		await refreshPrivateStatus();
		return status.error
			? {ok: false, reason: 'error', message: status.error}
			: {ok: true};
	} catch (error) {
		return {
			ok: false,
			reason: 'error',
			message:
				error instanceof Error ? error.message : 'Could not reach the server.',
		};
	}
}

/**
Forgets the private library on this phone: the key, the saved copy, and its sync position. The server keeps it.
*/
export async function lockPrivate(): Promise<void> {
	client?.stop();
	client = undefined;
	enabled = false;
	syncKey = undefined;
	setView('regular');
	await removeKeys([
		PRIVATE_KEY_KEY,
		ON_KEY,
		LIBRARY_KEY,
		prefix('tablodge.sync.state'),
		prefix('tablodge.sync.status'),
	]);
	core.load(emptyStore(Date.now()));
	await refreshPrivateStatus();
}

/**
Pulls the private library now, for pull to refresh. A failure shows in the status.
*/
export async function syncPrivate(): Promise<void> {
	await client?.syncNow().catch(() => undefined);
	await refreshPrivateStatus();
}

/**
Closes the private library's live connection while the app is in the background, and opens it again in front.
*/
export async function pausePrivate(): Promise<void> {
	await client?.pause().catch(() => undefined);
}

export async function wakePrivate(): Promise<void> {
	await client?.wake().catch(() => undefined);
	await refreshPrivateStatus();
}

export const isPrivateOpen = (): boolean => enabled;

export const usePrivateStore = () =>
	useSyncExternalStore(core.subscribe, () => core.store);

export const usePrivateStatus = (): SyncStatus =>
	useSyncExternalStore(
		(listener) => {
			statusListeners.add(listener);
			return () => {
				statusListeners.delete(listener);
			};
		},
		() => status,
	);
