import type {Store} from '../types';
import type {SyncedThumb} from '../image-store';
import type {TombstoneKind} from '../library-sync';
import {isRecord} from '../library-values';
import {type TrashEntry, refusedTrash} from '../trash';
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
	serverHeldKeys,
	startResync,
	type SyncState,
} from './engine';
import {
	assemble,
	isUntouchedDefault,
	sourcesOf,
	thumbsOf,
	splitLibrary,
	type SyncedSource,
	trashOf,
} from './library-records';

export const SYNC_CONFIG_KEY = 'tablodge.sync.config';
const SYNC_STATE_KEY = 'tablodge.sync.state';
export const SYNC_STATUS_KEY = 'tablodge.sync.status';
export const SYNC_SETTINGS_KEY = 'tablodge.sync.settings';
export const SYNC_ALARM = 'tablodge-sync';
export const SYNC_NUDGE_KEY = 'tablodge.sync.nudge';
export const SYNC_ALARM_MINUTES = 5;
export const MIN_TOKEN_LENGTH = 32;
const FEATURE_CHECK_MS = 10 * 60 * 1000;

export function createSyncToken(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
}

const PULL_LIMIT = 500;
const OPTIONAL_KINDS = [
	'trash',
	'note',
	'tag',
	'source',
	'setting',
	'thumb',
] as const;
type OptionalKind = (typeof OPTIONAL_KINDS)[number];
const PUSH_LIMIT = 500;
const PUSH_MAX_CHARS = 5_000_000;

function withinRequest(changes: SyncChange[]): SyncChange[] {
	let size = 0;
	const fitting: SyncChange[] = [];
	for (const change of changes) {
		size += JSON.stringify(change).length;
		if (fitting.length > 0 && size > PUSH_MAX_CHARS) {
			break;
		}

		fitting.push(change);
	}

	return fitting;
}

const LOCAL_CHANGE_DELAY_MS = 2500;
const LOCAL_CHANGE_MAX_WAIT_MS = 10_000;
const PUSH_CHECKPOINT_MS = 3000;
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
	refused: number;
	error: string | null;
	needsKey?: boolean;
	server?: ServerInfo;
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

export type SyncCodec = {
	prepare(
		call: (path: string, init?: RequestInit) => Promise<unknown>,
	): Promise<void>;
	seal(change: SyncChange): Promise<SyncChange>;
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
	trash?: {
		read(): Promise<TrashEntry[]>;
		apply(put: TrashEntry[], remove: string[]): Promise<void>;
	};
	sources?: {
		read(): Promise<SyncedSource[]>;
		apply(
			put: SyncedSource[],
			remove: string[],
			was: ReadonlyMap<string, unknown>,
		): Promise<void>;
	};
	thumbs?: {
		read(): Promise<SyncedThumb[]>;
		apply(put: unknown[], remove: string[]): Promise<void>;
	};
	outsideSettings?: {
		defaults: Readonly<Record<string, unknown>>;
		read(): Promise<Record<string, unknown>>;
		apply(
			put: Record<string, unknown>,
			was: Readonly<Record<string, unknown>>,
		): Promise<void>;
	};
	onSynced?: (
		target: SyncConfig,
		server: ServerInfo | undefined,
	) => void | Promise<void>;
	writeLibrary(store: Store): Promise<void>;
	backup(store: Store, reason: string): Promise<void>;
	codec?: SyncCodec;
	readOnly?: boolean;
	randomId(): string;
	now(): number;
};

export class SyncError extends Error {
	constructor(
		readonly kind:
			'config' | 'offline' | 'auth' | 'server' | 'key' | 'incompatible',
		message: string,
	) {
		super(message);
		this.name = 'SyncError';
	}
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

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
	const rest = {
		...state,
		shadow: Object.fromEntries(
			Object.entries(state.shadow).filter(([key]) => !isLeft(key)),
		),
		outbox: state.outbox.filter((key) => !isLeft(key)),
	};
	const captured = capture(
		rest,
		new Map([...records].filter(([, record]) => !left.has(record.kind))),
		now,
	);
	if (captured === rest) {
		return state;
	}

	return {
		...captured,
		shadow: {...captured.shadow, ...kept},
		outbox: [...captured.outbox, ...queued],
	};
}

