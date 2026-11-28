import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import process from 'node:process';
import {type Page} from 'playwright';
import {fromRoot} from '../vite-shared.ts';
import {
	captureEvidence,
	captureViewports,
	EVIDENCE_VIEWPORTS,
} from './evidence.ts';
import {
	closeServer,
	countTabs,
	createDevFixture,
	type ExtensionApi,
	groupFolderId,
	readDevStore,
	seed,
	sessionUrls,
	startPageServer,
	writeDevStore,
} from './fixtures.ts';
import {check, type Env, type Theme, THEMES, until} from './harness.ts';
import {
	attributes,
	axeViolationLines,
	focusedLabel,
	openMenuByKeyboard,
	openPage,
	setTheme,
} from './pages.ts';

export async function sessionMoveCheck(env: Env) {
	const {context, extensionId} = env;
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
}

export async function sessionArchiveCheck(env: Env) {
	const {context, extensionId, axeSource} = env;
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
				await openMenuByKeyboard(page, trigger);
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
				assert.ok(archiveClasses?.split(/\s+/).includes('text-amber-700'));
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

				await openMenuByKeyboard(page, trigger);
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
				await openMenuByKeyboard(page, archivedTrigger);
				assert.equal(
					await page.getByRole('menuitem', {name: 'Archive session'}).count(),
					0,
					'already archived sessions should not offer Archive session',
				);
				await page.getByRole('menuitem', {name: 'Move to folder…'}).focus();
				await page.keyboard.press('Enter');
				await page.keyboard.type('Work');
				await page.keyboard.press('Enter');
				await until(
					async () => (await groupFolderId(page, sessionId)) === 'folder-work',
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
}

export async function sessionFolderMoveFocusCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`moving a session out of its folder keeps focus off the next session (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await setTheme(page, theme);
			const fixture = createDevFixture(await readDevStore(page));
			const moved = fixture.groups.find(
				(group) => group.id === 'dev-session-1',
			);
			assert.ok(moved, 'the fixture needs a session to move');
			moved.folderId = 'folder-work';
			await writeDevStore(page, fixture);
			await page.reload();

			await page.locator('[data-session-folder-chip="folder-work"]').click();
			const movedCard = page.locator('#session-dev-session-1');
			const nextCard = page.locator('#session-dev-session-2');
			await movedCard.waitFor();
			await nextCard.waitFor();
			const trigger = movedCard.locator('[data-move-focus]');
			await openMenuByKeyboard(page, trigger);
			await page.getByRole('menuitem', {name: 'Move to folder…'}).focus();
			await page.keyboard.press('Enter');
			await page.keyboard.type('Trips');
			await page.keyboard.press('Enter');

			await until(
				async () =>
					(await groupFolderId(page, 'dev-session-1')) === 'folder-trips',
				'session to move to Trips',
			);
			await until(
				async () => (await movedCard.count()) === 0,
				'session to leave Work',
			);
			await until(
				async () =>
					(await page
						.locator(':focus')
						.getAttribute('data-session-folder-chip')) === 'folder-trips',
				'focus to move to the destination folder',
			);
			await page.waitForTimeout(800);
			assert.equal(
				await nextCard.locator(':focus-within').count(),
				0,
				'the next session must not receive focus',
			);
			assert.equal(
				await page
					.getByRole('tooltip', {
						name: 'Show tabs in Quarterly planning',
					})
					.count(),
				0,
				'the next session tooltip must not appear after the move',
			);
			await page.close();
		},
	);
}

export async function longFolderListCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`a long folder list stays windowed and reveals the folder in use (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await setTheme(page, theme);
			const original = await readDevStore(page);
			const fixture = createDevFixture(original);
			const template = fixture.folders.find(
				(folder) => folder.id === 'folder-work',
			);
			assert.ok(template, 'the fixture needs the Work folder');
			fixture.folders = [
				...fixture.folders,
				...Array.from({length: 100}, (_, index) => ({
					...template,
					id: `folder-long-${index}`,
					name: `Long folder ${index}`,
				})),
			];
			const moved = fixture.groups.find(
				(group) => group.id === 'dev-session-1',
			);
			assert.ok(moved, 'the fixture needs a session to move');
			moved.folderId = 'folder-work';
			await writeDevStore(page, fixture);
			await page.reload();

			const folders = page.getByRole('navigation', {name: 'Session folders'});
			const chip = (id: string) =>
				folders.locator(`[data-session-folder-chip="${id}"]`);
			await chip('folder-work').click();
			assert.ok(
				(await folders.locator('[data-session-folder-chip]').count()) < 50,
				'only the folders near the visible area should be mounted',
			);
			assert.equal(await chip('folder-long-90').count(), 0);

			const list = folders.locator('[data-radix-scroll-area-viewport]');
			const focusedFolder = () =>
				page.locator(':focus').getAttribute('data-session-folder-chip');
			const newFolder = folders.getByRole('button', {name: 'New folder'});
			const listedIds = () =>
				folders
					.locator('[data-session-folder-chip]')
					.evaluateAll((nodes: Array<{dataset: Record<string, string>}>) =>
						nodes.map((node) => node.dataset.sessionFolderChip),
					);
			await newFolder.focus();
			await page.keyboard.press('Shift+Tab');
			const lastId = await focusedFolder();
			assert.equal(lastId, (await listedIds()).at(-1));
			assert.ok(lastId, 'a folder should have focus');
			const focusedRow = () =>
				page
					.locator(':focus')
					.evaluate((node: {parentElement: {dataset: {index?: string}}}) =>
						Number(node.parentElement.dataset.index),
					);
			const lastRow = await focusedRow();
			assert.ok(lastRow >= 100, 'the last folder should be the last row');
			for (let back = 1; back <= 20; back += 1) {
				await page.keyboard.press('Shift+Tab');
				assert.equal(
					await focusedRow(),
					lastRow - back,
					'Shift+Tab must visit every folder in order',
				);
			}

			await chip('all').focus();
			await page.keyboard.press('Shift+Tab');
			assert.equal(
				await focusedFolder(),
				null,
				'Shift+Tab must leave the list',
			);
			await list.evaluate((node: {scrollTop: number; scrollHeight: number}) => {
				node.scrollTop = node.scrollHeight;
			});
			await page.keyboard.press('Tab');
			assert.equal(await focusedFolder(), 'all');
			await page.keyboard.press('Tab');
			assert.equal(await focusedFolder(), (await listedIds())[1]);
			await chip(lastId).focus();
			await page.keyboard.press('Tab');
			assert.ok(
				await newFolder.evaluate((node: {matches: (s: string) => boolean}) =>
					node.matches(':focus'),
				),
				'Tab must leave the list after the last folder',
			);

			const distanceFromEnd = await list.evaluate(
				async (node: {
					scrollTop: number;
					scrollHeight: number;
					clientHeight: number;
				}) => {
					node.scrollTop = node.scrollHeight;
					await new Promise((resolve) => {
						setTimeout(resolve, 500);
					});
					return node.scrollHeight - node.clientHeight - node.scrollTop;
				},
			);
			assert.ok(
				distanceFromEnd < 2,
				'scrolling away from the focused folder must not snap back',
			);
			await list.evaluate((node: {scrollTop: number}) => {
				node.scrollTop = 0;
			});
			await until(
				async () => (await chip('folder-long-90').count()) === 0,
				'the destination folder to be unmounted before the move',
			);

			const card = page.locator('#session-dev-session-1');
			await openMenuByKeyboard(page, card.locator('[data-move-focus]'));
			await page.getByRole('menuitem', {name: 'Move to folder…'}).focus();
			await page.keyboard.press('Enter');
			await page.keyboard.type('Long folder 90');
			await page.keyboard.press('Enter');
			await until(
				async () =>
					(await page
						.locator(':focus')
						.getAttribute('data-session-folder-chip')) === 'folder-long-90',
				'focus to move to the destination folder below the visible area',
			);

			await page.keyboard.press('Enter');
			await card.waitFor();
			await folders.getByRole('button', {name: 'New folder'}).focus();
			await page.keyboard.press('Enter');
			await page
				.getByRole('dialog')
				.getByRole('textbox', {name: 'Name'})
				.fill(`Newest folder ${theme}`);
			await page.keyboard.press('Enter');
			const created = folders
				.locator('[data-session-folder-chip][aria-pressed="true"]')
				.filter({hasText: `Newest folder ${theme}`});
			await until(async () => {
				const viewport = await folders
					.locator('[data-radix-scroll-area-viewport]')
					.boundingBox();
				const box =
					(await created.count()) > 0 ? await created.boundingBox() : null;
				return Boolean(
					viewport &&
					box &&
					box.y >= viewport.y - 1 &&
					box.y + box.height <= viewport.y + viewport.height + 1,
				);
			}, 'the new folder to be scrolled into view');
			await writeDevStore(page, original);
			await page.close();
		},
	);
}

