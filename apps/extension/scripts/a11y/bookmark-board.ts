import assert from 'node:assert/strict';
import {type Page} from 'playwright';
import {captureEvidence} from './evidence.ts';
import {
	createDevFixture,
	readDevStore,
	seed,
	writeDevStore,
} from './fixtures.ts';
import {check, type Env, type Theme, until} from './harness.ts';
import {
	attributes,
	axeViolationLines,
	focusedLabel,
	openMenuItemByKeyboard,
	openPage,
	selectQuickActions,
	setTheme,
} from './pages.ts';

async function assertBookmarkQuickActions(
	page: Page,
	labels: string[],
	bookmarkTitle: string,
	viewportWidth: number,
) {
	for (const label of labels) {
		const action = page.getByRole('button', {
			name: `${label}: ${bookmarkTitle}`,
			exact: true,
		});
		assert.equal(
			await action.count(),
			1,
			`${label} appears beside ${bookmarkTitle}`,
		);
		assert.equal(await action.isVisible(), true, `${label} is visible`);
		const bounds = await action.boundingBox();
		assert.ok(bounds);
		assert.ok(bounds.x >= 0, `${label} is within the left edge`);
		assert.ok(
			bounds.x + bounds.width <= viewportWidth,
			`${label} is within the right edge at ${viewportWidth}px`,
		);
	}
}

async function seedQuickActions(page: Page, actions: string[]) {
	const fixture = createDevFixture(await readDevStore(page));
	fixture.settings = {...fixture.settings, bookmarkQuickActions: actions};
	await writeDevStore(page, fixture);
	await until(
		async () =>
			JSON.stringify(
				(await readDevStore(page)).settings.bookmarkQuickActions,
			) === JSON.stringify(actions),
		'quick actions to reach the worker state',
	);
}

const MOUNTED_ROWS_LIMIT = 40;

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

export async function bookmarkQuickActionsCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`bookmark quick actions work by pointer and keyboard (${theme})`,
		async () => {
			const quickActionSeedPage = await openPage(
				context,
				extensionId,
				'newtab',
			);
			await seedQuickActions(quickActionSeedPage, ['open-new']);
			await quickActionSeedPage.close();

			const settingsPage = await openPage(context, extensionId, 'options');
			await setTheme(settingsPage, theme);
			const trigger = settingsPage.getByRole('button', {
				name: 'Quick actions on bookmarks: Open in new tab',
				exact: true,
			});
			await trigger.waitFor();
			await trigger.focus();
			await settingsPage.keyboard.press('Enter');
			const menu = settingsPage.getByRole('dialog', {
				name: 'Quick actions on bookmarks',
			});
			await menu.waitFor();
			await captureEvidence(
				settingsPage,
				`bookmark-quick-actions-settings-${theme}.png`,
				menu,
			);
			assert.equal(
				await menu
					.getByRole('button', {name: 'Remove Open in new tab'})
					.count(),
				1,
			);

			for (const action of ['Copy link', 'Delete']) {
				const item = menu.getByRole('button', {
					name: `Add ${action}`,
					exact: true,
				});
				await until(
					async () => (await item.count()) === 1,
					`${action} quick action option to appear`,
				);
				await item.focus();
				await settingsPage.keyboard.press('Enter');
				await until(
					async () => (await item.count()) === 0,
					`${action} quick action to be selected`,
				);
			}

			const deletionOption = menu.getByRole('button', {
				name: 'Remove Delete',
			});
			await deletionOption.focus();
			await settingsPage.keyboard.press('Enter');
			await until(
				async () => (await deletionOption.count()) === 0,
				'Delete quick action to clear by keyboard',
			);
			const actionButton = menu.getByRole('button', {
				name: 'Add Delete',
			});
			await actionButton.focus();
			await settingsPage.keyboard.press('Enter');
			await until(
				async () => (await actionButton.count()) === 0,
				'Delete quick action to select by keyboard',
			);

			const fourth = menu.getByRole('button', {
				name: 'Add Edit',
				exact: true,
			});
			await until(
				async () => fourth.isDisabled(),
				'a fourth action is disabled while three are selected',
			);
			await until(
				async () =>
					JSON.stringify(
						(await readDevStore(settingsPage)).settings.bookmarkQuickActions,
					) === JSON.stringify(['open-new', 'copy', 'delete']),
				'quick actions to save from Settings',
			);
			await settingsPage.keyboard.press('Escape');
			assert.equal(
				await settingsPage
					.getByRole('button', {
						name: 'Quick actions on bookmarks: 3 selected',
						exact: true,
					})
					.count(),
				1,
			);
			await settingsPage.close();

			const board = await openPage(context, extensionId, 'newtab');
			await board.setViewportSize({width: 480, height: 900});
			await setTheme(board, theme);
			await assertBookmarkQuickActions(
				board,
				['Open in new tab', 'Copy link', 'Delete'],
				'Gmail',
				480,
			);

			const copy = board.getByRole('button', {
				name: 'Copy link: Gmail',
				exact: true,
			});
			await copy.focus();
			await board.keyboard.press('Enter');
			await until(
				async () =>
					(await board.evaluate(() =>
						(
							navigator as Navigator & {
								clipboard: {readText: () => Promise<string>};
							}
						).clipboard.readText(),
					)) === 'https://mail.google.com/',
				'copy quick action to write the bookmark URL',
			);

			const remove = board.getByRole('button', {
				name: 'Delete: Gmail',
				exact: true,
			});
			await remove.focus();
			await board.keyboard.press('Enter');
			assert.equal(
				await board.getByRole('dialog').count(),
				0,
				'Delete runs without a confirmation dialog',
			);
			const undo = board.getByRole('button', {
				name: 'Undo',
				exact: true,
			});
			await undo.waitFor();
			assert.equal(
				await board.locator('[data-bookmark-title="Gmail"]').count(),
				0,
				'bookmark is removed right away',
			);
			await undo.focus();
			await board.keyboard.press('Enter');
			await until(
				async () =>
					(await board.locator('[data-bookmark-title="Gmail"]').count()) === 1,
				'Undo to restore the bookmark from the trash',
			);
			await seedQuickActions(board, ['open-new']);
			await board.close();
		},
	);
}

export async function bookmarkMenuQuickActionsCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`bookmark menu actions are available as quick actions (${theme})`,
		async () => {
			const quickActionSeed = await openPage(context, extensionId, 'newtab');
			await seedQuickActions(quickActionSeed, ['open-new']);
			await quickActionSeed.close();

			const options = await openPage(context, extensionId, 'options');
			await setTheme(options, theme);
			const trigger = options.getByRole('button', {
				name: 'Quick actions on bookmarks: Open in new tab',
				exact: true,
			});
			await trigger.focus();
			await options.keyboard.press('Enter');
			const menu = options.getByRole('dialog', {
				name: 'Quick actions on bookmarks',
			});
			await selectQuickActions(
				options,
				menu,
				['Move to column…', 'Move down'],
				'bookmark',
			);

			const fourthAction = menu.getByRole('button', {
				name: 'Add Move up',
				exact: true,
			});
			await until(
				async () => fourthAction.isDisabled(),
				'a fourth bookmark action is disabled when three are selected',
			);
			const moveDownAction = menu.getByRole('button', {
				name: 'Move Move down up',
			});
			await moveDownAction.focus();
			await options.keyboard.press('Enter');
			await until(async () => {
				const {settings} = await readDevStore(options);
				return (
					JSON.stringify(settings.bookmarkQuickActions) ===
					JSON.stringify(['open-new', 'move-down', 'move'])
				);
			}, 'reordered quick actions to save in Settings');
			await options.close();

			const board = await openPage(context, extensionId, 'newtab');
			await board.setViewportSize({width: 480, height: 900});
			await setTheme(board, theme);
			const gmail = board.locator('[data-bookmark-title="Gmail"]');
			const calendar = board.locator('[data-bookmark-title="Calendar"]');
			await assertBookmarkQuickActions(
				board,
				['Open in new tab', 'Move down', 'Move to column…'],
				'Gmail',
				480,
			);

			await captureEvidence(
				board,
				`bookmark-quick-actions-move-${theme}.png`,
				gmail,
			);

			const moveDown = board.getByRole('button', {
				name: 'Move down: Gmail',
				exact: true,
			});
			await moveDown.focus();
			await board.keyboard.press('Enter');
			await until(async () => {
				const [gmailBounds, calendarBounds] = await Promise.all([
					gmail.boundingBox(),
					calendar.boundingBox(),
				]);
				return Boolean(
					gmailBounds && calendarBounds && gmailBounds.y > calendarBounds.y,
				);
			}, 'Move down to reorder Gmail below Calendar');
			await until(
				async () => (await focusedLabel(board)) === 'Actions for Gmail',
				'focus to return to the bookmark menu after moving',
			);

			const moveTo = board.getByRole('button', {
				name: 'Move to column…: Gmail',
				exact: true,
			});
			assert.equal(await moveTo.isEnabled(), true);
			await moveTo.focus();
			assert.equal(await focusedLabel(board), 'Move to column…: Gmail');
			await board.keyboard.press('Enter');
			const moveDialog = board.getByRole('dialog');
			await moveDialog.waitFor();
			await moveDialog
				.getByRole('heading', {name: 'Move bookmark to', exact: true})
				.waitFor();
			await moveDialog.getByRole('button', {name: 'Cancel'}).click();
			await moveDialog.waitFor({state: 'hidden'});

			const reset = createDevFixture(await readDevStore(board));
			reset.settings = {
				...reset.settings,
				bookmarkQuickActions: ['open-new'],
			};
			await writeDevStore(board, reset);
			await board.close();
		},
	);
}

