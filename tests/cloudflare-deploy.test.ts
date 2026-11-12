import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {test} from 'vite-plus/test';

// Comments and trailing commas out, so JSONC parses as JSON.
const readJsonc = (path: string) =>
	JSON.parse(
		readFileSync(path, 'utf8')
			.replaceAll(/^\s*\/\/.*$/gm, '')
			.replaceAll(/,(?=\s*[\]}])/g, ''),
	) as Record<string, unknown>;

test('the Deploy to Cloudflare Worker is built from the current server source', () => {
	const result = spawnSync(
		'node',
		['server/scripts/cloudflare-deploy.ts', '--check'],
		{encoding: 'utf8'},
	);
	assert.equal(result.status, 0, result.stderr);
}, 60_000);

test('the Deploy to Cloudflare config keeps the same Durable Object and limits as cf:setup', () => {
	const button = readJsonc('server/cloudflare-deploy/wrangler.jsonc');
	const setup = readJsonc('server/wrangler.jsonc');
	for (const key of [
		'name',
		'compatibility_date',
		'durable_objects',
		'migrations',
		'vars',
	]) {
		assert.deepEqual(button[key], setup[key], key);
	}
});