export async function closeDuplicateTabsCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`close duplicate tabs and undo by keyboard (${theme})`,
		async () => {
			const address = 'https://duplicates.test/page';
			await context.route('https://duplicates.test/**', async (route) =>
				route.fulfill({
					contentType: 'text/html',
					body: '<title>Duplicate page</title><p>Duplicate page</p>',
				}),
			);
			const copies: Page[] = [];
			for (let copy = 0; copy < 3; copy++) {
				const page = await context.newPage();
				await page.goto(address);
				copies.push(page);
			}

			const panel = await openPage(context, extensionId, 'sidepanel');
			await setTheme(panel, theme);
			const copiesOpen = async () => countTabs(panel, address);
			assert.equal(await copiesOpen(), 3);
			await panel.getByRole('tab', {name: /Tabs/}).focus();
			await panel.keyboard.press('Enter');
			const closeButton = panel.getByRole('button', {
				name: /^Close \d+ duplicate tabs?$/,
			});
			await closeButton.waitFor();
			await captureEvidence(panel, `close-duplicates-before-${theme}.png`);
			await closeButton.focus();
			await panel.keyboard.press('Enter');
			await until(async () => (await copiesOpen()) === 1, 'duplicates closed');
			const undo = panel.getByRole('button', {name: 'Undo'});
			await undo.waitFor();
			await panel.getByRole('button', {name: 'No duplicate tabs'}).waitFor();
			await captureEvidence(panel, `close-duplicates-after-${theme}.png`);
			await undo.focus();
			await panel.keyboard.press('Enter');
			await until(async () => (await copiesOpen()) === 3, 'Undo reopens');
			await panel
				.getByRole('button', {name: 'Close 2 duplicate tabs'})
				.waitFor();
			await captureEvidence(panel, `close-duplicates-undone-${theme}.png`);
			await panel.close();

			const popup = await openPage(context, extensionId, 'popup');
			await setTheme(popup, theme);
			await popup.setViewportSize({width: 380, height: 560});
			const popupButton = popup.getByRole('button', {
				name: /^Close \d+ duplicate tabs?$/,
			});
			await popupButton.waitFor();
			if (process.env.TABLODGE_CAPTURE_EVIDENCE === '1') {
				await popup.screenshot({
					path: fromRoot(
						`.dev/evidence/close-duplicates-popup-before-${theme}.png`,
					),
				});
			}

			await popupButton.focus();
			await popup.keyboard.press('Enter');
			await popup.getByRole('button', {name: 'Undo'}).waitFor();
			if (process.env.TABLODGE_CAPTURE_EVIDENCE === '1') {
				await popup.screenshot({
					path: fromRoot(
						`.dev/evidence/close-duplicates-popup-after-${theme}.png`,
					),
				});
			}

			await until(
				async () => (await countTabs(popup, address)) === 1,
				'popup closes duplicates',
			);
			await popup.close();
			for (const page of copies) {
				await page.close().catch(() => undefined);
			}

			await context.unroute('https://duplicates.test/**');
		},
	);
}