type Snapshot = {state: SyncState; records: Records; epoch: number};

export function createSyncClient(host: SyncHost) {
	let config: SyncConfig | undefined;
	let status = SYNC_OFF;
	let running: Promise<void> | undefined;
	let again = false;
	let applying = false;
	let localTimer: ReturnType<typeof setTimeout> | undefined;
	let localPending = false;
	let localSince = 0;
	let socket: SyncSocket | undefined;
	let pingTimer: ReturnType<typeof setInterval> | undefined;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let reconnectDelay = RECONNECT_MIN_MS;
	let seenCursor = 0;
	let noticeCursor = 0;
	let trashOn = false;
	let notesOn = false;
	let tagsOn = false;
	let sourcesOn = false;
	let thumbsOn = false;
	let settingKindOn = false;
	let featureCheck:
		{key: string; until: number; features: ReadonlySet<string>} | undefined;
	let stateEpoch = 0;
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

	async function putState(state: SyncState) {
		stateEpoch += 1;
		const epoch = stateEpoch;
		await host.set(SYNC_STATE_KEY, state);
		return epoch;
	}

	async function dropState(extra: string[] = []) {
		stateEpoch += 1;
		await host.remove([...extra, SYNC_STATE_KEY]);
	}

	async function settingsOn() {
		return (await host.get(SYNC_SETTINGS_KEY)) !== false;
	}

	async function serverFeatures(
		target: SyncConfig,
	): Promise<ReadonlySet<string>> {
		const key = `${target.url}\n${target.token}`;
		if (featureCheck?.key === key && host.now() < featureCheck.until) {
			return featureCheck.features;
		}

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

	const unsupported = (kind: TombstoneKind | undefined) =>
		(kind === 'trash' && !trashOn) ||
		(kind === 'note' && !notesOn) ||
		(kind === 'tag' && !tagsOn) ||
		(kind === 'source' && !sourcesOn) ||
		(kind === 'thumb' && !thumbsOn) ||
		(kind === 'setting' && !settingKindOn);

	const resyncSupported = (state: SyncState): SyncState => {
		const started = startResync(state);
		return {
			...started,
			unseen: started.unseen?.filter(
				(key) => !unsupported(state.shadow[key]?.kind),
			),
		};
	};

	const queued = (state: SyncState, records: Records) =>
		withinRequest(
			outgoing(
				{
					...state,
					outbox: state.outbox.filter(
						(key) => !unsupported(state.shadow[key]?.kind),
					),
				},
				records,
				PUSH_LIMIT,
			),
		);

	const leftAlone = async (
		state: SyncState,
	): Promise<ReadonlySet<TombstoneKind>> =>
		new Set<TombstoneKind>([
			...((await settingsOn()) ? [] : (['preference', 'setting'] as const)),
			...(trashOn ? [] : (['trash'] as const)),
			...(notesOn ? [] : (['note'] as const)),
			...(tagsOn ? [] : (['tag'] as const)),
			...(sourcesOn ? [] : (['source'] as const)),
			...(thumbsOn ? [] : (['thumb'] as const)),
			...(settingKindOn && state.pulled?.includes('setting')
				? []
				: (['setting'] as const)),
		]);

	async function captureLocal(state: SyncState, all: Records) {
		const left = await leftAlone(state);
		const records = new Map(
			[...all].filter(
				([key, record]) =>
					state.shadow[key] ||
					!isUntouchedDefault(record, host.outsideSettings?.defaults),
			),
		);
		return left.size === 0
			? capture(state, records, host.now())
			: captureExcept(state, records, host.now(), left);
	}

	async function write(
		records: Records,
		before: Records,
		state: SyncState,
		base: Store,
	) {
		const syncSettings = await settingsOn();
		const outside = host.outsideSettings;
		applying = true;
		try {
			await host.writeLibrary(
				assemble(
					inOrder(state, records),
					base,
					syncSettings,
					new Set(Object.keys(outside?.defaults ?? {})),
				),
			);
			if (outside && syncSettings && settingKindOn) {
				const put: Record<string, unknown> = {};
				const was: Record<string, unknown> = {};
				for (const id of Object.keys(outside.defaults)) {
					const key = recordKey({kind: 'setting', id});
					const record = records.get(key);
					if (!record || record === before.get(key)) {
						continue;
					}

					put[id] = record.value;
					was[id] = before.get(key)?.value;
				}

				if (Object.keys(put).length > 0) {
					await outside.apply(put, was);
				}
			}

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

			if (thumbsOn && host.thumbs) {
				const put = thumbsOf(
					[...records]
						.filter(([key, record]) => before.get(key) !== record)
						.map(([, record]) => record),
				);
				const remove = [...before.values()]
					.filter(
						(record) =>
							record.kind === 'thumb' && !records.has(recordKey(record)),
					)
					.map((record) => record.id);
				if (put.length > 0 || remove.length > 0) {
					await host.thumbs.apply(put, remove);
				}
			}
		} finally {
			applying = false;
		}
	}

	function stepWithSnapshot<T>(
		work: (
			state: SyncState,
			records: Records,
			store: Store,
		) => Promise<{state: SyncState; result: T}>,
	) {
		return host.mutate(async () => {
			const store = await host.readLibrary();
			const stored = parseState(await host.get(SYNC_STATE_KEY));
			let state = stored ?? newSyncState(host.randomId());
			const records = splitLibrary(
				store,
				trashOn && host.trash ? await host.trash.read() : [],
				sourcesOn && host.sources ? await host.sources.read() : [],
				settingKindOn && host.outsideSettings
					? await host.outsideSettings.read()
					: {},
				serverHeldKeys(state),
				thumbsOn && host.thumbs ? await host.thumbs.read() : [],
			);
			if (state.joined) {
				state = await captureLocal(state, records);
			}

			const done = await work(state, records, store);
			const epoch =
				done.state === stored ? stateEpoch : await putState(done.state);
			return {
				result: done.result,
				snapshot: {state: done.state, records, epoch},
			};
		});
	}

	async function step<T>(
		work: (
			state: SyncState,
			records: Records,
			store: Store,
		) => Promise<{state: SyncState; result: T}>,
	) {
		return (await stepWithSnapshot(work)).result;
	}

	async function round(target: SyncConfig) {
		await setStatus({phase: 'syncing'});
		const features = await serverFeatures(target);
		const {codec} = host;
		await codec?.prepare(async (path, init) => request(target, path, init));
		trashOn = host.trash !== undefined && features.has('trash');
		notesOn = features.has('notes');
		tagsOn = features.has('tags');
		sourcesOn = host.sources !== undefined && features.has('sources');
		thumbsOn = host.thumbs !== undefined && features.has('thumbs');
		settingKindOn = features.has('settings');
		const reseal = new Set<string>();
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

		const pulledOnly = await stepWithSnapshot(async (state, records, store) => {
			const restarted = serverReset ? restartAfterServerReset(state) : state;
			const applied = receive(
				resync ? resyncSupported(restarted) : restarted,
				records,
				{changes: pulled, ...end},
				host.now(),
			);
			const finished = finishResync(applied.state, applied.records);
			if (applied.changed || finished.changed) {
				if (!state.joined) {
					await host.backup(store, 'Before the first sync');
				}

				await write(finished.records, records, finished.state, store);
			}

			let next = finished.state;
			if (reseal.size > 0) {
				const shadow = Object.fromEntries(
					Object.entries(next.shadow).map(([key, entry]) => [
						key,
						reseal.has(key) && finished.records.has(key)
							? {...entry, hash: ''}
							: entry,
					]),
				);
				next = {...next, shadow};
			}

			const joined = next.joined
				? next
				: {
						...(await captureLocal(next, finished.records)),
						joined: true,
					};
			const same =
				joined.pulled?.length === kinds.length &&
				kinds.every((kind) => joined.pulled?.includes(kind));
			return {
				state: same ? joined : {...joined, pulled: kinds},
				result: same && !applied.changed && !finished.changed,
			};
		});

		let refused = 0;
		const sentKeys = new Set<string>();
		let appliedThisRound = 0;
		let held: Snapshot | undefined = pulledOnly.result
			? pulledOnly.snapshot
			: undefined;
		let unsaved = false;
		let savedAt = host.now();
		const save = async () => {
			const snapshot = held;
			if (!snapshot || !unsaved || config !== target) {
				return;
			}

			unsaved = false;
			savedAt = host.now();
			await host.mutate(async () => {
				if (stateEpoch !== snapshot.epoch) {
					held = undefined;
					return;
				}

				held = {...snapshot, epoch: await putState(snapshot.state)};
			});
		};

		try {
			for (;;) {
				if (!held || held.epoch !== stateEpoch) {
					held = (
						await stepWithSnapshot(async (state) => ({
							state,
							result: undefined,
						}))
					).snapshot;
					unsaved = false;
				}

				const {state: current, records: library} = held;
				const sent = host.readOnly ? [] : queued(current, library);
				if (
					sent.length === 0 ||
					sent.some((change) => sentKeys.has(recordKey(change)))
				) {
					break;
				}

				for (const change of sent) {
					sentKeys.add(recordKey(change));
				}

				const sealed = codec
					? await Promise.all(sent.map(async (change) => codec.seal(change)))
					: sent;
				const sendable = sealed.filter((change) => !refusedTrash(change));
				const body = await request(target, '/v1/changes', {
					method: 'POST',
					body: JSON.stringify({changes: sendable}),
				});
				const results =
					isRecord(body) && Array.isArray(body.results) ? body.results : [];
				if (
					results.length !== sendable.length ||
					results.some((result) => !PUSH_RESULTS.has(String(result)))
				) {
					throw new SyncError(
						'server',
						'The sync server sent an answer this version does not understand.',
					);
				}

				const pulledCursor = current.cursor;
				const answers = (results as PushResult[]).values();
				const settled = settle(
					current,
					sent,
					sealed.map((change) =>
						refusedTrash(change) ? 'unsendable' : answers.next().value!,
					),
				);
				const known =
					isRecord(body) && Number.isSafeInteger(body.cursor)
						? Math.max(settled.state.known ?? 0, body.cursor as number)
						: settled.state.known;
				held = {...held, state: {...settled.state, known}};
				unsaved = true;
				refused += settled.refused;
				appliedThisRound += results.filter(
					(result) => result === 'applied',
				).length;
				if (host.now() - savedAt >= PUSH_CHECKPOINT_MS) {
					await save();
				}

				if (!isRecord(body) || !Number.isSafeInteger(body.cursor)) {
					continue;
				}

				seenCursor = Math.max(seenCursor, body.cursor as number);
				if ((body.cursor as number) > pulledCursor + appliedThisRound) {
					again = true;
				}
			}
		} catch (error) {
			await save().catch(() => undefined);
			throw error;
		}

		await save();
		const state = held?.epoch === stateEpoch ? held.state : await loadState();
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
					if (host.onSynced && config === target) {
						try {
							await host.onSynced(target, status.server);
						} catch {}
					}

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
			await dropState();
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

		async resendAll(): Promise<void> {
			await ready;
			if (!config) {
				return;
			}

			await host.mutate(async () => {
				const state = await loadState();
				const shadow = Object.fromEntries(
					Object.entries(state.shadow).map(([key, entry]) => [
						key,
						entry.deleted ? entry : {...entry, hash: ''},
					]),
				);
				await putState({...state, shadow});
			});
			await syncNow();
		},

		stop() {
			config = undefined;
			clearTimeout(localTimer);
			localPending = false;
			closeSocket();
		},

		async disconnect(): Promise<SyncStatus> {
			await ready;
			config = undefined;
			closeSocket();
			await running;
			await dropState([SYNC_CONFIG_KEY, SYNC_STATUS_KEY]);
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

		localChanged() {
			if (applying || !config) {
				return;
			}

			clearTimeout(localTimer);
			const now = host.now();
			if (!localPending) {
				localSince = now;
			}

			localPending = true;
			const wait = Math.min(
				LOCAL_CHANGE_DELAY_MS,
				Math.max(0, localSince + LOCAL_CHANGE_MAX_WAIT_MS - now),
			);
			localTimer = setTimeout(() => {
				localPending = false;
				void syncNow();
			}, wait);
		},

		async pause() {
			await ready;
			if (!config) {
				return;
			}

			clearTimeout(localTimer);
			closeSocket();
			void setStatus({live: false});
			const waiting =
				localPending ||
				(!host.readOnly && (await loadState()).outbox.length > 0);
			localPending = false;
			if (waiting) {
				await syncNow();
			}
		},

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
