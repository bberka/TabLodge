// Accessibility checks against the built extension (run `vp run build` first, then `vp run a11y`).
//
// Loads dist/tablodge in a headless Chromium with the development data fixture, then:
//   1. runs axe-core (WCAG 2.2 A and AA rules) on each extension page in both themes, and
//   2. exercises the keyboard workflows that automated rules cannot judge: the skip link, the
//      Appearance radio group, and moving sessions, columns and bookmarks without dragging.
// Automated checks do not replace manual keyboard and screen reader testing; see docs/CONTRIBUTING.md.
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {chromium, type BrowserContext, type Page} from 'playwright';
import {createDevFixture, type DevStore} from './dev-fixture.ts';
import {OUT_DIR, fromRoot} from './vite-shared.ts';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGES = ['newtab', 'options', 'help', 'popup', 'sidepanel'] as const;
const THEMES = ['light', 'dark'] as const;

type ExtensionApi = {
	runtime: {sendMessage(message: unknown): Promise<unknown>};
	storage: {local: {set(items: Record<string, unknown>): Promise<void>}};
};
type AxeResults = {
	violations: Array<{
		id: string;
		help: string;
		nodes: Array<{target: unknown[]}>;
	}>;
};
type AxeOptions = {runOnly: {type: 'tag'; values: string[]}};
type AxeGlobal = {axe: {run(options: AxeOptions): Promise<AxeResults>}};

const failures: string[] = [];

async function check(name: string, run: () => Promise<void>) {
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

// Polls until the condition holds; the pages redraw asynchronously after each action.
async function until(condition: () => Promise<boolean>, what: string) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (await condition()) {
			return;
		}

		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});
	}

	assert.fail(`Timed out waiting for ${what}.`);
}

async function seed(page: Page) {
	const base = await page.evaluate(async () => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		return chrome.runtime.sendMessage({type: 'GET_STATE'});
	});
	const {ok: _ok, ...store} = base as {ok: boolean} & DevStore;
	await page.evaluate(async (fixture) => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		await chrome.storage.local.set({'tablodge.state': fixture});
	}, createDevFixture(store));
}

// The pages follow the system theme by default, so emulating the color scheme switches them.
async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
	await page.emulateMedia({colorScheme: theme});
	// Colors transition between themes; measure contrast after they settle.
	await page.waitForTimeout(600);
}

async function openPage(
	context: BrowserContext,
	extensionId: string,
	name: string,
) {
	const page = await context.newPage();
	page.on('pageerror', (error) => {
		failures.push(`${name}: ${error.message}`);
		console.log(`FAIL ${name} page error: ${error.message}`);
	});
	await page.setViewportSize({width: 1280, height: 900});
	await page.goto(`chrome-extension://${extensionId}/${name}.html`);
	await page.waitForLoadState('networkidle');
	return page;
}

const attributes = (page: Page, selector: string, name: string) =>
	page
		.locator(selector)
		.evaluateAll(
			(
				nodes: Array<{getAttribute(name: string): string | null}>,
				attribute: string,
			) => nodes.map((node) => node.getAttribute(attribute)),
			name,
		);

// The control holding keyboard focus, by its accessible name.
const focusedLabel = (page: Page) =>
	page.locator(':focus').getAttribute('aria-label');

