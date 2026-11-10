// The locked area: bookmarks kept in one encrypted entry that only opens with a PIN or password.
//
// This module is the whole lock state machine and touches no `chrome.*` API: the service worker hands it a key and
// value backend for local and session storage, a clock, and an alarm. That is how the tests can break any storage call.
//
// Storage:
//   local   `tablodge.locked`          {version, kind, idleMinutes, rev, envelope (base64), updatedAt}. The envelope is the
//                                      crypto-envelope format and holds every title and address. Nothing else in the library
//                                      refers to it, so search, exports, snapshots and the trash cannot reach it.
//   session `tablodge.locked.key`      {key (base64), lastActive}. The unlock state: the AES key the credential derives.
//                                      Session storage lives in memory and is cleared when the browser closes, and survives a
//                                      service worker restart, which is what makes "unlocked until idle" possible.
//   session `tablodge.locked.flag`     {unlocked}. The only thing pages watch, so they never see the key.
//   session `tablodge.locked.attempts` {count, until}. Failed unlocks, to slow down guessing at an unlocked browser.
//
// Every write is one `set` of one key, so a crash leaves the old entry or the new one. While unlocked, data is resealed
// with the session key (a fresh nonce each time) and no credential is kept anywhere.
import {
	EnvelopeError,
	decryptBytesKeepingKey,
	decryptBytesWithKey,
	encryptBytesKeepingKey,
	encryptBytesWithKey,
	looksEncrypted,
	type SessionKey,
} from '../app/crypto-envelope';
import type {LockedBookmark, LockedStatus} from '../app/types';
import {
	validateCredential,
	type Credential,
	type CredentialKind,
} from '../app/passcode';

export const LOCKED_KEY = 'tablodge.locked';
export const LOCKED_SESSION_KEY = 'tablodge.locked.key';
export const LOCKED_FLAG_KEY = 'tablodge.locked.flag';
export const LOCKED_ATTEMPTS_KEY = 'tablodge.locked.attempts';
export const LOCKED_ALARM = 'tablodge-locked-idle';

export const LOCKED_RECORD_VERSION = 1;
/**
Minutes without use before the area locks; 0 keeps it unlocked until the browser closes.
*/
export const IDLE_MINUTES_CHOICES = [1, 5, 15, 30, 60, 0] as const;
export const DEFAULT_IDLE_MINUTES = 5;
export const MAX_LOCKED_ITEMS = 2000;
export const MAX_LOCKED_TITLE = 500;
/**
Bookmarks per write when a move adds many at once, so one storage write stays small and other work can run in between.
*/
export const MOVE_BATCH = 200;
const MAX_LOCKED_URL = 16_384;
/**
After this many wrong entries in a row, further tries wait.
*/
export const FREE_ATTEMPTS = 5;
export const COOLDOWN_MS = 30_000;
/**
From this many wrong entries in a row the unlock screen offers to reset the area. Earlier than the wait, so someone who
forgot the credential is not stuck guessing, but not on the first slip of a finger.
*/
export const RESET_OFFER_ATTEMPTS = 3;
/**
The message field a page must send to reset the area. The worker refuses a reset without it.
*/
export const LOCKED_RESET_CONFIRMATION = 'delete-everything-in-the-locked-area';
// A record is far smaller than this; a bigger one is not something this module wrote.
const MAX_RECORD_CHARS = 16 * 1024 * 1024;

export type LockedErrorCode =
	| 'not-set-up'
	| 'already-set-up'
	| 'locked'
	| 'wrong-credential'
	| 'too-many-attempts'
	| 'invalid-credential'
	| 'invalid'
	| 'full'
	| 'damaged'
	| 'not-confirmed';

export class LockedError extends Error {
	constructor(
		readonly code: LockedErrorCode,
		message: string,
		readonly retryAfterMs?: number,
	) {
		super(message);
	}
}

export type KeyValueArea = {
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<void>;
	remove(key: string): Promise<void>;
};

export type LockedBackend = {
	local: KeyValueArea;
	session: KeyValueArea;
	now(): number;
	alarm: {
		/**
		Wakes the worker at this time (milliseconds since the epoch) to check the idle timer.
		*/
		set(whenMs: number): Promise<void>;
		clear(): Promise<void>;
	};
};

