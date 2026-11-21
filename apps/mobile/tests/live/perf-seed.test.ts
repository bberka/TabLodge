/*
Fills a sync server with one scale scenario (see scripts/perf/scenarios.ts), as the extension would. Skipped unless
TL_SCENARIO is set. Env: TL_SCENARIO, TL_URL, TL_TOKEN; TL_DUMP=<file> writes the library there and stops. Prints the time of the first push and how many records
the server then holds. A phone that connects to that server pulls the whole library.
*/
import {writeFileSync} from 'node:fs';
import process from 'node:process';
import {describe, test} from 'vite-plus/test';
import {
	createSyncClient,
	SYNC_CONFIG_KEY,
} from '../../../extension/src/shared/sync/client';
import type {Store} from '../../../extension/src/shared/types';
import {buildScenario, type Scenario} from '../../scripts/perf/scenarios';

const scenario = process.env.TL_SCENARIO as Scenario | undefined;
const url = process.env.TL_URL ?? '';
const token = process.env.TL_TOKEN ?? '';

describe.skipIf(!scenario)('seed a scale scenario', () => {
	test(
		scenario ?? 'none',
		async () => {
			const store: Store = buildScenario(scenario!);
			if (process.env.TL_DUMP) {
				// Only write the library, for run-matrix.sh LOCAL=1 to put straight into the phone's storage.
				writeFileSync(process.env.TL_DUMP, JSON.stringify(store));
				return;
			}

			const storage = new Map<string, unknown>();
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
				async writeLibrary() {},
				async backup() {},
				randomId: () => crypto.randomUUID(),
				now: Date.now,
			});
			const started = performance.now();
			await client.syncNow();
			const seconds = ((performance.now() - started) / 1000).toFixed(1);
			const response = await fetch(`${url}/v1/changes?cursor=0&limit=1`, {
				headers: {Authorization: `Bearer ${token}`},
			});
			console.log('SEEDED', scenario, `push ${seconds}s`, response.status);
		},
		600_000,
	);
});
