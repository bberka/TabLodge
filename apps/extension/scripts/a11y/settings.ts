import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {Page} from 'playwright';
import {settingsSections} from '../../src/app/settings-sections.ts';
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
				assert.equal(await active(), 'Substack saved');
				// The list scrolls; the highlighted site is scrolled into view.
				const last = await page
					.getByRole('option', {name: /Substack saved/})
					.boundingBox();
				const list = await page.getByRole('listbox').boundingBox();
				assert.ok(last, 'the last site has a box');
				assert.ok(list, 'the list has a box');
				assert.ok(last.y >= list.y, 'the last site is not above the list');
				assert.ok(
					last.y + last.height <= list.y + list.height + 1,
					'the last site is not below the list',
				);
				await search.fill('twitter');
				assert.deepEqual(await page.getByRole('option').allTextContents(), [
					'X bookmarksPosts you bookmark on x.com or twitter.com',
				]);
				assert.equal(await active(), 'X bookmarks');
				await search.fill('');
				assert.equal(await page.getByRole('option').count(), 17);
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

async function animationsDone(page: Page) {
	await page.evaluate(async () => {
		const {document} = globalThis as typeof globalThis & {
			document: {getAnimations(): Array<{finished: Promise<unknown>}>};
		};
		await Promise.all(
			// A cancelled animation rejects; it is done either way.
			document
				.getAnimations()
				.map(async (animation) => animation.finished.catch(() => undefined)),
		);
	});
}

async function writeSources(page: Page, sources: Record<string, unknown>) {
	await page.evaluate(async (value) => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		await chrome.storage.local.set({
			'tablodge.sources': {version: 1, sources: value},
		});
	}, sources);
}

export async function siteSourceRemoveCheck(env: Env, theme: Theme) {
	const {context, extensionId, axeSource} = env;
	await check(
		`Sources: Remove asks first, and Cancel keeps the site (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'options');
			try {
				await setTheme(page, theme);
				// A site the browser took access from stays listed with Remove, without a permission prompt to answer.
				await writeSources(page, {github: {enabled: false, notice: 'revoked'}});
				const row = page.locator('[data-site-source="github"]');
				const remove = row.getByRole('button', {name: 'Remove GitHub stars'});
				await remove.focus();
				await page.keyboard.press('Enter');
				const confirm = page.getByRole('alertdialog', {
					name: 'Remove GitHub stars?',
				});
				await confirm
					.getByText(/gives back its access to github\.com/)
					.waitFor();
				// The dialog fades in; mid fade its button fails contrast.
				await animationsDone(page);
				const violations = await axeViolationLines(page, axeSource);
				assert.deepEqual(violations, [], violations.join('\n'));
				await confirm.getByRole('button', {name: 'Cancel'}).focus();
				await page.keyboard.press('Enter');
				await confirm.waitFor({state: 'hidden'});
				await until(
					async () =>
						(await page.locator(':focus').getAttribute('aria-label')) ===
						'Remove GitHub stars',
					'focus back on Remove',
				);
				assert.equal(await row.count(), 1, 'Cancel keeps the site');
				await page.keyboard.press('Enter');
				await confirm.getByRole('button', {name: 'Remove'}).focus();
				await page.keyboard.press('Enter');
				await row.waitFor({state: 'detached'});
				await page.getByText('No sites added.').waitFor();
				// The removed row held focus, so it lands on Add a site, not the page body.
				await until(
					async () =>
						(await page.locator(':focus').textContent()) === 'Add a site',
					'focus on Add a site',
				);
			} finally {
				await writeSources(page, {});
				await page.close();
			}
		},
	);
}

export async function backupsDialogCheck(env: Env, theme: Theme) {
	const {context, extensionId, axeSource} = env;
	await check(
		`Recovery: Backups opens a labelled dialog from the keyboard (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'options');
			try {
				await page.bringToFront();
				await setTheme(page, theme);
				const backUp = page.getByRole('button', {name: 'Back up now'});
				await backUp.click();
				await until(async () => backUp.isEnabled(), 'Back up now finished');
				const trigger = page.getByRole('button', {
					name: 'Backups',
					exact: true,
				});
				await trigger.focus();
				await page.keyboard.press('Enter');
				const dialog = page.getByRole('dialog', {name: 'Backups'});
				await dialog.waitFor();
				const rows = dialog
					.getByRole('list', {name: 'Backups'})
					.getByRole('listitem');
				await rows.first().waitFor();
				// Deleting a backup asks first, then offers Undo inside the dialog and moves focus to it.
				const before = await rows.count();
				await dialog
					.getByRole('button', {name: /^Delete the backup from/})
					.first()
					.focus();
				await page.keyboard.press('Enter');
				const ask = page.getByRole('alertdialog', {
					name: 'Delete this backup?',
				});
				await ask.getByRole('button', {name: 'Delete'}).focus();
				await page.keyboard.press('Enter');
				await ask.waitFor({state: 'hidden'});
				const undo = dialog.getByRole('button', {name: 'Undo'});
				await undo.waitFor();
				await until(
					async () => (await page.locator(':focus').textContent()) === 'Undo',
					'focus on Undo in the dialog',
				);
				await until(
					async () => (await rows.count()) === before - 1,
					'the backup is gone',
				);
				// Ctrl+Z runs it too, as it does for the page toast.
				await page.keyboard.press('Control+z');
				await dialog.getByText(/^Undone:/).waitFor();
				await until(
					async () => (await rows.count()) === before,
					'the backup is back',
				);
				// A confirmation opened inside the dialog hands focus back inside it, not to the page behind.
				await dialog.getByRole('button', {name: 'Clear snapshots'}).focus();
				await page.keyboard.press('Enter');
				const confirm = page.getByRole('alertdialog', {
					name: 'Clear all snapshots?',
				});
				await confirm.waitFor();
				await confirm.getByRole('button', {name: 'Cancel'}).focus();
				await page.keyboard.press('Enter');
				await confirm.waitFor({state: 'hidden'});
				await until(
					async () =>
						(await page.locator(':focus').textContent()) === 'Clear snapshots',
					'focus back on Clear snapshots',
				);
				const help = dialog.getByRole('button', {name: 'About backups'});
				await help.focus();
				await page.keyboard.press('Enter');
				await page.getByRole('dialog', {name: 'About backups'}).waitFor();
				await animationsDone(page);
				const violations = await axeViolationLines(page, axeSource);
				assert.deepEqual(violations, [], violations.join('\n'));
				// Escape closes the help first and leaves the Backups dialog open.
				await page.keyboard.press('Escape');
				await page
					.getByRole('dialog', {name: 'About backups'})
					.waitFor({state: 'hidden'});
				await dialog.waitFor();
				await dialog.getByRole('button', {name: 'Done'}).focus();
				await page.keyboard.press('Escape');
				await dialog.waitFor({state: 'hidden'});
				await until(
					async () =>
						(await page.locator(':focus').textContent()) === 'Backups',
					'focus back on Backups',
				);
			} finally {
				await page.close();
			}
		},
	);
}

