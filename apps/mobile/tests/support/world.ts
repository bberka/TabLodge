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
import {emptyStore} from '../../src/library/store-shape';

export const URL_BASE = 'https://sync.test';
export const TOKEN = 'phone-private-test-token-0123456789-abcdef';

export function makeServer() {
	let serverNow = Date.now;
	const main = createApi({
		token: TOKEN,
		now: () => serverNow(),
		log: (() => {
			const log = new ChangeLog();
			return () => log;
		})(),
	});
	const privateLog = new ChangeLog();
	const priv = createApi({
		token: TOKEN,
		log: () => privateLog,
		now: () => serverNow(),
	});
	let online = true;
	return {
		privateLog,
		setOnline(value: boolean) {
			online = value;
		},
		setNow(now: number) {
			serverNow = () => now;
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
