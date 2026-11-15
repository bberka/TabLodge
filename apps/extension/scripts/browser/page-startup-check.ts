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
		channel: 'chromium',
		headless: true,
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
		const probe = {getStateCalls: 0, pending: 0, delayedFirstResponse: false};
		document.addEventListener(
			'DOMContentLoaded',
			() => {
				document.documentElement.dataset.startupDomContentLoadedMs = String(performance.now());
			},
			{once: true},
		);
		const readyObserver = new MutationObserver(() => {
			if (document.querySelector('#sessions-title')) {
				document.documentElement.dataset.startupDashboardReadyMs = String(performance.now());
				readyObserver.disconnect();
			}
		});
		readyObserver.observe(document, {childList: true, subtree: true});
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
				document.documentElement.dataset.startupStateRequestReadyState = document.readyState;
			}
			const response = await sendMessage(message, ...args);
			if (isStateRequest && !probe.delayedFirstResponse) {
				probe.delayedFirstResponse = true;
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
	assert.equal(
		await dashboard
			.locator('html')
			.getAttribute('data-startup-state-request-ready-state'),
		'loading',
		'The new-tab page should start reading saved data before DOMContentLoaded.',
	);
	assert.equal(
		(await dashboard.locator('#root').innerText()).trim(),
		'',
		'The new-tab page should stay blank until saved data is ready.',
	);
	await dashboard.locator('#sessions-title').waitFor({timeout: 10_000});
	const domContentLoadedMs = Number(
		await dashboard
			.locator('html')
			.getAttribute('data-startup-dom-content-loaded-ms'),
	);
	const dashboardReadyMs = Number(
		await dashboard
			.locator('html')
			.getAttribute('data-startup-dashboard-ready-ms'),
	);
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
		'palette',
	]);
	for (const pageName of [
		'newtab',
		'popup',
		'options',
		'help',
		'sidepanel',
		'name-session',
		'add-bookmark',
		'palette',
	]) {
		const page = pageName === 'newtab' ? dashboard : await context.newPage();
		page.setDefaultTimeout(10_000);
		const errors: string[] = [];
		page.on('console', (message) => {
			if (message.type() === 'error') {
				errors.push(message.text());
			}
		});
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
				const loadingStatus = page
					.locator('[role="status"]')
					.filter({hasText: /^Loading TabLodge…$/});
				assert.match(
					(await loadingStatus.textContent())?.trim() ?? '',
					/^Loading TabLodge…$/,
					`${pageName}.html should keep its accessible loading announcement while saved data is pending.`,
				);
				assert.ok(
					(await loadingStatus.getAttribute('class'))
						?.split(/\s+/)
						.includes('sr-only'),
					`${pageName}.html should not display the loading announcement visually.`,
				);
				if (pageName === 'options') {
					assert.ok(
						await page
							.getByRole('searchbox', {name: 'Search settings'})
							.isVisible(),
						'Settings should render its search field while saved data is pending.',
					);
					assert.ok(
						await page
							.getByRole('navigation', {name: 'Settings categories'})
							.isVisible(),
						'Settings should render its navigation while saved data is pending.',
					);
				}
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

	console.log(
		`New tab dashboard ready ${Math.round(dashboardReadyMs - domContentLoadedMs)} ms after DOMContentLoaded (250 ms delayed state response).`,
	);
	console.log('Startup check passed for all eight extension pages.');
} finally {
	await context?.close();
	await rm(profile, {recursive: true, force: true});
}
