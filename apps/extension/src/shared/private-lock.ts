import {decryptBytes, encryptBytes, EnvelopeError} from './crypto-envelope';
import {type Credential, validateCredential} from './passcode';

export const LOCK_RECORD_KEY = 'tablodge.private.lock';
export const LOCK_SESSION_KEY = 'tablodge.privatelock.key';
export const LOCK_ACTIVITY_KEY = 'tablodge.privatelock.active';
export const LOCK_ATTEMPTS_KEY = 'tablodge.privatelock.attempts';
export const LOCK_WINDOWS_KEY = 'tablodge.privatelock.windows';

export const DEFAULT_IDLE_MINUTES = 5;
export const IDLE_MINUTE_CHOICES = [1, 5, 15, 30, 60, 0] as const;

export const isIdleMinutes = (value: unknown): value is number =>
	typeof value === 'number' &&
	(IDLE_MINUTE_CHOICES as readonly number[]).includes(value);

export type LockState = 'encrypting' | 'encrypted' | 'decrypting';

export type LockRecord = {
	version: 1;
	state: LockState;
	kind: 'pin' | 'password';
	wrapped: string;
	idleMinutes: number;
};

export type LockStatus = {
	enabled: boolean;
	state: LockState | 'none' | 'damaged';
	locked: boolean;
	idleMinutes: number;
	expiresAt: number | null;
};

export type LockErrorCode =
	| 'locked'
	| 'wrong-credential'
	| 'rate-limited'
	| 'damaged'
	| 'invalid'
	| 'state';

export class PrivateLockError extends Error {
	constructor(
		readonly code: LockErrorCode,
		message: string,
	) {
		super(message);
	}
}

export const LOCKED_MESSAGE =
	'Private windows are locked. Enter your password to unlock them.';
const WRONG_MESSAGE = 'That password is not correct.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseLockRecord(value: unknown): LockRecord | null {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		!['encrypting', 'encrypted', 'decrypting'].includes(String(value.state)) ||
		(value.kind !== 'pin' && value.kind !== 'password') ||
		typeof value.wrapped !== 'string' ||
		value.wrapped.length === 0 ||
		!isIdleMinutes(value.idleMinutes)
	) {
		return null;
	}

	return value as LockRecord;
}

export type WindowVerdict = {lock: true} | {lock: false; tracked: number[]};

const isWindowId = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parseWindowIds(value: unknown): number[] | undefined {
	return Array.isArray(value) && value.every((id) => isWindowId(id))
		? [...new Set(value)]
		: undefined;
}

const sameIds = (a: readonly number[] | undefined, b: readonly number[]) =>
	a?.length === b.length && b.every((id) => a.includes(id));

export function judgePrivateWindows(
	tracked: readonly number[] | undefined,
	open: readonly number[],
): WindowVerdict {
	const now = new Set(open);
	return tracked?.some((id) => now.has(id))
		? {lock: false, tracked: [...now]}
		: {lock: true};
}

export function toBase64(bytes: Uint8Array): string {
	let text = '';
	for (let at = 0; at < bytes.length; at += 0x80_00) {
		text += String.fromCodePoint(...bytes.subarray(at, at + 0x80_00));
	}

	// eslint-disable-next-line no-restricted-globals -- Uint8Array.prototype.toBase64 is not available in Chromium yet.
	return btoa(text);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
	// eslint-disable-next-line no-restricted-globals -- Uint8Array.fromBase64 is not available in Chromium yet.
	const raw = atob(text);
	const bytes = new Uint8Array(raw.length);
	for (let at = 0; at < raw.length; at += 1) {
		bytes[at] = raw.codePointAt(at)!;
	}

	return bytes;
}

const DATA_KEY_BYTES = 32;
const IV_BYTES = 12;

export const generateDataKey = () =>
	crypto.getRandomValues(new Uint8Array(DATA_KEY_BYTES));

export async function importDataKey(raw: Uint8Array): Promise<CryptoKey> {
	if (raw.length !== DATA_KEY_BYTES) {
		throw new PrivateLockError(
			'damaged',
			'The private library key is damaged.',
		);
	}

	return crypto.subtle.importKey(
		'raw',
		new Uint8Array(raw),
		{name: 'AES-GCM'},
		false,
		['encrypt', 'decrypt'],
	);
}

