/*
Encryption for syncing the private windows' library (the separate, saved private storage).

When a device that has a private PIN or password turns private sync on, it makes a random sync key, wraps it in the
same credential envelope as the private lock, and stores the wrapped copy on the server with POST /v1/key. Every
record value it sends is then sealed with that key, with the record's key as authenticated data, so the server sees
which records exist and when they change but not what they hold. Another device joins by entering the same PIN or
password once; it keeps the unwrapped key in its own private storage, which the local lock seals in turn.

Changing the PIN or password rewraps the same key, so nothing has to be encrypted again and the other devices keep
syncing. A library synced before any device had a lock holds plain values; a device with the key sends each one
again sealed as it pulls it (`reseal`).
*/
import {recordKey, type SyncChange} from './sync/changes';
import {SyncError, type SyncCodec} from './sync/client';
import {isRecord} from './library-values';
import type {Credential} from './passcode';
import {
	fromBase64,
	generateDataKey,
	importDataKey,
	isSealed,
	openValue,
	sealValue,
	toBase64,
	unwrapDataKey,
	wrapDataKey,
} from './private-lock';

/**
The sync key as this device keeps it: `raw` is the key itself (base64), `wrapped` the copy on the server.
*/
export type PrivateSyncKey = {id: string; raw: string; wrapped: string};

/**
The query a regular window adds when it opens Settings in a private window to turn private sync on there.
*/
export const PRIVATE_SYNC_ASK = 'privateSync=ask';

type ServerKey = {v: 1; id: string; wrapped: string};

export const NEEDS_KEY_MESSAGE =
	'Private data on the sync server is protected with a PIN or password. Enter it in Settings under Sync to sync private windows on this browser.';
const LOST_KEY_MESSAGE =
	'The key that protects private data is gone from the sync server. Turn private sync off and on again.';
const UNREADABLE_MESSAGE =
	'Some private data on the sync server cannot be read with this browser’s key. Turn private sync off and on again.';

export function parseServerKey(value: unknown): ServerKey | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return undefined;
	}

	return isRecord(parsed) &&
		parsed.v === 1 &&
		typeof parsed.id === 'string' &&
		typeof parsed.wrapped === 'string'
		? {v: 1, id: parsed.id, wrapped: parsed.wrapped}
		: undefined;
}

/**
The connection the private library syncs over: the regular server address with `/private` added, and the same token.
*/
export const privateSyncTarget = (regular: {url: string; token: string}) => ({
	url: `${regular.url}/private`,
	token: regular.token,
});

export const serverKeyText = (key: PrivateSyncKey) =>
	JSON.stringify({v: 1, id: key.id, wrapped: key.wrapped} satisfies ServerKey);

export function parsePrivateSyncKey(
	value: unknown,
): PrivateSyncKey | undefined {
	return isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.raw === 'string' &&
		typeof value.wrapped === 'string'
		? {id: value.id, raw: value.raw, wrapped: value.wrapped}
		: undefined;
}

/**
A new sync key, wrapped with the credential.
*/
export async function createSyncKey(
	credential: Credential,
): Promise<PrivateSyncKey> {
	const raw = generateDataKey();
	return {
		id: crypto.randomUUID(),
		raw: toBase64(raw),
		wrapped: await wrapDataKey(raw, credential),
	};
}

/**
The server's sync key, unwrapped with the credential. Throws PrivateLockError('wrong-credential') for a wrong one.
*/
export async function joinSyncKey(
	server: ServerKey,
	credential: string,
): Promise<PrivateSyncKey> {
	const raw = await unwrapDataKey(server.wrapped, credential);
	return {id: server.id, raw: toBase64(raw), wrapped: server.wrapped};
}

/**
The same key wrapped with a new credential.
*/
export async function rewrapSyncKey(
	key: PrivateSyncKey,
	credential: Credential,
): Promise<PrivateSyncKey> {
	return {...key, wrapped: await wrapDataKey(fromBase64(key.raw), credential)};
}

export function createPrivateCodec(store: {
	load(): Promise<PrivateSyncKey | undefined>;
	save(key: PrivateSyncKey): Promise<void>;
}): SyncCodec {
	let key: CryptoKey | undefined;
	return {
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

			const local = await store.load();
			if (!server) {
				if (local) {
					throw new SyncError('key', LOST_KEY_MESSAGE);
				}

				key = undefined;
				return;
			}

			if (local?.id !== server.id) {
				throw new SyncError('key', NEEDS_KEY_MESSAGE);
			}

			// Another device changed its PIN or password and rewrapped the same key.
			if (local.wrapped !== server.wrapped) {
				await store.save({...local, wrapped: server.wrapped});
			}

			key = await importDataKey(fromBase64(local.raw));
		},

		async seal(change: SyncChange) {
			return key && !change.deleted
				? {
						...change,
						value: await sealValue(key, recordKey(change), change.value),
					}
				: change;
		},

		async open(change: SyncChange) {
			if (!isSealed(change.value)) {
				return {change, reseal: key !== undefined};
			}

			if (!key) {
				throw new SyncError('key', NEEDS_KEY_MESSAGE);
			}

			try {
				const value = await openValue(key, recordKey(change), change.value);
				return {change: {...change, value}, reseal: false};
			} catch {
				throw new SyncError('key', UNREADABLE_MESSAGE);
			}
		},
	};
}