export async function columnCapCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`bookmark columns cap long lists and scroll by keyboard (${theme})`,
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
			await until(
				async () => (await cards.count()) > 0,
				'bookmarks in the capped column',
			);
			assert.ok(
				(await cards.count()) <= MOUNTED_ROWS_LIMIT,
				'a capped column mounts only the rows near its viewport',
			);
			assert.equal(
				await column.getByRole('button', {name: /^Show \d+ more$/}).count(),
				0,
				'a capped column scrolls instead of asking to load more',
			);
			const columnBody = column.locator('[role="region"]');
			await columnBody.focus();
			await board.keyboard.press('PageDown');
			await until(
				async () =>
					(await columnBody.evaluate(
						(element) => (element as {scrollTop: number}).scrollTop,
					)) > 0,
				'the capped column to scroll by keyboard',
			);
			await until(async () => {
				await columnBody.evaluate((element) => {
					(element as {scrollTop: number}).scrollTop = 1e9;
				});
				return (
					(await column
						.locator('[data-bookmark-id="bookmark-limit-65"]')
						.count()) > 0
				);
			}, 'the last bookmark to appear as the column scrolls to its end');
			assert.ok(
				(await cards.count()) <= MOUNTED_ROWS_LIMIT,
				'rows leave the page again as the column scrolls',
			);
			await board.screenshot({
				path: `.dev/evidence/bookmark-limit-${theme}.png`,
			});
			await board.close();

			const resetPage = await openPage(context, extensionId, 'newtab');
			await seed(resetPage);
			await resetPage.close();
		},
	);
}

