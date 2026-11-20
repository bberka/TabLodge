/*
The sync client the service worker runs: it connects to a self hosted server, runs sync rounds, and keeps a live
socket open so changes from other devices arrive within a moment. Everything it touches (storage, the network,
the library) comes in through `SyncHost`, so the tests drive it against the reference server in memory.

A round: stamp local edits, pull and apply the server's changes page by page, then push the outbox. Each library
read and write happens inside the worker's mutation queue (`host.mutate`); the network calls happen between them,
so a slow server never holds up the app. Rounds never overlap: a request during a round runs one more after it.
*/
import type {Store} from '../types';
import type {TombstoneKind} from '../library-sync';
import {isRecord} from '../library-values';
import type {TrashEntry} from '../trash';
import type {PushResult} from './change-log';
import {parseChange, recordKey, type SyncChange} from './changes';
import {
	incompatibleMessage,
	parseServerInfo,
	type ServerInfo,
	updateSide,
} from './compat';
import {
	capture,
	finishResync,
	inOrder,
	newSyncState,
	outgoing,
	type Records,
	receive,
	restartAfterServerReset,
	settle,
	startResync,
	type SyncState,
} from './engine';
import {
	assemble,
	isUntouchedDefault,
	sourcesOf,
	splitLibrary,
	type SyncedSource,
	trashOf,
} from './library-records';

export const SYNC_CONFIG_KEY = 'tablodge.sync.config';
const SYNC_STATE_KEY = 'tablodge.sync.state';
export const SYNC_STATUS_KEY = 'tablodge.sync.status';
/**
Whether this browser syncs its settings. Missing means yes; only an explicit `false` turns it off.
*/
export const SYNC_SETTINGS_KEY = 'tablodge.sync.settings';
export const SYNC_ALARM = 'tablodge-sync';
/**
Written by a private window's worker after it saves to the shared library, so the regular worker, which runs sync,
sends the change right away. Split workers cannot message each other, but they share local storage.
*/
export const SYNC_NUDGE_KEY = 'tablodge.sync.nudge';
/**
Minutes between fallback rounds, which also reopen a closed live socket.
*/
export const SYNC_ALARM_MINUTES = 5;
export const MIN_TOKEN_LENGTH = 32;
// How long a server's account of itself (protocol, version, features) is trusted.
const FEATURE_CHECK_MS = 10 * 60 * 1000;

/**
A new server token: 32 random bytes as 64 hex characters, which paste cleanly into any form.
*/
export function createSyncToken(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
}

const PULL_LIMIT = 500;
// Record kinds that sync only when the server and the host support them.
const OPTIONAL_KINDS = ['trash', 'note', 'tag', 'source', 'setting'] as const;
type OptionalKind = (typeof OPTIONAL_KINDS)[number];
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
	/**
	The library on the server is encrypted and this device needs the password to read it.
	*/
	needsKey?: boolean;
	/**
	What the server last said about itself at /v1/status. Missing until a round has asked, or when it did not answer.
	*/
	server?: ServerInfo;
	/**
	Sync stopped because the server speaks another protocol, and this side needs updating to fix it.
	*/
	incompatible?: 'server' | 'app';
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

/**
Encrypts record values before they leave this device and opens them as they arrive. Used for the private windows'
library; the regular library has none.
*/
export type SyncCodec = {
	/**
	Runs before each round with a way to call this server, so the codec can fetch or store its wrapped key. Throws a
	SyncError to stop the round.
	*/
	prepare(
		call: (path: string, init?: RequestInit) => Promise<unknown>,
	): Promise<void>;
	seal(change: SyncChange): Promise<SyncChange>;
	/**
	`reseal` is true for a value that arrived unencrypted, which this device then sends again encrypted.
	*/
	open(change: SyncChange): Promise<{change: SyncChange; reseal: boolean}>;
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
	The trash of this library, which syncs with a server that supports it. Without it the trash stays on the device.
	*/
	trash?: {
		read(): Promise<TrashEntry[]>;
		/**
		Adds or replaces `put`, removes the entries named in `remove`, and keeps the rest, so a delete made while the
		round runs is not lost. The host drops what is past its retention.
		*/
		apply(put: TrashEntry[], remove: string[]): Promise<void>;
	};
	/**
	The extension's Sources choices, one per site that is on, which sync with a server that supports them. They live
	outside the library and belong to the regular library's sync only. Without it they stay on the device.
	*/
	sources?: {
		read(): Promise<SyncedSource[]>;
		/**
		Adds or replaces `put` and removes the sites named in `remove`, keeping the rest. `was` holds each of those sites'
		values as `read` gave them this round (undefined for none): a site whose value changed since was edited in
		Settings meanwhile, so the host keeps that edit, and this round's push sends it. Values are stored as they came,
		so they go back unchanged.
		*/
		apply(
			put: SyncedSource[],
			remove: string[],
			was: ReadonlyMap<string, unknown>,
		): Promise<void>;
	};
	/**
	Writes a library assembled from synced records; the host normalizes it like any untrusted input.
	*/
	writeLibrary(store: Store): Promise<void>;
	backup(store: Store, reason: string): Promise<void>;
	codec?: SyncCodec;
	/**
	This device only reads: it pulls and applies the server's records and never sends one, not even after a server
	reset or a restore that would otherwise send everything again. For a library shown read only.
	*/
	readOnly?: boolean;
	randomId(): string;
	now(): number;
};

