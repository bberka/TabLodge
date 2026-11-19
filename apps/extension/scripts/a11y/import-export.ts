import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {readFile} from 'node:fs/promises';
import {type Page} from 'playwright';
import {assertInline, captureEvidence} from './evidence.ts';
import {seed} from './fixtures.ts';
import {check, type Env, type Theme, until} from './harness.ts';
import {
	axeViolationLines,
	openPage,
	type ScrollElement,
	setTheme,
} from './pages.ts';

async function pickImportKind(page: Page, name: string) {
	await page.locator('#import-what').focus();
	await page.keyboard.press('Enter');
	await page.getByRole('option', {name: new RegExp(`^${name}`)}).focus();
	await page.keyboard.press('Enter');
}

export async function importScopeCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`changing what to import cancels a pending read (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'options');
			await setTheme(page, theme);
			await page.getByRole('button', {name: 'Import', exact: true}).click();
			const dialog = page.getByRole('dialog');
			await pickImportKind(page, 'Sessions');
			await page.evaluate(() => {
				const file = new File(['https://example.com'], 'pending.txt');
				Object.defineProperty(file, 'slice', {
					value: () => ({
						arrayBuffer: () =>
							new Promise<ArrayBuffer>((resolve) => {
								Object.assign(globalThis, {
									finishImportRead: () => resolve(new ArrayBuffer(4)),
								});
							}),
					}),
				});
				const browser = globalThis as typeof globalThis & {
					DataTransfer: new () => {
						items: {add(file: File): void};
						files: unknown;
					};
					document: {
						querySelector(selector: string): {
							files: unknown;
							dispatchEvent(event: Event): boolean;
						};
					};
				};
				const transfer = new browser.DataTransfer();
				transfer.items.add(file);
				const input = browser.document.querySelector(
					':scope [role="dialog"] input[type="file"]',
				);
				input.files = transfer.files;
				input.dispatchEvent(new Event('change', {bubbles: true}));
			});
			await pickImportKind(page, 'Bookmarks');
			await page.evaluate(async () => {
				(
					globalThis as typeof globalThis & {finishImportRead(): void}
				).finishImportRead();
				const {requestAnimationFrame} = globalThis as typeof globalThis & {
					requestAnimationFrame(callback: () => void): number;
				};
				await new Promise<void>((resolve) => {
					requestAnimationFrame(() => {
						requestAnimationFrame(resolve);
					});
				});
			});
			assert.equal(await dialog.getByText('pending.txt').count(), 0);
			assert.equal(
				await dialog.getByRole('button', {name: 'Choose file'}).isEnabled(),
				true,
			);
			await page.close();
		},
	);
}

export async function protectedBackupCheck(env: Env, theme: Theme) {
	const {context, extensionId, axeSource} = env;
	await check(
		`a protected full backup is exported and opened by keyboard (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'options');
			await setTheme(page, theme);
			await page.getByRole('button', {name: 'Export', exact: true}).click();
			const dialog = page.getByRole('dialog');
			const protect = dialog.getByRole('checkbox', {
				name: 'Protect with a password',
			});
			await protect.focus();
			await page.keyboard.press('Space');
			const download = dialog.getByRole('button', {
				name: 'Download',
				exact: true,
			});
			assert.equal(await download.isDisabled(), true);
			const password = dialog.getByRole('textbox', {
				name: 'Password',
				exact: true,
			});
			const confirm = dialog.getByRole('textbox', {
				name: 'Confirm Password',
			});
			await password.focus();
			await page.keyboard.type('sho');
			assert.match(
				(await dialog.textContent()) ?? '',
				/needs at least 4 characters/,
			);
			await page.keyboard.type('rt');
			assert.match(
				(await dialog.textContent()) ?? '',
				/easy to guess/,
				'a short password that is long enough shows the hint',
			);
			await page.keyboard.type('er horse battery');
			await confirm.focus();
			await page.keyboard.type('different');
			assert.match((await dialog.textContent()) ?? '', /do not match/);
			assert.equal(await download.isDisabled(), true);
			await confirm.fill('shorter horse battery');
			assert.equal(
				await download.isDisabled(),
				true,
				'the notice must be acknowledged first',
			);
			const show = dialog.getByRole('button', {name: 'Show Password'});
			await show.focus();
			await page.keyboard.press('Enter');
			assert.equal(await password.getAttribute('type'), 'text');
			assert.equal(
				await dialog
					.getByRole('button', {name: 'Hide Password'})
					.getAttribute('aria-pressed'),
				'true',
			);
			const acknowledge = dialog.getByRole('checkbox', {
				name: /cannot be recovered/,
			});
			await acknowledge.focus();
			await page.keyboard.press('Space');
			assert.equal(await download.isEnabled(), true);
			assert.deepEqual(
				await axeViolationLines(page, axeSource),
				[],
				'the protect form should pass axe',
			);
			// A short or number-only password is allowed, and the field says it is easy to guess while it is typed.
			await password.fill('1234');
			await confirm.fill('1234');
			assert.match(
				(await dialog.textContent()) ?? '',
				/Short or number-only passwords are easy to guess/,
				'a short password shows the hint',
			);
			assert.equal(
				await download.isEnabled(),
				true,
				'a short password is allowed, so the hint does not block',
			);
			await password.fill('shorter horse battery');
			await confirm.fill('shorter horse battery');
			assert.doesNotMatch(
				(await dialog.textContent()) ?? '',
				/easy to guess/,
				'a longer password with letters shows no hint',
			);
			const downloadPromise = page.waitForEvent('download');
			await download.focus();
			await page.keyboard.press('Enter');
			const saved = await downloadPromise;
			assert.match(
				saved.suggestedFilename(),
				/^tablodge-full-\d{4}-\d{2}-\d{2}\.zip\.enc$/,
			);
			const savedPath = await saved.path();
			assert.ok(savedPath);
			const bytes = await readFile(savedPath);
			assert.equal(bytes.subarray(0, 4).toString('latin1'), 'TLEN');
			const text = bytes.toString('latin1');
			assert.equal(text.includes('Quarterly planning'), false);
			assert.equal(text.includes('https://'), false);
			await dialog.waitFor({state: 'hidden'});

			await page.getByRole('button', {name: 'Import', exact: true}).click();
			const importDialog = page.getByRole('dialog');
			await importDialog.locator('input[type="file"]').setInputFiles({
				name: 'protected.zip.enc',
				mimeType: 'application/octet-stream',
				buffer: bytes,
			});
			await importDialog
				.getByRole('heading', {name: 'Unlock encrypted backup'})
				.waitFor();
			assert.deepEqual(
				await axeViolationLines(page, axeSource),
				[],
				'the unlock step should pass axe',
			);
			await until(
				async () =>
					(await page.locator(':focus').getAttribute('type')) === 'password',
				'focus to move to the credential field',
			);
			await page.keyboard.type('wrong horse battery');
			await page.keyboard.press('Enter');
			await importDialog
				.getByRole('alert')
				.filter({hasText: 'wrong'})
				.waitFor();
			assert.equal(
				await importDialog
					.getByRole('heading', {name: 'Review full backup'})
					.count(),
				0,
				'a wrong entry must not open the backup',
			);
			await until(
				async () =>
					(await page.locator(':focus').getAttribute('type')) === 'password',
				'focus to stay in the credential field after an error',
			);
			await importDialog
				.getByRole('textbox', {name: 'password'})
				.fill('shorter horse battery');
			await page.keyboard.press('Enter');
			await importDialog
				.getByRole('heading', {name: 'Review full backup'})
				.waitFor();
			await page.keyboard.press('Escape');
			await importDialog.waitFor({state: 'hidden'});
			await page.close();
		},
	);
}

