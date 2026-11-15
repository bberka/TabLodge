/*
The private windows' library on this phone: a library of its own that is edited like the regular one, with or without
a server. It can have a PIN or password. The data key is random; only a copy of it wrapped by the PIN is kept (the same
envelope the extension uses), and the unwrapped key lives in memory while the library is unlocked. When a server is
connected the library syncs with the server's `/private` library, sealing every value with that key, as the extension
does (docs/adr/0002-private-window-sync.md). The library itself is stored on the phone unsealed, inside the app's
private storage; the PIN decides who can open it in the app and who can read it on the server.
*/
import {randomUUID} from 'expo-crypto';
import {useSyncExternalStore} from 'react';
import type {
	Credential,
	CredentialKind,
} from '../../../extension/src/shared/passcode';
import {
	isSealed,
	type SealedValue,
} from '../../../extension/src/shared/private-lock';
import {
	NEEDS_KEY_MESSAGE,
	parseServerKey,
	privateSyncTarget,
} from '../../../extension/src/shared/private-sync';
import {isRecord} from '../../../extension/src/shared/library-values';
import type {Store} from '../../../extension/src/shared/types';
import {recordKey} from '../../../extension/src/shared/sync/changes';
import {
	createSyncClient,
	SYNC_CONFIG_KEY,
	SYNC_OFF,
	SYNC_STATUS_KEY,
	SyncError,
	type SyncCodec,
	type SyncStatus,
} from '../../../extension/src/shared/sync/client';
import {
	generateKey,
	openSealed,
	sealValue,
	unwrapKey,
	wrapKey,
} from '../../modules/tablodge-crypto';
import {getPreferences} from '../settings/preferences';
import {emptyStore, isStore} from '../library/library';
import {createLibraryCore} from '../library/library-core';
import {
	PRIVATE_KEY_KEY,
	readJson,
	removeKeys,
	writeJson,
} from '../platform/storage';
import {setView} from '../library/view';
import {PRIVATE_TRASH_KEY} from '../library/trash';
import {dropSafetyCopy} from '../transfer/restore';

const LIBRARY_KEY = 'tablodge.private.library';
const ON_KEY = 'tablodge.private.on';
const LOCK_KEY = 'tablodge.private.lock';
// Where the data key waits, in the Android keystore, after the PIN was removed. See `Kept`.
const KEPT_KEY = 'tablodge.private.keptKey';
const prefix = (key: string) => `tablodge.private.${key}`;

/**
What protects the library: the data key, wrapped by a PIN or password. `kind` is missing when the key came from the
server, whose copy does not say which it is.
*/
type Lock = {
	id: string;
	wrapped: string;
	kind?: CredentialKind;
	/**
	The PIN or password was changed here and the server still holds the old wrapped copy. The next round sends it.
	*/
	unsent?: true;
};

/**
The data key of a library whose PIN or password was removed, so that it can keep syncing with a server that holds it
sealed. It sits in the Android keystore, which is where the server token lives too.
*/
type Kept = {id: string; wrapped: string; raw: string};

const core = createLibraryCore(LIBRARY_KEY);
let status: SyncStatus = SYNC_OFF;
let client: ReturnType<typeof createSyncClient> | undefined;
// Whether this phone has a private library at all.
let exists = false;
let lock: Lock | undefined;
let kept: Kept | undefined;
// The data key, base64, while a protected library is unlocked.
let unlockedKey: string | undefined;
// The key values are sealed with on the server, for the current round; none while the server's library is not sealed.
let syncKey: string | undefined;
const listeners = new Set<() => void>();

const UNREADABLE =
	'Some private data on the sync server cannot be read with this key. Lock the private library here and open it again.';

const notify = () => {
	for (const listener of listeners) {
		listener();
	}
};

/**
Where the private library stands: not set up, locked behind its PIN or password, or open.
*/
export type PrivateState = {
	exists: boolean;
	locked: boolean;
	/**
	The kind of lock, or null for none. A lock that came from the server does not say, and reads as a password.
	*/
	lockedWith: CredentialKind | null;
};

const stateOf = (): PrivateState => ({
	exists,
	locked: exists && lock !== undefined && unlockedKey === undefined,
	lockedWith: lock ? (lock.kind ?? 'password') : null,
});

let state: PrivateState = stateOf();

const refreshState = () => {
	const next = stateOf();
	if (
		next.exists !== state.exists ||
		next.locked !== state.locked ||
		next.lockedWith !== state.lockedWith
	) {
		state = next;
	}

	notify();
};

const parseKept = (value: unknown): Kept | undefined =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.wrapped === 'string' &&
	typeof value.raw === 'string'
		? {id: value.id, wrapped: value.wrapped, raw: value.raw}
		: undefined;

