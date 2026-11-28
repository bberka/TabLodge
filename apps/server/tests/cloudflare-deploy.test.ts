import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {test} from 'vite-plus/test';
import {PROTOCOL_VERSION} from '../../extension/src/shared/sync/change-log';
import {
	normalizeDomain,
	prepareWranglerDeploy,
	readCustomDomain,
	readWranglerConfig,
} from '../cloudflare-deploy/deploy.js';
import {runSetup, setCustomDomainInWrangler} from '../scripts/setup-cloudflare';

const serverDirectory = join(import.meta.dirname, '..');
const deployDirectory = join(serverDirectory, 'cloudflare-deploy');
const realWrangler = createRequire(import.meta.url).resolve('wrangler');

function withTempDeployCopy(
	work: (context: {
		directory: string;
		logPath: string;
		capturedConfigPath: string;
		env: NodeJS.ProcessEnv;
	}) => void,
) {
	const directory = mkdtempSync(join(tmpdir(), 'tablodge-deploy-test-'));
	const wranglerDirectory = join(directory, 'node_modules', 'wrangler');
	const logPath = join(directory, 'wrangler-args.json');
	const capturedConfigPath = join(directory, 'captured-config.json');
	try {
		copyFileSync(
			join(deployDirectory, 'deploy.js'),
			join(directory, 'deploy.js'),
		);
		copyFileSync(
			join(deployDirectory, 'wrangler.jsonc'),
			join(directory, 'wrangler.jsonc'),
		);
		writeFileSync(join(directory, 'worker.js'), 'export default {};\n');

		mkdirSync(join(wranglerDirectory, 'bin'), {recursive: true});
		writeFileSync(join(wranglerDirectory, 'package.json'), '{}');
		writeFileSync(
			join(wranglerDirectory, 'index.js'),
			`module.exports = require(${JSON.stringify(realWrangler)});\n`,
		);
		writeFileSync(
			join(wranglerDirectory, 'bin', 'wrangler.js'),
			`const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify(args));
const configIndex = args.indexOf('--config');
if (configIndex !== -1) {
	fs.copyFileSync(args[configIndex + 1], ${JSON.stringify(capturedConfigPath)});
}
`,
		);

		const env: NodeJS.ProcessEnv = {...process.env};
		delete env.CUSTOM_DOMAIN;
		work({directory, logPath, capturedConfigPath, env});
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
}

test('the Deploy to Cloudflare Worker is built from the current server source', () => {
	const result = spawnSync(
		'node',
		[join(serverDirectory, 'scripts', 'cloudflare-deploy.ts'), '--check'],
		{encoding: 'utf8'},
	);
	assert.equal(result.status, 0, result.stderr);
}, 60_000);

test('the Deploy to Cloudflare Worker states its sync protocol where the update workflow reads it', () => {
	const worker = readFileSync(join(deployDirectory, 'worker.js'), 'utf8');
	assert.match(
		worker,
		new RegExp(`^var PROTOCOL_VERSION = ${PROTOCOL_VERSION};$`, 'm'),
	);
});

test('the Deploy to Cloudflare config keeps the same Durable Object and limits as cf:setup', () => {
	const button = readWranglerConfig(join(deployDirectory, 'wrangler.jsonc'));
	const setup = readWranglerConfig(join(serverDirectory, 'wrangler.jsonc'));
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

test('the Deploy to Cloudflare package and config keep CUSTOM_DOMAIN inside vars only', () => {
	const config = readWranglerConfig(join(deployDirectory, 'wrangler.jsonc'));
	assert.equal(config.vars?.CUSTOM_DOMAIN, '');
	assert.equal('routes' in config, false);
	assert.equal('workers_dev' in config, false);

	const packageJson = JSON.parse(
		readFileSync(join(deployDirectory, 'package.json'), 'utf8'),
	) as {
		scripts: Record<string, string>;
	};
	assert.equal(packageJson.scripts.deploy, 'node deploy.js');
});

test('normalizeDomain accepts hostnames and URLs and rejects invalid values', () => {
	assert.equal(normalizeDomain(''), '');
	assert.equal(normalizeDomain(' '.repeat(3)), '');
	assert.equal(normalizeDomain('sync.example.com'), 'sync.example.com');
	assert.equal(
		normalizeDomain('  HTTPS://Sync.Example.COM/  '),
		'sync.example.com',
	);
	for (const bad of [
		'localhost',
		'sync.example.com/path',
		'sync.example.com:8787',
		'*.example.com',
		'bad domain.com',
		'-bad.example.com',
	]) {
		assert.throws(() => normalizeDomain(bad), /invalid custom domain/i, bad);
	}
});

test('deploy.js runs plain wrangler deploy when CUSTOM_DOMAIN is empty', () => {
	withTempDeployCopy(({directory, logPath, capturedConfigPath, env}) => {
		const result = spawnSync('node', ['deploy.js', '--dry-run'], {
			cwd: directory,
			env,
			encoding: 'utf8',
		});
		assert.equal(result.status, 0, result.stderr);
		const args = JSON.parse(readFileSync(logPath, 'utf8')) as string[];
		assert.deepEqual(args, ['deploy', '--dry-run']);
		assert.equal(existsSync(capturedConfigPath), false);
	});
}, 60_000);

test('deploy.js passes --domain and keeps workers_dev enabled when CUSTOM_DOMAIN is set', () => {
	withTempDeployCopy(({directory, logPath, capturedConfigPath, env}) => {
		setCustomDomainInWrangler(
			join(directory, 'wrangler.jsonc'),
			'sync.example.com',
		);
		const result = spawnSync('node', ['deploy.js'], {
			cwd: directory,
			env,
			encoding: 'utf8',
		});
		assert.equal(result.status, 0, result.stderr);
		const args = JSON.parse(readFileSync(logPath, 'utf8')) as string[];
		assert.equal(args[0], 'deploy');
		assert.equal(args[1], '--config');
		const tempConfigPath = args[2];
		assert.ok(tempConfigPath);
		assert.equal(existsSync(tempConfigPath), false);
		assert.deepEqual(args.slice(3), ['--domain', 'sync.example.com']);

		const captured = JSON.parse(
			readFileSync(capturedConfigPath, 'utf8'),
		) as Record<string, unknown>;
		assert.equal(captured.workers_dev, true);
		assert.equal(captured.main, join(directory, 'worker.js'));
		assert.equal(
			(captured.vars as Record<string, string>).CUSTOM_DOMAIN,
			'sync.example.com',
		);
	});
}, 60_000);

test('deploy.js reads CUSTOM_DOMAIN from process.env and rejects invalid domains', () => {
	withTempDeployCopy(({directory, logPath, env}) => {
		const ok = spawnSync('node', ['deploy.js'], {
			cwd: directory,
			env: {...env, CUSTOM_DOMAIN: 'https://Sync.Example.org/'},
			encoding: 'utf8',
		});
		assert.equal(ok.status, 0, ok.stderr);
		const args = JSON.parse(readFileSync(logPath, 'utf8')) as string[];
		assert.deepEqual(args.slice(3), ['--domain', 'sync.example.org']);

		rmSync(logPath, {force: true});
		const bad = spawnSync('node', ['deploy.js'], {
			cwd: directory,
			env: {...env, CUSTOM_DOMAIN: 'not a domain'},
			encoding: 'utf8',
		});
		assert.notEqual(bad.status, 0);
		assert.match(bad.stderr, /Invalid custom domain/);
		assert.equal(existsSync(logPath), false);
	});
}, 60_000);

test('setCustomDomainInWrangler updates and clears CUSTOM_DOMAIN while keeping comments', () => {
	const directory = mkdtempSync(join(tmpdir(), 'tablodge-wrangler-edit-'));
	try {
		const configPath = join(directory, 'wrangler.jsonc');
		copyFileSync(join(serverDirectory, 'wrangler.jsonc'), configPath);

		setCustomDomainInWrangler(configPath, 'https://Sync.Example.com/');
		const updated = readFileSync(configPath, 'utf8');
		assert.match(updated, /^\/\/ Cloudflare deployment/m);
		assert.equal(readCustomDomain(configPath, {}), 'sync.example.com');

		setCustomDomainInWrangler(configPath, '');
		assert.equal(readCustomDomain(configPath, {}), '');
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

test('deploy.js reads a config with trailing and block comments', () => {
	withTempDeployCopy(({directory, logPath, capturedConfigPath, env}) => {
		writeFileSync(
			join(directory, 'wrangler.jsonc'),
			`/* Worker config */
{
	"name": "tablodge-sync", // Worker name
	"main": "worker.js", /* entry */
	"vars": {
		"NOTE": "https://x.example/*a*/,}", // keeps comment markers
		"CUSTOM_DOMAIN": "", /* none */
	},
}
`,
		);
		const run = (domain: string) =>
			spawnSync('node', ['deploy.js'], {
				cwd: directory,
				env: {...env, CUSTOM_DOMAIN: domain},
				encoding: 'utf8',
			});

		const plain = run('');
		assert.equal(plain.status, 0, plain.stderr);
		assert.deepEqual(JSON.parse(readFileSync(logPath, 'utf8')), ['deploy']);

		const custom = run('sync.example.com');
		assert.equal(custom.status, 0, custom.stderr);
		const captured = JSON.parse(readFileSync(capturedConfigPath, 'utf8')) as {
			vars: Record<string, string>;
		};
		assert.equal(captured.vars.NOTE, 'https://x.example/*a*/,}');
	});
}, 60_000);

test('setCustomDomainInWrangler edits vars.CUSTOM_DOMAIN, not a comment that names it', () => {
	const directory = mkdtempSync(join(tmpdir(), 'tablodge-wrangler-comment-'));
	try {
		const configPath = join(directory, 'wrangler.jsonc');
		const comments = [
			'// "CUSTOM_DOMAIN": ""',
			'/* "CUSTOM_DOMAIN": "block.example.com" */',
		];
		for (const active of ['"CUSTOM_DOMAIN": "old.example.com",', '']) {
			writeFileSync(
				configPath,
				`{
	"vars": {
		${comments.join('\n\t\t')}
		${active}
		"MAX_RECORDS": "1", // limit
	},
}
`,
			);

			setCustomDomainInWrangler(configPath, 'new.example.com');

			assert.equal(readCustomDomain(configPath, {}), 'new.example.com');
			const text = readFileSync(configPath, 'utf8');
			for (const comment of [...comments, '// limit']) {
				assert.ok(text.includes(comment), comment);
			}
		}
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

test('prepareWranglerDeploy honors explicit workers_dev: false and cleans up temp config', () => {
	const directory = mkdtempSync(join(tmpdir(), 'tablodge-prepare-'));
	try {
		const configPath = join(directory, 'wrangler.jsonc');
		const config = readWranglerConfig(join(serverDirectory, 'wrangler.jsonc'));
		writeFileSync(
			configPath,
			JSON.stringify({...config, workers_dev: false}, null, 2),
		);

		const prepared = prepareWranglerDeploy({
			directory,
			domain: 'sync.example.com',
		});
		const tempConfigPath = prepared.args[2];
		assert.ok(tempConfigPath);
		const written = JSON.parse(readFileSync(tempConfigPath, 'utf8')) as Record<
			string,
			unknown
		>;
		assert.equal(written.workers_dev, false);
		prepared.cleanup();
		assert.equal(existsSync(tempConfigPath), false);
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

test('runSetup persists --domain, deploys to it, and prints the custom domain address', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'tablodge-setup-'));
	try {
		const configPath = join(directory, 'wrangler.jsonc');
		copyFileSync(join(serverDirectory, 'wrangler.jsonc'), configPath);

		const calls: string[][] = [];
		const logs: string[] = [];
		const result = await runSetup({
			args: ['--domain', 'sync.example.com'],
			serverDirectory: directory,
			log(line) {
				logs.push(line);
			},
			createToken: () => 'test-token-value-123456789012345678901234',
			runWrangler(arguments_) {
				calls.push(arguments_);
				if (arguments_[0] === 'whoami') {
					return 'You are logged in';
				}

				if (arguments_[0] === 'deploy') {
					const configIndex = arguments_.indexOf('--config');
					assert.notEqual(configIndex, -1);
					const tempConfig = JSON.parse(
						readFileSync(arguments_[configIndex + 1], 'utf8'),
					) as Record<string, unknown>;
					assert.equal(tempConfig.workers_dev, true);
					return 'Deployed to https://tablodge-sync.me.workers.dev';
				}

				return arguments_[0] === 'secret' && arguments_[1] === 'list'
					? '[]'
					: '';
			},
		});

		assert.equal(result.domain, 'sync.example.com');
		assert.equal(result.address, 'https://sync.example.com');
		assert.equal(readCustomDomain(configPath, {}), 'sync.example.com');
		assert.ok(
			calls.some(
				(call) =>
					call[0] === 'deploy' &&
					call.includes('--domain') &&
					call.includes('sync.example.com'),
			),
		);
		assert.ok(logs.includes('Address: https://sync.example.com'));
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

test('runSetup without a domain leaves behavior unchanged and supports interactive prompt', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'tablodge-setup-prompt-'));
	try {
		const configPath = join(directory, 'wrangler.jsonc');
		copyFileSync(join(serverDirectory, 'wrangler.jsonc'), configPath);

		const calls: string[][] = [];
		const unchanged = await runSetup({
			args: [],
			serverDirectory: directory,
			log() {},
			promptDomain: async () => undefined,
			runWrangler(arguments_) {
				calls.push(arguments_);
				if (arguments_[0] === 'whoami') {
					return 'You are logged in';
				}

				return arguments_[0] === 'deploy'
					? 'https://tablodge-sync.me.workers.dev'
					: '[{"name":"TABLODGE_SYNC_TOKEN"}]';
			},
		});
		assert.equal(unchanged.domain, '');
		assert.equal(unchanged.address, 'https://tablodge-sync.me.workers.dev');
		assert.deepEqual(
			calls.find((call) => call[0] === 'deploy'),
			['deploy'],
		);

		const prompted = await runSetup({
			args: [],
			serverDirectory: directory,
			log() {},
			promptDomain: async () => 'sync.prompted.example',
			runWrangler(arguments_) {
				return arguments_[0] === 'whoami'
					? 'You are logged in'
					: '[{"name":"TABLODGE_SYNC_TOKEN"}]';
			},
		});
		assert.equal(prompted.domain, 'sync.prompted.example');
		assert.equal(prompted.address, 'https://sync.prompted.example');
		assert.equal(readCustomDomain(configPath, {}), 'sync.prompted.example');

		const cleared = await runSetup({
			args: [],
			serverDirectory: directory,
			log() {},
			async promptDomain(existing) {
				assert.equal(existing, 'sync.prompted.example');
				return '';
			},
			runWrangler(arguments_) {
				if (arguments_[0] === 'whoami') {
					return 'You are logged in';
				}

				return arguments_[0] === 'deploy'
					? 'https://tablodge-sync.me.workers.dev'
					: '[{"name":"TABLODGE_SYNC_TOKEN"}]';
			},
		});
		assert.equal(cleared.domain, '');
		assert.equal(readCustomDomain(configPath, {}), '');
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});

test('deploy.js succeeds with real wrangler --dry-run when CUSTOM_DOMAIN is set', () => {
	const result = spawnSync('node', ['deploy.js', '--dry-run'], {
		cwd: deployDirectory,
		env: {...process.env, CUSTOM_DOMAIN: 'sync.example.com'},
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /--dry-run: exiting now/);
}, 60_000);

test('cf:deploy passes the custom domain to wrangler', () => {
	const result = spawnSync(
		'node',
		['scripts/deploy-cloudflare.ts', '--dry-run'],
		{
			cwd: serverDirectory,
			env: {...process.env, CUSTOM_DOMAIN: 'sync.example.com'},
			encoding: 'utf8',
		},
	);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /CUSTOM_DOMAIN.*sync\.example\.com/);
}, 60_000);

test('runSetup keeps the saved domain when the deploy fails', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'tablodge-setup-fail-'));
	try {
		const configPath = join(directory, 'wrangler.jsonc');
		copyFileSync(join(serverDirectory, 'wrangler.jsonc'), configPath);

		await assert.rejects(
			runSetup({
				args: ['--domain', 'sync.example.com'],
				serverDirectory: directory,
				log() {},
				runWrangler(arguments_) {
					if (arguments_[0] === 'deploy') {
						throw new Error('zone not found');
					}

					return 'You are logged in';
				},
			}),
			/zone not found/,
		);
		assert.equal(readCustomDomain(configPath, {}), '');
	} finally {
		rmSync(directory, {recursive: true, force: true});
	}
});