export async function submenuOpenerCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`a submenu opener in the session menu does not expand or collapse the card (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await setTheme(page, theme);
			const toggle = page
				.locator('#session-dev-session-1 button[aria-expanded]')
				.first();
			const before = await toggle.getAttribute('aria-expanded');
			await page
				.getByRole('button', {name: 'More actions for Home lab rebuild'})
				.click();
			await page.getByRole('menuitem', {name: 'Restore options'}).click();
			await page
				.getByRole('menuitem', {name: 'Restore in this window'})
				.waitFor({timeout: 5000})
				.catch(() => undefined);
			assert.equal(await toggle.getAttribute('aria-expanded'), before);
			await page.close();
		},
	);
}

export async function sessionMenuOrderCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
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

export async function sessionReplaceAppendSplitCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`replace, append and split a session by keyboard with Undo (${theme})`,
		async () => {
			const {server, origin} = await startPageServer();
			const page = await openPage(context, extensionId, 'newtab');
			const other = await context.newPage();
			try {
				await seed(page);
				await page.reload();
				await setTheme(page, theme);
				await other.goto(`${origin}/alpha`);
				await page.bringToFront();
				const snapshot = await readDevStore(page);
				const original = (await sessionUrls(page, 'dev-session-1'))!;
				const reset = async () => {
					await writeDevStore(page, snapshot);
					await page.reload();
				};

				assert.ok(original.length > 2);
				const trigger = page.getByRole('button', {
					name: 'More actions for Home lab rebuild',
					exact: true,
				});
				const undoButton = page.getByRole('button', {name: 'Undo'});
				const sessionMenuItem = async (name: string) => {
					await trigger.focus();
					await page.keyboard.press('Enter');
					await page.getByRole('menuitem', {name, exact: true}).focus();
					await page.keyboard.press('Enter');
				};

				const windowMenuItem = async (name: string) => {
					await trigger.focus();
					await page.keyboard.press('Enter');
					await page
						.getByRole('menuitem', {name: 'Update from this window'})
						.focus();
					await page.keyboard.press('ArrowRight');
					await page.getByRole('menuitem', {name, exact: true}).focus();
					await page.keyboard.press('Enter');
				};

				await until(async () => {
					await trigger.focus();
					await page.keyboard.press('Enter');
					const enabled = await page
						.getByRole('menuitem', {name: 'Update from this window'})
						.isEnabled();
					await page.keyboard.press('Escape');
					return enabled;
				}, 'the window actions to become available');

				await trigger.focus();
				await page.keyboard.press('Enter');
				await page
					.getByRole('menuitem', {name: 'Update from this window'})
					.focus();
				await page.keyboard.press('ArrowRight');
				await page.getByRole('menuitem', {name: 'Replace all links'}).waitFor();
				await captureViewports(page, 'session-window-actions-menu', theme);
				await page.keyboard.press('Escape');

				await page.setViewportSize({width: 1440, height: 900});
				await windowMenuItem('Add missing tabs');
				await undoButton.waitFor();
				assert.deepEqual(await sessionUrls(page, 'dev-session-1'), [
					...original,
					`${origin}/alpha`,
				]);
				await undoButton.focus();
				await page.keyboard.press('Enter');
				await until(
					async () =>
						JSON.stringify(await sessionUrls(page, 'dev-session-1')) ===
						JSON.stringify(original),
					'Undo to restore the session after appending',
				);

				await windowMenuItem('Add missing tabs');
				await undoButton.waitFor();
				await captureViewports(page, 'session-append-result', theme);
				await reset();

				await windowMenuItem('Replace all links');
				await undoButton.waitFor();
				assert.deepEqual(await sessionUrls(page, 'dev-session-1'), [
					`${origin}/alpha`,
				]);
				await undoButton.focus();
				await page.keyboard.press('Enter');
				await until(
					async () =>
						JSON.stringify(await sessionUrls(page, 'dev-session-1')) ===
						JSON.stringify(original),
					'Undo to restore the session after replacing',
				);

				await windowMenuItem('Replace all links');
				await undoButton.waitFor();
				await captureViewports(page, 'session-replace-result', theme);
				await reset();

				const expand = page.getByRole('button', {
					name: 'Show tabs in Home lab rebuild',
					exact: true,
				});
				const collapse = page.getByRole('button', {
					name: 'Hide tabs in Home lab rebuild',
					exact: true,
				});
				const ensureExpanded = async () => {
					await expand.or(collapse).waitFor();
					if (!((await expand.count()) > 0)) {
						return;
					}

					await expand.focus();
					await page.keyboard.press('Enter');
				};

				await ensureExpanded();

				const firstLink = page
					.getByRole('checkbox', {
						name: /^Select .* from Home lab rebuild$/,
					})
					.first();
				await firstLink.focus();
				await page.keyboard.press('Space');
				await sessionMenuItem('Split selected links');
				await undoButton.waitFor();
				const split = (await readDevStore(page)).groups;
				const source = split.find((group) => group.id === 'dev-session-1')!;
				assert.equal(source.tabs.length, original.length - 1);
				assert.equal(
					split.find((group) => group.name === 'Home lab rebuild (split)')?.tabs
						.length,
					1,
				);
				await undoButton.focus();
				await page.keyboard.press('Enter');
				await until(
					async () =>
						JSON.stringify(await sessionUrls(page, 'dev-session-1')) ===
						JSON.stringify(original),
					'Undo to restore the session after splitting',
				);

				await ensureExpanded();

				await firstLink.focus();
				await page.keyboard.press('Space');
				await sessionMenuItem('Split selected links');
				await undoButton.waitFor();
				await captureViewports(page, 'session-split-result', theme);
				await reset();
			} finally {
				await other.close();
				await page.close();
				await closeServer(server);
			}
		},
	);
}