export async function focusViewCheck(env: Env, theme: Theme) {
	const {context, extensionId, axeSource} = env;
	await check(
		`bookmark Focus view switches columns by keyboard (${theme})`,
		async () => {
			const setupPage = await openPage(context, extensionId, 'newtab');
			await seed(setupPage);
			const fixture = createDevFixture(await readDevStore(setupPage));
			fixture.settings = {
				...fixture.settings,
				bookmarkBoardView: 'board',
				limitBookmarksPerColumn: true,
				bookmarkColumnPageSize: 16,
			};
			await writeDevStore(setupPage, fixture);
			await setupPage.close();

			const page = await openPage(context, extensionId, 'newtab');
			await setTheme(page, theme);
			await page.setViewportSize({width: 1440, height: 900});

			const focusButton = page.getByRole('button', {
				name: 'Switch to Focus view',
				exact: true,
			});
			await focusButton.focus();
			await page.keyboard.press('Enter');

			const rail = page.getByRole('navigation', {
				name: 'Bookmark columns',
			});
			await rail.waitFor({timeout: 5000});
			assert.equal(
				await page
					.getByRole('button', {
						name: 'Switch to Board view',
						exact: true,
					})
					.count(),
				1,
				'the view button switches to the Board action',
			);

			const all = rail.getByRole('button', {name: /^All/});
			const daily = rail.getByRole('button', {name: /^Daily/});
			const dev = rail.getByRole('button', {name: /^Dev/});
			assert.equal(
				await all.getAttribute('aria-current'),
				'true',
				'the All item is open first',
			);
			assert.ok(
				(await page.getByRole('region', {name: 'All bookmarks'}).count()) > 0,
				'the All panel lists every bookmark',
			);
			await daily.focus();
			await page.keyboard.press('Enter');
			assert.equal(await daily.getAttribute('aria-current'), 'true');

			await dev.focus();
			await page.keyboard.press('Enter');
			await until(
				async () =>
					(await page
						.locator('#focus-column-panel header h3')
						.textContent()) === 'Dev',
				'the Dev column to open',
			);
			assert.equal(await dev.getAttribute('aria-current'), 'true');
			assert.equal(await daily.getAttribute('aria-current'), null);

			const region = page.getByRole('region', {name: 'Dev bookmarks'});
			await region.waitFor();
			assert.equal(await region.getAttribute('tabindex'), '0');
			assert.ok(
				(
					await page
						.locator('nav[aria-label="Bookmark columns"] + [role="status"]')
						.textContent()
				)?.includes('Showing Dev'),
			);

			await dev.click({button: 'right'});
			const railMenu = page.getByRole('menu');
			await railMenu.waitFor();
			assert.equal(
				await railMenu
					.getByRole('menuitem', {name: 'Edit column', exact: true})
					.count(),
				1,
				'the rail column opens the same column menu on right click',
			);
			// The rail is a vertical list, so a column moves up or down, not left or right.
			assert.equal(
				await railMenu
					.getByRole('menuitem', {name: /^Move (up|down)$/})
					.count(),
				2,
				'the rail column menu moves a column up or down',
			);
			assert.equal(
				await railMenu
					.getByRole('menuitem', {name: /^Move (left|right)$/})
					.count(),
				0,
				'the rail column menu has no left or right',
			);
			await page.keyboard.press('Escape');
			await railMenu.waitFor({state: 'hidden'});

			const violations = await axeViolationLines(page, axeSource);
			assert.deepEqual(violations, [], 'Focus view should pass axe');

			await until(
				async () =>
					(await readDevStore(page)).settings.bookmarkBoardView === 'focus',
				'the Focus view setting to save',
			);
			const reset = createDevFixture(await readDevStore(page));
			reset.settings = {
				...reset.settings,
				bookmarkBoardView: 'board',
				limitBookmarksPerColumn: true,
				bookmarkColumnPageSize: 16,
			};
			await writeDevStore(page, reset);
			await page.close();
		},
	);
}

export async function boardLayoutCheck(env: Env, theme: Theme) {
	const {context, extensionId, axeSource} = env;
	await check(
		`bookmark board layout settings change by keyboard (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'options');
			await setTheme(page, theme);
			const layout = [
				['Bookmark column width', 'Wide', 'bookmarkColumnWidth', 'wide'],
				['Columns per row', '2 columns', 'bookmarkColumnsPerRow', 2],
				['Bookmark density', 'Compact', 'bookmarkDensity', 'compact'],
			] as const;
			for (const [label, option, key, value] of layout) {
				const select = page.getByRole('combobox', {
					name: label,
					exact: true,
				});
				await select.focus();
				await page.keyboard.press('Space');
				await page.getByRole('option', {name: option, exact: true}).click();
				await until(
					async () => (await readDevStore(page)).settings[key] === value,
					`${label} to save`,
				);
				// The menu hands focus back after its close animation, so wait for it.
				await until(
					async () =>
						(await page.locator(':focus').getAttribute('aria-label')) === label,
					`focus to return to ${label}`,
				);
			}

			const violations = await axeViolationLines(page, axeSource);
			assert.deepEqual(violations, [], 'layout settings should pass axe');
			const reset = createDevFixture(await readDevStore(page));
			reset.settings = {
				...reset.settings,
				bookmarkColumnWidth: 'default',
				bookmarkColumnsPerRow: 0,
				bookmarkDensity: 'comfortable',
			};
			await writeDevStore(page, reset);
			await page.close();
		},
	);
}

export async function statisticsCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`Statistics opens by keyboard, lists tabs and returns focus (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'options');
			await setTheme(page, theme);
			const opener = page.getByRole('button', {name: 'View', exact: true});
			await opener.focus();
			await page.keyboard.press('Enter');
			const dialog = page.getByRole('dialog', {name: 'Statistics'});
			await dialog.waitFor();
			await dialog.getByRole('heading', {name: 'Open now'}).waitFor();
			await dialog.getByRole('term').filter({hasText: 'Open tabs'}).waitFor();
			assert.ok(
				(await dialog.getByRole('list').count()) <= 1,
				'one tab list at most',
			);
			await page.keyboard.press('Escape');
			await dialog.waitFor({state: 'hidden'});
			await until(
				async () => (await page.locator(':focus').innerText()) === 'View',
				'focus returns to the View button',
			);
			await page.close();
		},
	);
}

