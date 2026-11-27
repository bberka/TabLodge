import {spawnSync} from 'node:child_process';
import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {experimental_readRawConfig as readRawConfig} from 'wrangler';

const WORKERS_DEV_KEY = 'workers_dev';
const HOSTNAME =
	/^[0-9a-z](?:[-0-9a-z]{0,61}[0-9a-z])?(?:\.[0-9a-z](?:[-0-9a-z]{0,61}[0-9a-z])?)+$/;

export function readWranglerConfig(configPath) {
	return readRawConfig({config: configPath}).rawConfig;
}

export function normalizeDomain(raw) {
	const trimmed = raw.trim();
	if (trimmed === '') {
		return '';
	}

	const host = trimmed
		.replace(/^https?:\/\//i, '')
		.replace(/\/+$/, '')
		.toLowerCase();
	if (host.length > 253 || !HOSTNAME.test(host)) {
		throw new Error(
			`Invalid custom domain "${raw}". Use a hostname on your Cloudflare account, such as sync.example.com.`,
		);
	}

	return host;
}

export function readCustomDomain(configPath, env = process.env) {
	const config = readWranglerConfig(configPath);
	const raw = env.CUSTOM_DOMAIN?.trim() || config.vars?.CUSTOM_DOMAIN || '';
	return normalizeDomain(raw);
}

export function prepareWranglerDeploy({
	directory,
	domain,
	extraArgs = [],
	env = process.env,
}) {
	const configPath = path.join(directory, 'wrangler.jsonc');
	const host =
		domain === undefined
			? readCustomDomain(configPath, env)
			: normalizeDomain(domain);
	if (!host) {
		return {args: ['deploy', ...extraArgs], cleanup() {}};
	}

	const config = readWranglerConfig(configPath);
	const resolvedConfig = {
		...config,
		main: path.resolve(directory, config.main),
		vars: {...config.vars, CUSTOM_DOMAIN: host},
	};
	resolvedConfig[WORKERS_DEV_KEY] = config[WORKERS_DEV_KEY] ?? true;
	delete resolvedConfig.$schema;
	const tempDirectory = mkdtempSync(path.join(tmpdir(), 'tablodge-wrangler-'));
	const tempConfigPath = path.join(tempDirectory, 'wrangler.json');
	writeFileSync(tempConfigPath, JSON.stringify(resolvedConfig, null, 2));

	return {
		args: [
			'deploy',
			'--config',
			tempConfigPath,
			'--domain',
			host,
			...extraArgs,
		],
		cleanup() {
			rmSync(tempDirectory, {recursive: true, force: true});
		},
	};
}

export function runDeploy(directory, extraArgs) {
	const require = createRequire(path.join(directory, 'package.json'));
	const wrangler = path.join(
		path.dirname(require.resolve('wrangler/package.json')),
		'bin',
		'wrangler.js',
	);
	const prepared = prepareWranglerDeploy({directory, extraArgs});
	try {
		const result = spawnSync(process.execPath, [wrangler, ...prepared.args], {
			cwd: directory,
			stdio: 'inherit',
		});
		return result.status ?? 1;
	} finally {
		prepared.cleanup();
	}
}

export function runFromCommandLine(directory) {
	try {
		process.exitCode = runDeploy(directory, process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === scriptPath) {
	runFromCommandLine(path.dirname(scriptPath));
}
