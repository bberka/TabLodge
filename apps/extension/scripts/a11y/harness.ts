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

export async function check(name: string, run: () => Promise<void>) {
	if (onlyChecks && !name.includes(onlyChecks)) {
		return;
	}

	try {
		await run();
		console.log(`ok   ${name}`);
	} catch (error) {
		failures.push(name);
		console.log(`FAIL ${name}`);
		console.log(
			`     ${error instanceof Error ? error.message : String(error)}`,
		);
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