/**
Every section the Settings page shows has a finder entry, every entry leads to a section that is there, and choosing
one from the palette opens Settings at it. Fails when a new Settings section is not added to settings-sections.ts.
*/
export async function settingsFinderCheck(env: Env) {
	const {context, extensionId} = env;
	await check('every Settings section is in the finder', async () => {
		const page = await openPage(context, extensionId, 'options');
		const manifest = JSON.parse(
			await readFile(fromRoot('shell/manifest.json'), 'utf8'),
		) as {short_name: string};
		const sections = page.locator('main [id^="settings-"]');
		await sections.first().waitFor();
		const rendered = await Promise.all(
			(await sections.all()).map(
				async (section) => (await section.getAttribute('id')) ?? '',
			),
		);
		await page.close();
		const entries = settingsSections(manifest.short_name, false);
		const targets = new Set(entries.map((entry) => entry.target ?? entry.id));
		assert.deepEqual(
			rendered.filter((id) => !targets.has(id)),
			[],
			'Settings sections with no finder entry (add them to src/app/settings-sections.ts)',
		);
		assert.deepEqual(
			[...targets].filter((id) => !rendered.includes(id)),
			[],
			'Finder entries that lead to no Settings section',
		);

		const palette = await openPage(context, extensionId, 'palette');
		await palette.keyboard.type('shared pages');
		const option = palette
			.getByRole('group', {name: 'Settings'})
			.getByRole('option', {name: /Shared pages/});
		await option.waitFor({timeout: 2000});
		await palette.screenshot({
			path: fromRoot('.dev/evidence/finder-settings-result.png'),
		});
		const opened = context.waitForEvent('page');
		await option.click();
		const settings = await opened;
		await settings.waitForLoadState();
		assert.match(settings.url(), /options\.html#settings-sync$/);
		await settings.close();
		await palette.close().catch(() => {});
	});
}
