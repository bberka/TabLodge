/*
Copies a library out of a sync server and into another one, through the sync API, so it works the same for the
Docker server and for Cloudflare. Used for backups and for moving between servers. The file is JSON lines: a header,
then one change per line, deletes included, with the stamps the server holds, so importing it anywhere gives the
same library. An encrypted library (private windows with a PIN or password) also carries its wrapped key in the
header, which the import stores; the values stay encrypted throughout.

The Docker image runs it as `node node.js export` and `node node.js import` against its own server, and
apps/server/scripts/transfer.ts runs it from a copy of the repository against any server, Cloudflare included. It
imports nothing from the rest of the repository, so Node can run that script directly.
*/
import {createInterface} from 'node:readline';
import process from 'node:process';
import {parseArgs} from 'node:util';

export const EXPORT_FORMAT = 'tablodge-sync-export';
const EXPORT_VERSION = 1;
const PULL_LIMIT = 1000;
const PUSH_LIMIT = 500;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type TransferTarget = {url: string; token: string; fetch?: Fetch};

type Counts = {
	applied: number;
	superseded: number;
	stale: number;
	clock: number;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

async function call(
	target: TransferTarget,
	path: string,
	init: RequestInit = {},
): Promise<unknown> {
	const send = target.fetch ?? fetch;
	for (;;) {
		const response = await send(`${target.url.replace(/\/+$/, '')}${path}`, {
			...init,
			headers: [
				['Authorization', `Bearer ${target.token}`],
				['Content-Type', 'application/json'],
			],
		});
		if (response.status === 429) {
			const seconds = Number(response.headers.get('Retry-After') ?? 5);

			await new Promise((resolve) => {
				setTimeout(resolve, Math.max(1, seconds) * 1000);
			});
			continue;
		}

		if (!response.ok) {
			throw new Error(
				`The server answered ${response.status}: ${await response.text()}`,
			);
		}

		return response.json() as Promise<unknown>;
	}
}

async function storedKey(target: TransferTarget): Promise<string | null> {
	const answer = await call(target, '/v1/key');
	return isObject(answer) && typeof answer.key === 'string' ? answer.key : null;
}

/**
Stores an export's wrapped key, unless the server already holds the same one. A different key would leave the
imported values unreadable, so it stops the import.
*/
async function storeKey(target: TransferTarget, key: string) {
	const current = await storedKey(target);
	if (current === key) {
		return;
	}

	if (current !== null) {
		throw new Error(
			'This server already holds a different encryption key for this library. Import into an empty one.',
		);
	}

	await call(target, '/v1/key', {
		method: 'POST',
		body: JSON.stringify({key, previous: null}),
	});
}

/**
Writes the whole library, one line at a time, and returns how many changes it wrote.
*/
export async function exportLibrary(
	target: TransferTarget,
	write: (line: string) => void,
): Promise<number> {
	const key = await storedKey(target);
	write(
		JSON.stringify({
			format: EXPORT_FORMAT,
			version: EXPORT_VERSION,
			exportedAt: new Date().toISOString(),
			...(key !== null && {key}),
		}),
	);
	let cursor = 0;
	let count = 0;
	for (;;) {
		const page = await call(
			target,
			`/v1/changes?cursor=${cursor}&limit=${PULL_LIMIT}`,
		);
		if (
			!isObject(page) ||
			!Array.isArray(page.changes) ||
			typeof page.cursor !== 'number'
		) {
			throw new Error(
				'The server sent an answer this version does not understand.',
			);
		}

		for (const change of page.changes) {
			write(JSON.stringify(change));
			count += 1;
		}

		cursor = page.cursor;
		if (page.more !== true) {
			return count;
		}
	}
}

/**
Pushes every change of an export. The server keeps the newer version of any record it already has.
*/
export async function importLibrary(
	target: TransferTarget,
	lines: AsyncIterable<string>,
): Promise<Counts> {
	const counts: Counts = {applied: 0, superseded: 0, stale: 0, clock: 0};
	let header = true;
	let batch: unknown[] = [];
	const flush = async () => {
		if (batch.length === 0) {
			return;
		}

		const answer = await call(target, '/v1/changes', {
			method: 'POST',
			body: JSON.stringify({changes: batch}),
		});
		const results =
			isObject(answer) && Array.isArray(answer.results) ? answer.results : [];
		for (const result of results) {
			if (typeof result === 'string' && Object.hasOwn(counts, result)) {
				counts[result as keyof Counts] += 1;
			}
		}

		batch = [];
	};

	for await (const line of lines) {
		if (line.trim() === '') {
			continue;
		}

		const value = JSON.parse(line) as unknown;
		if (header) {
			header = false;
			if (
				!isObject(value) ||
				value.format !== EXPORT_FORMAT ||
				value.version !== EXPORT_VERSION
			) {
				throw new Error('This is not a TabLodge sync export.');
			}

			if (typeof value.key === 'string') {
				await storeKey(target, value.key);
			}

			continue;
		}

		batch.push(value);
		if (batch.length >= PUSH_LIMIT) {
			await flush();
		}
	}

	if (header) {
		throw new Error('The export is empty.');
	}

	await flush();
	return counts;
}

/**
`export` or `import` from the command line; the server address defaults to this machine's server.
*/
export async function runTransfer(argv: string[]): Promise<void> {
	const {positionals, values} = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {url: {type: 'string'}, token: {type: 'string'}},
	});
	const target = {
		url: values.url ?? `http://127.0.0.1:${process.env.PORT ?? '8787'}`,
		token: values.token ?? process.env.TABLODGE_SYNC_TOKEN ?? '',
	};
	if (target.token === '') {
		throw new Error('Set TABLODGE_SYNC_TOKEN or pass --token.');
	}

	if (positionals[0] === 'export') {
		const count = await exportLibrary(target, (line) => {
			process.stdout.write(`${line}\n`);
		});
		process.stderr.write(`Exported ${count} changes.\n`);
	} else if (positionals[0] === 'import') {
		const counts = await importLibrary(
			target,
			createInterface({input: process.stdin, crlfDelay: Infinity}),
		);
		process.stderr.write(
			`Imported: ${counts.applied} applied, ${counts.superseded} already newer on the server, ${counts.stale + counts.clock} refused.\n`,
		);
	} else {
		throw new Error(
			'Usage: export | import [--url <server address>] [--token <token>]',
		);
	}
}
