import {randomUUID} from 'expo-crypto';
import {useSyncExternalStore} from 'react';
import type {Credential} from '../../../extension/src/shared/passcode';
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
	addSent,
	emptyPayload,
	parseSentPayload,
	type SentPayload,
} from '../../../extension/src/shared/send-to-private';
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
import {emptyStore, isStore} from '../library/store-shape';
import {createLibraryCore} from '../library/library-core';
import {
	PRIVATE_KEY_KEY,
	readJson,
	removeKeys,
	writeJson,
} from '../platform/storage';
import {setView} from '../library/view';
import {PRIVATE_TRASH_KEY} from '../library/trash';
import {settleTrash, syncedTrash} from '../library/trash-storage';
import {dropSafetyCopy} from '../transfer/restore';

const LIBRARY_KEY = 'tablodge.private.library';
const ON_KEY = 'tablodge.private.on';
const LOCK_KEY = 'tablodge.private.lock';
const KEPT_KEY = 'tablodge.private.keptKey';
const ERASING_KEY = 'tablodge.private.erasing';
const SENT_PENDING_KEY = 'tablodge.sendprivate.pending';
const prefix = (key: string) => `tablodge.private.${key}`;

type Lock = {
	id: string;
	wrapped: string;
	unsent?: true;
};

type Kept = {id: string; wrapped: string; raw: string};

const core = createLibraryCore(LIBRARY_KEY);
let status: SyncStatus = SYNC_OFF;
let client: ReturnType<typeof createSyncClient> | undefined;
let exists = false;
let lock: Lock | undefined;
let kept: Kept | undefined;
let adopting = false;
let erasing = false;
let unlockedKey: string | undefined;
let syncKey: string | undefined;
const listeners = new Set<() => void>();

const UNREADABLE =
	'Some private data on the sync server cannot be read with this key. Lock the private library here and open it again.';

const notify = () => {
	for (const listener of listeners) {
		listener();
	}
};

export type PrivateState = {
	exists: boolean;
	locked: boolean;
	hasLock: boolean;
	needsPassword: boolean;
};

const stateOf = (): PrivateState => ({
	exists,
	locked: exists && lock !== undefined && unlockedKey === undefined,
	hasLock: lock !== undefined,
	needsPassword: exists && lock === undefined,
});

let state: PrivateState = stateOf();

const refreshState = () => {
	const next = stateOf();
	if (
		next.exists !== state.exists ||
		next.locked !== state.locked ||
		next.hasLock !== state.hasLock ||
		next.needsPassword !== state.needsPassword
	) {
		state = next;
	}

	notify();
	if (isPrivateOpen()) {
		void takeInSent();
	}
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
				...(value.unsent === true && {unsent: true as const}),
			}
		: undefined;

let queue: Promise<unknown> = Promise.resolve();
const serial = async <T>(step: () => Promise<T>): Promise<T> => {
	const run = queue.then(step, step);
	queue = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
};

let epoch = 0;

const setLock = async (next: Lock | undefined) => {
	epoch += 1;
	lock = next;
	await (next ? writeJson(LOCK_KEY, next) : removeKeys([LOCK_KEY]));
};

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

let activeClient = 0;
let clientCount = 0;

const STOPPED = 'Private sync stopped.';