export async function wrapDataKey(
	dataKey: Uint8Array,
	credential: Credential,
): Promise<string> {
	return toBase64(await encryptBytes(dataKey, credential));
}

export async function unwrapDataKey(
	wrapped: string,
	credential: string,
): Promise<Uint8Array> {
	let envelope: Uint8Array;
	try {
		envelope = fromBase64(wrapped);
	} catch {
		throw new PrivateLockError(
			'damaged',
			'The private library lock is damaged.',
		);
	}

	try {
		return await decryptBytes(envelope, credential);
	} catch (error) {
		if (error instanceof EnvelopeError && error.code === 'wrong-credential') {
			throw new PrivateLockError('wrong-credential', WRONG_MESSAGE);
		}

		throw new PrivateLockError(
			'damaged',
			'The private library lock is damaged.',
		);
	}
}

export type SealedValue = {tlock: 1; iv: string; ct: string};

export const isSealed = (value: unknown): value is SealedValue =>
	isRecord(value) &&
	value.tlock === 1 &&
	typeof value.iv === 'string' &&
	typeof value.ct === 'string';

const nameBytes = (name: string) => new TextEncoder().encode(name);

export async function sealValue(
	key: CryptoKey,
	name: string,
	value: unknown,
): Promise<SealedValue> {
	const text = JSON.stringify(value);
	if (text === undefined) {
		throw new TypeError('This value cannot be stored.');
	}

	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const sealed = await crypto.subtle.encrypt(
		{name: 'AES-GCM', iv, additionalData: nameBytes(name)},
		key,
		new TextEncoder().encode(text),
	);
	return {tlock: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(sealed))};
}

export async function openValue(
	key: CryptoKey,
	name: string,
	sealed: SealedValue,
): Promise<unknown> {
	try {
		const plain = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: fromBase64(sealed.iv),
				additionalData: nameBytes(name),
			},
			key,
			fromBase64(sealed.ct),
		);
		return JSON.parse(new TextDecoder().decode(plain)) as unknown;
	} catch {
		throw new PrivateLockError(
			'damaged',
			'Some private library data cannot be read. It may have been changed.',
		);
	}
}

export async function readStored(
	key: CryptoKey,
	name: string,
	stored: unknown,
): Promise<unknown> {
	return isSealed(stored) ? openValue(key, name, stored) : stored;
}

export type ConvertBackend = {
	names(): Promise<string[]>;
	get(names: string[]): Promise<Record<string, unknown>>;
	set(values: Record<string, unknown>): Promise<void>;
};

const CONVERT_BATCH_CHARS = 1_000_000;
const CONVERT_BATCH_KEYS = 25;

export async function convertValues(
	backend: ConvertBackend,
	key: CryptoKey,
	direction: 'seal' | 'open',
	options: {
		batchKeys?: number;
		batchChars?: number;
		beforeBatch?: () => Promise<void>;
	} = {},
): Promise<number> {
	const batchKeys = options.batchKeys ?? CONVERT_BATCH_KEYS;
	const batchChars = options.batchChars ?? CONVERT_BATCH_CHARS;
	const names = await backend.names();
	let converted = 0;
	for (let at = 0; at < names.length; at += batchKeys) {
		await options.beforeBatch?.();

		const stored = await backend.get(names.slice(at, at + batchKeys));
		let pending: Record<string, unknown> = {};
		let pendingChars = 0;
		for (const [name, value] of Object.entries(stored)) {
			const wanted = direction === 'seal';
			if (isSealed(value) === wanted) {
				continue;
			}

			const next = wanted
				? await sealValue(key, name, value)
				: await openValue(key, name, value as SealedValue);
			pending[name] = next;
			pendingChars += JSON.stringify(next).length;
			converted += 1;
			if (!(pendingChars >= batchChars)) {
				continue;
			}

			await backend.set(pending);
			pending = {};
			pendingChars = 0;
		}

		if (Object.keys(pending).length > 0) {
			await backend.set(pending);
		}
	}

	return converted;
}