export async function duplicateBookmarksCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`duplicate bookmarks dialog works by keyboard (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			const store = createDevFixture(await readDevStore(page));
			const columnId = store.bookmarkColumns[0].id;
			const extra = (id: string, createdAt: number) => ({
				id,
				title: `Copy ${id}`,
				url: 'https://dup.example/page',
				columnId,
				createdAt,
				updatedAt: createdAt,
			});
			store.bookmarks = [extra('one', 1), extra('two', 2), extra('three', 3)];
			await writeDevStore(page, store);
			await page.reload();
			await setTheme(page, theme);
			const trigger = page.getByRole('button', {
				name: 'Import, back up and share bookmarks',
			});
			await openMenuItemByKeyboard(page, trigger, 'Find duplicate bookmarks');
			const dialog = page.getByRole('dialog', {
				name: 'Find duplicate bookmarks',
			});
			await dialog.waitFor();
			const group = dialog.getByRole('radiogroup', {
				name: 'dup.example/page',
			});
			assert.equal(await group.getByRole('radio').count(), 3);
			assert.equal(
				await group.getByRole('radio', {name: /Copy one/}).isChecked(),
				true,
				'the oldest copy is kept by default',
			);
			await group.getByRole('radio', {name: /Copy one/}).focus();
			await page.keyboard.press('ArrowDown');
			assert.equal(
				await group.getByRole('radio', {name: /Copy two/}).isChecked(),
				true,
				'arrow keys change the copy to keep',
			);
			await page.keyboard.press('Escape');
			await dialog.waitFor({state: 'hidden'});
			await until(
				async () =>
					(await page.locator(':focus').getAttribute('aria-label')) ===
					'Import, back up and share bookmarks',
				'focus returns to the bookmark menu button',
			);
			await openMenuItemByKeyboard(page, trigger, 'Find duplicate bookmarks');
			await dialog.waitFor();
			await dialog.getByRole('button', {name: 'Remove 2 extra copies'}).focus();
			await page.keyboard.press('Enter');
			await dialog.waitFor({state: 'hidden'});
			await until(
				async () =>
					(await page.locator('[data-bookmark-title^="Copy "]').count()) === 1,
				'the extra copies to be removed',
			);
			const undo = page.getByRole('button', {name: 'Undo', exact: true});
			await undo.focus();
			await page.keyboard.press('Enter');
			await until(
				async () =>
					(await page.locator('[data-bookmark-title^="Copy "]').count()) === 3,
				'Undo to restore the copies',
			);
			await openMenuItemByKeyboard(page, trigger, 'Find duplicate bookmarks');
			await dialog.waitFor();
			await dialog.getByRole('button', {name: 'Cancel'}).waitFor();
			await page.keyboard.press('Escape');
			await page.close();
		},
	);
}

export async function bookmarkMoveCheck(env: Env) {
	const {context, extensionId} = env;
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
}

export async function columnMoveCheck(env: Env) {
	const {context, extensionId} = env;
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
}

export async function bookmarkAddToSessionCheck(env: Env) {
	const {context, extensionId} = env;
	await check('a bookmark is added to a session from its menu', async () => {
		const page = await openPage(context, extensionId, 'newtab');
		const trigger = page
			.locator('[data-bookmark-id] [data-move-focus]')
			.first();
		await trigger.focus();
		await page.keyboard.press('Enter');
		await page.getByRole('menuitem', {name: 'Add to session…'}).focus();
		await page.keyboard.press('Enter');
		const dialog = page.getByRole('dialog', {name: 'Add to session'});
		await dialog.waitFor();
		await page.keyboard.type('Archived example');
		await dialog.getByText('No session matches.').first().waitFor();
		assert.equal(
			await dialog.getByRole('option').count(),
			0,
			'archived sessions should not be targets for adding bookmarks',
		);
		await page.keyboard.press('Control+a');
		await page.keyboard.type('Home lab');
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
}

async function seedBookmarkGrid(
	page: Page,
	columnCount: number,
	perColumn: number,
	view: 'board' | 'focus',
) {
	const fixture = createDevFixture(await readDevStore(page));
	fixture.bookmarkColumns = Array.from({length: columnCount}, (_, index) => ({
		id: `grid-column-${index}`,
		name: `Grid column ${index + 1}`,
		createdAt: index,
		isDefault: index === 0,
	}));
	fixture.bookmarks = Array.from(
		{length: columnCount * perColumn},
		(_, index) => ({
			id: `grid-bookmark-${index}`,
			title: `Grid bookmark ${index}`,
			url: `https://example.com/grid-${index}`,
			columnId: `grid-column-${Math.floor(index / perColumn)}`,
			createdAt: index,
			updatedAt: index,
		}),
	);
	fixture.settings = {
		...fixture.settings,
		limitBookmarksPerColumn: true,
		bookmarkBoardView: view,
	};
	await writeDevStore(page, fixture);
}

