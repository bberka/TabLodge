/*
Deploys the sync server to the Cloudflare account wrangler is logged in to, sets its token, and prints the address
and token to enter in TabLodge. Run it again to deploy an update; the token stays the same unless `--rotate-token`
is given. See docs/self-hosting.md.

	pnpm --filter tablodge-sync-server cf:setup [--rotate-token]
*/
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const SECRET = 'TABLODGE_SYNC_TOKEN';
const serverDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const {values} = parseArgs({options: {'rotate-token': {type: 'boolean'}}});

/**
Runs wrangler and returns its output. `interactive` lets it talk to the terminal, as login needs.
*/
function wrangler(
	arguments_: string[],
	{input, interactive = false}: {input?: string; interactive?: boolean} = {},
) {
	const result = spawnSync('pnpm', ['exec', 'wrangler', ...arguments_], {
		cwd: serverDirectory,
		encoding: 'utf8',
		input,
		stdio: interactive
			? 'inherit'
			: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'],
	});
	if (result.status !== 0) {
		throw new Error(`wrangler ${arguments_.join(' ')} failed`);
	}

	return result.stdout ?? '';
}

if (!/you are logged in/i.test(wrangler(['whoami']))) {
	console.log('Log in to Cloudflare in the browser window that opens.');
	wrangler(['login'], {interactive: true});
}

console.log('Deploying the TabLodge sync Worker...');
const deployOutput = wrangler(['deploy']);
console.log(deployOutput);
const url = /https:\/\/\S+\.workers\.dev/.exec(deployOutput)?.[0];

const secrets = JSON.parse(
	wrangler(['secret', 'list', '--format', 'json']),
) as Array<{name: string}>;
let token: string | undefined;
if (
	values['rotate-token'] ||
	secrets.every((secret) => secret.name !== SECRET)
) {
	token = randomBytes(32).toString('base64url');
	wrangler(['secret', 'put', SECRET], {input: token});
}

console.log('\nThe sync server is deployed.');
console.log(
	`Address: ${url ?? '(see the wrangler output above, or your custom domain)'}`,
);
console.log(
	token
		? `Token:   ${token}\nKeep the token somewhere safe. It is not shown again; run with --rotate-token for a new one.`
		: 'Token:   unchanged. Run with --rotate-token to replace it.',
);