export async function importScrollingCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
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
		assert.equal(
			await dialog.getByRole('radio', {name: 'Columns from folders'}).count(),
			0,
			'flat bookmark imports should not offer columns from folders',
		);
		assert.equal(
			await dialog.getByRole('radio', {name: 'One column'}).count(),
			0,
			'flat bookmark imports should not offer a column mode button',
		);
		const targetColumn = dialog.getByRole('combobox', {
			name: 'Column for every imported bookmark',
		});
		const targetLabel = dialog.getByText('Put bookmarks in', {exact: true});
		const savedLinksControl = dialog.getByRole('radiogroup', {
			name: 'Links already saved',
		});
		const savedLinksLabel = dialog.getByText('Links already saved', {
			exact: true,
		});
		for (const viewport of [
			{width: 440, height: 956},
			{width: 768, height: 1024},
			{width: 1440, height: 900},
			{width: 1920, height: 1080},
		]) {
			await page.setViewportSize(viewport);
			await assertInline(targetLabel, targetColumn, 'bookmark column picker');
			await assertInline(
				savedLinksLabel,
				savedLinksControl,
				'saved links selector',
			);
		}

		await captureEvidence(page, `bookmark-import-flat-${theme}.png`);
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
					(node: ScrollElement) => node.scrollHeight <= node.clientHeight + 1,
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
				(node: ScrollElement & {scrollWidth: number; clientWidth: number}) =>
					node.scrollWidth <= node.clientWidth + 1,
			),
			'the review fits a narrow screen',
		);
		await page.screenshot({
			path: `.dev/evidence/import-narrow-${theme}.png`,
		});
		await dialog.getByRole('button', {name: 'Back'}).click();
		await page.locator('input[type="file"]').setInputFiles({
			name: 'bookmarks.html',
			mimeType: 'text/html',
			buffer: Buffer.from(
				'<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Research</H3><DL><p><DT><A HREF="https://example.com/folder">Folder bookmark</A></DL><p></DL><p>',
			),
		});
		await dialog
			.getByRole('heading', {name: 'Review bookmark import'})
			.waitFor();
		const folderOption = dialog.getByRole('radio', {
			name: 'Columns from folders',
		});
		assert.equal(
			await folderOption.count(),
			1,
			'foldered bookmark imports should offer columns from folders',
		);
		await captureEvidence(page, `bookmark-import-folders-${theme}.png`);
		await folderOption.focus();
		await page.keyboard.press('Space');
		assert.equal(await folderOption.isChecked(), true);
		const oneColumnOption = dialog.getByRole('radio', {
			name: 'One column',
		});
		await oneColumnOption.focus();
		await page.keyboard.press('Space');
		assert.equal(await oneColumnOption.isChecked(), true);
		assert.equal(
			await dialog
				.getByRole('combobox', {
					name: 'Column for every imported bookmark',
				})
				.count(),
			1,
			'one-column mode should show the column picker',
		);
		await captureEvidence(page, `bookmark-import-one-column-${theme}.png`);
		await page.close();
	});
}

