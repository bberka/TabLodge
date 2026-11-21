import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {
	type BrowserContext,
	type Locator,
	type Page,
	type Route,
} from 'playwright';
import {fromRoot} from '../vite-shared.ts';
import {captureEvidence, withMobileEmulation} from './evidence.ts';
import {
	createDevFixture,
	readDevStore,
	seed,
	writeDevStore,
} from './fixtures.ts';
import {check, type Env, type Theme, until} from './harness.ts';
import {
	attributes,
	AXE_TAGS,
	type AxeGlobal,
	openPage,
	type ScrollViewport,
	setTheme,
} from './pages.ts';

async function verifySelectedLinksOpen(
	context: BrowserContext,
	action: Locator,
	urls: string[],
) {
	const existingPages = new Set(context.pages());
	try {
		await action.press('Enter');
		const openedPages = () =>
			context.pages().filter((page) => !existingPages.has(page));
		await until(
			async () => openedPages().length === urls.length,
			'selected links to open in new tabs',
		);
		assert.deepEqual(
			openedPages()
				.map((page) => page.url())
				.toSorted(),
			urls.toSorted(),
		);
	} finally {
		await Promise.all(
			context
				.pages()
				.filter((page) => !existingPages.has(page))
				.map((page) => page.close()),
		);
	}
}

async function alignDragEndpoints(
	page: Page,
	source: Locator,
	destination: Locator,
) {
	const viewport = page.viewportSize();
	assert.ok(viewport);
	const [sourceBounds, destinationBounds] = await Promise.all([
		source.boundingBox(),
		destination.boundingBox(),
	]);
	assert.ok(sourceBounds);
	assert.ok(destinationBounds);
	const scrollY = await page.evaluate(
		() => (globalThis as ScrollViewport).scrollY,
	);
	const top = Math.min(sourceBounds.y, destinationBounds.y) + scrollY;
	const bottom =
		Math.max(
			sourceBounds.y + sourceBounds.height,
			destinationBounds.y + destinationBounds.height,
		) + scrollY;
	const margin = 12;
	assert.ok(
		bottom - top <= viewport.height - margin * 2,
		'Drag endpoints should fit in the viewport together',
	);
	const minScroll = Math.max(0, bottom - (viewport.height - margin));
	const maxScroll = Math.max(0, top - margin);
	assert.ok(minScroll <= maxScroll);
	const alignedScroll = Math.min(maxScroll, Math.max(minScroll, scrollY));
	await page.evaluate(
		(topOffset) => (globalThis as ScrollViewport).scrollTo(0, topOffset),
		alignedScroll,
	);
	for (const locator of [source, destination]) {
		const bounds = await locator.boundingBox();
		assert.ok(bounds);
		assert.ok(bounds.y >= 0, 'Drag endpoint is above the viewport');
		assert.ok(
			bounds.y + bounds.height <= viewport.height,
			'Drag endpoint is below the viewport',
		);
	}
}

async function seedBulkOpenLinks(page: Page) {
	const fixture = createDevFixture(await readDevStore(page));
	fixture.bookmarks = fixture.bookmarks.map((bookmark) => ({
		...bookmark,
		url:
			bookmark.id === 'dev-bookmark-1'
				? 'https://example.com/bulk-open-bookmark-1'
				: bookmark.id === 'dev-bookmark-2'
					? 'https://example.com/bulk-open-bookmark-2'
					: bookmark.url,
	}));
	fixture.groups = fixture.groups.map((group) =>
		group.id === 'dev-session-3'
			? {
					...group,
					tabs: group.tabs.map((tab) => ({
						...tab,
						url:
							tab.title === 'Lisbon trip itinerary'
								? 'https://example.com/bulk-open-session-1'
								: tab.title === 'Train times and tickets'
									? 'https://example.com/bulk-open-session-2'
									: tab.url,
					})),
				}
			: group,
	);
	await writeDevStore(page, fixture);
}

async function selectBookmarks(page: Page, names: string[]) {
	await page
		.getByRole('button', {name: 'Select bookmarks', exact: true})
		.press('Enter');
	for (const name of names) {
		await page
			.getByRole('checkbox', {name: `Select bookmark: ${name}`})
			.press('Space');
	}
}

