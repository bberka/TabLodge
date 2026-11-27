import assert from 'node:assert/strict';
import {type Locator, type Page} from 'playwright';
import {type ExtensionApi, readDevStore, seed} from './fixtures.ts';
import {check, type Env, until} from './harness.ts';
import {openMenuByKeyboard, openPage} from './pages.ts';

async function askBeforeDeleting(page: Page, askFirst: boolean) {
	await page.evaluate(async (value) => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		await chrome.runtime.sendMessage({
			type: 'UPDATE_SETTINGS',
			settings: {askBeforeDeleting: value},
		});
	}, askFirst);
	await page.goto(page.url());
}

async function chooseByKeyboard(page: Page, trigger: Locator, item: string) {
	await openMenuByKeyboard(page, trigger);
	await page.getByRole('menuitem', {name: item, exact: true}).focus();
	await page.keyboard.press('Enter');
}

export async function askBeforeDeletingCheck(env: Env) {
	const {context, extensionId} = env;
	await check(
		'Ask before deleting asks by keyboard, and Cancel changes nothing',
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			try {
				await seed(page);
				await askBeforeDeleting(page, true);
				const before = await readDevStore(page);
				const counts = async () => {
					const store = await readDevStore(page);
					return [
						store.bookmarks.length,
						store.groups.length,
						store.bookmarkColumns.length,
					];
				};

				const unchanged = await counts();
				const [session] = before.groups;
				const [column] = before.bookmarkColumns;
				const bookmark = before.bookmarks.find(
					(entry) => entry.columnId === column.id,
				);
				assert.ok(session);
				assert.ok(bookmark);
				const targets = [
					{
						name: `Delete session “${session.name}”?`,
						trigger: page.locator(`#session-${session.id} [data-move-focus]`),
						item: 'Delete',
					},
					{
						name: `Delete bookmark “${bookmark.title}”?`,
						trigger: page
							.getByRole('button', {name: `Actions for ${bookmark.title}`})
							.first(),
						item: 'Delete',
					},
				];
				for (const {name, trigger, item} of targets) {
					await chooseByKeyboard(page, trigger, item);
					const dialog = page.getByRole('alertdialog', {name});
					await dialog.waitFor();
					await dialog.getByRole('button', {name: 'Cancel'}).press('Enter');
					await dialog.waitFor({state: 'detached'});
					assert.deepEqual(await counts(), unchanged);
					const label = await trigger.getAttribute('aria-label');
					await until(
						async () =>
							(await page.locator(':focus').getAttribute('aria-label')) ===
							label,
						`focus back on the menu button after ${name}`,
					);
				}

				const [target] = targets;
				await chooseByKeyboard(page, target.trigger, target.item);
				await page
					.getByRole('alertdialog')
					.getByRole('button', {name: 'Delete'})
					.press('Enter');
				await until(
					async () => (await counts())[1] === unchanged[1] - 1,
					'the confirmed session to go',
				);
				await page.getByRole('button', {name: 'Undo'}).press('Enter');
				await until(
					async () => (await counts())[1] === unchanged[1],
					'Undo to restore it',
				);
			} finally {
				await askBeforeDeleting(page, false);
				await page.close();
			}
		},
	);
}