type Area = {
	get(keys: string[] | null): Promise<Record<string, unknown>>;
	set(values: Record<string, unknown>): Promise<void>;
	remove(keys: string | string[]): Promise<void>;
};

export type LockEnv = {
	local: Area;
	session: Area;
	prefix: string;
	reserved: string[];
	now(): number;
	openWindows?(): Promise<number[]>;
	batch?: {batchKeys?: number; batchChars?: number};
};

type KeyPayload = {key: string; at: number};

const isKeyValue = (value: unknown): value is {key: string} =>
	isRecord(value) && typeof value.key === 'string';

const ATTEMPTS_BEFORE_LOCKOUT = 5;
const LOCKOUT_BASE_MS = 30_000;
const LOCKOUT_MAX_MS = 900_000;
const TOUCH_WRITE_MS = 10_000;

export type Gate = {
	state: LockState;
	key: CryptoKey | null;
};

export function createPrivateLock(env: LockEnv) {
	let cachedKey: {raw: string; key: CryptoKey} | undefined;
	let lastTouchWrite = 0;
	let keyQueue: Promise<unknown> = Promise.resolve();
	const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
		const run = keyQueue.then(task, task);
		keyQueue = run.catch(() => undefined);
		return run;
	};

	async function readRecord(): Promise<LockRecord | null | undefined> {
		const saved = await env.local.get([LOCK_RECORD_KEY]);
		const value = saved[LOCK_RECORD_KEY];
		return value === undefined ? undefined : parseLockRecord(value);
	}

	async function requireRecord(): Promise<LockRecord> {
		const record = await readRecord();
		if (record === undefined) {
			throw new PrivateLockError(
				'state',
				'Private windows are not locked with a password.',
			);
		}

		if (record === null) {
			throw new PrivateLockError(
				'damaged',
				'The private library lock is damaged.',
			);
		}

		return record;
	}

	async function readPayload(): Promise<KeyPayload | undefined> {
		const saved = await env.session.get([LOCK_SESSION_KEY, LOCK_ACTIVITY_KEY]);
		const value = saved[LOCK_SESSION_KEY];
		const at = saved[LOCK_ACTIVITY_KEY];
		return isKeyValue(value)
			? {key: value.key, at: typeof at === 'number' ? at : 0}
			: undefined;
	}

	const expired = (record: LockRecord, payload: KeyPayload) =>
		record.idleMinutes > 0 &&
		env.now() - payload.at >= record.idleMinutes * 60_000;

	async function dropKey() {
		cachedKey = undefined;
		await env.session.remove([
			LOCK_SESSION_KEY,
			LOCK_ACTIVITY_KEY,
			LOCK_WINDOWS_KEY,
		]);
	}

	const removeKey = () => exclusive(dropKey);

	async function lockWhenWindowsClosed(closed?: number): Promise<boolean> {
		if (!env.openWindows) {
			return false;
		}

		const {openWindows} = env;
		return exclusive(async () => {
			const saved = await env.session.get([LOCK_SESSION_KEY, LOCK_WINDOWS_KEY]);
			if (!isKeyValue(saved[LOCK_SESSION_KEY])) {
				return true;
			}

			const open = await openWindows().then(
				(ids) => ids.filter((id) => id !== closed),
				() => [],
			);
			const tracked = parseWindowIds(saved[LOCK_WINDOWS_KEY]);
			const verdict = judgePrivateWindows(tracked, open);
			if (verdict.lock) {
				await dropKey();
				return true;
			}

			if (!sameIds(tracked, verdict.tracked)) {
				await env.session.set({[LOCK_WINDOWS_KEY]: verdict.tracked});
			}

			return false;
		});
	}

	async function importCached(raw: string): Promise<CryptoKey> {
		if (cachedKey?.raw !== raw) {
			cachedKey = {raw, key: await importDataKey(fromBase64(raw))};
		}

		return cachedKey.key;
	}

	async function currentKey(
		record: LockRecord,
		touch: boolean,
	): Promise<CryptoKey | null> {
		const payload = await readPayload();
		if (!payload) {
			cachedKey = undefined;
			return null;
		}

		if (expired(record, payload)) {
			await removeKey();
			return null;
		}

		if (await lockWhenWindowsClosed()) {
			return null;
		}

		if (touch && env.now() - lastTouchWrite >= TOUCH_WRITE_MS) {
			lastTouchWrite = env.now();
			await env.session.set({[LOCK_ACTIVITY_KEY]: env.now()});
		}

		try {
			return await importCached(payload.key);
		} catch {
			await removeKey();
			return null;
		}
	}

	async function storeKey(raw: Uint8Array) {
		return exclusive(async () => {
			cachedKey = undefined;
			lastTouchWrite = env.now();
			const windows = env.openWindows
				? await env.openWindows().catch(() => [])
				: undefined;
			await env.session.set({
				[LOCK_SESSION_KEY]: {key: toBase64(raw)},
				[LOCK_ACTIVITY_KEY]: env.now(),
				...(windows && {[LOCK_WINDOWS_KEY]: [...new Set(windows)]}),
			});
		});
	}

	async function checkAttempts() {
		const saved = (await env.session.get([LOCK_ATTEMPTS_KEY]))[
			LOCK_ATTEMPTS_KEY
		];
		const wait =
			isRecord(saved) && typeof saved.until === 'number'
				? saved.until - env.now()
				: 0;
		if (wait > 0) {
			throw new PrivateLockError(
				'rate-limited',
				`Too many wrong entries. Try again in ${Math.ceil(wait / 1000)} seconds.`,
			);
		}
	}

	async function recordFailure() {
		const saved = (await env.session.get([LOCK_ATTEMPTS_KEY]))[
			LOCK_ATTEMPTS_KEY
		];
		const count = (isRecord(saved) && Number(saved.count)) || 0;
		const next = count + 1;
		const over = next - ATTEMPTS_BEFORE_LOCKOUT + 1;
		await env.session.set({
			[LOCK_ATTEMPTS_KEY]: {
				count: next,
				until:
					over > 0
						? env.now() +
							Math.min(LOCKOUT_MAX_MS, LOCKOUT_BASE_MS * 2 ** (over - 1))
						: 0,
			},
		});
	}

	async function verify(record: LockRecord, credential: string) {
		if (typeof credential !== 'string' || credential.length === 0) {
			throw new PrivateLockError('wrong-credential', WRONG_MESSAGE);
		}

		await checkAttempts();
		try {
			const raw = await unwrapDataKey(record.wrapped, credential);
			await env.session.remove(LOCK_ATTEMPTS_KEY);
			return raw;
		} catch (error) {
			if (
				error instanceof PrivateLockError &&
				error.code === 'wrong-credential'
			) {
				await recordFailure();
			}

			throw error;
		}
	}

	const reserved = new Set(env.reserved);
	const convertBackend: ConvertBackend = {
		async names() {
			const all = await env.local.get(null);
			return Object.keys(all)
				.filter((key) => key.startsWith(env.prefix) && !reserved.has(key))
				.map((key) => key.slice(env.prefix.length));
		},
		async get(names) {
			const saved = await env.local.get(names.map((name) => env.prefix + name));
			return Object.fromEntries(
				Object.entries(saved).map(([key, value]) => [
					key.slice(env.prefix.length),
					value,
				]),
			);
		},
		async set(values) {
			await env.local.set(
				Object.fromEntries(
					Object.entries(values).map(([name, value]) => [
						env.prefix + name,
						value,
					]),
				),
			);
		},
	};

	const idleLocked = async (record: LockRecord) => {
		const key = await currentKey(record, true);
		if (!key) {
			throw new PrivateLockError('locked', LOCKED_MESSAGE);
		}

		return key;
	};

	async function resume(): Promise<boolean> {
		const record = await readRecord();
		if (!record || record.state === 'encrypted') {
			return false;
		}

		const key = await currentKey(record, true);
		if (!key) {
			return false;
		}

		const beforeBatch = async () => {
			await idleLocked(record);
		};

		if (record.state === 'encrypting') {
			await convertValues(convertBackend, key, 'seal', {
				...env.batch,
				beforeBatch,
			});
			await env.local.set({
				[LOCK_RECORD_KEY]: {...record, state: 'encrypted'},
			});
			return true;
		}

		await convertValues(convertBackend, key, 'open', {
			...env.batch,
			beforeBatch,
		});
		await env.local.remove(LOCK_RECORD_KEY);
		await removeKey();
		return true;
	}

	return {
		readRecord,
		resume,

		async gate(): Promise<Gate | null> {
			const record = await readRecord();
			if (record === undefined) {
				return null;
			}

			if (record === null) {
				throw new PrivateLockError(
					'damaged',
					'The private library lock is damaged.',
				);
			}

			return {state: record.state, key: await currentKey(record, true)};
		},

		async status(): Promise<LockStatus> {
			const record = await readRecord();
			if (record === undefined) {
				return {
					enabled: false,
					state: 'none',
					locked: false,
					idleMinutes: DEFAULT_IDLE_MINUTES,
					expiresAt: null,
				};
			}

			if (record === null) {
				return {
					enabled: true,
					state: 'damaged',
					locked: true,
					idleMinutes: DEFAULT_IDLE_MINUTES,
					expiresAt: null,
				};
			}

			const key = await currentKey(record, false);
			const payload = key ? await readPayload() : undefined;
			return {
				enabled: true,
				state: record.state,
				locked: !key,
				idleMinutes: record.idleMinutes,
				expiresAt:
					payload && record.idleMinutes > 0
						? payload.at + record.idleMinutes * 60_000
						: null,
			};
		},

		async touch() {
			const record = await readRecord();
			if (record) {
				await currentKey(record, true);
			}
		},

		async lock() {
			await removeKey();
		},

		lockWhenWindowsClosed,

		async unlock(credential: string) {
			const record = await requireRecord();
			await storeKey(await verify(record, credential));
		},

		async enable(credential: Credential, idleMinutes = DEFAULT_IDLE_MINUTES) {
			if ((await readRecord()) !== undefined) {
				throw new PrivateLockError(
					'state',
					'Private windows already have a lock.',
				);
			}

			const problem = credential.verified
				? null
				: validateCredential(credential.value);
			if (problem) {
				throw new PrivateLockError('invalid', problem);
			}

			if (!isIdleMinutes(idleMinutes)) {
				throw new PrivateLockError('invalid', 'Choose a valid idle time.');
			}

			const dataKey = generateDataKey();
			const wrapped = await wrapDataKey(dataKey, credential);
			await storeKey(dataKey);
			await env.local.set({
				[LOCK_RECORD_KEY]: {
					version: 1,
					state: 'encrypting',
					kind: 'password',
					wrapped,
					idleMinutes,
				} satisfies LockRecord,
			});
			await resume();
		},

		async checkCredential(credential: string) {
			await verify(await requireRecord(), credential);
		},

		async disable(credential: string) {
			const record = await requireRecord();
			const dataKey = await verify(record, credential);
			await storeKey(dataKey);
			if (record.state !== 'decrypting') {
				await env.local.set({
					[LOCK_RECORD_KEY]: {...record, state: 'decrypting'},
				});
			}

			await resume();
		},

		async changeCredential(current: string, next: Credential) {
			const record = await requireRecord();
			if (record.state !== 'encrypted') {
				throw new PrivateLockError(
					'state',
					'Finish turning the lock on or off first. Unlock to continue.',
				);
			}

			const problem = next.verified ? null : validateCredential(next.value);
			if (problem) {
				throw new PrivateLockError('invalid', problem);
			}

			const dataKey = await verify(record, current);
			const wrapped = await wrapDataKey(dataKey, next);
			await env.local.set({
				[LOCK_RECORD_KEY]: {...record, kind: 'password', wrapped},
			});
		},

		async setIdleMinutes(minutes: number) {
			const record = await requireRecord();
			if (!isIdleMinutes(minutes)) {
				throw new PrivateLockError('invalid', 'Choose a valid idle time.');
			}

			await env.local.set({
				[LOCK_RECORD_KEY]: {...record, idleMinutes: minutes},
			});
		},
	};
}

export type PrivateLock = ReturnType<typeof createPrivateLock>;