/**
What a backup carries: the stored entry exactly as it is, so the blob stays encrypted.
*/
export type LockedRecord = {
	version: typeof LOCKED_RECORD_VERSION;
	kind: CredentialKind;
	idleMinutes: number;
	rev: number;
	envelope: string;
	updatedAt: number;
};

type Unlocked = {
	record: LockedRecord;
	key: SessionKey;
	items: LockedBookmark[];
};

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let index = 0; index < bytes.length; index += 0x80_00) {
		binary += String.fromCodePoint(...bytes.subarray(index, index + 0x80_00));
	}

	// eslint-disable-next-line no-restricted-globals -- Uint8Array.prototype.toBase64 is not available in Chromium yet
	return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
	// eslint-disable-next-line no-restricted-globals -- Uint8Array.fromBase64 is not available in Chromium yet
	const binary = atob(text);
	return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isIdleChoice = (value: unknown): value is number =>
	(IDLE_MINUTES_CHOICES as readonly unknown[]).includes(value);

/**
A stored entry in the shape this module writes, or null. The envelope is checked for its magic only; its contents need the key.
*/
export function readLockedRecord(value: unknown): LockedRecord | null {
	if (
		!isRecord(value) ||
		value.version !== LOCKED_RECORD_VERSION ||
		(value.kind !== 'pin' && value.kind !== 'password') ||
		!isIdleChoice(value.idleMinutes) ||
		typeof value.rev !== 'number' ||
		!Number.isSafeInteger(value.rev) ||
		typeof value.envelope !== 'string' ||
		value.envelope.length > MAX_RECORD_CHARS
	) {
		return null;
	}

	try {
		if (!looksEncrypted(base64ToBytes(value.envelope))) {
			return null;
		}
	} catch {
		return null;
	}

	return {
		version: LOCKED_RECORD_VERSION,
		kind: value.kind,
		idleMinutes: value.idleMinutes,
		rev: value.rev,
		envelope: value.envelope,
		updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
	};
}

/**
The http or https address in canonical form, or null.
*/
export function lockedUrl(value: unknown): string | null {
	if (typeof value !== 'string' || value.length > MAX_LOCKED_URL) {
		return null;
	}

	try {
		const url = new URL(value.trim());
		return url.protocol === 'http:' || url.protocol === 'https:'
			? url.href
			: null;
	} catch {
		return null;
	}
}

function lockedTitle(value: unknown, url: string): string {
	const text = typeof value === 'string' ? value.trim() : '';
	return text
		? text.slice(0, MAX_LOCKED_TITLE)
		: new URL(url).host.slice(0, MAX_LOCKED_TITLE);
}

function readItems(bytes: Uint8Array): LockedBookmark[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw new LockedError('damaged', 'The locked area could not be read.');
	}

	if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
		throw new LockedError('damaged', 'The locked area could not be read.');
	}

	const seen = new Set<string>();
	const items: LockedBookmark[] = [];
	for (const raw of parsed.items as unknown[]) {
		if (!isRecord(raw)) {
			continue;
		}

		const url = lockedUrl(raw.url);
		const id = typeof raw.id === 'string' ? raw.id : '';
		if (!url || !id || seen.has(id)) {
			continue;
		}

		seen.add(id);
		const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : 0;
		items.push({
			id,
			title: lockedTitle(raw.title, url),
			url,
			createdAt,
			updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt,
		});
	}

	return items;
}

const writeItems = (items: LockedBookmark[]): Uint8Array =>
	new TextEncoder().encode(JSON.stringify({version: 1, items}));

export type AddResult = {added: LockedBookmark[]; skipped: number};

