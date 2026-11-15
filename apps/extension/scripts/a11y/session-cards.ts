import assert from 'node:assert/strict';
import {type Page} from 'playwright';
import {captureEvidence, captureNarrowEvidence} from './evidence.ts';
import {
	createDevFixture,
	groupFolderId,
	readDevStore,
	writeDevStore,
} from './fixtures.ts';
import {check, type Env, type Theme, until} from './harness.ts';
import {
	attributes,
	axeViolationLines,
	focusedLabel,
	openPage,
	selectQuickActions,
	setTheme,
} from './pages.ts';

export async function sessionCardQuickActionsCheck(env: Env, theme: Theme) {
	const {context, extensionId, axeSource} = env;
	await check(
		`session card quick actions follow settings and expand without hover (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			const fixture = createDevFixture(await readDevStore(page));
			fixture.groups = fixture.groups.filter(
				(group) => group.folderId !== 'archived-sessions',
			);
			fixture.settings = {
				...fixture.settings,
				expandSessionsByDefault: false,
				sessionQuickActions: ['archive'],
			};
			await writeDevStore(page, fixture);
			await page.reload();
			await setTheme(page, theme);

			const archivedChip = page.locator(
				'[data-session-folder-chip="archived-sessions"]',
			);
			assert.equal(
				await archivedChip.count(),
				0,
				'empty Archived folder is hidden',
			);
			const card = page.locator('#session-dev-session-1');
			const archiveButton = card.getByRole('button', {
				name: 'Archive session Home lab rebuild',
			});
			assert.equal(await archiveButton.count(), 1);
			assert.equal(
				await card.getByRole('button', {name: /Delete session/}).count(),
				0,
				'Delete is hidden by default',
			);
			const initialExpand = card.getByRole('button', {
				name: 'Show tabs in Home lab rebuild',
			});
			await initialExpand.focus();
			await page.keyboard.press('Enter');
			await page.mouse.move(0, 0);
			const actionBar = card.locator('[data-session-quick-actions]');
			assert.ok(
				!(await actionBar.getAttribute('class'))?.includes('opacity-0'),
				'expanded card shows enabled quick actions without hover',
			);

			const options = await openPage(context, extensionId, 'options');
			await setTheme(options, theme);
			const quickActionsTrigger = options.getByRole('button', {
				name: 'Quick actions on session cards: Archive',
				exact: true,
			});
			await quickActionsTrigger.waitFor();
			await captureEvidence(
				options,
				`session-quick-actions-settings-${theme}.png`,
				options.locator('[data-setting-row="sessionQuickActions"]'),
			);
			await quickActionsTrigger.focus();
			await options.keyboard.press('Enter');
			const quickActionsMenu = options.getByRole('dialog', {
				name: 'Quick actions on session cards',
			});
			await quickActionsMenu.getByRole('button', {name: 'Add Delete'}).focus();
			await options.keyboard.press('Enter');
			const archiveRemoval = quickActionsMenu.getByRole('button', {
				name: 'Remove Archive',
			});
			await archiveRemoval.focus();
			await options.keyboard.press('Enter');
			await until(async () => {
				const {settings} = await readDevStore(options);
				return (
					JSON.stringify(settings.sessionQuickActions) ===
					JSON.stringify(['delete'])
				);
			}, 'quick action settings to save');
			await page.reload();
			await setTheme(page, theme);
			assert.equal(await archiveButton.count(), 0);
			assert.equal(
				await card
					.getByRole('button', {
						name: 'Delete session Home lab rebuild',
					})
					.count(),
				1,
				'Delete appears and Archive disappears when configured',
			);

			await options.keyboard.press('Escape');
			await options
				.getByRole('button', {
					name: 'Quick actions on session cards: Delete',
					exact: true,
				})
				.focus();
			await options.keyboard.press('Enter');
			const sessionActions = options.getByRole('dialog', {
				name: 'Quick actions on session cards',
			});
			await sessionActions.getByRole('button', {name: 'Add Archive'}).focus();
			await options.keyboard.press('Enter');
			await until(async () => {
				const {settings} = await readDevStore(options);
				return (
					JSON.stringify(settings.sessionQuickActions) ===
					JSON.stringify(['delete', 'archive'])
				);
			}, 'Archive setting to save');
			await options.close();
			await page.reload();
			await setTheme(page, theme);

			const expand = card.getByRole('button', {
				name: 'Show tabs in Home lab rebuild',
			});
			await expand.focus();
			await page.keyboard.press('Enter');
			await page.mouse.move(0, 0);
			assert.ok(
				!(await actionBar.getAttribute('class'))?.includes('opacity-0'),
			);
			assert.equal(await archiveButton.count(), 1);
			assert.equal(
				await card
					.getByRole('button', {name: 'Delete session Home lab rebuild'})
					.count(),
				1,
				'Delete appears after enabling it in Settings',
			);
			await archiveButton.hover();
			const archiveHoverColor = async () =>
				archiveButton.evaluate(
					(button: {
						ownerDocument: {
							defaultView: {
								getComputedStyle(element: unknown): {color: string};
							} | null;
						};
					}) =>
						button.ownerDocument.defaultView?.getComputedStyle(button).color,
				);
			const expectedHoverColor =
				theme === 'light' ? 'rgb(146, 64, 14)' : 'rgb(253, 230, 138)';
			await until(
				async () => (await archiveHoverColor()) === expectedHoverColor,
				'Archive button hover color transition',
			);
			assert.equal(await archiveHoverColor(), expectedHoverColor);
			assert.deepEqual(
				await axeViolationLines(page, axeSource, {
					type: 'rule',
					values: ['color-contrast'],
				}),
				[],
			);
			await captureEvidence(
				page,
				`session-quick-actions-${theme}.png`,
				card,
				archiveButton,
			);

			const sessionDeleteButton = card.getByRole('button', {
				name: 'Delete session Home lab rebuild',
			});
			await sessionDeleteButton.hover();
			// The computed value is serialized in oklab, so compare it as the color it paints over white.
			const deleteHoverBackground = async () =>
				sessionDeleteButton.evaluate(
					(button: {
						ownerDocument: {
							createElement(name: 'canvas'): {
								width: number;
								height: number;
								getContext(kind: '2d'): {
									fillStyle: string;
									fillRect(x: number, y: number, w: number, h: number): void;
									getImageData(
										x: number,
										y: number,
										w: number,
										h: number,
									): {data: number[]};
								} | null;
							};
							defaultView: {
								getComputedStyle(element: unknown): {
									backgroundColor: string;
								};
							} | null;
						};
					}) => {
						const paint = button.ownerDocument
							.createElement('canvas')
							.getContext('2d');
						const color =
							button.ownerDocument.defaultView?.getComputedStyle(
								button,
							).backgroundColor;
						if (!paint || !color) {
							return [];
						}

						paint.fillStyle = '#ffffff';
						paint.fillRect(0, 0, 1, 1);
						paint.fillStyle = color;
						paint.fillRect(0, 0, 1, 1);
						return paint.getImageData(0, 0, 1, 1).data.slice(0, 3);
					},
				);
			const [red, green, blue] =
				theme === 'light' ? [220, 38, 38] : [248, 113, 113];
			const expectedDeleteHoverBackground = [red, green, blue].map((channel) =>
				Math.round(channel * 0.1 + 255 * 0.9),
			);
			const deleteHoverMatches = async () => {
				const painted = await deleteHoverBackground();
				return (
					painted.length === 3 &&
					painted.every(
						(channel, index) =>
							Math.abs(channel - expectedDeleteHoverBackground[index]) <= 2,
					)
				);
			};

			await until(
				deleteHoverMatches,
				'Delete button hover background transition',
			);
			assert.ok(await deleteHoverMatches());
			assert.deepEqual(
				await axeViolationLines(page, axeSource, {
					type: 'rule',
					values: ['color-contrast'],
				}),
				[],
			);
			await captureEvidence(
				page,
				`session-delete-quick-action-${theme}.png`,
				card,
				sessionDeleteButton,
			);

			const sessionToRemove = page.locator('#session-dev-session-2');
			const sessionDeleteAction = sessionToRemove.getByRole('button', {
				name: 'Delete session Quarterly planning',
			});
			await sessionDeleteAction.focus();
			await page.keyboard.press('Enter');
			await until(
				async () => (await sessionToRemove.count()) === 0,
				'Delete quick action to remove the session',
			);

			await archiveButton.focus();
			await page.keyboard.press('Enter');
			await until(
				async () =>
					(await groupFolderId(page, 'dev-session-1')) === 'archived-sessions',
				'Archive quick action to move the session',
			);
			await archivedChip.waitFor();
			await archivedChip.focus();
			await page.keyboard.press('Enter');
			await card.waitFor();
			const menuTrigger = card.locator('[data-move-focus]');
			await menuTrigger.focus();
			await page.keyboard.press('Enter');
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
					(await groupFolderId(page, 'dev-session-1')) === 'folder-work',
				'session to leave Archived',
			);
			await until(
				async () => (await archivedChip.count()) === 0,
				'empty Archived folder to hide',
			);

			const reset = createDevFixture(await readDevStore(page));
			reset.settings = {
				...reset.settings,
				sessionQuickActions: ['archive'],
			};
			await writeDevStore(page, reset);
			await page.reload();
			await page.close();
		},
	);
}

export async function sessionFaviconPreviewsCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`session favicon previews toggle by keyboard (${theme})`,
		async () => {
			let page: Page | undefined;
			let options: Page | undefined;
			try {
				page = await openPage(context, extensionId, 'newtab');
				const fixture = createDevFixture(await readDevStore(page));
				fixture.settings = {
					...fixture.settings,
					expandSessionsByDefault: false,
					showSessionFaviconPreviews: true,
				};
				await writeDevStore(page, fixture);
				await page.reload();
				await setTheme(page, theme);

				const card = page.locator('#session-dev-session-1');
				const favicons = card.locator('img[data-favicon]');
				assert.ok(
					(await favicons.count()) > 0,
					'collapsed session card shows its favicon previews by default',
				);

				const settingsPage = await openPage(context, extensionId, 'options');
				options = settingsPage;
				await setTheme(settingsPage, theme);
				const toggle = settingsPage.getByRole('switch', {
					name: 'Show favicon previews on session cards',
					exact: true,
				});
				await toggle.focus();
				assert.equal(await toggle.getAttribute('aria-checked'), 'true');
				const settingRow = settingsPage.locator(
					'[data-setting-row="showSessionFaviconPreviews"]',
				);
				await captureEvidence(
					settingsPage,
					`session-favicon-setting-${theme}.png`,
					settingRow,
				);
				await captureNarrowEvidence(
					settingsPage,
					`session-favicon-setting-${theme}-375x812.png`,
					settingRow,
				);
				await settingsPage.keyboard.press('Space');
				assert.equal(
					await toggle.evaluate(
						(element: {ownerDocument: {activeElement: unknown}}) =>
							element === element.ownerDocument.activeElement,
					),
					true,
					'toggle keeps keyboard focus after changing state',
				);
				await until(async () => {
					const {settings} = await readDevStore(settingsPage);
					return settings.showSessionFaviconPreviews === false;
				}, 'favicon preview setting to turn off');

				await page.reload();
				await setTheme(page, theme);
				assert.equal(
					await favicons.count(),
					0,
					'collapsed session card hides the full preview strip',
				);
				await captureEvidence(
					page,
					`session-favicon-previews-hidden-${theme}.png`,
					card,
				);
				await captureNarrowEvidence(
					page,
					`session-favicon-previews-hidden-${theme}-375x812.png`,
					card,
				);

				await toggle.focus();
				await settingsPage.keyboard.press('Space');
				assert.equal(
					await toggle.evaluate(
						(element: {ownerDocument: {activeElement: unknown}}) =>
							element === element.ownerDocument.activeElement,
					),
					true,
					'toggle keeps keyboard focus when previews return',
				);
				await until(async () => {
					const {settings} = await readDevStore(settingsPage);
					return settings.showSessionFaviconPreviews === true;
				}, 'favicon preview setting to turn on');
				await page.reload();
				await setTheme(page, theme);
				assert.ok(
					(await favicons.count()) > 0,
					'collapsed session card restores its favicon previews',
				);
				assert.equal(await toggle.getAttribute('aria-checked'), 'true');
				await settingsPage.close();
				options = undefined;
				await page.close();
				page = undefined;
			} finally {
				await Promise.all([options?.close(), page?.close()]);
			}
		},
	);
}

export async function sessionQuickActionMenuCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`session quick actions include menu actions and allow five (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			const fixture = createDevFixture(await readDevStore(page));
			fixture.settings = {
				...fixture.settings,
				expandSessionsByDefault: false,
				sessionQuickActions: ['archive'],
			};
			await writeDevStore(page, fixture);
			await page.reload();
			await setTheme(page, theme);

			const options = await openPage(context, extensionId, 'options');
			await setTheme(options, theme);
			const trigger = options.getByRole('button', {
				name: 'Quick actions on session cards: Archive',
				exact: true,
			});
			await trigger.focus();
			await options.keyboard.press('Enter');
			const menu = options.getByRole('dialog', {
				name: 'Quick actions on session cards',
			});
			await menu.getByRole('button', {name: 'Clear all'}).focus();
			await options.keyboard.press('Enter');
			await menu.getByRole('button', {name: 'Add Archive'}).waitFor();
			await captureEvidence(options, `clear-quick-actions-${theme}.png`, menu);
			assert.equal(
				await options.locator('body').evaluate(
					(node: {
						ownerDocument: {
							activeElement: {
								getAttribute(name: string): string | null;
							} | null;
						};
					}) => node.ownerDocument.activeElement?.getAttribute('aria-label'),
				),
				'Find quick actions on session cards',
				'clearing quick actions returns focus to the search field',
			);
			await menu.getByRole('button', {name: 'Add Archive'}).click();
			await selectQuickActions(
				options,
				menu,
				['Share', 'Move up', 'Edit details', 'Move down'],
				'session',
			);
			for (const label of [
				'Archive',
				'Share',
				'Move up',
				'Edit details',
				'Move down',
			]) {
				assert.equal(
					await menu
						.getByRole('button', {
							name: `Remove ${label}`,
							exact: true,
						})
						.count(),
					1,
					`${label} stays selected after adding five quick actions`,
				);
			}

			for (const label of ['Delete', 'Switch to this session']) {
				const option = menu.getByRole('button', {
					name: `Add ${label}`,
					exact: true,
				});
				assert.equal(
					await option.isDisabled(),
					true,
					`${label} is disabled after five actions are selected`,
				);
			}

			await until(async () => {
				const {settings} = await readDevStore(options);
				return (
					JSON.stringify(settings.sessionQuickActions) ===
					JSON.stringify(['archive', 'share', 'move-up', 'edit', 'move-down'])
				);
			}, 'five session quick actions to save');
			await options.close();
			await page.reload();
			await setTheme(page, theme);
			await page.setViewportSize({width: 440, height: 956});
			const collapsedTitle = page.locator('#session-dev-session-2 h3');
			await captureEvidence(
				page,
				`session-quick-actions-collapsed-${theme}.png`,
				page.locator('#session-dev-session-2'),
			);
			const collapsedTitleBounds = await collapsedTitle.boundingBox();
			assert.ok(collapsedTitleBounds);
			assert.ok(
				collapsedTitleBounds.width >= 128,
				`five quick actions leave a readable title width on collapsed cards (${collapsedTitleBounds.width}px)`,
			);

			const card = page.locator('#session-dev-session-1');
			for (const label of [
				'Archive session',
				'Share session',
				'Move up',
				'Edit details',
				'Move down',
			]) {
				assert.equal(
					await card
						.getByRole('button', {
							name: `${label} Home lab rebuild`,
							exact: true,
						})
						.count(),
					1,
					`${label} appears on the session card`,
				);
			}

			const expand = card.getByRole('button', {
				name: 'Show tabs in Home lab rebuild',
				exact: true,
			});
			await expand.focus();
			await page.keyboard.press('Enter');
			await page.mouse.move(0, 0);
			const actionBar = card.locator('[data-session-quick-actions]');
			await until(
				async () =>
					!(await actionBar.getAttribute('class'))?.includes('opacity-0'),
				'enabled quick actions to remain visible on the expanded card',
			);

			await captureEvidence(
				page,
				`session-quick-actions-five-${theme}.png`,
				card,
			);
			const sessionOrder = () =>
				attributes(page, 'article[id^="session-"]', 'id');
			const beforeMove = await sessionOrder();
			const firstSessionId = beforeMove[0];
			assert.ok(firstSessionId);
			const firstCard = page.locator(`#${firstSessionId}`);
			const focusTarget = await firstCard
				.locator('[data-move-focus]')
				.getAttribute('aria-label');
			const moveDown = firstCard.getByRole('button', {
				name: /^Move down /,
			});
			await moveDown.focus();
			await page.keyboard.press('Enter');
			await until(async () => {
				const order = await sessionOrder();
				return order[0] !== firstSessionId && order[1] === firstSessionId;
			}, 'Move down to reorder the first session');
			await until(
				async () => (await focusedLabel(page)) === focusTarget,
				'focus to return to the moved session menu',
			);

			const edit = card.getByRole('button', {
				name: 'Edit details Home lab rebuild',
				exact: true,
			});
			await edit.focus();
			await page.keyboard.press('Enter');
			const details = page.getByRole('dialog', {name: 'Session details'});
			await details.waitFor();
			await details.getByRole('button', {name: 'Cancel'}).click();
			await details.waitFor({state: 'hidden'});
			const reset = createDevFixture(await readDevStore(page));
			reset.settings = {
				...reset.settings,
				sessionQuickActions: ['archive'],
			};
			await writeDevStore(page, reset);
			await page.close();
		},
	);
}
