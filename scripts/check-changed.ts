import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

const CODE = /\.[cm]?[jt]sx?$/;
const TYPES = /(?:^|\/)(?:tsconfig[^/]*\.json|package\.json)$|^tsconfig\//;

type Plan = {lint: string[]; typecheck: boolean; test: boolean};

export function plan(files: string[]): Plan {
	const code = files.filter((file) => CODE.test(file));
	const lint = [
		...code,
		...files.filter((file) => file.endsWith('package.json')),
	];
	return {
		lint,
		typecheck: code.length > 0 || files.some((file) => TYPES.test(file)),
		test: code.length > 0,
	};
}

function git(...args: string[]): string {
	const {stdout} = spawnSync('git', args, {encoding: 'utf8'});
	return stdout.trim();
}

function changedFiles(base: string): string[] {
	const tracked = git('diff', '--name-only', '--diff-filter=d', base).split(
		'\n',
	);
	const untracked = git('ls-files', '--others', '--exclude-standard').split(
		'\n',
	);
	return [...new Set([...tracked, ...untracked])].filter(
		(file) => file !== '' && existsSync(file),
	);
}

function run(label: string, command: string, args: string[]): boolean {
	console.log(`\n> ${label}`);
	return spawnSync(command, args, {stdio: 'inherit'}).status === 0;
}

function main(): number {
	const base = git('merge-base', 'HEAD', 'origin/master');
	if (base === '') {
		console.error(
			'No merge base with origin/master. Run `git fetch origin master` first.',
		);
		return 1;
	}

	const files = changedFiles(base);
	const {lint, typecheck, test} = plan(files);
	const results: Array<[string, boolean | undefined]> = [
		[
			'lint',
			lint.length > 0
				? run(`xo (${lint.length} files)`, 'pnpm', ['exec', 'xo', ...lint])
				: undefined,
		],
		[
			'typecheck',
			typecheck ? run('tsgo -b', 'pnpm', ['exec', 'tsgo', '-b']) : undefined,
		],
		[
			'test',
			test
				? run(`vp test run --changed ${base.slice(0, 8)}`, 'pnpm', [
						'exec',
						'vp',
						'test',
						'run',
						'--changed',
						base,
					])
				: undefined,
		],
	];

	console.log(
		'\ncheck:changed against origin/master (not the full gate; `vp run check` still runs before a push)',
	);
	for (const [name, ok] of results) {
		console.log(
			`  ${name.padEnd(9)} ${ok === undefined ? 'skipped, nothing relevant changed' : ok ? 'passed' : 'FAILED'}`,
		);
	}

	return results.some(([, ok]) => ok === false) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	process.exitCode = main();
}