const baseCodec: Omit<SyncCodec, 'prepare'> & {
	prepare(
		call: (path: string, init?: RequestInit) => Promise<unknown>,
		live: () => void,
	): Promise<void>;
} = {
	async prepare(call, live) {
		const writeLock = async (next: Lock) =>
			serial(async () => {
				live();
				await setLock(next);
			});
		const body = await call('/v1/key');
		live();
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
			if (held && unlockedKey) {
				await call('/v1/key', {
					method: 'POST',
					body: JSON.stringify({key: serverKeyText(held), previous: null}),
				});
				live();
				if (lock?.unsent) {
					await writeLock({...lock, unsent: undefined});
				}

				syncKey = unlockedKey;
			} else {
				syncKey = undefined;
			}

			return;
		}

		if (held?.id !== server.id || !unlockedKey) {
			throw new SyncError('key', NEEDS_KEY_MESSAGE);
		}

		if (held.wrapped !== server.wrapped) {
			if (lock?.unsent) {
				try {
					await call('/v1/key', {
						method: 'POST',
						body: JSON.stringify({key: serverKeyText(lock), previous: stored}),
					});
					live();
					await writeLock({...lock, unsent: undefined});
				} catch (error) {
					if (!(error instanceof SyncError) || error.kind !== 'server') {
						throw error;
					}

					live();
					await writeLock({id: lock.id, wrapped: server.wrapped});
				}
			} else if (lock) {
				await writeLock({...lock, wrapped: server.wrapped});
			} else if (kept) {
				kept = {...kept, wrapped: server.wrapped};
				await writeJson(KEPT_KEY, kept);
			}
		}

		syncKey = unlockedKey;
	},
	async seal(change) {
		if (!syncKey && (lock || kept)) {
			throw new SyncError('key', NEEDS_KEY_MESSAGE);
		}

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
	clientCount += 1;
	const mine = clientCount;
	activeClient = mine;
	const live = () => {
		if (activeClient !== mine) {
			throw new SyncError('key', STOPPED);
		}
	};

	const codec: SyncCodec = {
		async prepare(call) {
			live();
			return baseCodec.prepare(call, live);
		},
		async seal(change) {
			live();
			return baseCodec.seal(change);
		},
		async open(change) {
			live();
			return baseCodec.open(change);
		},
	};
	return createSyncClient({
		async get(key) {
			return key === SYNC_CONFIG_KEY ? target() : readJson(prefix(key));
		},
		async set(key, value) {
			if (key === SYNC_CONFIG_KEY) {
				return;
			}

			live();
			await writeJson(prefix(key), value);
			if (key === SYNC_STATUS_KEY) {
				void refreshPrivateStatus();
			}
		},
		async remove(keys) {
			live();
			await removeKeys(
				keys.filter((key) => key !== SYNC_CONFIG_KEY).map((key) => prefix(key)),
			);
		},
		fetch: async (url, init) => fetch(url, init),
		openSocket: (url) => new WebSocket(url),
		mutate: async (work) =>
			core.mutate(async () => {
				live();
				return work();
			}),
		readLibrary: async () => core.store,
		trash: (() => {
			const trash = syncedTrash(
				'private',
				() => core.store.settings.trashRetentionDays,
			);
			return {
				async read() {
					live();
					return trash.read();
				},
				async apply(...args: Parameters<typeof trash.apply>) {
					live();
					return trash.apply(...args);
				},
			};
		})(),
		async writeLibrary(store) {
			live();
			return core.write(store);
		},
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

function runClient(): void {
	if (
		client ||
		!exists ||
		state.locked ||
		state.needsPassword ||
		!getPreferences().syncPrivate
	) {
		return;
	}

	client = createClient();
	void client.wake().then(refreshPrivateStatus, () => undefined);
}

function stopClient(): void {
	activeClient = 0;
	client?.stop();
	client = undefined;
	syncKey = undefined;
}

export async function startPrivate(): Promise<void> {
	erasing = (await readJson(ERASING_KEY)) === true;
	if (erasing) {
		await eraseSteps().catch(() => undefined);
	}

	exists = !erasing && (await readJson(ON_KEY)) === true;
	if (erasing) {
		exists = false;
		lock = undefined;
		kept = undefined;
		refreshState();
		await refreshPrivateStatus();
		return;
	}

	lock = parseLock(await readJson(LOCK_KEY));
	if (!lock) {
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

export const isPrivateOpen = (): boolean =>
	exists && !state.locked && !state.needsPassword;

export const canLockPrivate = (): boolean =>
	exists && lock !== undefined && unlockedKey !== undefined;

export const privateExists = (): boolean => exists;

export async function setupPrivate(credential?: Credential): Promise<void> {
	await serial(async () => {
		await settleErase();
		core.load(emptyStore(Date.now()));
		await core.write(core.store);
		exists = true;
		await writeJson(ON_KEY, true);
		await (credential ? protect(credential) : setLock(undefined));
	});
	refreshState();
	runClient();
	await refreshPrivateStatus();
}

async function protect(credential: Credential): Promise<void> {
	const key = generateKey();
	const wrapped = await wrapKey(key, credential.value);
	const hadKept = kept !== undefined;
	const installing = setLock({
		id: randomUUID(),
		wrapped,
	});
	unlockedKey = key;
	kept = undefined;
	await installing;
	if (hadKept) {
		await removeKeys([KEPT_KEY]);
	}
}

export async function protectPrivate(credential: Credential): Promise<void> {
	await serial(async () => protect(credential));
	stopClient();
	refreshState();
	runClient();
	await client?.resendAll().catch(() => undefined);
	await refreshPrivateStatus();
}

export type ChangeResult = 'ok' | 'wrong' | 'error';

export async function changePrivateLock(
	current: string,
	next: Credential,
): Promise<ChangeResult> {
	if (!lock || !unlockedKey) {
		return 'error';
	}

	const outcome: {value: ChangeResult} = {value: 'error'};
	try {
		await serial(async () => {
			const held = lock;
			if (!held || !unlockedKey) {
				return;
			}

			const key = await unwrapKey(held.wrapped, current);
			if (key === null) {
				outcome.value = 'wrong';
				return;
			}

			const wrapped = await wrapKey(key, next.value);
			if (lock?.id !== held.id || lock.wrapped !== held.wrapped) {
				return;
			}

			await setLock({id: held.id, wrapped, unsent: true});
			outcome.value = 'ok';
		});
	} catch {
		return 'error';
	}

	if (outcome.value !== 'ok') {
		return outcome.value;
	}

	refreshState();
	await client?.syncNow().catch(() => undefined);
	await refreshPrivateStatus();
	return 'ok';
}

export type UnlockResult = 'ok' | 'wrong' | 'error';

export async function unlockPrivate(credential: string): Promise<UnlockResult> {
	if (!lock) {
		return 'ok';
	}

	const started = epoch;
	try {
		const key = await unwrapKey(lock.wrapped, credential);
		if (key === null) {
			return 'wrong';
		}

		if (epoch !== started) {
			return 'error';
		}

		unlockedKey = key;
	} catch {
		return 'error';
	}

	refreshState();
	runClient();
	await refreshPrivateStatus().catch(() => undefined);
	return 'ok';
}

export async function lockPrivate(): Promise<void> {
	setView('regular');
	if (lock) {
		unlockedKey = undefined;
		stopClient();
	}

	refreshState();
	await refreshPrivateStatus();
}

export async function removePrivate(): Promise<void> {
	await serial(eraseNow);
}

async function eraseNow(): Promise<void> {
	setView('regular');
	stopClient();
	epoch += 1;
	try {
		await writeJson(ERASING_KEY, true);
	} catch {
		runClient();
		throw new EraseNotStartedError('The erase did not start.');
	}

	await settleTrash().catch(() => undefined);
	erasing = true;
	adopting = false;
	exists = false;
	unlockedKey = undefined;
	lock = undefined;
	kept = undefined;
	core.load(emptyStore(Date.now()));
	refreshState();
	await eraseSteps();
	await refreshPrivateStatus();
}

async function eraseSteps(): Promise<void> {
	await removeKeys([
		prefix('tablodge.sync.state'),
		prefix('tablodge.sync.status'),
		PRIVATE_TRASH_KEY,
		PRIVATE_KEY_KEY,
		KEPT_KEY,
	]);
	await serialSend(async () => removeKeys([SENT_PENDING_KEY]));
	await dropSafetyCopy('private');
	await removeKeys([LIBRARY_KEY]);
	await removeKeys([LOCK_KEY]);
	await removeKeys([ON_KEY]);
	await removeKeys([ERASING_KEY]);
	erasing = false;
}

async function settleErase(): Promise<void> {
	if (erasing) {
		await eraseSteps();
	}
}

export type OpenResult =
	| {ok: true}
	| {
			ok: false;
			reason: 'not-connected' | 'sync-off' | 'credential' | 'wrong' | 'error';
			message?: string;
	  };

export class EraseNotStartedError extends Error {}

export function eraseFailureNotice(error: unknown): {
	title: string;
	message: string;
} {
	return error instanceof EraseNotStartedError
		? {title: 'Could not erase it', message: 'Nothing was changed. Try again.'}
		: {
				title: 'Could not finish erasing',
				message:
					'The private library is closed and nothing of it syncs. The erase finishes the next time the app starts or you set up the private library.',
			};
}

const SERVER_CHECK_MS = 8000;

async function serverKey(to: {
	url: string;
	token: string;
}): Promise<{id: string; wrapped: string} | undefined> {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, SERVER_CHECK_MS);
	try {
		const response = await fetch(`${to.url}/v1/key`, {
			headers: [['Authorization', `Bearer ${to.token}`]],
			signal: controller.signal,
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
		const raw = isRecord(body) ? body.key : undefined;
		if (raw === null) {
			return undefined;
		}

		const parsed = parseServerKey(raw);
		if (!parsed) {
			throw new Error(
				'The sync server sent a key this version does not understand.',
			);
		}

		return {id: parsed.id, wrapped: parsed.wrapped};
	} catch (error) {
		throw controller.signal.aborted
			? new Error('The sync server did not answer.')
			: error;
	} finally {
		clearTimeout(timer);
	}
}

export async function privateServerInfo(): Promise<{
	connected: boolean;
	hasKey: boolean;
	failed: boolean;
}> {
	try {
		const to = getPreferences().syncPrivate ? await target() : undefined;
		if (!to) {
			return {connected: false, hasKey: false, failed: false};
		}

		const key = await serverKey(to);
		return {connected: true, hasKey: key !== undefined, failed: false};
	} catch {
		return {connected: true, hasKey: false, failed: true};
	}
}

export async function openFromServer(
	credential?: string,
	isCancelled: () => boolean = () => false,
): Promise<OpenResult> {
	try {
		const to = await target();
		if (!to) {
			return {ok: false, reason: 'not-connected'};
		}

		if (!getPreferences().syncPrivate) {
			return {ok: false, reason: 'sync-off'};
		}

		await serial(settleErase);
		const started = epoch;
		const server = await serverKey(to);
		if (server && (lock?.id !== server.id || adopting)) {
			if (credential === undefined) {
				return {ok: false, reason: 'credential'};
			}

			const key = await unwrapKey(server.wrapped, credential);
			if (key === null) {
				return {ok: false, reason: 'wrong'};
			}

			const committed = await serial(async () => {
				if (epoch !== started || isCancelled()) {
					return false;
				}

				const now = await target();
				if (
					epoch !== started ||
					isCancelled() ||
					!getPreferences().syncPrivate ||
					now?.url !== to.url ||
					now.token !== to.token
				) {
					return false;
				}

				const created = !exists;
				if (created) {
					core.load(emptyStore(Date.now()));
					exists = true;
				}

				stopClient();
				adopting = true;
				const installing = setLock({
					id: server.id,
					wrapped: server.wrapped,
				});
				unlockedKey = key;
				kept = undefined;
				if (created) {
					await core.write(core.store);
					await writeJson(ON_KEY, true);
				}

				await installing;
				await removeKeys([KEPT_KEY]);
				adopting = false;
				return true;
			});
			if (!committed) {
				return {
					ok: false,
					reason: 'error',
					message:
						'The private library changed while the server was checked. Try again.',
				};
			}
		} else if (!exists) {
			return {
				ok: false,
				reason: 'error',
				message:
					'Your server has no private library yet. Set up the private library on this phone, and it syncs once it has a password.',
			};
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

export const nudgePrivate = (): void => {
	client?.localChanged();
};

export async function syncPrivate(): Promise<void> {
	await client?.syncNow().catch(() => undefined);
	await refreshPrivateStatus();
}

export async function applyPrivateSyncSetting(): Promise<void> {
	if (getPreferences().syncPrivate) {
		await wakePrivate();
	} else {
		stopClient();
		await refreshPrivateStatus();
	}
}

export async function reconnectPrivate(): Promise<void> {
	stopClient();
	runClient();
	await client?.wake().catch(() => undefined);
	await refreshPrivateStatus();
}

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

type PendingSend = {id: string} & SentPayload;

const heldSends = new Set<string>();
let sendQueue: Promise<unknown> = Promise.resolve();
const serialSend = async <T>(step: () => Promise<T>): Promise<T> => {
	const run = sendQueue.then(step, step);
	sendQueue = run.catch(() => undefined);
	return run;
};

async function readPending(): Promise<PendingSend[]> {
	const saved = await readJson(SENT_PENDING_KEY);
	return Array.isArray(saved)
		? saved.flatMap((entry): PendingSend[] =>
				isRecord(entry) && typeof entry.id === 'string'
					? [{id: entry.id, ...parseSentPayload(entry)}]
					: [],
			)
		: [];
}

const writePending = async (pending: PendingSend[]) =>
	pending.length > 0
		? writeJson(SENT_PENDING_KEY, pending)
		: removeKeys([SENT_PENDING_KEY]);

export const canReceiveSent = (): boolean => exists && lock !== undefined;

export async function queueSent(
	sent: SentPayload,
	{held = true}: {held?: boolean} = {},
): Promise<string> {
	return serialSend(async () => {
		if (!canReceiveSent() || erasing) {
			throw new Error('There is no private library to send to.');
		}

		const id = randomUUID();
		if (held) {
			heldSends.add(id);
		}

		await writePending([...(await readPending()), {id, ...sent}]);
		return id;
	});
}

export async function withdrawSent(id: string): Promise<boolean> {
	return serialSend(async () => {
		heldSends.delete(id);
		const pending = await readPending();
		if (pending.every((entry) => entry.id !== id)) {
			return false;
		}

		await writePending(pending.filter((entry) => entry.id !== id));
		return true;
	});
}

const SENT_RETRY_MS = 30_000;

export async function releaseSent(id: string): Promise<void> {
	heldSends.delete(id);
	try {
		await takeInSent();
	} catch {
		setTimeout(() => {
			void takeInSent().catch(() => undefined);
		}, SENT_RETRY_MS);
	}
}

export async function takeInSent(): Promise<void> {
	await serialSend(async () => {
		if (!isPrivateOpen()) {
			return;
		}

		const pending = await readPending();
		const ready = pending.filter((entry) => !heldSends.has(entry.id));
		if (ready.length === 0) {
			return;
		}

		await core.mutate(async () => {
			const received = emptyPayload();
			for (const entry of ready) {
				received.links.push(...entry.links);
				received.columns.push(...entry.columns);
				received.sessions.push(...entry.sessions);
			}

			await core.write(addSent(core.store, received).store);
		});
		client?.localChanged();
		const imported = new Set(ready.map((entry) => entry.id));
		await writePending(pending.filter((entry) => !imported.has(entry.id)));
	});
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

export const getPrivateState = (): PrivateState => state;

export const usePrivateState = (): PrivateState =>
	useSyncExternalStore(subscribe, () => state);
