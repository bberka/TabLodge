import assert from 'node:assert/strict';
import {type BrowserContext, type Locator} from 'playwright';
import {type ExtensionApi} from './fixtures.ts';
import {
	check,
	type Env,
	type Theme,
	THEMES,
	until,
	watchConsole,
} from './harness.ts';
import {openPage, setTheme} from './pages.ts';

// The popup is opened as a tab here, so its own tab would be the active one. The first read of the active tab
// reports `activeUrl` as the page the popup was opened over.
async function openPopupOver(
	context: BrowserContext,
	extensionId: string,
	activeUrl: string,
) {
	const page = await context.newPage();
	watchConsole(page, 'popup page');
	await page.addInitScript((url) => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		const query = chrome.tabs.query.bind(chrome.tabs);
		let first = true;
		chrome.tabs.query = async (info) => {
			if (first && info.active && info.lastFocusedWindow) {
				first = false;
				return [{id: 1, url, active: true}];
			}

			return query(info);
		};
	}, activeUrl);
	await page.setViewportSize({width: 380, height: 560});
	await page.goto(`chrome-extension://${extensionId}/popup.html`);
	await page.waitForLoadState('networkidle');
	return page;
}

/**
Types a note into a bookmark form's Notes field, which stays one row tall until it is focused or holds text.
*/
async function typeNote(field: Locator, note: string) {
	assert.equal(await field.getAttribute('rows'), '1', 'Notes starts collapsed');
	// A column select that just closed hands focus back to its trigger a moment later, which can take focus off
	// Notes again. Focus it until it keeps focus and has opened.
	const page = field.page();
	await until(
		async () => (await page.locator('[role="listbox"]').count()) === 0,
		'the column select to close',
	);
	await until(async () => {
		if ((await field.and(page.locator(':focus')).count()) === 0) {
			await field.focus();
		}

		return (await field.getAttribute('rows')) === '3';
	}, 'Notes to open on focus');
	await field.pressSequentially(note);
}

export async function popupUnsavablePageCheck(env: Env) {
	const {context, extensionId} = env;
	await check(
		'toolbar popup disables page buttons on unsavable pages',
		async () => {
			const popup = await openPopupOver(
				context,
				extensionId,
				'chrome://newtab/',
			);
			for (const name of ['Bookmark this page', 'Add this page to a session']) {
				const button = popup.getByRole('button', {name, exact: true});
				assert.equal(await button.isDisabled(), true, `${name} is disabled`);
				assert.equal(
					await button.getAttribute('aria-describedby'),
					'page-unsavable',
				);
			}

			assert.equal(
				await popup.locator('#page-unsavable').textContent(),
				'This page cannot be saved.',
			);
			await popup.close();
		},
	);
}

export async function popupNewColumnCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
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
			const popup = await openPopupOver(context, extensionId, url);
			await setTheme(popup, theme);
			const name = `Popup ${theme}`;
			for (const save of [false, true]) {
				await webPage.bringToFront();
				await popup
					.getByRole('button', {name: 'Bookmark this page', exact: true})
					.press('Enter');
				const dialog = popup.getByRole('dialog');
				await dialog.getByText('Popup bookmark test', {exact: true}).waitFor();
				await dialog.getByRole('combobox').press('Space');
				await popup
					.getByRole('option', {name: 'New column', exact: true})
					.press('Enter', {timeout: 2000});
				await dialog.getByRole('textbox', {name: 'New column name'}).fill(name);
				const note = `Popup note ${theme}`;
				await typeNote(dialog.getByRole('textbox', {name: 'Notes'}), note);
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
					const card = column
						.locator('[data-bookmark-id]')
						.filter({has: board.locator(`a[href="${url}"]`)});
					assert.equal(await card.count(), 1);
					assert.match(await card.innerText(), new RegExp(note));
				} else {
					assert.equal(await column.count(), 0, 'Cancel creates no column');
				}

				await board.close();
			}

			await popup.close();
			await webPage.close();
		},
	);
}

export async function addBookmarkNewColumnCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
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
				await page.getByRole('textbox', {name: 'New column name'}).fill(name);
				const note = `${entry} note ${theme}`;
				await typeNote(page.getByRole('textbox', {name: 'Notes'}), note);
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
				const card = column
					.locator('[data-bookmark-id]')
					.filter({has: board.locator(`a[href="${url}"]`)});
				await card.waitFor();
				assert.equal(await card.count(), 1);
				assert.match(await card.innerText(), new RegExp(note));
				await board.close();
				if (!page.isClosed()) {
					await page.close();
				}
			},
		);
	}
}

export async function archivedHiddenCheck(env: Env) {
	const {context, extensionId} = env;
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
					await sidepanel.getByText('Archived example', {exact: true}).count(),
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
}
