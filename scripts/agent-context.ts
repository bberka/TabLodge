import {execFileSync} from 'node:child_process';
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

// Keeps the agent instructions from growing unnoticed. Agents read AGENTS.md, the per-folder AGENTS.md files, and
// whichever docs/agents page matches the task; each byte costs every session. The budget file records the current
// size, so a pull request that adds instructions shows the growth in its diff, and CI rejects growth over master's
// budget unless the pull request carries the `agent-context-increase` label (it sets ALLOW_INCREASE=true).
//
//   node scripts/agent-context.ts                 fail unless the budget matches the files
//   node scripts/agent-context.ts --write         rewrite the budget from the files
//   node scripts/agent-context.ts --base <ref>    also fail when a size is above the one at <ref>

const BUDGET = 'scripts/agent-context-budget.json';

export type Sizes = Record<string, number>;

export function measure(): Sizes {
	const bytes = (paths: string[]) =>
		paths.reduce((sum, path) => sum + readFileSync(path).length, 0);
	const appFiles = readdirSync('apps')
		.map((app) => `apps/${app}/AGENTS.md`)
		.filter((path) => existsSync(path));
	const docFiles = readdirSync('docs/agents')
		.filter((name) => name.endsWith('.md'))
		.map((name) => `docs/agents/${name}`);
	return {
		'AGENTS.md': bytes(['AGENTS.md']),
		'apps/*/AGENTS.md': bytes(appFiles),
		'docs/agents': bytes(docFiles),
	};
}

export function grown(current: Sizes, base: Sizes): string[] {
	return Object.entries(current)
		.filter(([key, size]) => base[key] !== undefined && size > base[key])
		.map(
			([key, size]) =>
				`${key}: ${base[key]} -> ${size} bytes (+${size - base[key]})`,
		);
}

// The base has no budget file until the pull request that adds it merges.
function baseBudget(ref: string): Sizes | undefined {
	try {
		return JSON.parse(
			execFileSync('git', ['show', `${ref}:${BUDGET}`], {
				encoding: 'utf8',
				stdio: 'pipe',
			}),
		) as Sizes;
	} catch {
		return undefined;
	}
}

function main(args: string[]): number {
	const current = measure();
	if (args.includes('--write')) {
		writeFileSync(BUDGET, `${JSON.stringify(current, null, '\t')}\n`);
		console.log(`Wrote ${BUDGET}`);
		return 0;
	}

	const budget = JSON.parse(readFileSync(BUDGET, 'utf8')) as Sizes;
	if (JSON.stringify(budget) !== JSON.stringify(current)) {
		console.error(
			`${BUDGET} does not match the files.\nbudget:  ${JSON.stringify(budget)}\nmeasured: ${JSON.stringify(current)}\nRun \`node scripts/agent-context.ts --write\` and commit the result.`,
		);
		return 1;
	}

	const baseRef = args[args.indexOf('--base') + 1];
	if (args.includes('--base') && baseRef !== undefined) {
		const base = baseBudget(baseRef);
		const growth = base === undefined ? [] : grown(budget, base);
		if (growth.length > 0 && process.env.ALLOW_INCREASE !== 'true') {
			console.error(
				`Agent instructions grew compared to master:\n${growth.join('\n')}\nCut the added text, or ask the maintainer for the agent-context-increase label.`,
			);
			return 1;
		}
	}

	console.log(`Agent instructions: ${JSON.stringify(current)}`);
	return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	process.exitCode = main(process.argv.slice(2));
}
