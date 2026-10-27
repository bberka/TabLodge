// Launches installed Chrome when available, with Playwright Chromium as a portable fallback.
import process from 'node:process';
import {chromium, type BrowserContext} from 'playwright';
import {OUT_DIR, fromRoot} from './vite-shared.ts';

const userDataDir = fromRoot('.dev/chrome-profile');
const launchOptions = {
	headless: false,
	args: [
		`--disable-extensions-except=${OUT_DIR}`,
		`--load-extension=${OUT_DIR}`,
	],
};

async function launchBrowser(): Promise<BrowserContext> {
	if (process.env.CHROME_BIN) {
		return chromium.launchPersistentContext(userDataDir, {
			...launchOptions,
			executablePath: process.env.CHROME_BIN,
		});
	}

	try {
		return await chromium.launchPersistentContext(userDataDir, {
			...launchOptions,
			channel: 'chrome',
		});
	} catch {
		const context = await chromium.launchPersistentContext(
			userDataDir,
			launchOptions,
		);
		console.log(
			'Google Chrome was not found. Using Playwright Chromium instead.',
		);
		return context;
	}
}

export async function openDevBrowser(): Promise<void> {
	let context: BrowserContext | undefined;

	try {
		context = await launchBrowser();
		const serviceWorker =
			context
				.serviceWorkers()
				.find((worker) => worker.url().endsWith('/service-worker.js')) ??
			(await context.waitForEvent('serviceworker', {timeout: 15_000}));
		const extensionId = new URL(serviceWorker.url()).hostname;
		const page = context.pages()[0] ?? (await context.newPage());
		await page.goto(`chrome-extension://${extensionId}/newtab.html`);

		console.log(
			'Opened the browser with TabLodge loaded in the isolated .dev/chrome-profile. Reload the extension after each rebuild.',
		);
	} catch (error) {
		await context?.close().catch(() => {});
		console.warn(
			'Could not launch a browser. Run `pnpm exec vp run browser:install` or set CHROME_BIN to your browser executable, then run `pnpm exec vp run dev` again. The build watcher is still running.',
		);
		console.warn(error instanceof Error ? error.message : String(error));
	}
}
