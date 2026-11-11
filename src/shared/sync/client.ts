/*
The sync client the service worker runs: it connects to a self hosted server, runs sync rounds, and keeps a live
socket open so changes from other devices arrive within a moment. Everything it touches (storage, the network,
the library) comes in through `SyncHost`, so the tests drive it against the reference server in memory.

A round: stamp local edits, pull and apply the server's changes page by page, then push the outbox. Each library
read and write happens inside the worker's mutation queue (`host.mutate`); the network calls happen between them,
so a slow server never holds up the app. Rounds never overlap: a request during a round runs one more after it.
*/
import type {Store} from '../../app/types';
import {isRecord} from '../library-values';
import type {PushResult} from './change-log';
import {parseChange, recordKey, type SyncChange} from './changes';
import {
	capture,
	finishResync,
	inOrder,
	newSyncState,
	outgoing,
	type Records,
	receive,
	settle,
	startResync,
	type SyncState,
} from './engine';
import {assemble, splitLibrary} from './library-records';

export const SYNC_CONFIG_KEY = 'tablodge.sync.config';
export const SYNC_STATE_KEY = 'tablodge.sync.state';
export const SYNC_STATUS_KEY = 'tablodge.sync.status';
export const SYNC_ALARM = 'tablodge-sync';
/**
Minutes between fallback rounds, which also reopen a closed live socket.
*/
export const SYNC_ALARM_MINUTES = 5;
export const MIN_TOKEN_LENGTH = 32;

const PROTOCOL_VERSION = 1;
const PULL_LIMIT = 500;
const PUSH_LIMIT = 500;
const LOCAL_CHANGE_DELAY_MS = 1500;
// Chrome keeps an extension service worker alive while its WebSocket exchanges messages within 30 seconds.
const PING_MS = 20_000;
const RECONNECT_MIN_MS = 5000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;
const PUSH_RESULTS: ReadonlySet<string> = new Set([
	'applied',
	'superseded',
	'stale',
	'clock',
]);

export type SyncConfig = {url: string; token: string};

export type SyncStatus = {
	connected: boolean;
	url: string | null;
	phase: 'off' | 'idle' | 'syncing' | 'offline' | 'error';
	live: boolean;
	lastSyncAt: number | null;
	pending: number;
	/**
	Changes the server refused because they could bring back a deleted record or had a wrong clock.
	*/
	refused: number;
	error: string | null;
};

export type SyncSocket = {
	send(data: string): void;
	close(): void;
	addEventListener(
		type: 'open' | 'close' | 'error',
		listener: () => void,
	): void;
	addEventListener(
		type: 'message',
		listener: (event: {data: unknown}) => void,
	): void;
};

export type SyncHost = {
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<void>;
	remove(keys: string[]): Promise<void>;
	fetch(url: string, init: RequestInit): Promise<Response>;
	openSocket?: (url: string) => SyncSocket;
	mutate<T>(work: () => Promise<T>): Promise<T>;
	readLibrary(): Promise<Store>;
	/**
	Writes a library assembled from synced records; the host normalizes it like any untrusted input.
	*/
	writeLibrary(store: Store): Promise<void>;
	backup(store: Store, reason: string): Promise<void>;
	randomId(): string;
	now(): number;
};

export class SyncError extends Error {
	constructor(
		readonly kind: 'config' | 'offline' | 'auth' | 'server',
		message: string,
	) {
		super(message);
		this.name = 'SyncError';
	}
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
The server address in a canonical form. HTTPS is required, because the token and the library travel with every
request; plain HTTP is allowed only for a server on this computer.
*/
export function parseServerUrl(text: string): string {
	let url: URL;
	try {
		url = new URL(text.trim());
	} catch {
		throw new SyncError(
			'config',
			'Enter the full server address, starting with https://.',
		);
	}

	if (
		url.protocol !== 'https:' &&
		!(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))
	) {
		throw new SyncError(
			'config',
			'The server address must start with https:// (http:// only for localhost).',
		);
	}

	if (url.username || url.password || url.search || url.hash) {
		throw new SyncError(
			'config',
			'Enter the server address without a user name, query, or #.',
		);
	}

