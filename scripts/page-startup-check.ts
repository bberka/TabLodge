import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {chromium} from 'playwright';

const extension = join(process.cwd(), 'dist/tablodge');
const profile = await mkdtemp(join(tmpdir(), 'tablodge-startup-check-'));
let context:
	Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;

try {
	context = await chromium.launchPersistentContext(profile, {
		headless: false,
		args: [
			`--disable-extensions-except=${extension}`,
			`--load-extension=${extension}`,
		],
	});
	const worker =
		context.serviceWorkers()[0] ??
		(await context.waitForEvent('serviceworker', {timeout: 15_000}));
	const extensionId = new URL(worker.url()).hostname;
	await context.addInitScript(`(() => {
		const probe = {getStateCalls: 0, pending: 0};
		const runtime = globalThis.chrome?.runtime;
		if (!runtime || typeof runtime.sendMessage !== 'function') return;
		const sendMessage = runtime.sendMessage.bind(runtime);
		runtime.sendMessage = async (message, ...args) => {
			const isStateRequest = message?.type === 'GET_STATE';
			if (isStateRequest) {
				probe.getStateCalls++;
				probe.pending++;
				document.documentElement.dataset.startupGetStateCalls = String(probe.getStateCalls);
				document.documentElement.dataset.startupPending = String(probe.pending);
			}
			const response = await sendMessage(message, ...args);
			if (isStateRequest && probe.getStateCalls === 1) {
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			if (isStateRequest) {
				probe.pending--;
				document.documentElement.dataset.startupPending = String(probe.pending);
			}
			return response;
		};
	})();`);

	const dashboard = await context.newPage();
	dashboard.setDefaultTimeout(10_000);
	await dashboard.goto('chrome://newtab/', {waitUntil: 'domcontentloaded'});
	await dashboard
		.locator('html[data-startup-get-state-calls="1"][data-startup-pending="1"]')
		.waitFor();
	const loadingStatus = await dashboard
		.locator('[role="status"]')
		.textContent();
	assert.match(
		loadingStatus?.trim() ?? '',
		/^Loading TabLodge…$/,
		'The new-tab page should announce that saved data is loading instead of showing a blank page.',
	);
	await dashboard.locator('#sessions-title').waitFor({timeout: 10_000});
	assert.equal(
		await dashboard
			.locator('html')
			.getAttribute('data-startup-get-state-calls'),
		'1',
		'The dashboard and embedded session list should share one initial state read.',
	);

	const statePages = new Set([
		'popup',
		'options',
		'sidepanel',
		'name-session',
		'add-bookmark',
	]);
	for (const pageName of [
		'newtab',
		'popup',
		'options',
		'help',
		'sidepanel',
		'name-session',
		'add-bookmark',
	]) {
		const page = pageName === 'newtab' ? dashboard : await context.newPage();
		page.setDefaultTimeout(10_000);
		const errors: string[] = [];
		page.on('pageerror', (error) => {
			errors.push(error.message);
		});
		if (pageName !== 'newtab') {
			await page.goto(`chrome-extension://${extensionId}/${pageName}.html`);
			if (statePages.has(pageName)) {
				await page
					.locator(
						'html[data-startup-get-state-calls="1"][data-startup-pending="1"]',
					)
					.waitFor();
				const status = await page.locator('[role="status"]').textContent();
				assert.match(
					status?.trim() ?? '',
					/^Loading TabLodge…$/,
					`${pageName}.html should show a loading status while saved data is pending.`,
				);
			}
		}

		if (pageName !== 'help') {
			await page.locator('html[data-startup-pending="0"]').waitFor();
		}

		await page.locator('#root > *').first().waitFor({state: 'visible'});
		const content = await page.locator('#root').innerText();
		assert.ok(content.trim());
		assert.notStrictEqual(content.trim(), 'Loading TabLodge…');
		assert.deepEqual(
			errors,
			[],
			`${pageName}.html should load without page errors.`,
		);
		if (pageName !== 'newtab') {
			await page.close();
		}
	}

	console.log('Startup check passed for all seven extension pages.');
} finally {
	await context?.close();
	await rm(profile, {recursive: true, force: true});
}
