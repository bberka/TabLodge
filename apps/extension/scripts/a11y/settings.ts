import assert from 'node:assert/strict';
import {fromRoot} from '../vite-shared.ts';
import {captureEvidence, captureResetEvidence} from './evidence.ts';
import {type ExtensionApi} from './fixtures.ts';
import {check, type Env, type Theme, THEMES, until} from './harness.ts';
import {attributes, axeViolationLines, openPage, setTheme} from './pages.ts';

export async function settingsSearchCheck(env: Env) {
	const {context, extensionId} = env;
	await check(
		'settings search stays active when navigating categories',
		async () => {
			for (const theme of THEMES) {
				const page = await openPage(context, extensionId, 'options');
				try {
					await setTheme(page, theme);
					const search = page.getByRole('searchbox', {
						name: 'Search settings',
					});
					await search.fill('saving');
					const savingCategory = page.getByRole('link', {
						name: 'Saving',
						exact: true,
					});
					await savingCategory.waitFor();
					await savingCategory.focus();
					await page.keyboard.press('Enter');
					assert.equal(await search.inputValue(), 'saving');
					assert.match(page.url(), /[&?]q=saving/);
					assert.match(page.url(), /#settings-when-saving$/);
					assert.equal(
						await page
							.locator('[data-setting-row="saveDuplicateHandling"]')
							.count(),
						1,
					);
					await captureEvidence(
						page,
						`settings-search-navigation-${theme}.png`,
					);
				} finally {
					await page.close();
				}
			}
		},
	);
}

export async function skipLinkCheck(env: Env) {
	const {context, extensionId} = env;
	await check('skip link moves focus to the content', async () => {
		const page = await openPage(context, extensionId, 'options');
		await page.bringToFront();
		await page.locator('body').focus();
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
}

export async function appearanceCheck(env: Env) {
	const {context, extensionId} = env;
	await check(
		'appearance is one tab stop with arrow key selection',
		async () => {
			const page = await openPage(context, extensionId, 'options');
			await page
				.getByRole('button', {name: 'Accent color: Default', exact: true})
				.click();
			assert.equal(
				await page.getByRole('option', {name: 'Default', exact: true}).count(),
				1,
			);
			assert.equal(
				await page
					.getByRole('option', {name: 'TabLodge default', exact: true})
					.count(),
				0,
			);
			const radios = page
				.getByRole('radiogroup', {name: 'Appearance', exact: true})
				.getByRole('radio');
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
			await page.getByRole('radio', {name: 'System', checked: true}).waitFor();
			await page.close();
		},
	);
}

export async function settingResetCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
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
			assert.equal(await page.locator(':focus').getAttribute('role'), 'switch');
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
			assert.equal(currentSettings.restoreTarget, 'new-window-unless-only-tab');
			await page.close();
		},
	);
}

export async function siteSourcePickerCheck(env: Env, theme: Theme) {
	const {context, extensionId, axeSource} = env;
	await check(
		`Sources: Add a site is a keyboard combobox (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'options');
			try {
				await setTheme(page, theme);
				const trigger = page.getByRole('button', {name: 'Add a site'});
				await trigger.waitFor();
				await page.getByText('No sites added.').waitFor();
				await trigger.focus();
				await page.keyboard.press('Enter');
				const search = page.getByRole('combobox', {
					name: 'Search supported sites',
				});
				await search.waitFor();
				assert.equal(
					await page.locator(':focus').getAttribute('aria-label'),
					'Search supported sites',
				);
				const active = async () => {
					const id = await search.getAttribute('aria-activedescendant');
					return id
						? page.locator(`[id="${id}"] .font-medium`).textContent()
						: undefined;
				};

				assert.equal(await active(), 'YouTube Watch later');
				await page.keyboard.press('ArrowDown');
				assert.equal(await active(), 'Reddit saved');
				await page.keyboard.press('End');
				assert.equal(await active(), 'Lobsters saved');
				await search.fill('twitter');
				assert.deepEqual(await page.getByRole('option').allTextContents(), [
					'X bookmarksPosts you bookmark on x.com or twitter.com',
				]);
				assert.equal(await active(), 'X bookmarks');
				await search.fill('');
				assert.equal(await page.getByRole('option').count(), 9);
				const violations = await axeViolationLines(page, axeSource);
				assert.deepEqual(violations, [], violations.join('\n'));
				await page.keyboard.press('Escape');
				await until(
					async () =>
						(await page.locator(':focus').textContent()) === 'Add a site',
					'focus back on Add a site',
				);
			} finally {
				await page.close();
			}
		},
	);
}
