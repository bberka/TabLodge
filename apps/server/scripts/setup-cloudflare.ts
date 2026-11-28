import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import process from 'node:process';
import {createInterface} from 'node:readline/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {applyEdits, modify} from 'jsonc-parser';
import {
	normalizeDomain,
	prepareWranglerDeploy,
	readCustomDomain,
} from '../cloudflare-deploy/deploy.js';

const SECRET = 'TABLODGE_SYNC_TOKEN';

type WranglerRunner = (
	arguments_: string[],
	options?: {input?: string; interactive?: boolean},
) => string;

type SetupOptions = {
	args: string[];
	serverDirectory: string;
	runWrangler?: WranglerRunner;
	promptDomain?: (existingDomain: string) => Promise<string | undefined>;
	log?: (message: string) => void;
	createToken?: () => string;
};

function createWranglerRunner(serverDirectory: string): WranglerRunner {
	return (arguments_, {input, interactive = false} = {}) => {
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
	};
}

export function setCustomDomainInWrangler(
	configPath: string,
	domain: string,
): void {
	const text = readFileSync(configPath, 'utf8');
	const edits = modify(
		text,
		['vars', 'CUSTOM_DOMAIN'],
		normalizeDomain(domain),
		{formattingOptions: {insertSpaces: false, tabSize: 1}},
	);
	writeFileSync(configPath, applyEdits(text, edits));
}

async function promptForDomain(
	existingDomain: string,
): Promise<string | undefined> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return undefined;
	}

	const readline = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		const prompt = existingDomain
			? `Custom domain on Cloudflare (Enter to keep ${existingDomain}, or - to clear): `
			: 'Custom domain on Cloudflare (optional, e.g. sync.example.com; Enter to use workers.dev): ';
		const answer = (await readline.question(prompt)).trim();
		if (answer === '') {
			return undefined;
		}

		return answer === '-' ? '' : answer;
	} finally {
		readline.close();
	}
}

export async function runSetup(options: SetupOptions): Promise<{
	address?: string;
	domain: string;
	token?: string;
}> {
	const {
		args,
		serverDirectory,
		runWrangler = createWranglerRunner(serverDirectory),
		promptDomain = promptForDomain,
		log = (message) => {
			console.log(message);
		},
		createToken = () => randomBytes(32).toString('base64url'),
	} = options;

	const {values} = parseArgs({
		args,
		options: {
			'rotate-token': {type: 'boolean'},
			domain: {type: 'string'},
		},
	});

	const configPath = join(serverDirectory, 'wrangler.jsonc');
	const existingDomain = readCustomDomain(configPath, {});
	const requested =
		values.domain === undefined
			? await promptDomain(existingDomain)
			: values.domain;
	const domain =
		requested === undefined ? existingDomain : normalizeDomain(requested);
	if (!/you are logged in/i.test(runWrangler(['whoami']))) {
		log('Log in to Cloudflare in the browser window that opens.');
		runWrangler(['login'], {interactive: true});
	}

	log(
		domain
			? `Deploying the TabLodge sync Worker to ${domain}...`
			: 'Deploying the TabLodge sync Worker...',
	);
	const prepared = prepareWranglerDeploy({
		directory: serverDirectory,
		domain,
	});
	let deployOutput: string;
	try {
		deployOutput = runWrangler(prepared.args);
	} finally {
		prepared.cleanup();
	}

	if (domain !== existingDomain) {
		setCustomDomainInWrangler(configPath, domain);
	}

	log(deployOutput);
	const workersDevUrl = /https:\/\/\S+\.workers\.dev/.exec(deployOutput)?.[0];
	const address = domain ? `https://${domain}` : workersDevUrl;

	const secrets = JSON.parse(
		runWrangler(['secret', 'list', '--format', 'json']),
	) as Array<{name: string}>;
	let token: string | undefined;
	if (
		values['rotate-token'] ||
		secrets.every((secret) => secret.name !== SECRET)
	) {
		token = createToken();
		runWrangler(['secret', 'put', SECRET], {input: token});
	}

	log('\nThe sync server is deployed.');
	log(
		`Address: ${address ?? '(see the wrangler output above, or your custom domain)'}`,
	);
	if (domain && workersDevUrl) {
		log(
			`Note:    ${workersDevUrl} stays active so devices already using it keep syncing.`,
		);
	}

	log(
		token
			? `Token:   ${token}\nKeep the token somewhere safe. It is not shown again; run with --rotate-token for a new one.`
			: 'Token:   unchanged. Run with --rotate-token to replace it.',
	);

	return {address, domain, token};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const serverDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
	try {
		await runSetup({args: process.argv.slice(2), serverDirectory});
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
