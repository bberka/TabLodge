import assert from 'node:assert/strict';
import type {Buffer} from 'node:buffer';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import process from 'node:process';
import {chromium, type Browser} from 'playwright';
import {fromRoot} from './vite-shared.ts';

const child = spawn(
	process.execPath,
	['scripts/build.ts', '--watch', '--open-browser', '--headless'],
	{
		cwd: fromRoot('.'),
		stdio: ['ignore', 'pipe', 'inherit'],
		signal: AbortSignal.timeout(120_000),
	},
);
const exited = new Promise<number | null>((resolve, reject) => {
	child.once('error', reject);
	child.once('exit', resolve);
});
let browser: Browser | undefined;

try {
	const endpoint = await Promise.race([
		new Promise<string>((resolve) => {
			let output = '';
			child.stdout.on('data', (chunk: Buffer) => {
				process.stdout.write(chunk);
				output += chunk.toString();
				const match = /Dev browser CDP: (http:\/\/127\.0\.0\.1:\d+)/.exec(
					output,
				);
				if (match) {
					resolve(match[1]);
				}
			});
		}),
		exited.then((code) => {
			throw new Error(
				`Dev browser exited before publishing its endpoint (${code}).`,
			);
		}),
	]);
	browser = await chromium.connectOverCDP(endpoint);
	const context = browser.contexts()[0];
	const page = context.pages()[0];
	await page.waitForURL('chrome-extension://*/newtab.html');
	await page.locator('#sessions-title').waitFor();
	assert.match(
		await page.evaluate(() => navigator.userAgent),
		/HeadlessChrome/,
	);
	const worker = context.serviceWorkers()[0];
	assert.ok(worker.url().endsWith('/service-worker.js'));
	await mkdir(fromRoot('.dev/evidence'), {recursive: true});
	await page.screenshot({path: fromRoot('.dev/evidence/headless-dev.png')});
	const session = await browser.newBrowserCDPSession();
	await session.send('Browser.close');
	assert.equal(
		await exited,
		0,
		'Closing the browser should stop the launcher.',
	);
	console.log(
		'Headless dev check passed: extension loaded, CDP connected, screenshot captured, launcher stopped.',
	);
} finally {
	await browser?.close();
	if (child.exitCode === null && child.signalCode === null) {
		child.kill();
	}

	await exited;
}
