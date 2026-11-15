import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fromRoot} from '../vite-shared.ts';
import {check, type Env, type Theme, until} from './harness.ts';
import {focusedLabel, openPage, setTheme} from './pages.ts';

export async function narrowHeaderCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`dashboard header and buttons fit narrow windows (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await setTheme(page, theme);
			for (const width of [320, 480]) {
				await page.setViewportSize({width, height: 900});
				await mkdir(fromRoot('.dev/evidence'), {recursive: true});
				await page.screenshot({
					path: fromRoot(`.dev/evidence/dashboard-${width}-${theme}.png`),
				});
				for (const control of await page
					.locator('main > header a, main button')
					.all()) {
					const rect = await control.boundingBox();
					if (!rect) {
						continue;
					}

					assert.ok(rect.x >= 0, `control starts inside ${width}px viewport`);
					assert.ok(
						rect.x + rect.width <= width,
						`control ends inside ${width}px viewport`,
					);
				}

				const header = page.locator('main > header');
				const brand = await header
					.getByRole('link', {name: 'TabLodge', exact: true})
					.boundingBox();
				const nav = await header.getByRole('navigation').boundingBox();
				assert.ok(brand);
				assert.ok(nav);
				assert.ok(
					nav.y >= brand.y + brand.height,
					'narrow navigation has its own row',
				);
			}

			await page.close();
		},
	);
}

export async function sidePanelHeaderIconsCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`side panel header icons work by keyboard (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'sidepanel');
			await page.setViewportSize({width: 320, height: 900});
			await setTheme(page, theme);
			for (const label of ['Recent snapshots', 'Trash bin']) {
				const button = page.getByRole('button', {name: label, exact: true});
				assert.equal(await button.count(), 1, `${label} has a direct button`);
				await button.focus();
				await page.keyboard.press('Enter');
				await page.getByRole('dialog').waitFor();
				await page.keyboard.press('Escape');
				await until(
					async () => (await focusedLabel(page)) === label,
					'focus returns to the header icon',
				);
			}

			for (const [label, destination] of [
				['Open dashboard', 'newtab'],
				['Open settings', 'options'],
			]) {
				const link = page.getByRole('link', {name: label, exact: true});
				await link.focus();
				const opened = context.waitForEvent('page');
				await page.keyboard.press('Enter');
				const tab = await opened;
				await tab.waitForLoadState();
				assert.equal(
					tab.url(),
					`chrome-extension://${extensionId}/${destination}.html`,
				);
				assert.equal(
					page.url(),
					`chrome-extension://${extensionId}/sidepanel.html`,
				);
				await tab.close();
			}

			for (const control of await page
				.locator('header a, header button')
				.all()) {
				const rect = await control.boundingBox();
				assert.ok(rect);
				assert.ok(rect.x >= 0);
				assert.ok(rect.x + rect.width <= 320);
				assert.ok(rect.width >= 24);
				assert.ok(rect.height >= 24);
			}

			await page.close();
		},
	);
}

export async function sidePanelTitleCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(`side panel title opens a dashboard tab (${theme})`, async () => {
		const page = await openPage(context, extensionId, 'sidepanel');
		await page.setViewportSize({width: 320, height: 900});
		await setTheme(page, theme);
		const brand = page.getByRole('link', {name: 'TabLodge', exact: true});
		await brand.waitFor();
		await mkdir(fromRoot('.dev/evidence'), {recursive: true});
		await page.screenshot({
			path: fromRoot(`.dev/evidence/sidebar-${theme}.png`),
		});
		await brand.focus();
		assert.equal(await brand.getAttribute('target'), '_blank');
		const opened = context.waitForEvent('page');
		await page.keyboard.press('Enter');
		const dashboard = await opened;
		await dashboard.waitForLoadState();
		assert.equal(
			dashboard.url(),
			`chrome-extension://${extensionId}/newtab.html`,
		);
		assert.equal(
			page.url(),
			`chrome-extension://${extensionId}/sidepanel.html`,
		);
		await dashboard.close();
		await page.close();
	});
}

export async function syncButtonCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(`sync button names its state and action (${theme})`, async () => {
		const page = await openPage(context, extensionId, 'newtab');
		try {
			await setTheme(page, theme);
			await page.evaluate(async () => {
				const {chrome} = globalThis as typeof globalThis & {
					chrome: {
						storage: {
							local: {set(items: Record<string, unknown>): Promise<void>};
						};
					};
				};
				await chrome.storage.local.set({
					'tablodge.sync.status': {
						connected: true,
						phase: 'idle',
						pending: 0,
						live: false,
					},
				});
			});
			const sync = page.getByRole('link', {
				name: 'Sync: up to date. Open Sync settings',
				exact: true,
			});
			await sync.waitFor();
			assert.equal(
				await sync.getAttribute('href'),
				'options.html#settings-sync',
			);
			await sync.focus();
			const tip = page.getByRole('tooltip');
			await tip.waitFor();
			assert.equal(
				await tip.first().textContent(),
				'Sync: up to date. Open Sync settings',
			);
		} finally {
			await page.evaluate(async () => {
				const {chrome} = globalThis as typeof globalThis & {
					chrome: {
						storage: {local: {remove(key: string): Promise<void>}};
					};
				};
				await chrome.storage.local.remove('tablodge.sync.status');
			});
			await page.close();
		}
	});
}

export async function dialogFocusReturnCheck(env: Env) {
	const {context, extensionId} = env;
	await check('dialogs hand focus back to what opened them', async () => {
		const page = await openPage(context, extensionId, 'newtab');
		const add = page.getByRole('button', {name: 'Add bookmark'}).first();
		await add.focus();
		await page.keyboard.press('Enter');
		await page.getByRole('dialog').waitFor();
		await page.keyboard.press('Escape');
		await until(
			async () => (await focusedLabel(page)) === 'Add bookmark',
			'focus to return to the Add bookmark button',
		);
		// A dialog opened from a menu item returns to the menu's button.
		const trigger = page
			.locator('[data-bookmark-id] [data-move-focus]')
			.first();
		const label = await trigger.getAttribute('aria-label');
		await trigger.focus();
		await page.keyboard.press('Enter');
		await page.getByRole('menuitem', {name: 'Edit', exact: true}).click();
		await page.getByRole('dialog').waitFor();
		await page.keyboard.press('Escape');
		await until(async () => (await focusedLabel(page)) === label, 'focus');
		await page.close();
	});
}

export async function searchAnnouncementCheck(env: Env) {
	const {context, extensionId} = env;
	await check('searches announce how many results they found', async () => {
		const page = await openPage(context, extensionId, 'newtab');
		await page.getByRole('button', {name: 'Search bookmarks'}).click();
		await page.keyboard.type('zzzqq');
		await until(
			async () =>
				(await page.getByRole('status').allTextContents()).includes(
					'No bookmarks match',
				),
			'the no results announcement',
		);
		await page.keyboard.press('Escape');
		await until(
			async () => (await focusedLabel(page)) === 'Search bookmarks',
			'focus to return to the search button',
		);
		await page.close();
	});
}
