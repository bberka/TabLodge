import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fromRoot} from '../vite-shared.ts';
import {EVIDENCE_VIEWPORTS, withMobileEmulation} from './evidence.ts';
import {readDevStore, seed} from './fixtures.ts';
import {check, type Env, type Theme} from './harness.ts';
import {openMenuItemByKeyboard, openPage, setTheme} from './pages.ts';

export async function sessionShareCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`share one session, or save it as a file, from its menu by keyboard (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await seed(page);
			await page.reload();
			await setTheme(page, theme);
			const card = page.locator('#session-dev-session-1');
			const name = 'Home lab rebuild';
			const trigger = card.locator('[data-move-focus]');

			await openMenuItemByKeyboard(page, trigger, 'Share');
			const shareDialog = page.getByRole('dialog');
			await shareDialog.waitFor();
			assert.equal(await shareDialog.locator('h4').textContent(), name);
			assert.equal(await shareDialog.locator('h5').count(), 0);
			await mkdir(fromRoot('.dev/evidence'), {recursive: true});
			await shareDialog.screenshot({
				path: fromRoot(`.dev/evidence/session-share-${theme}.png`),
			});

			const shareDownloadPromise = page.waitForEvent('download');
			await shareDialog
				.getByRole('button', {name: 'Download', exact: true})
				.focus();
			await page.keyboard.press('Enter');
			const shareDownload = await shareDownloadPromise;
			const sharePath = await shareDownload.path();
			assert.ok(sharePath);
			const shareHtml = await readFile(sharePath, 'utf8');
			assert.match(shareHtml, /<h1>Home lab rebuild<\/h1>/);
			assert.doesNotMatch(shareHtml, /<h2>Home lab rebuild<\/h2>/);
			await shareDialog.waitFor({state: 'hidden'});

			await openMenuItemByKeyboard(page, trigger, 'Share');
			const exportDialog = page.getByRole('dialog');
			await exportDialog.waitFor();
			const exportScope = exportDialog.getByRole('radiogroup', {
				name: 'What to share',
			});
			assert.equal(await exportScope.count(), 1);
			const allSessions = exportScope.getByRole('radio', {
				name: /^All sessions/,
			});
			await exportScope
				.getByRole('radio', {name: new RegExp(`^${name}`)})
				.focus();
			await page.keyboard.press('ArrowRight');
			assert.equal(await allSessions.isChecked(), true);
			const jsonWay = exportDialog.getByRole('radio', {name: /^JSON file/});
			await jsonWay.focus();
			await page.keyboard.press('Space');
			assert.equal(await jsonWay.isChecked(), true);
			const allSessionsDownloadPromise = page.waitForEvent('download');
			await exportDialog
				.getByRole('button', {name: 'Download', exact: true})
				.focus();
			await page.keyboard.press('Enter');
			const allSessionsDownload = await allSessionsDownloadPromise;
			const allSessionsPath = await allSessionsDownload.path();
			assert.ok(allSessionsPath);
			const allSessionsJson = JSON.parse(
				await readFile(allSessionsPath, 'utf8'),
			) as {groups: Array<{name: string}>};
			assert.ok(allSessionsJson.groups.some((group) => group.name === name));
			assert.ok(allSessionsJson.groups.length > 1);
			await exportDialog.waitFor({state: 'hidden'});

			await openMenuItemByKeyboard(page, trigger, 'Share');
			const currentExportDialog = page.getByRole('dialog');
			await currentExportDialog.waitFor();

			const htmlFormat = currentExportDialog.getByRole('radio', {
				name: /Browser bookmarks \(HTML\)/,
			});
			await htmlFormat.focus();
			await page.keyboard.press('Space');
			assert.equal(await htmlFormat.isChecked(), true);
			await mkdir(fromRoot('.dev/evidence'), {recursive: true});
			await currentExportDialog.screenshot({
				path: fromRoot(`.dev/evidence/session-export-${theme}.png`),
			});
			const exportDownloadPromise = page.waitForEvent('download');
			await currentExportDialog
				.getByRole('button', {name: 'Download', exact: true})
				.focus();
			await page.keyboard.press('Enter');
			const exportDownload = await exportDownloadPromise;
			assert.match(
				exportDownload.suggestedFilename(),
				/^tablodge-sessions-home-lab-rebuild-\d{4}-\d{2}-\d{2}\.html$/,
			);
			const exportPath = await exportDownload.path();
			assert.ok(exportPath);
			const exportHtml = await readFile(exportPath, 'utf8');
			assert.match(exportHtml, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
			assert.match(exportHtml, /Home lab rebuild/);
			assert.doesNotMatch(exportHtml, /Quarterly planning/);
			await page.close();
		},
	);
}

export async function columnShareTitleCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`bookmark column share does not repeat its title (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await seed(page);
			await page.reload();
			await setTheme(page, theme);
			const column = page.locator('section[data-column-id]').first();
			const trigger = column.locator('header [data-move-focus]');

			await openMenuItemByKeyboard(page, trigger, 'Share');
			const dialog = page.getByRole('dialog');
			await dialog.waitFor();
			assert.equal(await dialog.locator('h4').textContent(), 'Daily');
			assert.equal(await dialog.locator('h5').count(), 0);
			await mkdir(fromRoot('.dev/evidence'), {recursive: true});
			await dialog.screenshot({
				path: fromRoot(`.dev/evidence/bookmark-share-${theme}.png`),
			});

			const downloadPromise = page.waitForEvent('download');
			await dialog.getByRole('button', {name: 'Download', exact: true}).focus();
			await page.keyboard.press('Enter');
			const download = await downloadPromise;
			const path = await download.path();
			assert.ok(path);
			const html = await readFile(path, 'utf8');
			assert.match(html, /<h1>Daily<\/h1>/);
			assert.doesNotMatch(html, /<h2>Daily<\/h2>/);
			assert.match(html, /Gmail/);
			await page.close();
		},
	);
}

