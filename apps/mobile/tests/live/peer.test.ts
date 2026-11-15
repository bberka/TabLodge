/*
The extension's side of a live check against a real phone. Skipped unless TL_STEP is set. It uses the extension's own
sync client, private codec, and key code, over real HTTP to a server the phone also talks to.
Steps: read, create, edit. Env: TL_URL, TL_TOKEN, TL_PIN (optional), TL_KIND (pin or password, for create), TL_STATE (file the key is saved to), TL_LINK.
*/
import {writeFileSync} from 'node:fs';
import process from 'node:process';
import {describe, test} from 'vite-plus/test';
import {
	createPrivateCodec,
	createSyncKey,
	joinSyncKey,
	parseServerKey,
	serverKeyText,
	type PrivateSyncKey,
} from '../../../extension/src/shared/private-sync';
import {isSealed} from '../../../extension/src/shared/private-lock';
import {
	createSyncClient,
	SYNC_CONFIG_KEY,
} from '../../../extension/src/shared/sync/client';
import {addBookmark, emptyStore} from '../../src/library/library';
import type {Store} from '../../../extension/src/shared/types';

const step = process.env.TL_STEP;
const url = `${process.env.TL_URL}/private`;
const token = process.env.TL_TOKEN ?? '';
const pin = process.env.TL_PIN;
const stateFile = process.env.TL_STATE ?? '/tmp/tl-peer-state.json';
const auth = {Authorization: `Bearer ${token}`};

async function serverKey() {
	const r = await fetch(`${url}/v1/key`, {headers: auth});
	return parseServerKey(((await r.json()) as {key: unknown}).key);
}

async function records() {
	const r = await fetch(`${url}/v1/changes?cursor=0&limit=1000`, {
		headers: auth,
	});
	return (
		(await r.json()) as {
			changes: Array<{
				kind: string;
				id?: string;
				value: unknown;
				deleted?: boolean;
			}>;
		}
	).changes;
}

describe.skipIf(!step)('extension peer', () => {
	test(step ?? 'none', async () => {
		let key: PrivateSyncKey | undefined;
		let store: Store = emptyStore(Date.now());
		const storage = new Map<string, unknown>();
		const server = await serverKey();
		console.log(
			'SERVER KEY',
			server ? `id=${server.id} wrapped.len=${server.wrapped.length}` : 'none',
		);
		if (step === 'create' && pin && !server) {
			key = await createSyncKey({
				kind: (process.env.TL_KIND as 'pin' | 'password') ?? 'pin',
				value: pin,
			});
			const r = await fetch(`${url}/v1/key`, {
				method: 'POST',
				headers: {...auth, 'Content-Type': 'application/json'},
				body: JSON.stringify({key: serverKeyText(key), previous: null}),
			});
			console.log('KEY POST', r.status);
		} else if (server && pin) {
			key = await joinSyncKey(server, pin);
			console.log('JOINED the phone key with the PIN: ok');
		}

		const client = createSyncClient({
			get: async (name) =>
				name === SYNC_CONFIG_KEY
					? {url, token}
					: structuredClone(storage.get(name)),
			async set(name, value) {
				storage.set(name, structuredClone(value));
			},
			async remove(names) {
				for (const name of names) {
					storage.delete(name);
				}
			},
			fetch: async (u, init) => fetch(u, init),
			async mutate(work) {
				return work();
			},
			readLibrary: async () => structuredClone(store),
			async writeLibrary(next) {
				store = structuredClone(next);
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
			randomId: () => crypto.randomUUID(),
			now: Date.now,
		});
		if (step === 'create' || step === 'edit') {
			if (step === 'edit') {
				await client.syncNow();
			}

			store = addBookmark(
				store,
				{
					url: process.env.TL_LINK ?? 'https://ext.example/one',
					title: 'From extension',
					columnId: '',
				},
				crypto.randomUUID(),
				Date.now(),
			);
		}

		await client.syncNow();
		const raw = await records();
		console.log(
			'SERVER RECORDS',
			raw.length,
			'sealed:',
			raw.filter((r) => isSealed(r.value)).length,
			'plain:',
			raw.filter((r) => !isSealed(r.value) && !r.deleted).length,
		);
		console.log(
			'EXTENSION OPENED BOOKMARKS',
			JSON.stringify(store.bookmarks.map((b) => [b.url, b.title])),
		);
		if (key) {
			writeFileSync(stateFile, JSON.stringify(key));
		}
	});
});