async function main() {
	const profile = await mkdtemp(join(tmpdir(), 'tablodge-a11y-'));
	const context = await chromium.launchPersistentContext(profile, {
		channel: 'chromium',
		headless: true,
		args: [
			`--disable-extensions-except=${OUT_DIR}`,
			`--load-extension=${OUT_DIR}`,
		],
	});
	try {
		const worker =
			context.serviceWorkers()[0] ??
			(await context.waitForEvent('serviceworker', {timeout: 15_000}));
		const extensionId = new URL(worker.url()).hostname;
		const axeSource = await readFile(
			fromRoot('node_modules/axe-core/axe.min.js'),
			'utf8',
		);

		const seedPage = await openPage(context, extensionId, 'newtab');
		await seed(seedPage);
		await seedPage.close();

		for (const theme of THEMES) {
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

							assert.ok(
								rect.x >= 0,
								`control starts inside ${width}px viewport`,
							);
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

			await check(
				`side panel header icons work by keyboard (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'sidepanel');
					await page.setViewportSize({width: 320, height: 900});
					await setTheme(page, theme);
					for (const label of ['Recent snapshots', 'Trash bin']) {
						const button = page.getByRole('button', {name: label, exact: true});
						assert.equal(
							await button.count(),
							1,
							`${label} has a direct button`,
						);
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

			await check(
				`side panel title opens a dashboard tab (${theme})`,
				async () => {
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
				},
			);
		}

		for (const name of PAGES) {
			for (const theme of THEMES) {
				await check(`axe ${name} (${theme})`, async () => {
					const page = await openPage(context, extensionId, name);
					await setTheme(page, theme);
					// Evaluated through the protocol: the pages' CSP blocks an injected inline script.
					await page.evaluate(axeSource);
					const results = await page.evaluate(
						async (values) =>
							(globalThis as typeof globalThis & AxeGlobal).axe.run({
								runOnly: {type: 'tag', values},
							}),
						AXE_TAGS,
					);
					await page.close();
					const lines = results.violations.map(
						(violation) =>
							`${violation.id}: ${violation.help} (${violation.nodes.length}) e.g. ${violation.nodes[0].target.join(' ')}`,
					);
					assert.deepEqual(lines, []);
				});
			}
		}

		for (const theme of THEMES) {
			await check(`bookmark selection mode and ranges (${theme})`, async () => {
				const page = await openPage(context, extensionId, 'newtab');
				await seed(page);
				await page.reload();
				await setTheme(page, theme);
				const mode = page.getByRole('button', {
					name: 'Select bookmarks',
					exact: true,
				});
				await mode.waitFor({timeout: 2000});
				await mode.focus();
				await page.keyboard.press('Enter');
				assert.equal(await mode.getAttribute('aria-pressed'), 'true');
				const cards = page.locator('[data-bookmark-id]');
				await cards.first().getByRole('checkbox').focus();
				await page.keyboard.press('Space');
				await cards.nth(3).getByRole('checkbox').focus();
				await page.keyboard.press('Shift+Space');
				await cards
					.nth(6)
					.locator('a')
					.click({modifiers: ['Shift']});
				const checked = await attributes(
					page,
					'[data-bookmark-id] [role="checkbox"]',
					'aria-checked',
				);
				assert.deepEqual(
					checked.slice(0, 7),
					Array.from({length: 7}, () => 'true'),
				);
				assert.ok(checked.slice(7).every((value) => value === 'false'));
				const [opened] = await Promise.all([
					context.waitForEvent('page', {timeout: 2000}),
					cards
						.first()
						.locator('a')
						.click({modifiers: ['Control']}),
				]);
				await opened.close();
				assert.equal(
					await cards
						.first()
						.getByRole('checkbox')
						.getAttribute('aria-checked'),
					'true',
				);
				await page
					.getByRole('button', {name: 'Clear bookmark selection', exact: true})
					.click();
				await cards.nth(6).getByRole('checkbox').click();
				await cards
					.nth(2)
					.getByRole('checkbox')
					.click({modifiers: ['Shift']});
				assert.deepEqual(
					await attributes(
						page,
						'[data-bookmark-id] [role="checkbox"]',
						'aria-checked',
					),
					Array.from({length: 16}, (_, index) =>
						index >= 2 && index <= 6 ? 'true' : 'false',
					),
				);
				await page.keyboard.press('Escape');
				await until(
					async () => (await mode.getAttribute('aria-pressed')) === 'false',
					'selection mode to exit',
				);
				assert.equal(await cards.first().getByRole('checkbox').count(), 0);
				const [normalTab] = await Promise.all([
					context.waitForEvent('page', {timeout: 2000}),
					cards
						.first()
						.locator('a')
						.click({modifiers: ['Control']}),
				]);
				await normalTab.close();
				assert.equal(await mode.getAttribute('aria-pressed'), 'false');
				await mode.click();
				await cards.first().getByRole('checkbox').click();
				await mode.click();
				assert.equal(await cards.first().getByRole('checkbox').count(), 0);
				await page.close();
			});

			await check(
				`move and delete selected bookmarks by keyboard (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'newtab');
					await seed(page);
					await page.reload();
					await setTheme(page, theme);
					const cards = page.locator('[data-bookmark-id]');
					const ids = (
						await attributes(page, '[data-bookmark-id]', 'data-bookmark-id')
					).slice(0, 2);
					await cards.first().locator('[data-move-focus]').focus();
					await page.keyboard.press('Enter');
					assert.equal(
						await page
							.getByRole('menuitem', {name: 'Select bookmark', exact: true})
							.locator('svg')
							.count(),
						1,
					);
					await page
						.getByRole('menuitem', {name: 'Select bookmark', exact: true})
						.focus();
					await page.keyboard.press('Enter');
					await cards.first().locator('[data-move-focus]').focus();
					await page.keyboard.press('Enter');
					assert.equal(
						await page
							.getByRole('menuitem', {name: 'Deselect bookmark', exact: true})
							.locator('svg')
							.count(),
						1,
					);
					await page.keyboard.press('Escape');
					await cards.nth(1).getByRole('checkbox').focus();
					await page.keyboard.press('Space');
					const move = page.getByRole('button', {
						name: 'Move selected bookmarks',
					});
					await move.focus();
					await page.keyboard.press('Enter');
					await page
						.getByRole('combobox', {name: 'Column', exact: true})
						.focus();
					await page.keyboard.press('Enter');
					await page.keyboard.press('r');
					await until(
						async () =>
							(await page.locator('[role="option"]:focus').textContent()) ===
							'Reading',
						'the last column option to receive focus',
					);
					await page.keyboard.press('Enter');
					await page
						.getByRole('button', {name: 'Move bookmarks', exact: true})
						.focus();
					await page.keyboard.press('Enter');
					await page.getByRole('dialog').waitFor({state: 'hidden'});
					const destination = page.locator('section[data-column-id]').last();
					const columnId = await destination.getAttribute('data-column-id');
					assert.deepEqual(
						(
							await attributes(
								page,
								`section[data-column-id="${columnId}"] [data-bookmark-id]`,
								'data-bookmark-id',
							)
						).slice(-2),
						ids,
					);
					await until(
						async () =>
							(await focusedLabel(page)) === 'Move selected bookmarks',
						'focus after moving',
					);
					const remove = page.getByRole('button', {
						name: 'Delete selected bookmarks',
					});
					await remove.focus();
					await page.keyboard.press('Enter');
					await until(
						async () =>
							(
								await attributes(page, '[data-bookmark-id]', 'data-bookmark-id')
							).every((id) => !ids.includes(id)),
						'both bookmarks to be deleted',
					);
					await page.getByRole('button', {name: 'Undo', exact: true}).focus();
					await page.keyboard.press('Enter');
					await until(async () => {
						const restored = await attributes(
							page,
							'[data-bookmark-id]',
							'data-bookmark-id',
						);
						return ids.every((id) => restored.includes(id));
					}, 'both bookmarks to be restored');
					assert.deepEqual(
						(
							await attributes(
								page,
								`section[data-column-id="${columnId}"] [data-bookmark-id]`,
								'data-bookmark-id',
							)
						).slice(-2),
						ids,
					);
					assert.equal(await page.locator('body:focus').count(), 0);
					await page.close();
				},
			);

			await check(`drag selected bookmarks (${theme})`, async () => {
				const page = await openPage(context, extensionId, 'newtab');
				await page.setViewportSize({width: 1440, height: 900});
				await seed(page);
				await page.reload();
				await setTheme(page, theme);
				const cards = page.locator('[data-bookmark-id]');
				const ids = (
					await attributes(page, '[data-bookmark-id]', 'data-bookmark-id')
				).slice(0, 2);
				await cards.first().hover();
				await page.keyboard.down('Alt');
				await cards.first().getByRole('checkbox').click();
				await page.keyboard.up('Alt');
				await cards.nth(1).getByRole('checkbox').click();
				await mkdir(fromRoot('.dev/evidence'), {recursive: true});
				await page.locator('#bookmark-library').screenshot({
					path: fromRoot(`.dev/evidence/bookmark-selection-${theme}.png`),
				});
				await page.evaluate(axeSource);
				const selectedAxe = await page.evaluate(
					async (values) =>
						(globalThis as typeof globalThis & AxeGlobal).axe.run({
							runOnly: {type: 'tag', values},
						}),
					AXE_TAGS,
				);
				assert.deepEqual(selectedAxe.violations, []);
				await page.setViewportSize({width: 375, height: 900});
				assert.ok(
					await page
						.locator('html')
						.evaluate(
							(node: {scrollWidth: number; clientWidth: number}) =>
								node.scrollWidth <= node.clientWidth,
						),
				);
				await page.locator('#bookmark-library').screenshot({
					path: fromRoot(
						`.dev/evidence/bookmark-selection-mobile-${theme}.png`,
					),
				});
				await page.setViewportSize({width: 1440, height: 900});
				const destination = page.locator('section[data-column-id]').last();
				const columnId = await destination.getAttribute('data-column-id');
				await cards
					.first()
					.locator('article')
					.dragTo(destination.locator('header'));
				await until(async () => {
					const moved = await attributes(
						page,
						`section[data-column-id="${columnId}"] [data-bookmark-id]`,
						'data-bookmark-id',
					);
					return moved.slice(-2).join(',') === ids.join(',');
				}, 'both bookmarks to move together in order');
				const movedCard = page.locator(
					`[data-bookmark-id="${ids[0]}"] article`,
				);
				const target = destination.locator('[data-bookmark-id]').first();
				const targetId = await target.getAttribute('data-bookmark-id');
				await movedCard.dragTo(target, {targetPosition: {x: 60, y: 2}});
				await until(
					async () =>
						(
							await attributes(
								page,
								`section[data-column-id="${columnId}"] [data-bookmark-id]`,
								'data-bookmark-id',
							)
						)
							.slice(0, 3)
							.join(',') === [...ids, targetId].join(','),
					'the selection to move before a bookmark',
				);
				const sameTarget = page.locator(`[data-bookmark-id="${targetId}"]`);
				const box = await sameTarget.boundingBox();
				assert.ok(box);
				await movedCard.dragTo(sameTarget, {
					targetPosition: {x: 60, y: box.height - 2},
				});
				await until(
					async () =>
						(
							await attributes(
								page,
								`section[data-column-id="${columnId}"] [data-bookmark-id]`,
								'data-bookmark-id',
							)
						)
							.slice(0, 3)
							.join(',') === [targetId, ...ids].join(','),
					'the selection to move after a bookmark',
				);
				await page.locator('#bookmark-library').screenshot({
					path: fromRoot(`.dev/evidence/bookmark-group-moved-${theme}.png`),
				});
				await page.close();
			});

			await check(`bookmark selection (${theme})`, async () => {
				const page = await openPage(context, extensionId, 'newtab');
				await seed(page);
				await page.reload();
				await setTheme(page, theme);
				const cards = page.locator('[data-bookmark-id]');
				await cards.first().hover();
				await page.keyboard.down('Alt');
				const first = cards.first().getByRole('checkbox');
				await first.waitFor({state: 'visible', timeout: 2000});
				await page.keyboard.up('Alt');
				await until(
					async () => (await first.count()) === 0,
					'the favicon to return when Alt is released',
				);
				await page.keyboard.down('Alt');
				await first.click();
				await page.keyboard.up('Alt');
				const second = cards.nth(1).getByRole('checkbox');
				await second.focus();
				await page.keyboard.press('Space');
				assert.equal(await first.getAttribute('aria-checked'), 'true');
				assert.equal(await second.getAttribute('aria-checked'), 'true');
				assert.ok(
					await page
						.getByRole('button', {name: 'Move selected bookmarks'})
						.isVisible(),
				);
				await page.keyboard.press('Escape');
				assert.equal(
					await page
						.getByRole('button', {name: 'Move selected bookmarks'})
						.count(),
					0,
				);
				await page.close();
			});
		}

		await check('skip link moves focus to the content', async () => {
			const page = await openPage(context, extensionId, 'options');
			await page.keyboard.press('Tab');
			assert.equal(
				await page.locator(':focus').textContent(),
				'Skip to main content',
			);
			await page.keyboard.press('Enter');
			assert.equal(
				await page.locator(':focus').getAttribute('id'),
				'main-content',
			);
			await page.close();
		});

		await check(
			'appearance is one tab stop with arrow key selection',
			async () => {
				const page = await openPage(context, extensionId, 'options');
				const radios = page.getByRole('radio');
				assert.equal(await radios.count(), 3);
				assert.deepEqual(await attributes(page, '[role="radio"]', 'tabindex'), [
					'0',
					'-1',
					'-1',
				]);
				await page.getByRole('radio', {name: 'System'}).focus();
				await page.keyboard.press('ArrowRight');
				await page.getByRole('radio', {name: 'Light', checked: true}).waitFor();
				assert.equal(await page.locator(':focus').textContent(), 'Light');
				await page.keyboard.press('End');
				await page.getByRole('radio', {name: 'Dark', checked: true}).waitFor();
				await page.keyboard.press('ArrowRight');
				await page
					.getByRole('radio', {name: 'System', checked: true})
					.waitFor();
				await page.close();
			},
		);

		await check(
			'a bookmark moves down from its menu and keeps focus',
			async () => {
				const page = await openPage(context, extensionId, 'newtab');
				const column = page.locator('section[data-column-id]').first();
				await column.locator('[data-bookmark-id]').first().waitFor();
				const order = () =>
					attributes(
						page,
						'section[data-column-id]:first-of-type [data-bookmark-id]',
						'data-bookmark-id',
					);
				const before = await order();
				assert.ok(before.length >= 2, 'the fixture column needs two bookmarks');
				const trigger = column
					.locator(`[data-bookmark-id="${before[0]}"] [data-move-focus]`)
					.first();
				const label = await trigger.getAttribute('aria-label');
				await trigger.focus();
				await page.keyboard.press('Enter');
				await page.getByRole('menuitem', {name: 'Move down'}).click();
				await until(
					async () => (await order())[0] === before[1],
					'the bookmark to move',
				);
				await until(async () => (await focusedLabel(page)) === label, 'focus');
				assert.deepEqual((await order()).slice(0, 2), [before[1], before[0]]);
				await page.close();
			},
		);

		await check(
			'a column moves right from its menu and keeps focus',
			async () => {
				const page = await openPage(context, extensionId, 'newtab');
				await page.locator('section[data-column-id]').first().waitFor();
				const ids = () =>
					attributes(page, 'section[data-column-id]', 'data-column-id');
				const before = await ids();
				assert.ok(before.length >= 2, 'the fixture needs two columns');
				const trigger = page.locator(
					`section[data-column-id="${before[0]}"] header [data-move-focus]`,
				);
				const label = await trigger.getAttribute('aria-label');
				await trigger.focus();
				await page.keyboard.press('Enter');
				await page.getByRole('menuitem', {name: 'Move right'}).click();
				await until(
					async () => (await ids())[0] === before[1],
					'the column to move',
				);
				await until(async () => (await focusedLabel(page)) === label, 'focus');
				await page.close();
			},
		);

		await check(
			'a session moves down from its menu and keeps focus',
			async () => {
				const page = await openPage(context, extensionId, 'newtab');
				await page.locator('article[id^="session-"]').first().waitFor();
				const ids = () => attributes(page, 'article[id^="session-"]', 'id');
				const before = await ids();
				assert.ok(before.length >= 2, 'the fixture needs two sessions');
				const trigger = page.locator(`#${before[0]} [data-move-focus]`);
				const label = await trigger.getAttribute('aria-label');
				await trigger.focus();
				await page.keyboard.press('Enter');
				await page.getByRole('menuitem', {name: 'Move down'}).click();
				await until(
					async () => (await ids())[0] === before[1],
					'the session to move',
				);
				await until(async () => (await focusedLabel(page)) === label, 'focus');
				await page.close();
			},
		);
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

		await check('a bookmark is added to a session from its menu', async () => {
			const page = await openPage(context, extensionId, 'newtab');
			const trigger = page
				.locator('[data-bookmark-id] [data-move-focus]')
				.first();
			await trigger.focus();
			await page.keyboard.press('Enter');
			await page.getByRole('menuitem', {name: 'Add to session'}).focus();
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('Enter');
			await until(
				async () =>
					(await page.getByRole('status').allTextContents()).some((text) =>
						text.startsWith('Added'),
					),
				'the added announcement',
			);
			await page.close();
		});
	} finally {
		await context.close();
		await rm(profile, {recursive: true, force: true});
	}

	if (failures.length > 0) {
		console.log(`\n${failures.length} accessibility check(s) failed.`);
		process.exitCode = 1;
	} else {
		console.log('\nAll accessibility checks passed.');
	}
}

await main();
