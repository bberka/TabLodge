import assert from 'node:assert/strict';
import type {Page} from 'playwright';
import {seed} from './fixtures.ts';
import {check, type Env, type Theme} from './harness.ts';
import {openPage, setTheme} from './pages.ts';

export async function paletteWindowCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(`palette window keyboard use (${theme})`, async () => {
		const page = await openPage(context, extensionId, 'palette');
		await setTheme(page, theme);
		const input = page.getByRole('combobox', {name: 'Search'});
		await input.waitFor({timeout: 5000});
		await page.locator('input[role="combobox"]:focus').waitFor({
			timeout: 2000,
		});
		const listbox = page.getByRole('listbox', {name: 'Results'});
		assert.equal(
			await input.getAttribute('aria-controls'),
			await listbox.getAttribute('id'),
		);
		const first = await input.getAttribute('aria-activedescendant');
		await page.keyboard.press('ArrowDown');
		const second = await input.getAttribute('aria-activedescendant');
		assert.ok(first, 'A result is active when the palette opens');
		assert.notEqual(second, first, 'Arrow keys move');
		assert.equal(
			await page.locator(`#${second}`).getAttribute('aria-selected'),
			'true',
		);
		await page.keyboard.type('zzzz');
		await page
			.getByRole('option', {name: /Search the web for/})
			.waitFor({timeout: 2000});
		assert.equal(
			await page.getByRole('status').filter({hasText: 'result'}).count(),
			1,
			'A new search announces how many results it found',
		);
		// With a single result the spare room is between the list and the shortcut bar, not below the bar.
		const gap = await page.evaluate(() => {
			const {document, innerHeight} = globalThis as typeof globalThis & {
				document: {
					querySelector(selector: string): {
						getBoundingClientRect(): {bottom: number};
					} | null;
				};
				innerHeight: number;
			};
			const bar = document.querySelector('main div.border-t');
			return innerHeight - Math.round(bar?.getBoundingClientRect().bottom ?? 0);
		});
		assert.equal(gap, 0, 'The shortcut bar sits at the bottom of the window');
		await page.screenshot({
			path: `.dev/evidence/palette-keyboard-${theme}.png`,
		});
		// Escape closes the window, which ends the key press call itself.
		const closed = page.waitForEvent('close', {timeout: 3000});
		await page.keyboard.press('Escape').catch(() => {});
		await closed;
	});
}

export async function paletteOverlayCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(`palette overlay frame keyboard use (${theme})`, async () => {
		// The overlay is palette.html in a frame; a stand-in parent page receives its close request.
		const page = await openPage(context, extensionId, 'help');
		await setTheme(page, theme);
		await page.evaluate((address) => {
			const {document, addEventListener} = globalThis as typeof globalThis & {
				document: {
					title: string;
					body: {append(element: unknown): void};
					createElement(tag: string): {
						title: string;
						src: string;
						style: {cssText: string};
					};
				};
				addEventListener(
					type: string,
					listener: (event: {data?: {type?: string}}) => void,
				): void;
			};
			addEventListener('message', (event) => {
				if (event.data?.type === 'tablodge-palette-close') {
					document.title = 'palette-close-requested';
				}
			});
			const frame = document.createElement('iframe');
			frame.title = 'Search TabLodge';
			frame.src = address;
			frame.style.cssText =
				'position:fixed;top:40px;left:40px;width:640px;height:520px;z-index:99';
			document.body.append(frame);
		}, `chrome-extension://${extensionId}/palette.html?overlay=1`);
		const frame = page.frameLocator('iframe[title="Search TabLodge"]');
		const input = frame.getByRole('combobox', {name: 'Search'});
		await input.waitFor({timeout: 5000});
		// The service worker's injected script hands focus to the frame; the search box takes it from there.
		await input.focus();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Shift+Tab');
		assert.equal(
			await input.evaluate(
				(element: {ownerDocument: {activeElement: unknown}}) =>
					element === element.ownerDocument.activeElement,
			),
			true,
			'Tab and Shift+Tab stay in the palette frame',
		);
		await page.keyboard.press('Escape');
		await page.waitForFunction(
			() =>
				(globalThis as typeof globalThis & {document: {title: string}}).document
					.title === 'palette-close-requested',
		);
		await page.close();
	});
}

