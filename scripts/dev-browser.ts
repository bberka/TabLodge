// Launches installed Chrome when available, with Playwright Chromium as a portable fallback.
import process from 'node:process';
import {chromium, type BrowserContext, type Page} from 'playwright';
import {
	createDevFixture,
	devFixtureUrls,
	type DevStore,
} from './dev-fixture.ts';
import {loadDevFavicons} from './dev-favicon-cache.ts';
import {OUT_DIR, fromRoot} from './vite-shared.ts';

const userDataDir = fromRoot('.dev/chrome-profile');
const launchOptions = {
	headless: false,
	viewport: null,
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

type ExtensionPageApi = {
	runtime: {
		sendMessage(message: {
			type: 'GET_STATE';
		}): Promise<({ok: true} & DevStore) | {ok: false; error: string}>;
	};
	storage: {local: {set(items: Record<string, DevStore>): Promise<void>}};
};

async function seedDevStore(page: Page): Promise<void> {
	const response = await page.evaluate(async () => {
		const extension = (
			globalThis as typeof globalThis & {chrome: ExtensionPageApi}
		).chrome;
		return extension.runtime.sendMessage({type: 'GET_STATE'});
	});
	if (!response.ok) {
		throw new Error(`Could not read the default store: ${response.error}`);
	}

	const {ok: _ok, ...baseStore} = response;
	await page.evaluate(async (store) => {
		const extension = (
			globalThis as typeof globalThis & {chrome: ExtensionPageApi}
		).chrome;
		await extension.storage.local.set({'tablodge.state': store});
	}, createDevFixture(baseStore));
	await page.reload();
	const seeded = await page.evaluate(async () => {
		const extension = (
			globalThis as typeof globalThis & {chrome: ExtensionPageApi}
		).chrome;
		return extension.runtime.sendMessage({type: 'GET_STATE'});
	});
	if (
		!seeded.ok ||
		seeded.groups.length !== 6 ||
		seeded.bookmarks.length !== 16
	) {
		throw new Error('The development data fixture did not load as expected.');
	}

	await page
		.locator('img[data-favicon][src^="data:image/"]')
		.first()
		.waitFor({timeout: 5000});
}

export async function openDevBrowser(
	options: {seedData?: boolean} = {},
): Promise<void> {
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
		if (options.seedData) {
			const favicons = await loadDevFavicons(page, devFixtureUrls);
			await context.addInitScript({
				content: `globalThis.__TABLODGE_DEV_FAVICONS__ = ${JSON.stringify(favicons)};`,
			});
		}

		await page.goto(`chrome-extension://${extensionId}/newtab.html`);
		if (options.seedData) {
			await seedDevStore(page);
			console.log('Loaded the deterministic development data fixture.');
		}

		console.log(
			'Opened the browser with TabLodge loaded in the isolated .dev/chrome-profile. Reload the extension after each rebuild.',
		);
	} catch (error) {
		await context?.close().catch(() => {});
		console.warn(
			'Could not launch a browser. Run `vp run browser:install` or set CHROME_BIN to your browser executable, then run `vp run dev` again. The build watcher is still running.',
		);
		console.warn(error instanceof Error ? error.message : String(error));
	}
}