export class SyncError extends Error {
	constructor(
		/**
		`key`: the library is encrypted and this device does not have its key. `incompatible`: the server speaks
		another protocol.
		*/
		readonly kind:
			'config' | 'offline' | 'auth' | 'server' | 'key' | 'incompatible',
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

export function parseConfig(value: unknown): SyncConfig | undefined {
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
		? ({
				purged: 0,
				...value,
				// Anything but a list of kinds counts as none pulled yet, which only costs one pull from the start.
				pulled: Array.isArray(value.pulled)
					? value.pulled.filter((kind): kind is OptionalKind =>
							(OPTIONAL_KINDS as readonly unknown[]).includes(kind),
						)
					: undefined,
			} as SyncState)
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

export const SYNC_OFF: SyncStatus = {
	connected: false,
	url: null,
	phase: 'off',
	live: false,
	lastSyncAt: null,
	pending: 0,
	refused: 0,
	error: null,
};

/**
One request to a sync server with the token. Throws SyncError for an unreachable server or a refused token, and
leaves every other status to the caller.
*/
export async function callServer(
	send: SyncHost['fetch'],
	target: SyncConfig,
	path: string,
	init: RequestInit = {},
): Promise<{status: number; body: unknown}> {
	let response: Response;
	try {
		response = await send(`${target.url}${path}`, {
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

	return {status: response.status, body};
}

/**
Stamps local edits to everything but the `left` kinds, which keep what was last agreed with the server. Records that
are not looked at here (the settings of a device that does not sync them, the trash of a server that cannot hold it)
would otherwise look deleted.
*/
function captureExcept(
	state: SyncState,
	records: Records,
	now: number,
	left: ReadonlySet<TombstoneKind>,
): SyncState {
	const isLeft = (key: string) => {
		const kind = state.shadow[key]?.kind;
		return kind !== undefined && left.has(kind);
	};

	const kept = Object.fromEntries(
		Object.entries(state.shadow).filter(([key]) => isLeft(key)),
	);
	const queued = state.outbox.filter((key) => isLeft(key));
	const captured = capture(
		{
			...state,
			shadow: Object.fromEntries(
				Object.entries(state.shadow).filter(([key]) => !isLeft(key)),
			),
			outbox: state.outbox.filter((key) => !isLeft(key)),
		},
		new Map([...records].filter(([, record]) => !left.has(record.kind))),
		now,
	);
	return {
		...captured,
		shadow: {...captured.shadow, ...kept},
		outbox: [...captured.outbox, ...queued],
	};
}

export function createSyncClient(host: SyncHost) {
	let config: SyncConfig | undefined;
	let status = SYNC_OFF;
	let running: Promise<void> | undefined;
	let again = false;
	let applying = false;
	let localTimer: ReturnType<typeof setTimeout> | undefined;
	// A local change is waiting for its delayed round.
	let localPending = false;
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
	// Whether this round syncs the trash: the host has one and the server lists the `trash` feature.
	let trashOn = false;
	// Whether this round syncs bookmark notes: the server lists the `notes` feature.
	let notesOn = false;
	// Whether this round syncs bookmark tags: the server lists the `tags` feature.
	let tagsOn = false;
	// Whether this round syncs Sources choices: the host has them and the server lists the `sources` feature.
	let sourcesOn = false;
	// Whether this round syncs the settings added since 0.3.0: the server lists the `settings` feature.
	let settingKindOn = false;
	let featureCheck:
		{key: string; until: number; features: ReadonlySet<string>} | undefined;
	// What the last /v1/status answer said, for the status the round ends with.
	let serverInfo: ServerInfo | undefined;
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
		const {status: code, body} = await callServer(
			host.fetch,
			target,
			path,
			init,
		);
		if (code < 200 || code >= 300) {
			const error =
				isRecord(body) && typeof body.error === 'string' ? body.error : '';
			throw new SyncError(
				'server',
				ERROR_MESSAGES.get(error) ??
					`The sync server answered with an error (${code}).`,
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

	async function settingsOn() {
		return (await host.get(SYNC_SETTINGS_KEY)) !== false;
	}

	/**
	Asks the server about itself, at most every few minutes, and returns the optional record kinds it lists. An old
	server refuses a push with a kind it does not know, which would stop every round, so the trash, bookmark notes and
	tags, Sources choices, and newer settings wait until the server says it can hold them. A server that speaks another protocol stops
	the round; that answer is not kept, so the round after the server's update goes ahead.
	*/
	async function serverFeatures(
		target: SyncConfig,
	): Promise<ReadonlySet<string>> {
		const key = `${target.url}\n${target.token}`;
		if (featureCheck?.key === key && host.now() < featureCheck.until) {
			return featureCheck.features;
		}

		/*
		A status request that fails ends the round, like any other request. Taken as "no features", it would make the pull
		skip the trash, notes, and tags while the cursor moves past them, so this device would never get them.
		*/
		const info = parseServerInfo(await request(target, '/v1/status'));
		const side = info && updateSide(info.protocol);
		if (side) {
			featureCheck = undefined;
			await setStatus({server: info});
			throw new SyncError('incompatible', incompatibleMessage(side));
		}

		serverInfo = info ?? serverInfo;
		const features = new Set(info?.features);
		featureCheck = {key, until: host.now() + FEATURE_CHECK_MS, features};
		return features;
	}

	// The kinds this round leaves alone because the server cannot hold them: they stay on the device, unsent.
	const unsupported = (kind: TombstoneKind | undefined) =>
		(kind === 'trash' && !trashOn) ||
		(kind === 'note' && !notesOn) ||
		(kind === 'tag' && !tagsOn) ||
		(kind === 'source' && !sourcesOn) ||
		(kind === 'setting' && !settingKindOn);

	/**
	Starts a resync that never counts a record of an unsupported kind as deleted: the pull skips those kinds, so they
	would all look unseen at the end and be removed from the library.
	*/
	const resyncSupported = (state: SyncState): SyncState => {
		const started = startResync(state);
		return {
			...started,
			unseen: started.unseen?.filter(
				(key) => !unsupported(state.shadow[key]?.kind),
			),
		};
	};

	/**
	The changes to push. The trash, notes, tags, Sources choices, and newer settings stay queued while the server cannot
	hold them.
	*/
	const queued = (state: SyncState, records: Records) =>
		outgoing(
			{
				...state,
				outbox: state.outbox.filter(
					(key) => !unsupported(state.shadow[key]?.kind),
				),
			},
			records,
			PUSH_LIMIT,
		);

	/*
	`setting` records are left alone until a pull has taken them once. Most of these settings existed in 0.3.0 without
	syncing, so every browser already holds its own values, and the phone holds every default. Captured first, each
	would carry a stamp from now and overwrite what the server has; this way the server's value wins over one that
	never synced, and only the settings the server lacks go out after the pull.
	*/
	const leftAlone = async (
		state: SyncState,
	): Promise<ReadonlySet<TombstoneKind>> =>
		new Set<TombstoneKind>([
			...((await settingsOn()) ? [] : (['preference', 'setting'] as const)),
			...(trashOn ? [] : (['trash'] as const)),
			...(notesOn ? [] : (['note'] as const)),
			...(tagsOn ? [] : (['tag'] as const)),
			...(sourcesOn ? [] : (['source'] as const)),
			...(settingKindOn && state.pulled?.includes('setting')
				? []
				: (['setting'] as const)),
		]);

	async function captureLocal(state: SyncState, all: Records) {
		const left = await leftAlone(state);
		const records = new Map(
			[...all].filter(
				([key, record]) => state.shadow[key] || !isUntouchedDefault(record),
			),
		);
		return left.size === 0
			? capture(state, records, host.now())
			: captureExcept(state, records, host.now(), left);
	}

	/**
	Writes the library from `records` and, when they changed, the trash entries and Sources choices that differ from
	`before`.
	*/
	async function write(
		records: Records,
		before: Records,
		state: SyncState,
		base: Store,
	) {
		const syncSettings = await settingsOn();
		applying = true;
		try {
			await host.writeLibrary(
				assemble(inOrder(state, records), base, syncSettings),
			);
			if (trashOn && host.trash) {
				const put = trashOf(
					[...records]
						.filter(([key, record]) => before.get(key) !== record)
						.map(([, record]) => record),
				);
				const remove = [...before.values()]
					.filter(
						(record) =>
							record.kind === 'trash' && !records.has(recordKey(record)),
					)
					.map((record) => record.id);
				if (put.length > 0 || remove.length > 0) {
					await host.trash.apply(put, remove);
				}
			}

			if (sourcesOn && host.sources) {
				const put = sourcesOf(
					[...records]
						.filter(([key, record]) => before.get(key) !== record)
						.map(([, record]) => record),
				);
				const remove = [...before.values()]
					.filter(
						(record) =>
							record.kind === 'source' && !records.has(recordKey(record)),
					)
					.map((record) => record.id);
				if (put.length > 0 || remove.length > 0) {
					const was = new Map(
						[...put.map(({id}) => id), ...remove].map((id) => [
							id,
							before.get(recordKey({kind: 'source', id}))?.value,
						]),
					);
					await host.sources.apply(put, remove, was);
				}
			}
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
			const records = splitLibrary(
				store,
				trashOn && host.trash ? await host.trash.read() : [],
				sourcesOn && host.sources ? await host.sources.read() : [],
			);
			let state = await loadState();
			if (state.joined) {
				state = await captureLocal(state, records);
			}

			const done = await work(state, records, store);
			await host.set(SYNC_STATE_KEY, done.state);
			return done.result;
		});
	}

	async function round(target: SyncConfig) {
		await setStatus({phase: 'syncing'});
		// Before anything else, so a server that speaks another protocol gets no key, pull, or push request.
		const features = await serverFeatures(target);
		const {codec} = host;
		await codec?.prepare(async (path, init) => request(target, path, init));
		trashOn = host.trash !== undefined && features.has('trash');
		notesOn = features.has('notes');
		tagsOn = features.has('tags');
		sourcesOn = host.sources !== undefined && features.has('sources');
		settingKindOn = features.has('settings');
		// Records that arrived unencrypted in an encrypted library; they are sent again encrypted.
		const reseal = new Set<string>();
		/*
		The whole pull is collected before any of it is applied. Records arrive in the order the server last changed
		them, so a tab can come pages before its session, or a bookmark before its column. Applied page by page, the
		library would drop such a tab or move such a bookmark, and the next capture would send that loss to every
		device.
		*/
		/*
		The optional kinds this round pulls. A kind skipped by earlier pulls (the server lacked it, or this device ran a
		version without it, such as 0.3.0 before Sources) was left behind the cursor, so a round that takes it for the
		first time pulls from the start. Stamps decide record by record, so nothing newer here is lost. It runs as a
		resync: the server checks for purged deletes only against a cursor past 0, so a record deleted elsewhere whose
		delete was purged since would otherwise stay. A record not seen again is removed, unless it waits to be sent.
		*/
		const kinds = OPTIONAL_KINDS.filter((kind) => !unsupported(kind));
		const start = await step(async (state) => ({
			state,
			result: {
				replay:
					state.cursor > 0 &&
					kinds.some((kind) => !state.pulled?.includes(kind)),
				cursor: state.cursor,
				purged: state.purged,
				known: Math.max(state.known ?? 0, state.cursor),
			},
		}));
		let end = {cursor: start.replay ? 0 : start.cursor, purged: start.purged};
		let resync = start.replay;
		let serverReset = false;
		const pulled: SyncChange[] = [];
		for (;;) {
			const page = parsePull(
				await request(
					target,
					`/v1/changes?cursor=${end.cursor}&purged=${end.purged}&limit=${PULL_LIMIT}`,
				),
			);
			if (page.resync) {
				resync = true;
				pulled.length = 0;
				end = {cursor: 0, purged: end.purged};
				continue;
			}

			// The server is behind this device: it was restored from an older backup or replaced. Start over. Only the
			// last page says where the server is; an earlier one of a pull from the start ends wherever its page does.
			if (
				!serverReset &&
				!page.more &&
				page.cursor < Math.max(end.cursor, start.known)
			) {
				serverReset = true;
				pulled.length = 0;
				end = {cursor: 0, purged: 0};
				continue;
			}

			for (const change of page.changes) {
				if (unsupported(change.kind)) {
					continue;
				}

				if (codec && !change.deleted) {
					const opened = await codec.open(change);
					if (opened.reseal) {
						reseal.add(recordKey(change));
					}

					pulled.push(opened.change);
				} else {
					pulled.push(change);
				}
			}

			end = {cursor: page.cursor, purged: page.purged};
			seenCursor = Math.max(seenCursor, page.cursor);
			if (!page.more) {
				break;
			}
		}

		await step(async (state, records, store) => {
			const restarted = serverReset ? restartAfterServerReset(state) : state;
			const applied = receive(
				resync ? resyncSupported(restarted) : restarted,
				records,
				{changes: pulled, ...end},
				host.now(),
			);
			const finished = finishResync(applied.state, applied.records);
			if (applied.changed || finished.changed) {
				// A library that never synced gets a safety backup before the server's copy is written over it.
				if (!state.joined) {
					await host.backup(store, 'Before the first sync');
				}

				await write(finished.records, records, finished.state, store);
			}

			let next = finished.state;
			if (reseal.size > 0) {
				// Without a shadow entry the next capture stamps the record again, so it goes out encrypted.
				const shadow = Object.fromEntries(
					Object.entries(next.shadow).filter(
						([key]) => !(reseal.has(key) && finished.records.has(key)),
					),
				);
				next = {...next, shadow};
			}

			const joined = next.joined
				? next
				: {
						...(await captureLocal(next, finished.records)),
						joined: true,
					};
			return {state: {...joined, pulled: kinds}, result: undefined};
		});

		let refused = 0;
		const sentKeys = new Set<string>();
		let appliedThisRound = 0;
		for (;;) {
			const {sent, pulledCursor} = await step(async (state, records) => ({
				state,
				result: {
					sent: host.readOnly ? [] : queued(state, records),
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
				body: JSON.stringify({
					changes: codec
						? await Promise.all(sent.map(async (change) => codec.seal(change)))
						: sent,
				}),
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
				const known =
					isRecord(body) && Number.isSafeInteger(body.cursor)
						? Math.max(settled.state.known ?? 0, body.cursor as number)
						: settled.state.known;
				return {state: {...settled.state, known}, result: settled.refused};
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
			needsKey: false,
			server: serverInfo ?? status.server,
			incompatible: undefined,
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
						needsKey: failure.kind === 'key',
						// Offline says nothing new about the server, so what was known stays.
						incompatible:
							failure.kind === 'offline'
								? status.incompatible
								: failure.kind === 'incompatible' && status.server
									? updateSide(status.server.protocol)
									: undefined,
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
				// The server may have been updated while the socket was closed, so the round asks it again.
				featureCheck = undefined;
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
			const server = parseServerInfo(await request(target, '/v1/status'));
			if (!server) {
				throw new SyncError(
					'server',
					'This address does not answer like a TabLodge sync server.',
				);
			}

			const side = updateSide(server.protocol);
			if (side) {
				throw new SyncError('incompatible', incompatibleMessage(side));
			}

			closeSocket();
			config = target;
			serverInfo = server;
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
				server,
			};
			await host.set(SYNC_STATUS_KEY, status);
			openLive();
			await syncNow();
			return this.status();
		},

		/**
		Sends every record again with a new stamp, as after the library became encrypted.
		*/
		async resendAll(): Promise<void> {
			await ready;
			if (!config) {
				return;
			}

			await host.mutate(async () => {
				const state = await loadState();
				await host.set(SYNC_STATE_KEY, {...state, shadow: {}});
			});
			await syncNow();
		},

		/**
		Closes the live socket and forgets the server until the next load, keeping everything stored. For a library
		that cannot be read for now, such as a locked private one.
		*/
		stop() {
			config = undefined;
			clearTimeout(localTimer);
			localPending = false;
			closeSocket();
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
				server: undefined,
				incompatible: undefined,
			};
			serverInfo = undefined;
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
			localPending = true;
			localTimer = setTimeout(() => {
				localPending = false;
				void syncNow();
			}, LOCAL_CHANGE_DELAY_MS);
		},

		/**
		For a device that goes to the background: sends a change that was still waiting, then closes the live socket and
		its timers so nothing wakes the radio. The server stays configured; `wake` starts it again.
		*/
		async pause() {
			await ready;
			if (!config) {
				return;
			}

			clearTimeout(localTimer);
			closeSocket();
			void setStatus({live: false});
			// A change waiting for its delay, or one a failed or offline round left unsent, goes out before the pause.
			const waiting =
				localPending ||
				(!host.readOnly && (await loadState()).outbox.length > 0);
			localPending = false;
			if (waiting) {
				await syncNow();
			}
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