	return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function parseConfig(value: unknown): SyncConfig | undefined {
	return isRecord(value) &&
		typeof value.url === 'string' &&
		typeof value.token === 'string'
		? {url: value.url, token: value.token}
		: undefined;
}

function parseState(value: unknown): SyncState | undefined {
	return isRecord(value) &&
		typeof value.device === 'string' &&
		isRecord(value.clock) &&
		typeof value.cursor === 'number' &&
		isRecord(value.shadow) &&
		Array.isArray(value.outbox)
		? ({purged: 0, ...value} as SyncState)
		: undefined;
}

type PullPage =
	| {resync: true}
	| {
			resync: false;
			changes: SyncChange[];
			cursor: number;
			more: boolean;
			purged: number;
	  };

function parsePull(body: unknown): PullPage {
	if (isRecord(body) && body.resync === true) {
		return {resync: true};
	}

	if (
		!isRecord(body) ||
		!Array.isArray(body.changes) ||
		!Number.isSafeInteger(body.cursor) ||
		typeof body.more !== 'boolean'
	) {
		throw new SyncError(
			'server',
			'The sync server sent an answer this version does not understand.',
		);
	}

	return {
		resync: false,
		// A malformed change is skipped rather than applied.
		changes: body.changes.flatMap((change) => parseChange(change) ?? []),
		cursor: body.cursor as number,
		more: body.more,
		purged: Number.isSafeInteger(body.purged) ? (body.purged as number) : 0,
	};
}

const ERROR_MESSAGES = new Map([
	[
		'quota',
		'The sync server is full. Delete some sessions or bookmarks, or raise its record limit.',
	],
	['too_large', 'A change was too large for the sync server.'],
	[
		'change_too_large',
		'A session, tab, or bookmark is too large for the sync server.',
	],
	['bad_change', 'The sync server refused a change as malformed.'],
	[
		'rate_limited',
		'The sync server asked TabLodge to slow down. Sync tries again in a few minutes.',
	],
	['not_configured', 'The sync server has no token set up yet.'],
]);

export function createSyncClient(host: SyncHost) {
	let config: SyncConfig | undefined;
	let status: SyncStatus = {
		connected: false,
		url: null,
		phase: 'off',
		live: false,
		lastSyncAt: null,
		pending: 0,
		refused: 0,
		error: null,
	};
	let running: Promise<void> | undefined;
	let again = false;
	let applying = false;
	let localTimer: ReturnType<typeof setTimeout> | undefined;
	let socket: SyncSocket | undefined;
	let pingTimer: ReturnType<typeof setInterval> | undefined;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let reconnectDelay = RECONNECT_MIN_MS;
	/*
	The highest server cursor this device has pulled or pushed up to, and the highest one a live notice announced.
	A notice only means something new while it is ahead of what this device has seen. A notice for this device's
	own push can arrive before the push's answer does, so the two are compared once a round ends, not on arrival.
	*/
	let seenCursor = 0;
	let noticeCursor = 0;
	const ready = load();

	async function load() {
		config = parseConfig(await host.get(SYNC_CONFIG_KEY));
		const saved = await host.get(SYNC_STATUS_KEY);
		if (config) {
			status = {
				...status,
				...(isRecord(saved) && (saved as Partial<SyncStatus>)),
				connected: true,
				url: config.url,
				phase: 'idle',
				live: false,
			};
		}
	}

	async function setStatus(change: Partial<SyncStatus>) {
		status = {...status, ...change};
		await host.set(SYNC_STATUS_KEY, status);
	}

	async function request(
		target: SyncConfig,
		path: string,
		init: RequestInit = {},
	): Promise<unknown> {
		let response: Response;
		try {
			response = await host.fetch(`${target.url}${path}`, {
				...init,
				headers: [
					['Authorization', `Bearer ${target.token}`],
					['Content-Type', 'application/json'],
				],
			});
		} catch {
			throw new SyncError('offline', 'The sync server cannot be reached.');
		}

		if (response.status === 401) {
			throw new SyncError('auth', 'The sync server refused the token.');
		}

		let body: unknown;
		try {
			body = await response.json();
		} catch {
			body = undefined;
		}

		if (!response.ok) {
			const code =
				isRecord(body) && typeof body.error === 'string' ? body.error : '';
			throw new SyncError(
				'server',
				ERROR_MESSAGES.get(code) ??
					`The sync server answered with an error (${response.status}).`,
			);
		}

		return body;
	}

	async function loadState(): Promise<SyncState> {
		return (
			parseState(await host.get(SYNC_STATE_KEY)) ??
			newSyncState(host.randomId())
		);
	}

	async function write(records: Records, state: SyncState, base: Store) {
		applying = true;
		try {
			await host.writeLibrary(assemble(inOrder(state, records), base));
		} finally {
			applying = false;
		}
	}

	/**
	Reads the library, stamps local edits, runs `work`, and saves the state, all inside the mutation queue.
	*/
	function step<T>(
		work: (
			state: SyncState,
			records: Records,
			store: Store,
		) => Promise<{state: SyncState; result: T}>,
	) {
		return host.mutate(async () => {
			const store = await host.readLibrary();
			const records = splitLibrary(store);
			let state = await loadState();
			if (state.joined) {
				state = capture(state, records, host.now());
			}

			const done = await work(state, records, store);
			await host.set(SYNC_STATE_KEY, done.state);
			return done.result;
		});
	}

	async function round(target: SyncConfig) {
		await setStatus({phase: 'syncing'});
		// Taken once, before the first remote change is written over a library that never synced.
		const backup = {taken: false};
		for (;;) {
			const {cursor, purged} = await step(async (state) => ({
				state,
				result: state,
			}));
			const page = parsePull(
				await request(
					target,
					`/v1/changes?cursor=${cursor}&purged=${purged}&limit=${PULL_LIMIT}`,
				),
			);
			if (!page.resync) {
				seenCursor = Math.max(seenCursor, page.cursor);
			}

			const more = await step(async (state, records, store) => {
				if (page.resync) {
					return {state: startResync(state), result: true};
				}

				const applied = receive(state, records, page, host.now());
				if (applied.changed) {
					if (!state.joined && !backup.taken) {
						backup.taken = true;
						await host.backup(store, 'Before the first sync');
					}

					await write(applied.records, applied.state, store);
				}

				return {state: applied.state, result: page.more};
			});
			if (!more) {
				break;
			}
		}

		await step(async (state, records, store) => {
			const finished = finishResync(state, records);
			if (finished.changed) {
				await write(finished.records, finished.state, store);
			}

			const joined = finished.state.joined
				? finished.state
				: {
						...capture(finished.state, finished.records, host.now()),
						joined: true,
					};
			return {state: joined, result: undefined};
		});

		let refused = 0;
		const sentKeys = new Set<string>();
		let appliedThisRound = 0;
		for (;;) {
			const {sent, pulledCursor} = await step(async (state, records) => ({
				state,
				result: {
					sent: outgoing(state, records, PUSH_LIMIT),
					pulledCursor: state.cursor,
				},
			}));
			// A record that changed again while it was being sent goes out in the next round, so a value that keeps
			// changing can never keep one round pushing.
			if (
				sent.length === 0 ||
				sent.some((change) => sentKeys.has(recordKey(change)))
			) {
				break;
			}

			for (const change of sent) {
				sentKeys.add(recordKey(change));
			}

			const body = await request(target, '/v1/changes', {
				method: 'POST',
				body: JSON.stringify({changes: sent}),
			});
			const results =
				isRecord(body) && Array.isArray(body.results) ? body.results : [];
			if (
				results.length !== sent.length ||
				results.some((result) => !PUSH_RESULTS.has(String(result)))
			) {
				throw new SyncError(
					'server',
					'The sync server sent an answer this version does not understand.',
				);
			}

			const count = await step(async (state) => {
				const settled = settle(state, sent, results as PushResult[]);
				return {state: settled.state, result: settled.refused};
			});
			refused += count;
			appliedThisRound += results.filter(
				(result) => result === 'applied',
			).length;
			if (!isRecord(body) || !Number.isSafeInteger(body.cursor)) {
				continue;
			}

			seenCursor = Math.max(seenCursor, body.cursor as number);
			// The server took more changes than this round applied since its pull: another device pushed in between,
			// and its live notice may already have been dismissed as this device's own echo. Pull again.
			if ((body.cursor as number) > pulledCursor + appliedThisRound) {
				again = true;
			}
		}

		const state = await loadState();
		await setStatus({
			phase: 'idle',
			lastSyncAt: host.now(),
			pending: state.outbox.length,
			refused: status.refused + refused,
			error: null,
		});
	}

	/**
	Runs a round now, or once more after the one in progress.
	*/
	async function syncNow(): Promise<void> {
		await ready;
		if (!config) {
			return;
		}

		if (running) {
			again = true;
			return running;
		}

		return startRound(config);
	}

	/**
	A live notice: runs a round when it announces changes this device has not seen.
	*/
	function noticed(cursor: number) {
		noticeCursor = Math.max(noticeCursor, cursor);
		if (!running && noticeCursor > seenCursor) {
			void syncNow();
		}
	}

	function startRound(target: SyncConfig): Promise<void> {
		running = (async () => {
			try {
				for (;;) {
					again = false;

					await round(target);
					if (noticeCursor > seenCursor) {
						again = true;
					}

					if (!again || config !== target) {
						break;
					}
				}
			} catch (error) {
				const failure =
					error instanceof SyncError
						? error
						: new SyncError('server', 'Sync failed.');
				if (config === target) {
					await setStatus({
						phase: failure.kind === 'offline' ? 'offline' : 'error',
						error: failure.message,
					});
				}
			} finally {
				running = undefined;
			}
		})();
		return running;
	}

	function closeSocket() {
		clearInterval(pingTimer);
		clearTimeout(reconnectTimer);
		const open = socket;
		socket = undefined;
		open?.close();
	}

	function openLive() {
		if (!config || !host.openSocket || socket) {
			return;
		}

		const target = config;
		const live = host.openSocket(
			`${target.url.replace(/^http/, 'ws')}/v1/live`,
		);
		socket = live;
		live.addEventListener('open', () => {
			live.send(JSON.stringify({type: 'auth', token: target.token}));
			pingTimer = setInterval(() => {
				live.send('ping');
			}, PING_MS);
		});
		live.addEventListener('message', (event) => {
			let message: unknown;
			try {
				message = JSON.parse(String(event.data));
			} catch {
				return;
			}

			if (!isRecord(message)) {
				return;
			}

			if (message.type === 'ready') {
				reconnectDelay = RECONNECT_MIN_MS;
				void setStatus({live: true});
				void syncNow();
			} else if (
				message.type === 'cursor' &&
				Number.isSafeInteger(message.cursor)
			) {
				noticed(message.cursor as number);
			}
		});
		live.addEventListener('close', () => {
			if (socket !== live) {
				return;
			}

			socket = undefined;
			clearInterval(pingTimer);
			void setStatus({live: false});
			if (config !== target) {
				return;
			}

			reconnectTimer = setTimeout(openLive, reconnectDelay);
			reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
		});
	}

	return {
		async status(): Promise<SyncStatus> {
			await ready;
			const state = config ? await loadState() : undefined;
			return {...status, pending: state?.outbox.length ?? 0};
		},

		/**
		Checks the server and token, then starts syncing this library with it.
		*/
		async connect(urlText: string, tokenText: string): Promise<SyncStatus> {
			await ready;
			const url = parseServerUrl(urlText);
			const token = tokenText.trim();
			if (token.length < MIN_TOKEN_LENGTH) {
				throw new SyncError(
					'config',
					`The token is at least ${MIN_TOKEN_LENGTH} characters long.`,
				);
			}

			const target = {url, token};
			const server = await request(target, '/v1/status');
			if (!isRecord(server) || server.protocol !== PROTOCOL_VERSION) {
				throw new SyncError(
					'server',
					'This server runs a sync version this TabLodge does not support.',
				);
			}

			closeSocket();
			config = target;
			await host.remove([SYNC_STATE_KEY]);
			await host.set(SYNC_CONFIG_KEY, target);
			status = {
				connected: true,
				url,
				phase: 'idle',
				live: false,
				lastSyncAt: null,
				pending: 0,
				refused: 0,
				error: null,
			};
			await host.set(SYNC_STATUS_KEY, status);
			openLive();
			await syncNow();
			return this.status();
		},

		/**
		Stops syncing. The library on this device stays as it is.
		*/
		async disconnect(): Promise<SyncStatus> {
			await ready;
			config = undefined;
			closeSocket();
			await running;
			await host.remove([SYNC_CONFIG_KEY, SYNC_STATE_KEY, SYNC_STATUS_KEY]);
			status = {
				...status,
				connected: false,
				url: null,
				phase: 'off',
				live: false,
				error: null,
				refused: 0,
			};
			return status;
		},

		syncNow,

		/**
		Called after every library write; a write made by sync itself is ignored.
		*/
		localChanged() {
			if (applying || !config) {
				return;
			}

			clearTimeout(localTimer);
			localTimer = setTimeout(() => {
				void syncNow();
			}, LOCAL_CHANGE_DELAY_MS);
		},

		/**
		Worker start and the fallback alarm: reopen the live socket and catch up.
		*/
		async wake() {
			await ready;
			if (!config) {
				return;
			}

			openLive();
			await syncNow();
		},

		get enabled() {
			return config !== undefined;
		},
	};
}

export type SyncClient = ReturnType<typeof createSyncClient>;