const parseLock = (value: unknown): Lock | undefined =>
	isRecord(value) &&
	typeof value.id === 'string' &&
	typeof value.wrapped === 'string'
		? {
				id: value.id,
				wrapped: value.wrapped,
				...((value.kind === 'pin' || value.kind === 'password') && {
					kind: value.kind,
				}),
				...(value.unsent === true && {unsent: true as const}),
			}
		: undefined;

const setLock = async (next: Lock | undefined) => {
	lock = next;
	await (next ? writeJson(LOCK_KEY, next) : removeKeys([LOCK_KEY]));
};

/**
The regular connection with `/private` added, or nothing while no server is connected.
*/
async function target(): Promise<{url: string; token: string} | undefined> {
	const regular = await readJson(SYNC_CONFIG_KEY);
	return isRecord(regular) &&
		typeof regular.url === 'string' &&
		typeof regular.token === 'string'
		? privateSyncTarget({url: regular.url, token: regular.token})
		: undefined;
}

const serverKeyText = (held: {id: string; wrapped: string}) =>
	JSON.stringify({v: 1, id: held.id, wrapped: held.wrapped});

const codec: SyncCodec = {
	async prepare(call) {
		const body = await call('/v1/key');
		const stored = isRecord(body) ? body.key : undefined;
		const server = parseServerKey(stored);
		if (stored !== null && stored !== undefined && !server) {
			throw new SyncError(
				'server',
				'The sync server sent an answer this version does not understand.',
			);
		}

		const held = lock ?? kept;
		if (!server) {
			// The server's library has no key yet. A protected library puts its own there, and from then on the server
			// holds sealed values only.
			if (held && unlockedKey) {
				await call('/v1/key', {
					method: 'POST',
					body: JSON.stringify({key: serverKeyText(held), previous: null}),
				});
				if (lock?.unsent) {
					await setLock({...lock, unsent: undefined});
				}

				syncKey = unlockedKey;
			} else {
				syncKey = undefined;
			}

			return;
		}

		// The server's library is protected by a key this phone does not hold.
		if (held?.id !== server.id || !unlockedKey) {
			throw new SyncError('key', NEEDS_KEY_MESSAGE);
		}

		if (held.wrapped !== server.wrapped) {
			if (lock?.unsent) {
				// The PIN or password was changed here, perhaps while offline. The server's copy is replaced, unless another
				// device changed it first, and then that device's wins.
				try {
					await call('/v1/key', {
						method: 'POST',
						body: JSON.stringify({key: serverKeyText(lock), previous: stored}),
					});
					await setLock({...lock, unsent: undefined});
				} catch (error) {
					if (!(error instanceof SyncError) || error.kind !== 'server') {
						throw error;
					}

					await setLock({id: lock.id, wrapped: server.wrapped});
				}
			} else if (lock) {
				// Another device changed its PIN or password and rewrapped the same key.
				await setLock({...lock, wrapped: server.wrapped});
			} else if (kept) {
				kept = {...kept, wrapped: server.wrapped};
				await writeJson(KEPT_KEY, kept);
			}
		}

		syncKey = unlockedKey;
	},
	async seal(change) {
		if (!syncKey || change.deleted) {
			return change;
		}

		const text = JSON.stringify(change.value);
		if (text === undefined) {
			return change;
		}

		const {iv, ct} = await sealValue(syncKey, recordKey(change), text);
		const value: SealedValue = {tlock: 1, iv, ct};
		return {...change, value};
	},
	async open(change) {
		if (!isSealed(change.value)) {
			return {change, reseal: syncKey !== undefined};
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
			return key === SYNC_CONFIG_KEY ? target() : readJson(prefix(key));
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
	refreshState();
}

/**
Starts syncing when the library is open and a server is connected; the client does nothing without a connection.
*/
function runClient(): void {
	if (client || !exists || state.locked || !getPreferences().syncPrivate) {
		return;
	}

	client = createClient();
	void client.wake().then(refreshPrivateStatus, () => undefined);
}

function stopClient(): void {
	client?.stop();
	client = undefined;
	syncKey = undefined;
}

/**
Loads the library and its lock and, when it is open, resumes syncing. Call at startup.
*/
export async function startPrivate(): Promise<void> {
	exists = (await readJson(ON_KEY)) === true;
	lock = parseLock(await readJson(LOCK_KEY));
	if (!lock) {
		// An earlier version kept the server's key here, unwrapped, after the PIN was asked once. Keep its wrapped copy as
		// the lock, so the library asks for the same PIN, and drop the unwrapped one.
		const old = await readJson(PRIVATE_KEY_KEY);
		if (
			isRecord(old) &&
			typeof old.id === 'string' &&
			typeof old.wrapped === 'string'
		) {
			await setLock({id: old.id, wrapped: old.wrapped});
			exists = true;
			await writeJson(ON_KEY, true);
		}

		await removeKeys([PRIVATE_KEY_KEY]);
	}

	kept = lock ? undefined : parseKept(await readJson(KEPT_KEY));
	unlockedKey = kept?.raw;
	const saved = await readJson(LIBRARY_KEY);
	if (isStore(saved)) {
		core.load(saved);
	}

	refreshState();
	runClient();
	await refreshPrivateStatus();
}

/**
Whether the private library can be shown now: it exists and is not locked.
*/
export const isPrivateOpen = (): boolean => exists && !state.locked;

/**
Whether the private library is open and has a PIN or password to lock it with, so locking it does something.
*/
export const canLockPrivate = (): boolean =>
	exists && lock !== undefined && unlockedKey !== undefined;

export const privateExists = (): boolean => exists;

/**
Makes the private library on this phone, empty, with a PIN or password when one is given. It works without a server and
syncs once one is connected.
*/
export async function setupPrivate(credential?: Credential): Promise<void> {
	core.load(emptyStore(Date.now()));
	await core.write(core.store);
	exists = true;
	await writeJson(ON_KEY, true);
	await (credential ? protect(credential) : setLock(undefined));
	refreshState();
	runClient();
	await refreshPrivateStatus();
}

async function protect(credential: Credential): Promise<void> {
	// A library whose PIN was removed takes the same key back, so the server's copy stays readable.
	const key = kept?.raw ?? generateKey();
	await setLock({
		id: kept?.id ?? randomUUID(),
		wrapped: await wrapKey(key, credential.value),
		kind: credential.kind,
		...(kept && {unsent: true as const}),
	});
	unlockedKey = key;
	if (!kept) {
		return;
	}

	kept = undefined;
	await removeKeys([KEPT_KEY]);
}

/**
Puts a PIN or password on a library that has none. The next sync gives the server the same lock.
*/
export async function protectPrivate(credential: Credential): Promise<void> {
	const again = kept !== undefined;
	await protect(credential);
	stopClient();
	refreshState();
	runClient();
	if (!again) {
		// What this library already sent the server is plain there. Every record goes again, sealed with the new key.
		await client?.resendAll().catch(() => undefined);
	}

	await refreshPrivateStatus();
}

export type ChangeResult = 'ok' | 'wrong' | 'error';

/**
Wraps the same data key with a new PIN or password, so nothing is encrypted again. The server's copy follows on the next
round, and other devices keep working with their own copy of the key.
*/
export async function changePrivateLock(
	current: string,
	next: Credential,
): Promise<ChangeResult> {
	if (!lock || !unlockedKey) {
		return 'error';
	}

	try {
		const key = await unwrapKey(lock.wrapped, current);
		if (key === null) {
			return 'wrong';
		}

		await setLock({
			id: lock.id,
			wrapped: await wrapKey(key, next.value),
			kind: next.kind,
			unsent: true,
		});
	} catch {
		return 'error';
	}

	refreshState();
	await client?.syncNow().catch(() => undefined);
	await refreshPrivateStatus();
	return 'ok';
}

/**
Takes the PIN or password off the library, which then opens without one. The data key stays in the keystore, so a
library that syncs sealed with a server keeps doing so.
*/
export async function removePrivateLock(
	current: string,
): Promise<ChangeResult> {
	if (!lock || !unlockedKey) {
		return 'error';
	}

	try {
		const key = await unwrapKey(lock.wrapped, current);
		if (key === null) {
			return 'wrong';
		}

		kept = {id: lock.id, wrapped: lock.wrapped, raw: key};
		await writeJson(KEPT_KEY, kept);
		await setLock(undefined);
	} catch {
		return 'error';
	}

	refreshState();
	return 'ok';
}

export type UnlockResult = 'ok' | 'wrong' | 'error';

/**
Opens a locked library with its PIN or password, and resumes syncing.
*/
export async function unlockPrivate(credential: string): Promise<UnlockResult> {
	if (!lock) {
		return 'ok';
	}

	try {
		const key = await unwrapKey(lock.wrapped, credential);
		if (key === null) {
			return 'wrong';
		}

		unlockedKey = key;
	} catch {
		return 'error';
	}

	refreshState();
	runClient();
	await refreshPrivateStatus();
	return 'ok';
}

/**
Locks the library: forgets the key, stops syncing, and goes back to the regular library. The data stays on the phone.
A library without a PIN or password only goes back to the regular library.
*/
export async function lockPrivate(): Promise<void> {
	setView('regular');
	if (lock) {
		unlockedKey = undefined;
		stopClient();
	}

	refreshState();
	await refreshPrivateStatus();
}

/**
Deletes the private library from this phone: its data, its lock, and its sync position. The server keeps its copy.
*/
export async function removePrivate(): Promise<void> {
	setView('regular');
	stopClient();
	exists = false;
	unlockedKey = undefined;
	lock = undefined;
	kept = undefined;
	await removeKeys([
		ON_KEY,
		LOCK_KEY,
		KEPT_KEY,
		LIBRARY_KEY,
		PRIVATE_TRASH_KEY,
		PRIVATE_KEY_KEY,
		prefix('tablodge.sync.state'),
		prefix('tablodge.sync.status'),
	]);
	core.load(emptyStore(Date.now()));
	await dropSafetyCopy('private');
	refreshState();
	await refreshPrivateStatus();
}

export type OpenResult =
	| {ok: true}
	| {
			ok: false;
			/**
			`not-connected`: no server. `credential`: the server's library is protected and needs its PIN or password.
			`wrong`: that one did not open it. `error`: anything else.
			*/
			reason: 'not-connected' | 'credential' | 'wrong' | 'error';
			message?: string;
	  };

async function serverKey(to: {
	url: string;
	token: string;
}): Promise<{id: string; wrapped: string} | undefined> {
	const response = await fetch(`${to.url}/v1/key`, {
		headers: [['Authorization', `Bearer ${to.token}`]],
	});
	if (response.status === 404) {
		return undefined;
	}

	if (!response.ok) {
		throw new Error(
			`The sync server answered with an error (${response.status}).`,
		);
	}

	const body: unknown = await response.json();
	const parsed = parseServerKey(isRecord(body) ? body.key : undefined);
	return parsed ? {id: parsed.id, wrapped: parsed.wrapped} : undefined;
}

/**
Brings in the private library the extension keeps on the connected server. A protected one asks for its PIN or password
(pass `credential` after a `credential` result); the phone's library then takes that lock, and keeps everything it
already has, which syncs with the server's. Without a library on the phone, one is made.
*/
export async function openFromServer(credential?: string): Promise<OpenResult> {
	const to = getPreferences().syncPrivate ? await target() : undefined;
	if (!to) {
		return {ok: false, reason: 'not-connected'};
	}

	try {
		const server = await serverKey(to);
		if (server && (lock ?? kept)?.id !== server.id) {
			if (credential === undefined) {
				return {ok: false, reason: 'credential'};
			}

			const key = await unwrapKey(server.wrapped, credential);
			if (key === null) {
				return {ok: false, reason: 'wrong'};
			}

			if (!exists) {
				core.load(emptyStore(Date.now()));
				await core.write(core.store);
				exists = true;
				await writeJson(ON_KEY, true);
			}

			await setLock({id: server.id, wrapped: server.wrapped});
			kept = undefined;
			await removeKeys([KEPT_KEY]);
			unlockedKey = key;
			stopClient();
		} else if (!exists) {
			await setupPrivate();
		}

		refreshState();
		runClient();
		await client?.wake();
		await refreshPrivateStatus();
		return status.error && !status.needsKey
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
Changes the private library and sends the change to the server after a short delay. It runs only while the library is
open.
*/
export async function editPrivate(
	change: (current: Store) => Store,
): Promise<void> {
	await core.mutate(async () => {
		const next = change(core.store);
		if (next !== core.store) {
			await core.write(next);
		}
	});
	client?.localChanged();
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
/**
Starts or stops the private library's sync after the setting changes.
*/
export async function applyPrivateSyncSetting(): Promise<void> {
	if (getPreferences().syncPrivate) {
		await wakePrivate();
	} else {
		stopClient();
		await refreshPrivateStatus();
	}
}

/**
Starts the private library's sync over a server that was just connected or changed. The sync client reads the server
address once, so the one made before the server was there is dropped.
*/
export async function reconnectPrivate(): Promise<void> {
	stopClient();
	runClient();
	await client?.wake().catch(() => undefined);
	await refreshPrivateStatus();
}

/**
Ends the private library's sync when the server is disconnected: the sync position goes, so a server connected later
gets the whole library again. The library on the phone stays.
*/
export async function disconnectPrivate(): Promise<void> {
	stopClient();
	await removeKeys([
		prefix('tablodge.sync.state'),
		prefix('tablodge.sync.status'),
	]);
	await refreshPrivateStatus();
}

export async function pausePrivate(): Promise<void> {
	await client?.pause().catch(() => undefined);
}

export async function wakePrivate(): Promise<void> {
	runClient();
	await client?.wake().catch(() => undefined);
	await refreshPrivateStatus();
}

export const getPrivateStore = (): Store => core.store;

export const getPrivateStatus = (): SyncStatus => status;

export const usePrivateStore = () =>
	useSyncExternalStore(core.subscribe, () => core.store);

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const usePrivateStatus = (): SyncStatus =>
	useSyncExternalStore(subscribe, () => status);

export const usePrivateState = (): PrivateState =>
	useSyncExternalStore(subscribe, () => state);