export async function bulkSelectionActionsCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`bulk bookmark and session selection actions work by keyboard (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await seedBulkOpenLinks(page);
			await page.reload();
			await setTheme(page, theme);
			const bookmarks = page.getByRole('group', {
				name: 'Selected bookmarks',
			});
			await selectBookmarks(page, ['Gmail', 'Calendar']);

			await bookmarks.waitFor();
			await bookmarks.scrollIntoViewIfNeeded();
			await captureEvidence(
				page,
				`bookmark-multi-select-${theme}.png`,
				bookmarks,
			);
			await bookmarks
				.getByRole('button', {name: 'Open', exact: true})
				.waitFor();
			await bookmarks
				.getByRole('button', {name: 'Move bookmarks', exact: true})
				.waitFor();
			for (const name of ['Share', 'Delete']) {
				await bookmarks.getByRole('button', {name, exact: true}).waitFor();
			}

			await bookmarks
				.getByRole('button', {
					name: 'Add to session…',
					exact: true,
				})
				.waitFor();
			assert.equal(
				await bookmarks.getByText('2 bookmarks selected').count(),
				1,
			);
			await verifySelectedLinksOpen(
				context,
				bookmarks.getByRole('button', {
					name: 'Open',
					exact: true,
				}),
				[
					'https://example.com/bulk-open-bookmark-1',
					'https://example.com/bulk-open-bookmark-2',
				],
			);
			await captureEvidence(
				page,
				`bookmark-selection-actions-${theme}.png`,
				bookmarks,
			);

			await bookmarks
				.getByRole('button', {
					name: 'Add to session…',
					exact: true,
				})
				.press('Enter');
			const homeLabTarget = page.getByRole('option', {
				name: 'Home lab rebuild',
				exact: true,
			});
			await homeLabTarget.waitFor();
			assert.equal(await homeLabTarget.getAttribute('aria-selected'), 'true');
			await page.keyboard.press('Enter');
			await until(async () => {
				const store = await readDevStore(page);
				const session = store.groups.find(
					(group) => group.id === 'dev-session-1',
				);
				return session?.tabs.length === 6;
			}, 'selected bookmarks added to a session');

			const session = page.locator('#session-dev-session-3');
			await session
				.getByRole('button', {name: 'Show tabs in Lisbon trip'})
				.press('Enter');
			for (const name of ['Lisbon trip itinerary', 'Train times and tickets']) {
				await session
					.getByRole('checkbox', {
						name: `Select ${name} from Lisbon trip`,
					})
					.press('Space');
			}

			const sessionSelection = page.getByRole('group', {
				name: 'Selected session tabs',
			});
			await sessionSelection.scrollIntoViewIfNeeded();
			await sessionSelection
				.getByRole('button', {name: 'Open', exact: true})
				.waitFor();
			await sessionSelection
				.getByRole('button', {
					name: 'Bookmark',
					exact: true,
				})
				.waitFor();
			for (const name of ['Share']) {
				await sessionSelection
					.getByRole('button', {name, exact: true})
					.waitFor();
			}

			assert.equal(
				await sessionSelection.getByText('2 tabs selected').count(),
				1,
			);
			await verifySelectedLinksOpen(
				context,
				sessionSelection.getByRole('button', {
					name: 'Open',
					exact: true,
				}),
				[
					'https://example.com/bulk-open-session-1',
					'https://example.com/bulk-open-session-2',
				],
			);
			await captureEvidence(
				page,
				`session-multi-select-${theme}.png`,
				page.getByRole('group', {name: 'Selected session tabs'}),
			);
			await captureEvidence(
				page,
				`session-selection-actions-${theme}.png`,
				page.getByRole('group', {name: 'Selected session tabs'}),
			);

			await sessionSelection
				.getByRole('button', {
					name: 'Bookmark',
					exact: true,
				})
				.press('Enter');
			const dialog = page.getByRole('dialog');
			await dialog
				.getByRole('button', {name: 'Bookmark 2 tabs'})
				.press('Enter');
			await dialog.waitFor({state: 'hidden'});
			const store = await readDevStore(page);
			assert.deepEqual(
				store.bookmarks
					.filter((bookmark) =>
						[
							'https://example.com/bulk-open-session-1',
							'https://example.com/bulk-open-session-2',
						].includes(bookmark.url),
					)
					.map((bookmark) => bookmark.columnId),
				['bookmark-daily', 'bookmark-daily'],
			);
			await page.close();
		},
	);
}

export async function sessionHeaderCheckboxCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`session header checkbox selects every link by keyboard and hover (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await seed(page);
			await page.reload();
			await setTheme(page, theme);
			const session = page.locator('#session-dev-session-1');
			const selectAll = session.getByRole('checkbox', {
				name: 'Select all links in Home lab rebuild',
			});
			await selectAll.waitFor();
			const selectControl = session.locator('[data-session-select]');
			const controlOpacity = () =>
				selectControl.evaluate(
					(element: {
						ownerDocument: {
							defaultView: {
								getComputedStyle(element: unknown): {opacity: string};
							} | null;
						};
					}) =>
						element.ownerDocument.defaultView?.getComputedStyle(element)
							.opacity ?? '',
				);
			await page.mouse.move(0, 0);
			assert.equal(
				await controlOpacity(),
				'0',
				'the card checkbox starts hidden until hover or focus',
			);
			await session.hover();
			await until(
				async () => (await controlOpacity()) === '1',
				'card checkbox to appear on hover',
			);
			await captureEvidence(
				page,
				`session-card-select-checkbox-${theme}.png`,
				session,
				selectAll,
			);
			await withMobileEmulation(
				page,
				{width: 440, height: 956},
				async () => {
					assert.equal(
						await page.evaluate(() => {
							const {matchMedia} = globalThis as typeof globalThis & {
								matchMedia: (query: string) => {matches: boolean};
							};
							return matchMedia('(hover: none)').matches;
						}),
						true,
						'touch devices do not have hover',
					);
					await page.mouse.move(0, 0);
					await until(
						async () => (await controlOpacity()) === '1',
						'the session checkbox to appear on touch devices',
					);
				},
				true,
			);

			const expand = session.getByRole('button', {
				name: 'Show tabs in Home lab rebuild',
			});
			await expand.focus();
			await page.keyboard.press('Enter');
			const firstTab = session.getByRole('checkbox', {
				name: 'Select TabLodge architecture from Home lab rebuild',
			});
			await firstTab.focus();
			await page.keyboard.press('Space');
			await until(
				async () => (await selectAll.getAttribute('aria-checked')) === 'mixed',
				'partially selected state on the session checkbox',
			);
			await selectAll.focus();
			await page.keyboard.press('Space');
			await until(
				async () => (await selectAll.getAttribute('aria-checked')) === 'true',
				'all session links to become selected',
			);
			assert.deepEqual(
				await attributes(
					page,
					'#session-dev-session-1 [data-tab-id] [role="checkbox"]',
					'aria-checked',
				),
				['true', 'true', 'true', 'true'],
			);
			assert.equal(
				await page
					.getByRole('group', {name: 'Selected session tabs'})
					.getByText('4 tabs selected')
					.count(),
				1,
			);
			await captureEvidence(
				page,
				`session-select-all-${theme}.png`,
				page.getByRole('group', {name: 'Selected session tabs'}),
			);

			await selectAll.focus();
			await page.keyboard.press('Space');
			await until(
				async () => (await selectAll.getAttribute('aria-checked')) === 'false',
				'session links to be cleared',
			);
			await page.close();
		},
	);
}

export async function moveSelectedToNewColumnCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`move selected bookmarks to a new column by keyboard (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await seed(page);
			await page.reload();
			await setTheme(page, theme);
			await selectBookmarks(page, ['Gmail', 'Calendar']);

			await page
				.getByRole('button', {name: 'Move bookmarks', exact: true})
				.press('Enter');
			const dialog = page.getByRole('dialog');
			await until(
				async () => (await dialog.locator('input:focus').count()) === 1,
				'the search field to take focus',
			);
			const options = dialog.getByRole('option');
			const optionNames = (await options.allTextContents()).map((name) =>
				name.trim(),
			);
			assert.deepEqual(optionNames, ['Daily', 'Dev', 'Reading']);
			assert.ok(!optionNames.includes('Unfiled'));
			// A name that matches nothing offers to create the column.
			const columnName = `Bulk move ${theme}`;
			await page.keyboard.type(columnName);
			await options.filter({hasText: `New column “${columnName}”`}).waitFor();
			await page.keyboard.press('Enter');
			await dialog.waitFor({state: 'hidden'});
			// The dialog closes first; the column is created and the bookmarks move after.
			const moved = async () => {
				const store = await readDevStore(page);
				const column = store.bookmarkColumns.find(
					(entry) => entry.name === columnName,
				);
				const columnIds = store.bookmarks
					.filter((bookmark) =>
						['dev-bookmark-1', 'dev-bookmark-2'].includes(bookmark.id),
					)
					.map((bookmark) => bookmark.columnId);
				return column && columnIds.every((id) => id === column.id)
					? column.id
					: undefined;
			};

			await until(
				async () => (await moved()) !== undefined,
				'the selected bookmarks to land in the new column',
			);
			await page.close();
		},
	);
}

export async function altClickLinkCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`Alt-click selects a saved session link without opening or collapsing it (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await seed(page);
			await page.reload();
			await setTheme(page, theme);
			await page
				.getByRole('button', {name: 'Select bookmarks', exact: true})
				.press('Enter');
			const session = page.locator('#session-dev-session-1');
			if ((await session.locator('[data-tab-id]').count()) === 0) {
				await session
					.getByRole('button', {name: 'Show tabs in Home lab rebuild'})
					.press('Enter');
			}

			const bookmarkCheckbox = await page
				.getByRole('checkbox', {name: 'Select bookmark: Gmail'})
				.boundingBox();
			const sessionCheckbox = page.getByRole('checkbox', {
				name: 'Select TabLodge architecture from Home lab rebuild',
			});
			const sessionCheckboxBounds = await sessionCheckbox.boundingBox();
			assert.ok(bookmarkCheckbox);
			assert.ok(sessionCheckboxBounds);
			assert.deepEqual(
				[sessionCheckboxBounds.width, sessionCheckboxBounds.height],
				[bookmarkCheckbox.width, bookmarkCheckbox.height],
				'session and bookmark checkboxes should have matching dimensions',
			);
			assert.equal(bookmarkCheckbox.width, 24);
			assert.equal(bookmarkCheckbox.height, 24);

			const pageCount = context.pages().length;
			await session
				.getByRole('link', {name: 'TabLodge architecture', exact: true})
				.click({modifiers: ['Alt']});
			await until(
				async () =>
					(await sessionCheckbox.getAttribute('aria-checked')) === 'true',
				'Alt-clicked session tab to become selected',
			);
			assert.equal(context.pages().length, pageCount);
			assert.equal(
				await session.locator('[data-tab-id]').count(),
				4,
				'the session should remain expanded',
			);
			await page.close();
		},
	);
}