export async function openSettingsLayoutCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`opening settings layout and palette default (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'options');
			await setTheme(page, theme);
			const row = (name: string) =>
				page.locator(`[data-setting-row="${name}"]`);
			const location = row('paletteLocation').getByRole('combobox');
			await location.waitFor();
			assert.match(
				(await location.innerText()).trim(),
				/In the current page/,
				'the palette opens in the current page by default',
			);
			const hangs = async (name: string) =>
				Boolean(
					(await row(name).getAttribute('class'))?.includes('border-l-2'),
				);
			assert.ok(
				await hangs('autoFocusSearchOnNewTab'),
				'a dependent setting hangs from its parent',
			);
			for (const name of [
				'newTabEnabled',
				'paletteLocation',
				'keepLodgePinned',
				'openDashboardOnStartup',
				'actionMode',
				'dashboardBehavior',
			]) {
				assert.ok(
					!(await hangs(name)),
					`${name} is not drawn as a dependent setting`,
				);
			}

			await page.close();
		},
	);
}

export async function paletteActionsMenuCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(`palette actions menu keyboard use (${theme})`, async () => {
		const seeding = await openPage(context, extensionId, 'newtab');
		await seed(seeding);
		await seeding.close();
		const page = await openPage(context, extensionId, 'palette');
		await setTheme(page, theme);
		const input = page.getByRole('combobox', {name: 'Search'});
		await input.waitFor({timeout: 5000});
		await page.keyboard.type('Lisbon trip');
		await page
			.getByRole('option', {name: /Lisbon trip/})
			.first()
			.waitFor({timeout: 2000});
		const results = await input.getAttribute('aria-controls');
		await page.keyboard.press('ArrowRight');
		const menu = page.getByRole('listbox', {name: /^Actions for/});
		await menu.waitFor({timeout: 2000});
		assert.equal(
			await page
				.getByRole('combobox', {name: 'Filter actions'})
				.getAttribute('aria-controls'),
			await menu.getAttribute('id'),
		);
		assert.notStrictEqual(
			await menu.getAttribute('id'),
			results,
			'The menu is its own listbox',
		);
		await page
			.getByRole('navigation', {name: 'Breadcrumb'})
			.waitFor({timeout: 1000});
		assert.match(
			(await page.getByRole('status').allTextContents()).join(' '),
			/Actions for .*\d actions/,
			'Opening the menu is announced',
		);
		const first = await page
			.getByRole('combobox', {name: 'Filter actions'})
			.getAttribute('aria-activedescendant');
		await page.keyboard.press('ArrowDown');
		assert.notEqual(
			await page
				.getByRole('combobox', {name: 'Filter actions'})
				.getAttribute('aria-activedescendant'),
			first,
			'Arrow keys move through actions',
		);
		await page.screenshot({
			path: `.dev/evidence/palette-actions-${theme}.png`,
		});
		await page.keyboard.type('new window');
		assert.equal(
			await menu.getByRole('option').count(),
			1,
			'Typing filters the actions',
		);
		await page.keyboard.press('ArrowLeft');
		assert.ok(
			await menu.isVisible(),
			'← moves the caret through typed text and stays in the menu',
		);
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Backspace');
		for (let at = 0; at < 'new window'.length - 1; at++) {
			await page.keyboard.press('Backspace');
		}

		await page.keyboard.press('Backspace');
		await menu.waitFor({state: 'hidden', timeout: 1000});
		assert.equal(
			await page.locator('input[role="combobox"]:focus').count(),
			1,
			'Focus stays in the search box going back',
		);
		assert.equal(await input.inputValue(), 'Lisbon trip');
		const highlighted = await input.getAttribute('aria-activedescendant');
		await page.keyboard.press('ArrowRight');
		await menu.waitFor({timeout: 1000});
		await page.screenshot({
			path: `.dev/evidence/palette-actions-back-hint-${theme}.png`,
		});
		await page.keyboard.press('ArrowLeft');
		await menu.waitFor({state: 'hidden', timeout: 1000});
		assert.equal(
			await input.getAttribute('aria-activedescendant'),
			highlighted,
			'← goes back to the same result',
		);
		await page.keyboard.press('ArrowRight');
		await menu.waitFor({timeout: 1000});
		// Escape goes up one level first, so the window is still there afterwards.
		await page.keyboard.press('Escape');
		await menu.waitFor({state: 'hidden', timeout: 1000});
		const closed = page.waitForEvent('close', {timeout: 3000});
		await page.keyboard.press('Escape').catch(() => {});
		await closed;
	});
}

/**
The keys bar under the results: every hint it shows sits on one line.
*/
async function footerLines(page: Page) {
	return page.evaluate(() => {
		const {document} = globalThis as typeof globalThis & {
			document: {
				querySelectorAll(selector: string): Iterable<{
					textContent: string | null;
					querySelectorAll(selector: string): Iterable<{
						getBoundingClientRect(): {top: number; width: number};
					}>;
				}>;
			};
		};
		const bar = [...document.querySelectorAll('div.border-t')].find((element) =>
			element.textContent?.includes('Enter'),
		);
		const hints = [...(bar?.querySelectorAll(':scope > div > span') ?? [])]
			.map((hint) => hint.getBoundingClientRect())
			.filter((box) => box.width > 0);
		return new Set(hints.map((box) => Math.round(box.top))).size;
	});
}

export async function paletteFooterCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(`palette keys bar stays on one line (${theme})`, async () => {
		const dashboard = await openPage(context, extensionId, 'newtab');
		await setTheme(dashboard, theme);
		await dashboard.keyboard.press('Control+k');
		await dashboard.locator('[data-finder] [role="option"]').first().waitFor();
		assert.equal(await footerLines(dashboard), 1, 'dashboard palette');
		await dashboard.close();
		for (const [width, fontSize] of [
			[640, 16],
			[360, 16],
			[320, 16],
			[640, 20],
		] as const) {
			const page = await openPage(context, extensionId, 'palette');
			await setTheme(page, theme);
			await page.setViewportSize({width, height: 520});
			await page.addStyleTag({content: `html{font-size:${fontSize}px}`});
			await page.getByRole('option').first().waitFor();
			assert.equal(
				await footerLines(page),
				1,
				`palette window ${width}px wide, ${fontSize}px font`,
			);
			await page.keyboard.press('ArrowRight');
			await page
				.getByRole('listbox', {name: /^Actions for/})
				.waitFor({timeout: 2000});
			assert.equal(
				await footerLines(page),
				1,
				`actions menu ${width}px wide, ${fontSize}px font`,
			);
			await page.close();
		}
	});
}