export function createLockedStore(backend: LockedBackend) {
	// Operations run one at a time, so a read-modify-write cannot interleave with another.
	let queue: Promise<unknown> = Promise.resolve();
	const serial = async <T>(task: () => Promise<T>): Promise<T> => {
		const run = queue.then(task, task);
		queue = run.catch(() => undefined);
		return run;
	};

	async function readRecord(): Promise<LockedRecord | null> {
		const stored = await backend.local.get(LOCKED_KEY);
		if (stored === undefined || stored === null) {
			return null;
		}

		const record = readLockedRecord(stored);
		if (!record) {
			throw new LockedError(
				'damaged',
				'The locked area is damaged and cannot be opened.',
			);
		}

		return record;
	}

	async function readSession(): Promise<{
		key: SessionKey;
		lastActive: number;
	} | null> {
		const stored = await backend.session.get(LOCKED_SESSION_KEY);
		if (
			!isRecord(stored) ||
			typeof stored.key !== 'string' ||
			typeof stored.lastActive !== 'number'
		) {
			return null;
		}

		try {
			return {key: base64ToBytes(stored.key), lastActive: stored.lastActive};
		} catch {
			return null;
		}
	}

	async function lockNow(): Promise<void> {
		await backend.session.remove(LOCKED_SESSION_KEY);
		await backend.session.set(LOCKED_FLAG_KEY, {unlocked: false});
		await backend.alarm.clear();
	}

	async function setUnlocked(
		key: SessionKey,
		record: LockedRecord,
	): Promise<void> {
		const lastActive = backend.now();
		await backend.session.set(LOCKED_SESSION_KEY, {
			key: bytesToBase64(key),
			lastActive,
		});
		await backend.session.set(LOCKED_FLAG_KEY, {unlocked: true});
		await (record.idleMinutes > 0
			? backend.alarm.set(lastActive + record.idleMinutes * 60_000)
			: backend.alarm.clear());
	}

	/**
	The record and its items, opened with the session key. Locks and throws when the area is not unlocked: no key, the
	idle time is up, or the key no longer fits the entry (it was replaced or restored since).
	*/
	async function open(): Promise<Unlocked> {
		const record = await readRecord();
		if (!record) {
			throw new LockedError('not-set-up', 'The locked area is not set up.');
		}

		const session = await readSession();
		if (
			!session ||
			(record.idleMinutes > 0 &&
				backend.now() - session.lastActive >= record.idleMinutes * 60_000)
		) {
			if (session) {
				await lockNow();
			}

			throw new LockedError('locked', 'The locked area is locked.');
		}

		try {
			const items = readItems(
				await decryptBytesWithKey(base64ToBytes(record.envelope), session.key),
			);
			return {record, key: session.key, items};
		} catch (error) {
			if (error instanceof EnvelopeError) {
				await lockNow();
				throw new LockedError('locked', 'The locked area is locked.');
			}

			throw error;
		}
	}

	async function failedAttempts(): Promise<number> {
		const stored = await backend.session.get(LOCKED_ATTEMPTS_KEY);
		return isRecord(stored) &&
			typeof stored.count === 'number' &&
			Number.isSafeInteger(stored.count) &&
			stored.count > 0
			? stored.count
			: 0;
	}

	async function cooldownLeft(): Promise<number> {
		const stored = await backend.session.get(LOCKED_ATTEMPTS_KEY);
		return !isRecord(stored) || typeof stored.until !== 'number'
			? 0
			: Math.max(0, stored.until - backend.now());
	}

	async function recordFailure(): Promise<number> {
		const stored = await backend.session.get(LOCKED_ATTEMPTS_KEY);
		const count =
			(isRecord(stored) && typeof stored.count === 'number'
				? stored.count
				: 0) + 1;
		const until =
			count >= FREE_ATTEMPTS ? backend.now() + COOLDOWN_MS : undefined;
		await backend.session.set(LOCKED_ATTEMPTS_KEY, {count, until});
		return until ? COOLDOWN_MS : 0;
	}

	/**
	Checks a credential against the stored entry, counting a wrong entry as a failed attempt.
	*/
	async function verify(
		record: LockedRecord,
		credential: string,
	): Promise<{data: Uint8Array; key: SessionKey}> {
		const wait = await cooldownLeft();
		if (wait > 0) {
			throw new LockedError(
				'too-many-attempts',
				`Too many wrong entries. Try again in ${Math.ceil(wait / 1000)} seconds.`,
				wait,
			);
		}

		try {
			const result = await decryptBytesKeepingKey(
				base64ToBytes(record.envelope),
				credential,
			);
			await backend.session.remove(LOCKED_ATTEMPTS_KEY);
			return result;
		} catch (error) {
			if (error instanceof EnvelopeError && error.code === 'wrong-credential') {
				const retryAfterMs = await recordFailure();
				throw new LockedError(
					'wrong-credential',
					`That ${record.kind === 'pin' ? 'PIN' : 'password'} is wrong.`,
					retryAfterMs || undefined,
				);
			}

			if (error instanceof EnvelopeError) {
				throw new LockedError(
					'damaged',
					'The locked area is damaged and cannot be opened.',
				);
			}

			throw error;
		}
	}

	async function commit(
		unlocked: Unlocked,
		items: LockedBookmark[],
		overrides: Partial<Pick<LockedRecord, 'idleMinutes'>> = {},
	): Promise<LockedRecord> {
		const previous = base64ToBytes(unlocked.record.envelope);
		const envelope = await encryptBytesWithKey(
			writeItems(items),
			unlocked.key,
			previous,
		);
		const record: LockedRecord = {
			...unlocked.record,
			...overrides,
			rev: unlocked.record.rev + 1,
			envelope: bytesToBase64(envelope),
			updatedAt: backend.now(),
		};
		await backend.local.set(LOCKED_KEY, record);
		await setUnlocked(unlocked.key, record);
		return record;
	}

	const store = {
		/**
		What a page needs to draw: whether the area exists, whether it is open, and how to ask for the credential. It does
		not count as use, so a page polling it never keeps the area unlocked.
		*/
		async status(): Promise<LockedStatus> {
			return serial(async () => {
				const record = await readRecord();
				if (!record) {
					return {configured: false};
				}

				try {
					const {items} = await open();
					return {
						configured: true,
						unlocked: true,
						kind: record.kind,
						idleMinutes: record.idleMinutes,
						count: items.length,
					};
				} catch (error) {
					if (!(error instanceof LockedError) || error.code !== 'locked') {
						throw error;
					}

					const wait = await cooldownLeft();
					const failed = await failedAttempts();
					return {
						configured: true,
						unlocked: false,
						kind: record.kind,
						idleMinutes: record.idleMinutes,
						...(wait > 0 && {retryAfterMs: wait}),
						...(failed > 0 && {failedAttempts: failed}),
					};
				}
			});
		},

		/**
		Creates the area, empty and unlocked, protected by the credential.
		*/
		async setup(
			credential: Credential,
			idleMinutes = DEFAULT_IDLE_MINUTES,
		): Promise<void> {
			return serial(async () => {
				const problem = validateCredential(credential.kind, credential.value);
				if (problem) {
					throw new LockedError('invalid-credential', problem);
				}

				if (!isIdleChoice(idleMinutes)) {
					throw new LockedError('invalid', 'Choose a listed auto-lock time.');
				}

				if (await readRecord()) {
					throw new LockedError(
						'already-set-up',
						'The locked area is already set up.',
					);
				}

				const {envelope, key} = await encryptBytesKeepingKey(
					writeItems([]),
					credential,
				);
				const record: LockedRecord = {
					version: LOCKED_RECORD_VERSION,
					kind: credential.kind,
					idleMinutes,
					rev: 1,
					envelope: bytesToBase64(envelope),
					updatedAt: backend.now(),
				};
				await backend.local.set(LOCKED_KEY, record);
				await backend.session.remove(LOCKED_ATTEMPTS_KEY);
				await setUnlocked(key, record);
			});
		},

		async unlock(credential: string): Promise<void> {
			return serial(async () => {
				const record = await readRecord();
				if (!record) {
					throw new LockedError('not-set-up', 'The locked area is not set up.');
				}

				const {key} = await verify(record, credential);
				await setUnlocked(key, record);
			});
		},

		async lock(): Promise<void> {
			return serial(lockNow);
		},

		/**
		Counts as use: pushes the idle deadline out. Does nothing while locked.
		*/
		async touch(): Promise<void> {
			return serial(async () => {
				const unlocked = await open().catch((error: unknown) => {
					if (error instanceof LockedError) {
						return null;
					}

					throw error;
				});
				if (unlocked) {
					await setUnlocked(unlocked.key, unlocked.record);
				}
			});
		},

		async list(): Promise<LockedBookmark[]> {
			return serial(async () => {
				const unlocked = await open();
				await setUnlocked(unlocked.key, unlocked.record);
				return unlocked.items;
			});
		},

		/**
		Adds addresses; ones already stored are skipped. Titles are trimmed and capped, and only http and https pass.
		*/
		async add(
			entries: Array<{title?: unknown; url: unknown}>,
		): Promise<AddResult> {
			return serial(async () => {
				const unlocked = await open();
				const known = new Set(unlocked.items.map((item) => item.url));
				const now = backend.now();
				const added: LockedBookmark[] = [];
				let skipped = 0;
				for (const entry of entries) {
					const url = lockedUrl(entry.url);
					if (!url) {
						throw new LockedError(
							'invalid',
							'Only http and https addresses can be saved.',
						);
					}

					if (known.has(url)) {
						skipped++;
						continue;
					}

					known.add(url);
					added.push({
						id: crypto.randomUUID(),
						title: lockedTitle(entry.title, url),
						url,
						createdAt: now,
						updatedAt: now,
					});
				}

				if (unlocked.items.length + added.length > MAX_LOCKED_ITEMS) {
					throw new LockedError(
						'full',
						`The locked area holds at most ${MAX_LOCKED_ITEMS} bookmarks.`,
					);
				}

				if (added.length > 0) {
					await commit(unlocked, [...unlocked.items, ...added]);
				} else {
					await setUnlocked(unlocked.key, unlocked.record);
				}

				return {added, skipped};
			});
		},

		/**
		Adds many addresses in batches of `batchSize`, one encrypted write each. Everything is checked first: an invalid
		address or too many bookmarks throws before anything is written. A failure later (the area locked or storage
		failed) leaves the batches before it stored, which is harmless to a caller that removes the originals only
		after this returns.
		*/
		async addMany(
			entries: Array<{title?: unknown; url: unknown}>,
			batchSize = MOVE_BATCH,
		): Promise<AddResult> {
			await serial(async () => {
				const unlocked = await open();
				const known = new Set(unlocked.items.map((item) => item.url));
				const fresh = new Set<string>();
				for (const entry of entries) {
					const url = lockedUrl(entry.url);
					if (!url) {
						throw new LockedError(
							'invalid',
							'Only http and https addresses can be saved.',
						);
					}

					if (!known.has(url)) {
						fresh.add(url);
					}
				}

				if (unlocked.items.length + fresh.size > MAX_LOCKED_ITEMS) {
					throw new LockedError(
						'full',
						`The locked area holds at most ${MAX_LOCKED_ITEMS} bookmarks.`,
					);
				}
			});
			const added: LockedBookmark[] = [];
			let skipped = 0;
			for (let at = 0; at < entries.length; at += batchSize) {
				const result = await store.add(entries.slice(at, at + batchSize));
				added.push(...result.added);
				skipped += result.skipped;
			}

			return {added, skipped};
		},

		async update(
			id: string,
			fields: {title?: unknown; url?: unknown},
		): Promise<LockedBookmark> {
			return serial(async () => {
				const unlocked = await open();
				const index = unlocked.items.findIndex((item) => item.id === id);
				if (index === -1) {
					throw new LockedError('invalid', 'That bookmark no longer exists.');
				}

				const current = unlocked.items[index];
				let {url} = current;
				if (fields.url !== undefined) {
					const next = lockedUrl(fields.url);
					if (!next) {
						throw new LockedError(
							'invalid',
							'Only http and https addresses can be saved.',
						);
					}

					if (
						unlocked.items.some((item) => item.id !== id && item.url === next)
					) {
						throw new LockedError(
							'invalid',
							'That address is already in the locked area.',
						);
					}

					url = next;
				}

				const updated: LockedBookmark = {
					...current,
					url,
					title: lockedTitle(fields.title ?? current.title, url),
					updatedAt: backend.now(),
				};
				const items = unlocked.items.with(index, updated);
				await commit(unlocked, items);
				return updated;
			});
		},

		/**
		Deletes bookmarks for good. The locked area has no trash, because the trash is stored in plain text.
		*/
		async remove(ids: string[]): Promise<number> {
			return serial(async () => {
				const unlocked = await open();
				const drop = new Set(ids);
				const items = unlocked.items.filter((item) => !drop.has(item.id));
				const removed = unlocked.items.length - items.length;
				if (removed > 0) {
					await commit(unlocked, items);
				} else {
					await setUnlocked(unlocked.key, unlocked.record);
				}

				return removed;
			});
		},

		async setIdleMinutes(idleMinutes: number): Promise<void> {
			return serial(async () => {
				if (!isIdleChoice(idleMinutes)) {
					throw new LockedError('invalid', 'Choose a listed auto-lock time.');
				}

				const unlocked = await open();
				await commit(unlocked, unlocked.items, {idleMinutes});
			});
		},

		/**
		Re-encrypts the area under a new credential after checking the current one. The old credential stops working. The
		entry is replaced first and the session key second: a crash between them leaves the area locked, and the new
		credential opens it.
		*/
		async changeCredential(current: string, next: Credential): Promise<void> {
			return serial(async () => {
				const problem = validateCredential(next.kind, next.value);
				if (problem) {
					throw new LockedError('invalid-credential', problem);
				}

				const unlocked = await open();
				const {data} = await verify(unlocked.record, current);
				const sealed = await encryptBytesKeepingKey(data, next);
				const record: LockedRecord = {
					...unlocked.record,
					kind: next.kind,
					rev: unlocked.record.rev + 1,
					envelope: bytesToBase64(sealed.envelope),
					updatedAt: backend.now(),
				};
				await backend.local.set(LOCKED_KEY, record);
				await setUnlocked(sealed.key, record);
			});
		},

		/**
		Deletes the area after checking the credential. `beforeDelete` gets the decrypted bookmarks first, to move them
		somewhere else; if it throws, nothing is deleted.
		*/
		async removeLock(
			credential: string,
			beforeDelete?: (items: LockedBookmark[]) => Promise<void>,
		): Promise<number> {
			return serial(async () => {
				const unlocked = await open();
				await verify(unlocked.record, credential);
				await beforeDelete?.(unlocked.items);
				await backend.local.remove(LOCKED_KEY);
				await lockNow();
				return unlocked.items.length;
			});
		},

		/**
		Deletes the area without the credential, for someone who forgot it: the entry, the key, and the count of wrong entries,
		so the area is back to not set up and a new credential can create it. Works locked or unlocked, and when nothing is set
		up. The key goes first and the entry second: a crash between them leaves a locked area that can be reset again, never
		a half deleted one. A page must pass `LOCKED_RESET_CONFIRMATION`.
		*/
		async reset(confirmation: unknown): Promise<void> {
			return serial(async () => {
				if (confirmation !== LOCKED_RESET_CONFIRMATION) {
					throw new LockedError(
						'not-confirmed',
						'Resetting the locked area needs a confirmation.',
					);
				}

				await lockNow();
				await backend.local.remove(LOCKED_KEY);
				await backend.session.remove(LOCKED_ATTEMPTS_KEY);
			});
		},

		/**
		The stored entry as is, for a full backup. Still encrypted, and readable while locked.
		*/
		async exportRecord(): Promise<LockedRecord | null> {
			return serial(readRecord);
		},

		/**
		Replaces the area with an entry from a backup and locks it: the old key does not fit, and the credential is the one the backup was made with.
		*/
		async importRecord(value: unknown): Promise<boolean> {
			return serial(async () => {
				const record = readLockedRecord(value);
				if (!record) {
					return false;
				}

				await backend.local.set(LOCKED_KEY, record);
				await backend.session.remove(LOCKED_ATTEMPTS_KEY);
				await lockNow();
				return true;
			});
		},

		/**
		For the idle alarm: locks when the time is up, otherwise sets the alarm again.
		*/
		async checkIdle(): Promise<void> {
			return serial(async () => {
				const record = await readRecord().catch(() => null);
				const session = await readSession();
				if (!record || !session) {
					await backend.alarm.clear();
					return;
				}

				if (
					record.idleMinutes > 0 &&
					backend.now() - session.lastActive >= record.idleMinutes * 60_000
				) {
					await lockNow();
					return;
				}

				await (record.idleMinutes > 0
					? backend.alarm.set(session.lastActive + record.idleMinutes * 60_000)
					: backend.alarm.clear());
			});
		},

		/**
		A new browser session starts locked. Session storage is cleared by the browser already; this covers a worker that wakes with leftovers.
		*/
		async startup(): Promise<void> {
			return serial(lockNow);
		},
	};

	return store;
}

export type LockedStore = ReturnType<typeof createLockedStore>;

export {type LockedBookmark, type LockedStatus} from '../app/types';
