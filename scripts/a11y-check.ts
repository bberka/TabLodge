// Accessibility checks against the built extension (run `vp run build` first, then `vp run a11y`).
//
// Loads dist/tablodge in a headless Chromium with the development data fixture, then:
//   1. runs axe-core (WCAG 2.2 A and AA rules) on each extension page in both themes, and
//   2. exercises the keyboard workflows that automated rules cannot judge: the skip link, the
//      Appearance radio group, moving sessions, columns and bookmarks without dragging, and
//      archiving a session from its menu. Page and service worker console errors fail the run.
// Axe and keyboard checks do not judge reading order or screen reader announcements; see docs/CONTRIBUTING.md.
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {
	chromium,
	type BrowserContext,
	type Locator,
	type Page,
	type Worker,
} from 'playwright';
import {createDevFixture, type DevStore} from './dev-fixture.ts';
import {OUT_DIR, fromRoot} from './vite-shared.ts';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGES = ['newtab', 'options', 'help', 'popup', 'sidepanel'] as const;
const THEMES = ['light', 'dark'] as const;
const EVIDENCE_VIEWPORTS = [
	[768, 1024],
	[1440, 900],
	[1920, 1080],
] as const;

type ExtensionApi = {
	runtime: {sendMessage(message: unknown): Promise<unknown>};
	storage: {local: {set(items: Record<string, unknown>): Promise<void>}};
};
type AxeResults = {
	violations: Array<{
		id: string;
		help: string;
		nodes: Array<{target: unknown[]; failureSummary?: string}>;
	}>;
};
type AxeOptions = {runOnly: {type: 'rule' | 'tag'; values: string[]}};
type AxeGlobal = {axe: {run(options: AxeOptions): Promise<AxeResults>}};
type ScrollElement = {scrollHeight: number; clientHeight: number};

const failures: string[] = [];
const consoleErrors: string[] = [];

function watchConsole(target: Page | Worker, source: string) {
	target.on('console', (message) => {
		if (message.type() === 'error') {
			consoleErrors.push(`${source}: ${message.text()}`);
		}
	});
}

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

async function readDevStore(page: Page) {
	const base = await page.evaluate(async () => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		return chrome.runtime.sendMessage({type: 'GET_STATE'});
	});
	const {ok: _ok, ...store} = base as {ok: boolean} & DevStore;
	return store;
}

async function writeDevStore(page: Page, store: DevStore) {
	await page.evaluate(async (data) => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		await chrome.storage.local.set({'tablodge.state': data});
	}, store);
}

async function seed(page: Page) {
	const fixture = createDevFixture(await readDevStore(page));
	fixture.settings = {
		...fixture.settings,
		limitBookmarksPerColumn: false,
		bookmarkColumnPageSize: 10,
	};
	await writeDevStore(page, fixture);
}

async function seedLongBookmarkColumn(page: Page, count: number) {
	const fixture = createDevFixture(await readDevStore(page));
	fixture.bookmarkColumns = [
		{id: 'bookmark-limit', name: 'Limit test', createdAt: 0, isDefault: true},
	];
	fixture.bookmarks = Array.from({length: count}, (_, index) => ({
		id: `bookmark-limit-${index + 1}`,
		title: `Limit test bookmark ${index + 1}`,
		url: `https://example.com/limit-${index + 1}`,
		columnId: 'bookmark-limit',
		createdAt: index,
		updatedAt: index,
	})).concat(
		Array.from({length: count}, (_, index) => ({
			id: `unfiled-limit-${index + 1}`,
			title: `Unfiled limit test bookmark ${index + 1}`,
			url: `https://example.com/unfiled-limit-${index + 1}`,
			columnId: 'bookmark-unfiled',
			createdAt: index,
			updatedAt: index,
		})),
	);
	fixture.settings = {
		...fixture.settings,
		limitBookmarksPerColumn: false,
		bookmarkColumnPageSize: 10,
	};
	await writeDevStore(page, fixture);
}

async function groupFolderId(page: Page, groupId: string) {
	const state = (await page.evaluate(async () => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		return chrome.runtime.sendMessage({type: 'GET_STATE'});
	})) as {groups: Array<{id: string; folderId: string}>};
	return state.groups.find((group) => group.id === groupId)?.folderId;
}

// The pages follow the system theme by default, so emulating the color scheme switches them.
async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
	await page.emulateMedia({colorScheme: theme});
	// Colors transition between themes; measure contrast after they settle.
	await page.waitForTimeout(600);
}

async function openMenuItemByKeyboard(
	page: Page,
	trigger: Locator,
	name: string,
) {
	await trigger.focus();
	await page.keyboard.press('Enter');
	await page.getByRole('menuitem', {name, exact: true}).focus();
	await page.keyboard.press('Enter');
}

async function openPage(
	context: BrowserContext,
	extensionId: string,
	name: string,
) {
	const page = await context.newPage();
	watchConsole(page, `${name} page`);
	page.on('pageerror', (error) => {
		failures.push(`${name}: ${error.message}`);
		console.log(`FAIL ${name} page error: ${error.message}`);
	});
	await page.setViewportSize({width: 1280, height: 900});
	await page.goto(`chrome-extension://${extensionId}/${name}.html`);
	await page.waitForLoadState('networkidle');
	return page;
}

