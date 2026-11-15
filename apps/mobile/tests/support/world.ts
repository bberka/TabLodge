/*
A sync server and an "extension side" for tests. The server is the real API (apps/server/src/api.ts) over the real change
log, in two libraries as node.ts serves them: the regular one and `/private`. The extension side is the extension's own
sync client, private codec, and key code (apps/extension/src/shared), wired to memory the way its service worker wires
them to extension storage.
*/
import {vi} from 'vite-plus/test';
import {createApi} from '../../../server/src/api';
import {ChangeLog} from '../../../extension/src/shared/sync/change-log';
import {
	createSyncClient,
	SYNC_CONFIG_KEY,
	type SyncClient,
} from '../../../extension/src/shared/sync/client';
import {
	createPrivateCodec,
	createSyncKey,
	joinSyncKey,
	parseServerKey,
	rewrapSyncKey,
	serverKeyText,
	type PrivateSyncKey,
} from '../../../extension/src/shared/private-sync';
import type {Credential} from '../../../extension/src/shared/passcode';
import type {Store} from '../../../extension/src/shared/types';
import {emptyStore} from '../../src/library/library';

export const URL_BASE = 'https://sync.test';
export const TOKEN = 'phone-private-test-token-0123456789-abcdef';

export function makeServer() {
	const main = createApi({
		token: TOKEN,
		log: (() => {
			const log = new ChangeLog();
			return () => log;
		})(),
	});
	const privateLog = new ChangeLog();
	const priv = createApi({token: TOKEN, log: () => privateLog});
	let online = true;
	return {
		privateLog,
		setOnline(value: boolean) {
			online = value;
		},
		async fetch(url: string, init: RequestInit = {}): Promise<Response> {
			if (!online) {
				throw new TypeError('Failed to fetch');
			}

			const parsed = new URL(url);
			if (parsed.pathname.startsWith('/private/')) {
				parsed.pathname = parsed.pathname.slice('/private'.length);
				return priv.request(parsed.pathname + parsed.search, init);
			}

			return main.request(parsed.pathname + parsed.search, init);
		},
	};
}

export type Server = ReturnType<typeof makeServer>;

/**
Routes the phone's global `fetch` to the server, and gives its live socket nothing to say, so it relies on the
explicit rounds a test asks for.
*/
export function connectGlobals(server: Server) {
	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
		server.fetch(String(input), init),
	);
	vi.stubGlobal(
		'WebSocket',
		class {
			addEventListener() {}
			send() {}
			close() {}
		},
	);
}

export type Extension = {
	store: Store;
	readonly key: PrivateSyncKey | undefined;
	client: SyncClient;
	edit(change: (current: Store) => Store): void;
	sync(): Promise<void>;
	protect(credential: Credential): Promise<void>;
	enterCredential(credential: string): Promise<void>;
	rewrap(credential: Credential): Promise<void>;
};

/**
The extension's private library: its store, its sync key as it keeps it, and the sync client it runs.
*/
export function makeExtension(
	server: Server,
	store: Store = emptyStore(Date.now()),
): Extension {
	const storage = new Map<string, unknown>();
	let key: PrivateSyncKey | undefined;
	let queue: Promise<unknown> = Promise.resolve();
	let counter = 0;
	const device: Extension = {
		store,
		get key() {
			return key;
		},
		client: createSyncClient({
			get: async (name) =>
				name === SYNC_CONFIG_KEY
					? {url: `${URL_BASE}/private`, token: TOKEN}
					: structuredClone(storage.get(name)),
			async set(name, value) {
				storage.set(name, structuredClone(value));
			},
			async remove(names) {
				for (const name of names) {
					storage.delete(name);
				}
			},
			fetch: async (url, init) => server.fetch(url, init),
			mutate<T>(work: () => Promise<T>) {
				const run = queue.then(work);
				queue = run.then(
					() => undefined,
					() => undefined,
				);
				return run;
			},
			readLibrary: async () => structuredClone(device.store),
			async writeLibrary(next) {
				device.store = structuredClone(next);
			},
			async backup() {},
			codec: createPrivateCodec({
				async load() {
					return key;
				},
				async save(next) {
					key = next;
				},
			}),
			randomId() {
				counter += 1;
				return `extension-${counter}`;
			},
			now: Date.now,
		}),
		edit(change: (current: Store) => Store) {
			device.store = change(device.store);
			device.client.localChanged();
		},
		async sync() {
			await device.client.syncNow();
		},
		/**
		What enablePrivateSync does in the service worker for a library with a PIN or password and no key on the server yet.
		*/
		async protect(credential: Credential) {
			key = await createSyncKey(credential);
			const response = await server.fetch(`${URL_BASE}/private/v1/key`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({key: serverKeyText(key), previous: null}),
			});
			if (response.status !== 200) {
				throw new Error(`key refused: ${response.status}`);
			}
		},
		/**
		What enablePrivateSync does when the server already has a key: the PIN or password is entered once.
		*/
		async enterCredential(credential: string) {
			const response = await server.fetch(`${URL_BASE}/private/v1/key`, {
				headers: {Authorization: `Bearer ${TOKEN}`},
			});
			const body = (await response.json()) as {key: unknown};
			const parsed = parseServerKey(body.key);
			if (!parsed) {
				throw new Error('no key on the server');
			}

			key = await joinSyncKey(parsed, credential);
		},
		/**
		RewrapPrivateSyncKey: a new PIN or password for the same key.
		*/
		async rewrap(credential: Credential) {
			const old = key!;
			const next = await rewrapSyncKey(old, credential);
			const response = await server.fetch(`${URL_BASE}/private/v1/key`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					key: serverKeyText(next),
					previous: serverKeyText(old),
				}),
			});
			if (response.status !== 200) {
				throw new Error(`key refused: ${response.status}`);
			}

			key = next;
		},
	};
	return device;
}