export async function dragSelectedLinksCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`drag selected links between bookmarks and sessions (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await page.setViewportSize({width: 1440, height: 900});
			await seed(page);
			await page.reload();
			await setTheme(page, theme);
			const bookmarks = page.locator('[data-bookmark-id]');
			await selectBookmarks(page, ['Gmail', 'Calendar']);

			await bookmarks
				.first()
				.locator('article')
				.dragTo(page.locator('#session-dev-session-1'));
			await until(async () => {
				const store = await readDevStore(page);
				return (
					store.groups.find((group) => group.id === 'dev-session-1')?.tabs
						.length === 6
				);
			}, 'both selected bookmarks to be added to the session');

			const trip = page.locator('#session-dev-session-3');
			const tripTabs = trip.locator('[data-tab-id]');
			if ((await tripTabs.count()) === 0) {
				await trip
					.getByRole('button', {name: 'Show tabs in Lisbon trip'})
					.press('Enter');
			}

			for (const name of ['Lisbon trip itinerary', 'Train times and tickets']) {
				await trip
					.getByRole('checkbox', {
						name: `Select ${name} from Lisbon trip`,
					})
					.press('Space');
			}

			assert.deepEqual(
				await attributes(
					page,
					'#session-dev-session-3 [data-tab-id] [role="checkbox"]',
					'aria-checked',
				),
				['true', 'true', 'false', 'false'],
			);
			assert.equal(await tripTabs.first().getAttribute('draggable'), 'true');
			const source = tripTabs.first().locator('a');
			const destination = page.locator(
				'section[data-column-id="bookmark-reading"] header',
			);
			await alignDragEndpoints(page, source, destination);
			await source.dragTo(destination);
			await until(async () => {
				const store = await readDevStore(page);
				const added = store.bookmarks.filter((bookmark) =>
					['https://www.visitlisboa.com/', 'https://www.cp.pt/'].includes(
						bookmark.url,
					),
				);
				return added.length === 2;
			}, 'both selected session tabs to be added to the bookmark column');
			const store = await readDevStore(page);
			assert.deepEqual(
				store.bookmarks
					.filter((bookmark) =>
						['https://www.visitlisboa.com/', 'https://www.cp.pt/'].includes(
							bookmark.url,
						),
					)
					.map((bookmark) => bookmark.columnId),
				['bookmark-reading', 'bookmark-reading'],
			);
			await destination.scrollIntoViewIfNeeded();
			await captureEvidence(
				page,
				`multi-link-drag-after-${theme}.png`,
				destination,
			);
			await page.close();
		},
	);
}

export async function selectionModeRangesCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(`bookmark selection mode and ranges (${theme})`, async () => {
		// Ctrl+click opens the real sites of the sample bookmarks, and Playwright reports the tab only once its first
		// navigation commits, which took over 2 s against the live site on a busy machine. Serve them locally.
		const web = /^https?:\/\//;
		const stub = async (route: Route) =>
			route.fulfill({
				contentType: 'text/html',
				body: '<title>Opened bookmark</title>',
			});
		await context.route(web, stub);
		try {
			await selectionModeRanges(context, extensionId, theme);
		} finally {
			await context.unroute(web, stub);
		}
	});
}

async function selectionModeRanges(
	context: BrowserContext,
	extensionId: string,
	theme: Theme,
) {
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
		context.waitForEvent('page', {timeout: 10_000}),
		cards
			.first()
			.locator('a')
			.click({modifiers: ['Control']}),
	]);
	await opened.close();
	assert.equal(
		await cards.first().getByRole('checkbox').getAttribute('aria-checked'),
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
		context.waitForEvent('page', {timeout: 10_000}),
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
}

export async function moveDeleteSelectedCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
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
			await page
				.getByRole('group', {name: 'Selected bookmarks'})
				.getByRole('button', {name: 'Move bookmarks', exact: true})
				.focus();
			await page.keyboard.press('Enter');
			await page.getByRole('combobox', {name: 'Search columns'}).waitFor();
			await page.keyboard.type('Reading');
			await page.keyboard.press('Enter');
			await page.locator('[role="dialog"]').waitFor({state: 'detached'});
			const destination = page.locator('section[data-column-id]').last();
			const columnId = await destination.getAttribute('data-column-id');
			// The move lands after the dialog closes, so poll instead of reading once.
			await until(
				async () =>
					JSON.stringify(
						(
							await attributes(
								page,
								`section[data-column-id="${columnId}"] [data-bookmark-id]`,
								'data-bookmark-id',
							)
						).slice(-2),
					) === JSON.stringify(ids),
				'the selected bookmarks to land at the end of the last column',
			);
			await page
				.getByRole('group', {name: 'Selected bookmarks'})
				.waitFor({state: 'hidden'});
			await until(
				async () =>
					(await page.locator(':focus').count()) === 1 &&
					(await page.locator('body:focus').count()) === 0,
				'focus to stay off the page body after the selection ends',
			);
			for (const id of ids) {
				await page
					.locator(`[data-bookmark-id="${id}"]`)
					.getByRole('checkbox')
					.focus();
				await page.keyboard.press('Space');
			}

			await page
				.getByRole('button', {
					name: 'Delete',
					exact: true,
				})
				.focus();
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
}

export async function dragSelectedBookmarksCheck(env: Env, theme: Theme) {
	const {context, extensionId, axeSource} = env;
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
			path: fromRoot(`.dev/evidence/bookmark-selection-mobile-${theme}.png`),
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
		await page
			.getByRole('group', {name: 'Selected bookmarks'})
			.waitFor({state: 'hidden'});
		const movedCard = page.locator(`[data-bookmark-id="${ids[0]}"] article`);
		// Moving ends the selection, so pick the pair again before each drag.
		const selectPair = async () => {
			for (const id of ids) {
				await page
					.locator(`[data-bookmark-id="${id}"]`)
					.getByRole('checkbox')
					.focus();
				await page.keyboard.press('Space');
			}
		};

		await selectPair();
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
		await page
			.getByRole('group', {name: 'Selected bookmarks'})
			.waitFor({state: 'hidden'});
		await selectPair();
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
}

export async function bookmarkSelectionCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
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
		const selection = page.getByRole('group', {name: 'Selected bookmarks'});
		assert.equal(await selection.isVisible(), true);
		assert.equal(
			await selection
				.getByRole('button', {name: 'Share', exact: true})
				.isVisible(),
			true,
		);
		await page.keyboard.press('Escape');
		assert.equal(await selection.count(), 0);
		await page.close();
	});
}
