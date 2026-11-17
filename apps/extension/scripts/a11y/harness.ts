import assert from 'node:assert/strict';
import process from 'node:process';
import {type BrowserContext, type Page, type Worker} from 'playwright';

export const PAGES = [
	'newtab',
	'options',
	'help',
	'popup',
	'sidepanel',
	'palette',
	'reader',
] as const;

export const THEMES = ['light', 'dark'] as const;

export const failures: string[] = [];

export const consoleErrors: string[] = [];

export function watchConsole(target: Page | Worker, source: string) {
	target.on('console', (message) => {
		if (message.type() === 'error') {
			consoleErrors.push(`${source}: ${message.text()}`);
		}
	});
}

// A11Y_ONLY=text runs only the checks whose name contains the text, to repeat one check.
const onlyChecks = process.env.A11Y_ONLY;

// A11Y_SHARD=index/total (for example 2/4) runs every total-th check, starting at index, so CI can split the run
// across jobs. Checks run in the same order in every shard, so the split is stable.
const shard = /^(\d+)\/(\d+)$/.exec(process.env.A11Y_SHARD ?? '');
const shardIndex = shard ? Number(shard[1]) - 1 : 0;
const shardTotal = shard ? Number(shard[2]) : 1;
let checkCount = 0;

export async function check(name: string, run: () => Promise<void>) {
	if (onlyChecks && !name.includes(onlyChecks)) {
		return;
	}

	checkCount += 1;
	if ((checkCount - 1) % shardTotal !== shardIndex) {
		return;
	}

	let timer: NodeJS.Timeout | undefined;
	const started = Date.now();
	try {
		// A check that never settles would otherwise hang the whole run until the CI job times out.
		await Promise.race([
			run(),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					reject(new Error('The check did not finish within 3 minutes.'));
				}, 180_000);
			}),
		]);
		console.log(
			`ok   ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
		);
	} catch (error) {
		failures.push(name);
		console.log(`FAIL ${name}`);
		console.log(
			`     ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		clearTimeout(timer);
	}
}

// Polls until the condition holds, for up to 15 seconds. The pages redraw asynchronously after each action.
export async function until(condition: () => Promise<boolean>, what: string) {
	for (let attempt = 0; attempt < 150; attempt += 1) {
		if (await condition()) {
			return;
		}

		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});
	}

	assert.fail(`Timed out waiting for ${what}.`);
}

export type Theme = (typeof THEMES)[number];

export type Env = {
	context: BrowserContext;
	extensionId: string;
	axeSource: string;
	worker: Worker;
};

// Runs each check for the light theme, then each for the dark one.
export async function eachTheme(
	env: Env,
	checks: Array<(env: Env, theme: Theme) => Promise<void>>,
) {
	for (const theme of THEMES) {
		for (const run of checks) {
			await run(env, theme);
		}
	}
}