export async function rowWindowCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`10,000 bookmarks mount a bounded number of rows (${theme})`,
		async () => {
			for (const [columns, perColumn, view] of [
				[1, 10_000, 'focus'],
				[100, 100, 'board'],
				[100, 100, 'focus'],
			] as const) {
				const seedPage = await openPage(context, extensionId, 'newtab');
				await seedBookmarkGrid(seedPage, columns, perColumn, view);
				await seedPage.close();
				const board = await openPage(context, extensionId, 'newtab');
				await setTheme(board, theme);
				await board.locator('[data-bookmark-id]').first().waitFor();
				const mounted = await board.locator('[data-bookmark-id]').count();
				assert.ok(
					mounted <= MOUNTED_ROWS_LIMIT * (view === 'board' ? 6 : 1),
					`${columns} columns of ${perColumn} in ${view} view mounted ${mounted} rows`,
				);
				await board.close();
			}

			const resetPage = await openPage(context, extensionId, 'newtab');
			await seed(resetPage);
			await resetPage.close();
		},
	);
}

export async function sessionLinksWindowCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`an expanded session of 1,000 links mounts a bounded number of rows (${theme})`,
		async () => {
			const seedPage = await openPage(context, extensionId, 'newtab');
			const fixture = createDevFixture(await readDevStore(seedPage));
			fixture.groups = [
				{
					...fixture.groups[0],
					id: 'long-session',
					name: 'Long session',
					tabs: Array.from({length: 1000}, (_, index) => ({
						...fixture.groups[0].tabs[0],
						id: `long-tab-${index}`,
						title: `Long session link ${index}`,
						url: `https://example.com/long-${index}`,
						originalIndex: index,
					})),
				},
			];
			await writeDevStore(seedPage, fixture);
			await seedPage.close();

			const page = await openPage(context, extensionId, 'newtab');
			await setTheme(page, theme);
			const card = page.locator('#session-long-session');
			await card.waitFor();
			await card.getByRole('button', {expanded: false}).first().click();
			const region = card.getByRole('region', {name: 'Links in Long session'});
			await region.waitFor();
			await page.locator('[data-tab-id]').first().waitFor();
			const rows = page.locator('[data-tab-id]');
			assert.ok(
				(await rows.count()) <= MOUNTED_ROWS_LIMIT,
				'an expanded session mounts only the links near its viewport',
			);
			const box = await region.boundingBox();
			assert.ok(box, 'the link list has a box');
			assert.ok(
				box.height <= 44 * 16 + 1,
				'the link list stops at its maximum height and scrolls inside the card',
			);
			await until(async () => {
				await region.evaluate((element) => {
					(element as {scrollTop: number}).scrollTop = 1e9;
				});
				return (await page.locator('[data-tab-id="long-tab-999"]').count()) > 0;
			}, 'the last link to appear as the session scrolls to its end');
			assert.ok(
				(await rows.count()) <= MOUNTED_ROWS_LIMIT,
				'links leave the page again as the session scrolls',
			);
			await page.close();

			const resetPage = await openPage(context, extensionId, 'newtab');
			await seed(resetPage);
			await resetPage.close();
		},
	);
}
