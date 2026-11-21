// Accessibility checks against the built extension (run `vp run build` first, then `vp run check:a11y`).
//
// Loads dist/tablodge in a headless Chromium with the development data fixture, then:
//   1. runs axe-core (WCAG 2.2 A and AA rules) on each extension page in both themes, and
//   2. exercises the keyboard workflows that automated rules cannot judge: the skip link, the
//      Appearance radio group, bookmark quick actions, moving sessions, columns and bookmarks
//      without dragging, and archiving a session from its menu. Page and service worker console
//      errors fail the run.
// Axe and keyboard checks do not judge reading order or screen reader announcements; see docs/CONTRIBUTING.md.
//
// This file runs the checks in a fixed order and reports; each area of the extension keeps its checks in its own module
// beside it, and the helpers they share are in harness.ts, fixtures.ts, pages.ts and evidence.ts.
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {chromium} from 'playwright';
import {OUT_DIR, fromRoot} from '../vite-shared.ts';
import {captureMobileExportEvidence} from './evidence.ts';
import {seed} from './fixtures.ts';
import {
	check,
	consoleErrors,
	eachTheme,
	type Env,
	failures,
	watchConsole,
} from './harness.ts';
import {openPage} from './pages.ts';
import {axeCheck} from './axe.ts';
import {
	boardLayoutCheck,
	bookmarkAddToSessionCheck,
	bookmarkMenuQuickActionsCheck,
	bookmarkMoveCheck,
	bookmarkQuickActionsCheck,
	columnCapCheck,
	columnMoveCheck,
	duplicateBookmarksCheck,
	focusViewCheck,
	statisticsCheck,
} from './bookmark-board.ts';
import {
	browserBookmarksImportCheck,
	importNewColumnCheck,
	importScopeCheck,
	importScrollingCheck,
	pasteNewColumnCheck,
	protectedBackupCheck,
	savedTabNewColumnCheck,
} from './import-export.ts';
import {
	openSettingsLayoutCheck,
	paletteActionsMenuCheck,
	paletteFooterCheck,
	paletteOverlayCheck,
	paletteWindowCheck,
} from './palette.ts';
import {
	addBookmarkNewColumnCheck,
	archivedHiddenCheck,
	popupNewColumnCheck,
	popupUnsavablePageCheck,
} from './popup.ts';
import {
	altClickLinkCheck,
	bookmarkSelectionCheck,
	bulkSelectionActionsCheck,
	dragSelectedBookmarksCheck,
	dragSelectedLinksCheck,
	moveDeleteSelectedCheck,
	moveSelectedToNewColumnCheck,
	selectionModeRangesCheck,
	sessionHeaderCheckboxCheck,
} from './selection.ts';
import {
	sessionCardQuickActionsCheck,
	sessionFaviconPreviewsCheck,
	sessionQuickActionMenuCheck,
} from './session-cards.ts';
import {
	closeDuplicateTabsCheck,
	sessionArchiveCheck,
	sessionFolderMoveFocusCheck,
	sessionMenuOrderCheck,
	sessionMoveCheck,
	sessionReplaceAppendSplitCheck,
	submenuOpenerCheck,
} from './session-menus.ts';
import {
	appearanceCheck,
	backupsDialogCheck,
	settingResetCheck,
	settingsFinderCheck,
	settingsNarrowLayoutCheck,
	settingsSearchCheck,
	siteSourcePickerCheck,
	siteSourceRemoveCheck,
	skipLinkCheck,
} from './settings.ts';
import {
	columnShareFileCheck,
	columnShareTitleCheck,
	sessionShareCheck,
	shareAllSessionsCheck,
	sharePreviewCheck,
} from './share.ts';
import {
	dialogFocusReturnCheck,
	narrowHeaderCheck,
	searchAnnouncementCheck,
	sidePanelHeaderIconsCheck,
	sidePanelTitleCheck,
	syncButtonCheck,
} from './shell.ts';

