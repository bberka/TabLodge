/*
Builds apps/server/cloudflare-deploy/worker.js, the bundled Worker that the Deploy to Cloudflare button deploys. The button
copies only that folder, so the Worker is shipped prebuilt instead of from apps/server/src. With `--check`, fails if the
committed file is out of date instead of writing it.

	node apps/server/scripts/cloudflare-deploy.ts [--check]
*/
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const serverDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(serverDirectory, 'cloudflare-deploy', 'worker.js');
const header =
	'// Generated from apps/server/src by apps/server/scripts/cloudflare-deploy.ts. Do not edit; see README.md to update.\n';
const {values} = parseArgs({options: {check: {type: 'boolean'}}});

function buildWorker() {
	const out = mkdtempSync(join(tmpdir(), 'tablodge-cloudflare-'));
	try {
		const result = spawnSync(
			'pnpm',
			['exec', 'wrangler', 'deploy', '--dry-run', '--outdir', out],
			{cwd: serverDirectory, encoding: 'utf8'},
		);
		if (result.status !== 0) {
			throw new Error(
				`wrangler could not bundle the Worker:\n${result.stderr}`,
			);
		}

		const bundle = readFileSync(join(out, 'worker.js'), 'utf8');
		return header + bundle.replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n');
	} finally {
		rmSync(out, {recursive: true, force: true});
	}
}

const built = buildWorker();
if (values.check) {
	let committed = '';
	try {
		committed = readFileSync(target, 'utf8');
	} catch {}

	if (committed !== built) {
		throw new Error(
			'apps/server/cloudflare-deploy/worker.js is out of date. Run `pnpm run cf:bundle` and commit it.',
		);
	}
} else {
	writeFileSync(target, built);
	console.log(`Wrote ${target}`);
}