export async function importNewColumnCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
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
			const importAction = dialog.getByRole('button', {
				name: 'Import 1 bookmark',
				exact: true,
			});
			await importAction.waitFor();
			await until(
				async () =>
					(await page.locator(':focus').textContent())?.trim() ===
					'Import 1 bookmark',
				'focus to move to the Import action',
			);
			assert.equal(
				await dialog.getByRole('radio', {name: 'Columns from folders'}).count(),
				0,
			);
			assert.equal(
				await dialog
					.getByRole('radio', {name: 'One column', exact: true})
					.count(),
				0,
			);
			const columnSelect = dialog.getByRole('combobox', {
				name: 'Column for every imported bookmark',
			});
			await columnSelect.waitFor();
			await columnSelect.focus();
			await page.keyboard.press('Space');
			const newColumnOption = page.getByRole('option', {
				name: 'New column',
				exact: true,
			});
			await newColumnOption.waitFor();
			await newColumnOption.press('Enter');
			assert.equal(
				await dialog
					.getByRole('button', {name: 'Import 1 bookmark', exact: true})
					.isEnabled(),
				false,
				'a new column needs a name',
			);
			await dialog.getByRole('textbox', {name: 'New column name'}).fill(name);
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
}

export async function pasteNewColumnCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
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
}

export async function savedTabNewColumnCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(`bookmark a saved tab into a new column (${theme})`, async () => {
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
		await dialog.getByRole('textbox', {name: 'New column name'}).fill(name);
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
	});
}

export async function browserBookmarksImportCheck(env: Env, theme: Theme) {
	const {context, extensionId, worker} = env;
	await check(
		`browser bookmarks import into a new column (${theme})`,
		async () => {
			const url = `https://example.com/browser-import-${theme}`;
			const browserBookmarkId = await worker.evaluate(async (bookmarkUrl) => {
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
			}, url);
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
					.getByRole('heading', {name: 'Review bookmark import'})
					.waitFor();
				const oneColumnMode = dialog.getByRole('radio', {
					name: 'One column',
					exact: true,
				});
				// The dialog moves focus to Import on the next frame after the review appears; a key
				// pressed before that lands on Import and would run the import.
				await until(
					async () =>
						dialog
							.getByRole('button', {name: 'Import 1 bookmark', exact: true})
							.evaluate(
								(element: {ownerDocument: {activeElement: unknown}}) =>
									element === element.ownerDocument.activeElement,
							),
					'focus to move to the Import button',
				);
				await oneColumnMode.press('Space');
				await until(
					() => oneColumnMode.isChecked(),
					'one column import mode to be selected',
				);
				const columnPicker = dialog.getByRole('combobox', {
					name: 'Column for every imported bookmark',
				});
				await columnPicker.waitFor();
				await columnPicker.press('Space');
				await page
					.getByRole('option', {name: 'New column', exact: true})
					.press('Enter');
				const name = `Browser import ${theme}`;
				await dialog.getByRole('textbox', {name: 'New column name'}).fill(name);
				await dialog
					.getByRole('button', {name: 'Import 1 bookmark', exact: true})
					.press('Enter');
				await dialog.waitFor({state: 'hidden'});
				const column = page
					.locator('section[data-column-id]')
					.filter({has: page.getByRole('heading', {name, exact: true})});
				await column.waitFor();
				assert.equal(
					await column.locator(`[data-bookmark-id] a[href="${url}"]`).count(),
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