async function main() {
	const profile = await mkdtemp(join(tmpdir(), 'tablodge-a11y-'));
	const context = await chromium.launchPersistentContext(profile, {
		channel: 'chromium',
		headless: true,
		args: [
			`--disable-extensions-except=${OUT_DIR}`,
			`--load-extension=${OUT_DIR}`,
		],
	});
	// Waits end as soon as their condition holds; the longer limit only matters on a loaded machine.
	context.setDefaultTimeout(60_000);
	context.setDefaultNavigationTimeout(60_000);
	try {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		const worker =
			context.serviceWorkers()[0] ??
			(await context.waitForEvent('serviceworker', {timeout: 60_000}));
		watchConsole(worker, 'service worker');
		const extensionId = new URL(worker.url()).hostname;
		const axeSource = await readFile(
			fromRoot('node_modules/axe-core/axe.min.js'),
			'utf8',
		);
		const env: Env = {context, extensionId, axeSource, worker};

		const seedPage = await openPage(context, extensionId, 'newtab');
		await seed(seedPage);
		await seedPage.close();
		await settingsSearchCheck(env);
		await settingsNarrowLayoutCheck(env);
		await settingsFinderCheck(env);
		await eachTheme(env, [siteSourcePickerCheck, siteSourceRemoveCheck]);
		await eachTheme(env, [backupsDialogCheck]);
		await eachTheme(env, [sessionCardQuickActionsCheck]);
		await eachTheme(env, [sessionFaviconPreviewsCheck]);
		await eachTheme(env, [
			sessionQuickActionMenuCheck,
			narrowHeaderCheck,
			sidePanelHeaderIconsCheck,
			sidePanelTitleCheck,
		]);
		await eachTheme(env, [
			bookmarkQuickActionsCheck,
			bookmarkMenuQuickActionsCheck,
			columnCapCheck,
			focusViewCheck,
			boardLayoutCheck,
			statisticsCheck,
			importScopeCheck,
			protectedBackupCheck,
			duplicateBookmarksCheck,
			importScrollingCheck,
			importNewColumnCheck,
			pasteNewColumnCheck,
			savedTabNewColumnCheck,
			bulkSelectionActionsCheck,
			sessionHeaderCheckboxCheck,
			moveSelectedToNewColumnCheck,
			altClickLinkCheck,
			dragSelectedLinksCheck,
			sessionShareCheck,
			columnShareTitleCheck,
			columnShareFileCheck,
		]);
		await popupUnsavablePageCheck(env);
		await eachTheme(env, [
			popupNewColumnCheck,
			addBookmarkNewColumnCheck,
			browserBookmarksImportCheck,
		]);
		await eachTheme(env, [syncButtonCheck]);
		await axeCheck(env);
		await eachTheme(env, [paletteWindowCheck]);
		await eachTheme(env, [paletteOverlayCheck]);
		await eachTheme(env, [openSettingsLayoutCheck]);
		await eachTheme(env, [paletteActionsMenuCheck]);
		await eachTheme(env, [paletteFooterCheck]);
		await eachTheme(env, [
			selectionModeRangesCheck,
			moveDeleteSelectedCheck,
			dragSelectedBookmarksCheck,
			bookmarkSelectionCheck,
		]);
		await skipLinkCheck(env);
		await appearanceCheck(env);
		await eachTheme(env, [settingResetCheck]);
		await bookmarkMoveCheck(env);
		await columnMoveCheck(env);
		await sessionMoveCheck(env);
		await sessionArchiveCheck(env);
		await eachTheme(env, [sessionFolderMoveFocusCheck]);
		await eachTheme(env, [closeDuplicateTabsCheck]);
		await archivedHiddenCheck(env);
		await sharePreviewCheck(env);
		await eachTheme(env, [
			submenuOpenerCheck,
			sessionMenuOrderCheck,
			sessionReplaceAppendSplitCheck,
			shareAllSessionsCheck,
		]);
		await dialogFocusReturnCheck(env);
		await searchAnnouncementCheck(env);
		await bookmarkAddToSessionCheck(env);

		if (process.env.TABLODGE_CAPTURE_EVIDENCE === '1') {
			await check('mobile export dialog evidence at DSF 3', async () => {
				await captureMobileExportEvidence(extensionId);
			});
		}

		if (consoleErrors.length > 0) {
			failures.push('browser console errors');
			for (const error of consoleErrors) {
				console.log(`FAIL ${error}`);
			}
		}
	} finally {
		await context.close();
		await rm(profile, {recursive: true, force: true});
	}

	if (failures.length > 0) {
		console.log(`\n${failures.length} accessibility check(s) failed.`);
		process.exitCode = 1;
	} else {
		console.log('\nAll accessibility checks passed.');
	}
}

await main();