export async function columnShareFileCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`bookmark column share saves this column or all bookmarks as a file (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await seed(page);
			await page.reload();
			await setTheme(page, theme);
			const column = page.locator('section[data-column-id]').first();
			const trigger = column.locator('header [data-move-focus]');
			await openMenuItemByKeyboard(page, trigger, 'Share');
			const dialog = page.getByRole('dialog');
			await dialog.waitFor();
			const choices = dialog.getByRole('radiogroup', {
				name: 'What to share',
			});
			assert.equal(await choices.count(), 1);
			const current = choices.getByRole('radio', {name: /^Daily/});
			const allBookmarks = choices.getByRole('radio', {
				name: /^All bookmarks/,
			});
			await current.focus();
			await page.keyboard.press('ArrowRight');
			assert.equal(await allBookmarks.isChecked(), true);
			await page.keyboard.press('ArrowLeft');
			assert.equal(await current.isChecked(), true);
			const jsonWay = dialog.getByRole('radio', {name: /^JSON file/});
			await jsonWay.focus();
			await page.keyboard.press('Space');
			assert.equal(await jsonWay.isChecked(), true);
			await mkdir(fromRoot('.dev/evidence'), {recursive: true});
			await dialog.screenshot({
				path: fromRoot(`.dev/evidence/bookmark-export-${theme}.png`),
			});

			const downloadPromise = page.waitForEvent('download');
			await dialog.getByRole('button', {name: 'Download', exact: true}).focus();
			await page.keyboard.press('Enter');
			const download = await downloadPromise;
			const path = await download.path();
			assert.ok(path);
			const exported = JSON.parse(await readFile(path, 'utf8')) as {
				bookmarkColumns: Array<{name: string}>;
				bookmarks: Array<{columnId: string}>;
			};
			assert.deepEqual(
				exported.bookmarkColumns.map((entry) => entry.name),
				['Daily'],
			);
			assert.ok(exported.bookmarks.length > 0);
			assert.ok(
				exported.bookmarks.every(
					(bookmark) => bookmark.columnId === 'bookmark-daily',
				),
			);
			await page.close();
		},
	);
}

export async function sharePreviewCheck(env: Env) {
	const {context, extensionId} = env;
	await check('share preview stays inside the dialog', async () => {
		const page = await openPage(context, extensionId, 'newtab');
		await page.setViewportSize({width: 900, height: 700});
		await page
			.getByRole('button', {name: 'More actions for Home lab rebuild'})
			.click();
		await page.getByRole('menuitem', {name: 'Share', exact: true}).click();
		const dialog = page.getByRole('dialog');
		await dialog.locator('label', {hasText: 'Markdown'}).first().click();
		const preview = dialog.locator('pre').first();
		// One address with no break points, as a long tracking link has, used to stretch the whole dialog.
		await preview.evaluate((element) => {
			const target = element as unknown as {textContent: string};
			target.textContent = `- [Long](https://example.com/${'a%20b%3D'.repeat(120)})`;
		});
		const dialogBox = await dialog.boundingBox();
		const previewBox = await preview.boundingBox();
		const overflow = await preview.evaluate((element) => {
			const {scrollWidth, clientWidth} = element as unknown as {
				scrollWidth: number;
				clientWidth: number;
			};
			return scrollWidth - clientWidth;
		});
		assert.ok(dialogBox);
		assert.ok(previewBox);
		assert.ok(
			previewBox.width <= dialogBox.width,
			`the preview is ${previewBox.width}px in a ${dialogBox.width}px dialog`,
		);
		assert.equal(overflow, 0, 'the preview wraps instead of scrolling');
		await page.close();
	});
}

export async function shareAllSessionsCheck(env: Env, theme: Theme) {
	const {context, extensionId} = env;
	await check(
		`share all sessions from the Sessions menu (${theme})`,
		async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await setTheme(page, theme);
			const currentSessions = await readDevStore(page);
			const linkCount = currentSessions.groups.reduce(
				(count, group) => count + group.tabs.length,
				0,
			);
			const linksLabel = linkCount === 1 ? 'link' : 'links';
			const groupsLabel =
				currentSessions.groups.length === 1 ? 'group' : 'groups';
			const trigger = page.getByRole('button', {
				name: 'Import and back up sessions',
			});
			await openMenuItemByKeyboard(page, trigger, 'Share and export sessions');
			const dialog = page.getByRole('dialog');
			await dialog.waitFor();
			await dialog
				.getByText(
					`${linkCount} ${linksLabel} in ${currentSessions.groups.length} ${groupsLabel}`,
				)
				.waitFor();
			await mkdir(fromRoot('.dev/evidence'), {recursive: true});
			for (const [width, height] of EVIDENCE_VIEWPORTS) {
				await page.setViewportSize({width, height});
				if (width === 440) {
					await withMobileEmulation(page, {width, height}, async (device) => {
						const {data} = await device.send('Page.captureScreenshot', {
							format: 'png',
							captureBeyondViewport: false,
						});
						await writeFile(
							fromRoot(
								`.dev/evidence/share-all-sessions-${width}x${height}-dsf3-${theme}.png`,
							),
							Buffer.from(data, 'base64'),
						);
					});
				} else {
					await page.screenshot({
						animations: 'disabled',
						path: fromRoot(
							`.dev/evidence/share-all-sessions-${width}x${height}-${theme}.png`,
						),
					});
				}
			}

			await page.keyboard.press('Escape');
			await page.close();
		},
	);
}