async function axeViolationLines(
	page: Page,
	source: string,
	runOnly: AxeOptions['runOnly'] = {type: 'tag', values: AXE_TAGS},
) {
	// Evaluated through the protocol because the extension CSP blocks inline scripts.
	await page.evaluate(source);
	const results = await page.evaluate(
		async (options: AxeOptions['runOnly']) =>
			(globalThis as typeof globalThis & AxeGlobal).axe.run({
				runOnly: options,
			}),
		runOnly,
	);
	return results.violations.map(
		(violation) =>
			`${violation.id}: ${violation.help} (${violation.nodes.length}) targets: ${violation.nodes.map((node) => `${node.target.join(' ')} ${node.failureSummary ?? ''}`).join(', ')}`,
	);
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

async function captureEvidence(page: Page, name: string) {
	if (process.env.TABLODGE_CAPTURE_EVIDENCE !== '1') {
		return;
	}

	const directory = fromRoot('.dev/evidence');
	const viewport = page.viewportSize();
	assert.ok(viewport);
	await mkdir(directory, {recursive: true});
	for (const [width, height] of EVIDENCE_VIEWPORTS) {
		await page.setViewportSize({width, height});
		const sizedName = `${name.slice(0, -4)}-${width}x${height}.png`;
		await page.screenshot({
			path: join(directory, sizedName),
		});
	}

	await page.setViewportSize(viewport);
}

async function captureResetEvidence(
	page: Page,
	target: Locator,
	theme: string,
) {
	if (process.env.TABLODGE_CAPTURE_RESET_EVIDENCE !== '1') {
		return;
	}

	const directory = fromRoot('.dev/evidence');
	const viewport = page.viewportSize();
	assert.ok(viewport);
	await mkdir(directory, {recursive: true});
	for (const [width, height] of EVIDENCE_VIEWPORTS) {
		await page.setViewportSize({width, height});
		await target.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: join(directory, `reset-setting-${theme}-${width}x${height}.png`),
		});
	}

	await page.setViewportSize({width: 440, height: 956});
	const device = await page.context().newCDPSession(page);
	try {
		await device.send('Emulation.setDeviceMetricsOverride', {
			width: 440,
			height: 956,
			deviceScaleFactor: 3,
			mobile: true,
			screenOrientation: {angle: 0, type: 'portraitPrimary'},
		});
		await target.scrollIntoViewIfNeeded();
		assert.ok(
			await page
				.locator('html')
				.evaluate(
					(node: {scrollWidth: number; clientWidth: number}) =>
						node.scrollWidth <= node.clientWidth,
				),
			'settings overflow at 440px',
		);
		const {data} = await device.send('Page.captureScreenshot', {
			format: 'png',
			captureBeyondViewport: false,
		});
		await writeFile(
			join(directory, `reset-setting-${theme}-440x956-dsf3.png`),
			Buffer.from(data, 'base64'),
		);
	} finally {
		await device.send('Emulation.clearDeviceMetricsOverride');
		await device.detach();
		await page.setViewportSize(viewport);
	}
}

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
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		const worker =
			context.serviceWorkers()[0] ??
			(await context.waitForEvent('serviceworker', {timeout: 15_000}));
		watchConsole(worker, 'service worker');
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

		for (const theme of THEMES) {
			await check(
				`bookmark columns reveal configured batches by keyboard (${theme})`,
				async () => {
					const limitSeedPage = await openPage(context, extensionId, 'newtab');
					await seedLongBookmarkColumn(limitSeedPage, 65);
					await limitSeedPage.close();

					const defaultBoard = await openPage(context, extensionId, 'newtab');
					await setTheme(defaultBoard, theme);
					const defaultColumn = defaultBoard
						.locator('section[data-column-id]')
						.filter({
							has: defaultBoard.getByRole('heading', {name: 'Limit test'}),
						});
					await defaultColumn.waitFor();
					assert.equal(
						await defaultColumn.locator('[data-bookmark-id]').count(),
						60,
						'off keeps the existing 60-bookmark batches',
					);
					assert.equal(
						await defaultBoard
							.locator(
								'section[data-column-id="bookmark-unfiled"] [data-bookmark-id]',
							)
							.count(),
						65,
						'off keeps the existing unfiled display behavior',
					);
					await defaultBoard.close();

					const settingsPage = await openPage(context, extensionId, 'options');
					await setTheme(settingsPage, theme);
					const toggle = settingsPage.getByRole('switch', {
						name: 'Limit bookmarks shown at a time',
					});
					await toggle.waitFor({timeout: 2000});
					assert.equal(await toggle.getAttribute('aria-checked'), 'false');
					await toggle.focus();
					await settingsPage.keyboard.press('Space');
					assert.equal(await toggle.getAttribute('aria-checked'), 'true');
					const batchSize = settingsPage.getByRole('spinbutton', {
						name: 'Show at a time',
					});
					await batchSize.fill('10');
					await batchSize.press('Enter');
					await settingsPage.close();

					const board = await openPage(context, extensionId, 'newtab');
					await setTheme(board, theme);
					const column = board
						.locator('section[data-column-id]')
						.filter({has: board.getByRole('heading', {name: 'Limit test'})});
					const cards = column.locator('[data-bookmark-id]');
					const unfiled = board.locator(
						'section[data-column-id="bookmark-unfiled"]',
					);
					const unfiledCards = unfiled.locator('[data-bookmark-id]');
					await until(
						async () => (await cards.count()) === 10,
						'the first ten bookmarks',
					);
					await until(
						async () => (await unfiledCards.count()) === 10,
						'the first ten unfiled bookmarks',
					);
					const showMore = column.getByRole('button', {
						name: 'Show 10 more',
						exact: true,
					});
					const showMoreUnfiled = unfiled.getByRole('button', {
						name: 'Show 10 more',
						exact: true,
					});
					await showMore.waitFor();
					const showMoreBounds = await showMore.boundingBox();
					const listBounds = await showMore.locator('..').boundingBox();
					assert.ok(showMoreBounds);
					assert.ok(listBounds);
					assert.ok(
						Math.abs(showMoreBounds.width - listBounds.width) < 1,
						'Show more fills the bookmark column width',
					);
					await board.screenshot({
						path: `.dev/evidence/bookmark-limit-${theme}.png`,
					});
					await showMore.focus();
					await board.keyboard.press('Enter');
					await until(
						async () => (await cards.count()) === 20,
						'the next ten bookmarks',
					);
					await showMoreUnfiled.focus();
					await board.keyboard.press('Enter');
					await until(
						async () => (await unfiledCards.count()) === 20,
						'the next ten unfiled bookmarks',
					);
					assert.equal(
						await board.locator(':focus').count(),
						1,
						'focus stays on the Show more button after it updates',
					);
					await board.close();

					const resetPage = await openPage(context, extensionId, 'newtab');
					await seed(resetPage);
					await resetPage.close();
				},
			);

			await check(`bookmark import scrolling (${theme})`, async () => {
				const page = await openPage(context, extensionId, 'newtab');
				await seed(page);
				await page.reload();
				await setTheme(page, theme);
				await page.setViewportSize({width: 1440, height: 900});
				await page
					.getByRole('button', {name: 'Import, back up and share bookmarks'})
					.click();
				await page
					.getByRole('menuitem', {name: 'Import bookmarks', exact: true})
					.click();
				await page.locator('input[type="file"]').setInputFiles({
					name: 'bookmarks.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from(
						Array.from(
							{length: 60},
							(_, index) => `https://example.com/import-${index}`,
						).join('\n'),
					),
				});
				const dialog = page.getByRole('dialog');
				await dialog
					.getByRole('heading', {name: 'Review bookmark import'})
					.waitFor();
				await page.screenshot({path: `.dev/evidence/import-${theme}.png`});
				const body = dialog.locator('div').filter({has: page.locator('ol')});
				const scrolling = await body.evaluateAll(
					(nodes: ScrollElement[]) =>
						nodes.filter((node) => {
							const {getComputedStyle} = globalThis as typeof globalThis & {
								getComputedStyle: (node: ScrollElement) => {overflowY: string};
							};
							const style = getComputedStyle(node);
							return (
								['auto', 'scroll'].includes(style.overflowY) &&
								node.scrollHeight > node.clientHeight + 1
							);
						}).length,
				);
				assert.equal(
					scrolling,
					1,
					'only the bookmark list should scroll at desktop height',
				);
				for (const height of [600, 420]) {
					await page.setViewportSize({width: 800, height});
					assert.ok(
						await dialog.evaluate(
							(node: ScrollElement) =>
								node.scrollHeight <= node.clientHeight + 1,
						),
						'the dialog panel must not add another scrollbar',
					);
					const action = dialog.getByRole('button', {
						name: 'Import 60 bookmarks',
					});
					await action.focus();
					const bounds = await action.boundingBox();
					assert.ok(bounds, 'Import is rendered');
					assert.ok(bounds.y >= 0, 'Import stays below the top edge');
					assert.ok(
						bounds.y + bounds.height <= height,
						'Import stays above the bottom edge',
					);
				}

				await page.setViewportSize({width: 375, height: 667});
				assert.ok(
					await dialog.evaluate(
						(
							node: ScrollElement & {scrollWidth: number; clientWidth: number},
						) => node.scrollWidth <= node.clientWidth + 1,
					),
					'the review fits a narrow screen',
				);
				await page.screenshot({
					path: `.dev/evidence/import-narrow-${theme}.png`,
				});
				await page.close();
			});
			await check(`import into a new bookmark column (${theme})`, async () => {
				const page = await openPage(context, extensionId, 'newtab');
				await seed(page);
				await page.reload();
				await setTheme(page, theme);
				const name = `Imported ${theme}`;
				for (const save of [false, true]) {
					await page
						.getByRole('button', {name: 'Import, back up and share bookmarks'})
						.click();
					await page
						.getByRole('menuitem', {name: 'Import bookmarks', exact: true})
						.click();
					await page.locator('input[type="file"]').setInputFiles({
						name: 'links.txt',
						mimeType: 'text/plain',
						buffer: Buffer.from(`https://example.com/new-column-${theme}`),
					});
					const dialog = page.getByRole('dialog');
					await dialog
						.getByRole('radio', {name: 'One column', exact: true})
						.focus();
					await page.keyboard.press('Space');
					await dialog.getByRole('combobox').press('Space');
					await page
						.getByRole('option', {name: 'New column', exact: true})
						.waitFor({timeout: 2000});
					await page
						.getByRole('option', {name: 'New column', exact: true})
						.press('Enter');
					assert.equal(
						await dialog
							.getByRole('button', {name: 'Import 1 bookmark', exact: true})
							.isEnabled(),
						false,
						'a new column needs a name',
					);
					await dialog
						.getByRole('textbox', {name: 'New column name'})
						.fill(name);
					const nameBounds = await dialog
						.getByRole('textbox', {name: 'New column name'})
						.boundingBox();
					const dialogBounds = await dialog.boundingBox();
					assert.ok(nameBounds);
					assert.ok(dialogBounds);
					assert.ok(
						nameBounds.width > dialogBounds.width * 0.65,
						'the new column name gets its own full width row',
					);
					if (save) {
						await page.screenshot({
							path: `.dev/evidence/import-new-column-${theme}.png`,
						});
					}

					await dialog
						.getByRole('button', {
							name: save ? 'Import 1 bookmark' : 'Cancel',
							exact: true,
						})
						.click();
					await dialog.waitFor({state: 'hidden'});
					if (!save) {
						assert.equal(
							await page.getByRole('heading', {name, exact: true}).count(),
							0,
							'Cancel must not create the column',
						);
					}
				}

				await page.getByRole('heading', {name, exact: true}).waitFor();
				const column = page
					.locator('section[data-column-id]')
					.filter({has: page.getByRole('heading', {name, exact: true})});
				assert.equal(await column.locator('[data-bookmark-id]').count(), 1);
				await page.close();
			});
			await check(`paste bookmarks into a new column (${theme})`, async () => {
				const page = await openPage(context, extensionId, 'newtab');
				await seed(page);
				await page.reload();
				await setTheme(page, theme);
				await page.bringToFront();
				await page.evaluate(async (text) => {
					const {navigator} = globalThis as typeof globalThis & {
						navigator: {clipboard: {writeText(text: string): Promise<void>}};
					};
					await navigator.clipboard.writeText(text);
				}, `https://example.com/paste-${theme}-1\nhttps://example.com/paste-${theme}-2`);
				await page.keyboard.press('Control+V');
				const dialog = page.getByRole('dialog');
				await dialog.getByRole('combobox').press('Space');
				await page
					.getByRole('option', {name: 'New column', exact: true})
					.press('Enter', {timeout: 2000});
				const name = `Pasted ${theme}`;
				await dialog.getByRole('textbox', {name: 'New column name'}).fill(name);
				await dialog
					.getByRole('button', {name: 'Add 2 bookmarks', exact: true})
					.press('Enter');
				await dialog.waitFor({state: 'hidden'});
				const column = page
					.locator('section[data-column-id]')
					.filter({has: page.getByRole('heading', {name, exact: true})});
				await column.waitFor();
				assert.equal(await column.locator('[data-bookmark-id]').count(), 2);
				await page.close();
			});
			await check(
				`bookmark a saved tab into a new column (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'newtab');
					await seed(page);
					await page.reload();
					await setTheme(page, theme);
					await page
						.getByRole('button', {name: /^Expand session:/})
						.first()
						.press('Enter');
					await page
						.locator('[data-tab-id]')
						.first()
						.getByRole('button', {name: /^More actions for /})
						.press('Enter');
					await page
						.getByRole('menuitem', {name: 'Bookmark', exact: true})
						.press('Enter');
					const dialog = page.getByRole('dialog');
					await dialog.getByRole('combobox').press('Space');
					await page
						.getByRole('option', {name: 'New column', exact: true})
						.press('Enter', {timeout: 2000});
					const name = `Saved tab ${theme}`;
					await dialog
						.getByRole('textbox', {name: 'New column name'})
						.fill(name);
					await dialog
						.getByRole('button', {name: 'Save bookmark', exact: true})
						.press('Enter');
					await dialog.waitFor({state: 'hidden'});
					const column = page
						.locator('section[data-column-id]')
						.filter({has: page.getByRole('heading', {name, exact: true})});
					await column.waitFor();
					assert.equal(await column.locator('[data-bookmark-id]').count(), 1);
					await page.close();
				},
			);
			await check(
				`share and export one session from its menu by keyboard (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'newtab');
					await seed(page);
					await page.reload();
					await setTheme(page, theme);
					const card = page.locator('#session-dev-session-1');
					const name = 'Home lab rebuild';
					const trigger = card.locator('[data-move-focus]');

					await openMenuItemByKeyboard(page, trigger, 'Share');
					const shareDialog = page.getByRole('dialog');
					await shareDialog.waitFor();
					assert.equal(await shareDialog.locator('h4').textContent(), name);
					assert.equal(await shareDialog.locator('h5').count(), 0);
					await mkdir(fromRoot('.dev/evidence'), {recursive: true});
					await shareDialog.screenshot({
						path: fromRoot(`.dev/evidence/session-share-${theme}.png`),
					});

					const shareDownloadPromise = page.waitForEvent('download');
					await shareDialog
						.getByRole('button', {name: 'Download', exact: true})
						.focus();
					await page.keyboard.press('Enter');
					const shareDownload = await shareDownloadPromise;
					const sharePath = await shareDownload.path();
					assert.ok(sharePath);
					const shareHtml = await readFile(sharePath, 'utf8');
					assert.match(shareHtml, /<h1>Home lab rebuild<\/h1>/);
					assert.doesNotMatch(shareHtml, /<h2>Home lab rebuild<\/h2>/);
					await shareDialog.waitFor({state: 'hidden'});

					await openMenuItemByKeyboard(page, trigger, 'Export session');
					const exportDialog = page.getByRole('dialog');
					await exportDialog.waitFor();
					assert.equal(
						await exportDialog
							.getByRole('heading', {name: 'Export session'})
							.count(),
						1,
					);
					assert.equal(
						await exportDialog
							.getByRole('radiogroup', {name: 'What to back up'})
							.count(),
						0,
					);

					const htmlFormat = exportDialog.getByRole('radio', {
						name: /Browser bookmarks \(HTML\)/,
					});
					await htmlFormat.focus();
					await page.keyboard.press('Space');
					assert.equal(await htmlFormat.isChecked(), true);
					await mkdir(fromRoot('.dev/evidence'), {recursive: true});
					await exportDialog.screenshot({
						path: fromRoot(`.dev/evidence/session-export-${theme}.png`),
					});
					const exportDownloadPromise = page.waitForEvent('download');
					await exportDialog
						.getByRole('button', {name: 'Download', exact: true})
						.focus();
					await page.keyboard.press('Enter');
					const exportDownload = await exportDownloadPromise;
					assert.match(
						exportDownload.suggestedFilename(),
						/^tablodge-sessions-home-lab-rebuild-\d{4}-\d{2}-\d{2}\.html$/,
					);
					const exportPath = await exportDownload.path();
					assert.ok(exportPath);
					const exportHtml = await readFile(exportPath, 'utf8');
					assert.match(exportHtml, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
					assert.match(exportHtml, /Home lab rebuild/);
					assert.doesNotMatch(exportHtml, /Quarterly planning/);
					await page.close();
				},
			);
			await check(
				`bookmark column share does not repeat its title (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'newtab');
					await seed(page);
					await page.reload();
					await setTheme(page, theme);
					const column = page.locator('section[data-column-id]').first();
					const trigger = column.locator('header [data-move-focus]');

					await openMenuItemByKeyboard(page, trigger, 'Share');
					const dialog = page.getByRole('dialog');
					await dialog.waitFor();
					assert.equal(await dialog.locator('h4').textContent(), 'Daily');
					assert.equal(await dialog.locator('h5').count(), 0);
					await mkdir(fromRoot('.dev/evidence'), {recursive: true});
					await dialog.screenshot({
						path: fromRoot(`.dev/evidence/bookmark-share-${theme}.png`),
					});

					const downloadPromise = page.waitForEvent('download');
					await dialog
						.getByRole('button', {name: 'Download', exact: true})
						.focus();
					await page.keyboard.press('Enter');
					const download = await downloadPromise;
					const path = await download.path();
					assert.ok(path);
					const html = await readFile(path, 'utf8');
					assert.match(html, /<h1>Daily<\/h1>/);
					assert.doesNotMatch(html, /<h2>Daily<\/h2>/);
					assert.match(html, /Gmail/);
					await page.close();
				},
			);
		}

		for (const theme of THEMES) {
			await check(
				`toolbar popup bookmarks into a new column (${theme})`,
				async () => {
					const url = `https://example.com/popup-bookmark-${theme}`;
					const webPage = await context.newPage();
					await webPage.route(url, async (route) =>
						route.fulfill({
							contentType: 'text/html',
							body: '<title>Popup bookmark test</title>',
						}),
					);
					await webPage.goto(url);
					const popup = await openPage(context, extensionId, 'popup');
					await popup.setViewportSize({width: 380, height: 560});
					await setTheme(popup, theme);
					const name = `Popup ${theme}`;
					for (const save of [false, true]) {
						await webPage.bringToFront();
						await popup
							.getByRole('button', {name: 'Bookmark this page', exact: true})
							.press('Enter');
						const dialog = popup.getByRole('dialog');
						await dialog
							.getByText('Popup bookmark test', {exact: true})
							.waitFor();
						await dialog.getByRole('combobox').press('Space');
						await popup
							.getByRole('option', {name: 'New column', exact: true})
							.press('Enter', {timeout: 2000});
						await dialog
							.getByRole('textbox', {name: 'New column name'})
							.fill(name);
						await popup.screenshot({
							path: `.dev/evidence/popup-new-column-${theme}.png`,
						});
						await dialog
							.getByRole('button', {
								name: save ? 'Save bookmark' : 'Cancel',
								exact: true,
							})
							.press('Enter');
						await dialog.waitFor({state: 'hidden'});
						const board = await openPage(context, extensionId, 'newtab');
						const column = board
							.locator('section[data-column-id]')
							.filter({has: board.getByRole('heading', {name, exact: true})});
						if (save) {
							await column.waitFor();
							assert.equal(
								await column
									.locator(`[data-bookmark-id] a[href="${url}"]`)
									.count(),
								1,
							);
						} else {
							assert.equal(await column.count(), 0, 'Cancel creates no column');
						}

						await board.close();
					}

					await popup.close();
					await webPage.close();
				},
			);
			for (const entry of ['dashboard', 'prompt']) {
				await check(
					`${entry} adds a bookmark into a new column (${theme})`,
					async () => {
						const url = `https://example.com/${entry}-bookmark-${theme}`;
						const page = await openPage(
							context,
							extensionId,
							entry === 'dashboard' ? 'newtab' : 'add-bookmark',
						);
						if (entry === 'prompt') {
							await page.goto(
								`chrome-extension://${extensionId}/add-bookmark.html?url=${encodeURIComponent(url)}&title=Prompt%20bookmark&source=browser`,
							);
						}

						await setTheme(page, theme);
						if (entry === 'dashboard') {
							await page
								.getByRole('button', {name: 'Add bookmark', exact: true})
								.first()
								.focus();
							await page.keyboard.press('Enter');
							await page.getByRole('dialog').waitFor({timeout: 5000});
							await page
								.getByRole('textbox', {name: 'Title', exact: true})
								.fill('Dashboard bookmark', {timeout: 5000});
							await page
								.getByRole('textbox', {name: 'Web address', exact: true})
								.fill(url);
						}

						await page.getByRole('combobox').press('Space');
						await page
							.getByRole('option', {name: 'New column', exact: true})
							.press('Enter');
						const name = `${entry} ${theme}`;
						await page
							.getByRole('textbox', {name: 'New column name'})
							.fill(name);
						await page.screenshot({
							path: `.dev/evidence/${entry}-new-column-${theme}.png`,
						});
						await page
							.getByRole('button', {
								name: entry === 'dashboard' ? 'Create column and save' : 'Save',
								exact: true,
							})
							.press('Enter');
						const board = await openPage(context, extensionId, 'newtab');
						const column = board
							.locator('section[data-column-id]')
							.filter({has: board.getByRole('heading', {name, exact: true})});
						await column.waitFor();
						assert.equal(
							await column
								.locator(`[data-bookmark-id] a[href="${url}"]`)
								.count(),
							1,
						);
						await board.close();
						if (!page.isClosed()) {
							await page.close();
						}
					},
				);
			}

			await check(
				`browser bookmarks import into a new column (${theme})`,
				async () => {
					const url = `https://example.com/browser-import-${theme}`;
					const browserBookmarkId = await worker.evaluate(
						async (bookmarkUrl) => {
							const {chrome} = globalThis as typeof globalThis & {
								chrome: {
									bookmarks: {
										create(details: {
											title: string;
											url: string;
										}): Promise<{id: string}>;
									};
								};
							};
							const bookmark = await chrome.bookmarks.create({
								title: 'Browser import test',
								url: bookmarkUrl,
							});
							return bookmark.id;
						},
						url,
					);
					try {
						const page = await openPage(context, extensionId, 'newtab');
						await seed(page);
						await page.reload();
						await setTheme(page, theme);
						await page
							.getByRole('button', {
								name: 'Import, back up and share bookmarks',
							})
							.press('Enter');
						await page
							.getByRole('menuitem', {name: 'Import bookmarks', exact: true})
							.press('Enter');
						await page
							.getByRole('button', {name: 'Read bookmarks', exact: true})
							.press('Enter');
						const dialog = page.getByRole('dialog');
						await dialog
							.getByRole('radio', {name: 'One column', exact: true})
							.press('Space');
						await dialog.getByRole('combobox').press('Space');
						await page
							.getByRole('option', {name: 'New column', exact: true})
							.press('Enter');
						const name = `Browser import ${theme}`;
						await dialog
							.getByRole('textbox', {name: 'New column name'})
							.fill(name);
						await dialog
							.getByRole('button', {name: 'Import 1 bookmark', exact: true})
							.press('Enter');
						await dialog.waitFor({state: 'hidden'});
						const column = page
							.locator('section[data-column-id]')
							.filter({has: page.getByRole('heading', {name, exact: true})});
						await column.waitFor();
						assert.equal(
							await column
								.locator(`[data-bookmark-id] a[href="${url}"]`)
								.count(),
							1,
						);
						await page.close();
					} finally {
						await worker.evaluate(async (id) => {
							const {chrome} = globalThis as typeof globalThis & {
								chrome: {bookmarks: {remove(id: string): Promise<void>}};
							};
							await chrome.bookmarks.remove(id);
						}, browserBookmarkId);
					}
				},
			);
		}

		for (const name of PAGES) {
			for (const theme of THEMES) {
				await check(`axe ${name} (${theme})`, async () => {
					const page = await openPage(context, extensionId, name);
					await setTheme(page, theme);
					const lines = await axeViolationLines(page, axeSource);
					await page.close();
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
		for (const theme of THEMES) {
			await check(
				`changed setting resets to its default by keyboard (${theme})`,
				async () => {
					const setupPage = await openPage(context, extensionId, 'options');
					const updated = await setupPage.evaluate(async () => {
						const {chrome} = globalThis as typeof globalThis & {
							chrome: ExtensionApi;
						};
						return chrome.runtime.sendMessage({
							type: 'UPDATE_SETTINGS',
							settings: {
								closeOnSave: false,
								restoreTarget: 'current-window',
							},
						});
					});
					assert.equal((updated as {ok: boolean}).ok, true);
					await setupPage.close();

					const page = await openPage(context, extensionId, 'options');
					await setTheme(page, theme);
					const reset = page.getByRole('button', {
						name: 'Reset Close tabs after saving to default',
					});
					const resetSelect = page.getByRole('button', {
						name: 'Reset Open restored tabs in to default',
					});
					await reset.waitFor();
					await resetSelect.waitFor();
					assert.equal(
						await page
							.getByRole('button', {
								name: 'Reset Include pinned tabs to default',
							})
							.count(),
						0,
					);
					await captureResetEvidence(page, reset, theme);
					await page.setViewportSize({width: 375, height: 900});
					await reset.scrollIntoViewIfNeeded();
					assert.ok(
						await page
							.locator('html')
							.evaluate(
								(node: {scrollWidth: number; clientWidth: number}) =>
									node.scrollWidth <= node.clientWidth,
							),
						'settings overflow at 375px',
					);
					await page.screenshot({
						path: fromRoot(`.dev/evidence/reset-setting-${theme}-375x900.png`),
					});
					await reset.focus();
					await page.keyboard.press('Enter');
					await page
						.getByRole('switch', {
							name: 'Close tabs after saving',
							checked: true,
						})
						.waitFor();
					await until(
						async () => (await reset.count()) === 0,
						'reset button to disappear',
					);
					assert.equal(
						await page.locator(':focus').getAttribute('role'),
						'switch',
					);
					await resetSelect.scrollIntoViewIfNeeded();
					await resetSelect.focus();
					await page.keyboard.press('Enter');
					await until(
						async () => (await resetSelect.count()) === 0,
						'select reset button to disappear',
					);
					assert.equal(
						await page.locator(':focus').getAttribute('role'),
						'combobox',
					);
					const state = await page.evaluate(async () => {
						const {chrome} = globalThis as typeof globalThis & {
							chrome: ExtensionApi;
						};
						return chrome.runtime.sendMessage({type: 'GET_STATE'});
					});
					const currentSettings = (
						state as {
							settings: {
								closeOnSave: boolean;
								restoreTarget: string;
							};
						}
					).settings;
					assert.equal(currentSettings.closeOnSave, true);
					assert.equal(
						currentSettings.restoreTarget,
						'new-window-unless-only-tab',
					);
					await page.close();
				},
			);
		}

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
		for (const [index, theme] of THEMES.entries()) {
			await check(
				`a session archives from its menu by keyboard (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'newtab');
					await setTheme(page, theme);
					const sessionId = `dev-session-${index + 1}`;
					const previousFolderId =
						index === 0 ? 'folder-learning' : 'folder-work';
					const card = page.locator(`#session-${sessionId}`);
					await card.waitFor();
					const trigger = card.locator('[data-move-focus]');
					await trigger.focus();
					await page.keyboard.press('Enter');
					const menuItems = page.getByRole('menuitem');
					const labels = await menuItems.allTextContents();
					const archiveIndex = labels.findIndex((label) =>
						label.includes('Archive session'),
					);
					const trashIndex = labels.findIndex(
						(label) => label.trim() === 'Delete',
					);
					assert.notStrictEqual(archiveIndex, -1);
					assert.notStrictEqual(trashIndex, -1);
					assert.ok(archiveIndex < trashIndex);
					const archiveClasses = await menuItems
						.nth(archiveIndex)
						.getAttribute('class');
					assert.ok(archiveClasses?.split(/\s+/).includes('text-primary'));
					await page.evaluate(async () => {
						const {document} = globalThis as typeof globalThis & {
							document: {
								querySelector(selector: string): {
									getAnimations(options: {subtree: boolean}): Array<{
										finished: Promise<unknown>;
									}>;
								} | null;
							};
						};
						const menu = document.querySelector('[role="menu"]');
						if (!menu) {
							throw new Error('The session action menu did not open.');
						}

						await Promise.all(
							menu
								.getAnimations({subtree: true})
								.map((animation) => animation.finished),
						);
					});
					assert.deepEqual(
						await axeViolationLines(page, axeSource, {
							type: 'rule',
							values: ['color-contrast'],
						}),
						[],
					);
					await captureEvidence(page, `archive-menu-${theme}.png`);
					await page.getByRole('menuitem', {name: 'Archive session'}).focus();
					await page.keyboard.press('Enter');
					await until(
						async () =>
							(await page.getByRole('status').allTextContents()).some((text) =>
								text.includes('to Archived.'),
							),
						'the archive announcement',
					);
					await until(
						async () => (await card.count()) === 0,
						'session leaves All',
					);
					await until(
						async () =>
							(await page
								.locator(':focus')
								.getAttribute('data-session-folder-chip')) ===
							'archived-sessions',
						'focus to move to the Archived folder',
					);

					const state = (await page.evaluate(async () => {
						const {chrome} = globalThis as typeof globalThis & {
							chrome: ExtensionApi;
						};
						return chrome.runtime.sendMessage({type: 'GET_STATE'});
					})) as {
						groups: Array<{id: string; folderId: string}>;
						folders: Array<{id: string; name: string}>;
					};
					const archivedId = state.folders.find(
						(folder) => folder.name === 'Archived',
					)?.id;
					assert.ok(archivedId, 'the Archived folder should exist');
					assert.equal(
						state.groups.find((group) => group.id === sessionId)?.folderId,
						archivedId,
					);
					const undo = page.getByRole('button', {name: 'Undo'});
					await undo.focus();
					await page.keyboard.press('Enter');
					await until(
						async () =>
							(await groupFolderId(page, sessionId)) === previousFolderId,
						'Undo to restore the previous folder',
					);
					await card.waitFor();

					await trigger.focus();
					await page.keyboard.press('Enter');
					await page.getByRole('menuitem', {name: 'Archive session'}).focus();
					await page.keyboard.press('Enter');
					await until(
						async () => (await groupFolderId(page, sessionId)) === archivedId,
						'session to archive again',
					);

					const archivedFolderButton = page.getByRole('button', {
						name: /Archived/,
					});
					await archivedFolderButton.focus();
					await page.keyboard.press('Enter');
					await card.waitFor();
					const archivedTrigger = card.locator('[data-move-focus]');
					await archivedTrigger.focus();
					await page.keyboard.press('Enter');
					assert.equal(
						await page.getByRole('menuitem', {name: 'Archive session'}).count(),
						0,
						'already archived sessions should not offer Archive session',
					);
					await page.getByRole('menuitem', {name: 'Move to folder'}).focus();
					await page.keyboard.press('ArrowRight');
					const workFolder = page.getByRole('menuitem', {
						name: 'Work',
						exact: true,
					});
					await workFolder.focus();
					await page.keyboard.press('Enter');
					await until(
						async () =>
							(await groupFolderId(page, sessionId)) === 'folder-work',
						'session to move out of Archived',
					);
					await until(
						async () => (await card.count()) === 0,
						'session to leave Archived',
					);
					const workFolderButton = page.getByRole('button', {name: /Work/});
					await workFolderButton.focus();
					await page.keyboard.press('Enter');
					await card.waitFor();
					await page.close();
				},
			);
		}

		await check(
			'Archived sessions are hidden from popup and side panel',
			async () => {
				for (const theme of THEMES) {
					const popup = await openPage(context, extensionId, 'popup');
					await setTheme(popup, theme);
					await popup.getByRole('region', {name: 'Recent sessions'}).waitFor();
					assert.equal(
						await popup.getByText('Archived example', {exact: true}).count(),
						0,
					);
					assert.equal(
						await popup.getByText('Lisbon trip', {exact: true}).count(),
						1,
					);
					await popup.close();

					const sidepanel = await openPage(context, extensionId, 'sidepanel');
					await setTheme(sidepanel, theme);
					const sessionsTab = sidepanel.getByRole('tab', {name: /Sessions/});
					await sessionsTab.focus();
					await sidepanel.keyboard.press('Enter');
					assert.equal(
						await sidepanel
							.getByText('Archived example', {exact: true})
							.count(),
						0,
					);
					assert.equal(
						await sidepanel.getByText('Lisbon trip', {exact: true}).count(),
						1,
					);
					await sidepanel.close();
				}
			},
		);

		for (const theme of THEMES) {
			await check(`session action menu order (${theme})`, async () => {
				const page = await openPage(context, extensionId, 'newtab');
				await setTheme(page, theme);
				const trigger = page.getByRole('button', {
					name: 'More actions for Home lab rebuild',
				});
				await mkdir(fromRoot('.dev/evidence'), {recursive: true});
				for (const [width, height] of EVIDENCE_VIEWPORTS) {
					await page.setViewportSize({width, height});
					await trigger.scrollIntoViewIfNeeded();
					await trigger.focus();
					await page.keyboard.press('Enter');
					const menu = page.getByRole('menu');
					await menu
						.getByRole('menuitem', {name: 'Switch to this session'})
						.waitFor();
					assert.deepEqual(
						(await menu.getByRole('menuitem').allTextContents()).slice(0, 3),
						['Restore', 'Restore options', 'Switch to this session'],
					);
					await page.screenshot({
						animations: 'disabled',
						path: fromRoot(
							`.dev/evidence/session-action-menu-${width}x${height}-${theme}.png`,
						),
					});
					await page.keyboard.press('Escape');
				}

				await page.close();
			});
		}

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
			assert.equal(
				await page.getByRole('menuitem', {name: 'Archived example'}).count(),
				0,
				'archived sessions should not be targets for adding bookmarks',
			);
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

		if (consoleErrors.length > 0) {
			failures.push('browser console errors');
			for (const error of consoleErrors) {
				console.log(`FAIL ${error}`);
			}
		}
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
