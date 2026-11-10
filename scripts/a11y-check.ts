// Accessibility checks against the built extension (run `vp run build` first, then `vp run a11y`).
//
// Loads dist/tablodge in a headless Chromium with the development data fixture, then:
//   1. runs axe-core (WCAG 2.2 A and AA rules) on each extension page in both themes, and
//   2. exercises the keyboard workflows that automated rules cannot judge: the skip link, the
//      Appearance radio group, bookmark quick actions, moving sessions, columns and bookmarks
//      without dragging, and archiving a session from its menu. Page and service worker console
//      errors fail the run.
// Axe and keyboard checks do not judge reading order or screen reader announcements; see docs/CONTRIBUTING.md.
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {createServer, type Server} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {
	chromium,
	type BrowserContext,
	type Locator,
	type Page,
	type Worker,
} from 'playwright';
import {createDevFixture, type DevStore} from './dev-fixture.ts';
import {OUT_DIR, fromRoot} from './vite-shared.ts';

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGES = [
	'newtab',
	'options',
	'help',
	'popup',
	'sidepanel',
	'palette',
] as const;
const THEMES = ['light', 'dark'] as const;
const EVIDENCE_VIEWPORTS = [
	[440, 956],
	[768, 1024],
	[1440, 900],
	[1920, 1080],
] as const;

type ExtensionApi = {
	runtime: {sendMessage(message: unknown): Promise<unknown>};
	storage: {local: {set(items: Record<string, unknown>): Promise<void>}};
	tabs: {
		query(info: {
			url?: string;
			active?: boolean;
			lastFocusedWindow?: boolean;
		}): Promise<unknown[]>;
	};
};
type AxeResults = {
	violations: Array<{
		id: string;
		help: string;
		nodes: Array<{target: unknown[]; failureSummary?: string}>;
	}>;
};
type AxeOptions = {runOnly: {type: 'rule' | 'tag'; values: string[]}};
type AxeGlobal = {axe: {run(options: AxeOptions): Promise<AxeResults>}};
type ScrollElement = {scrollHeight: number; clientHeight: number};
type ScrollViewport = typeof globalThis & {
	scrollY: number;
	scrollTo(x: number, y: number): void;
};

const failures: string[] = [];
const consoleErrors: string[] = [];

function watchConsole(target: Page | Worker, source: string) {
	target.on('console', (message) => {
		if (message.type() === 'error') {
			consoleErrors.push(`${source}: ${message.text()}`);
		}
	});
}

// A11Y_ONLY=text runs only the checks whose name contains the text, to repeat one check.
const onlyChecks = process.env.A11Y_ONLY;

async function check(name: string, run: () => Promise<void>) {
	if (onlyChecks && !name.includes(onlyChecks)) {
		return;
	}

	try {
		await run();
		console.log(`ok   ${name}`);
	} catch (error) {
		failures.push(name);
		console.log(`FAIL ${name}`);
		console.log(
			`     ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

// Polls until the condition holds, for up to 15 seconds. The pages redraw asynchronously after each action.
async function until(condition: () => Promise<boolean>, what: string) {
	for (let attempt = 0; attempt < 150; attempt += 1) {
		if (await condition()) {
			return;
		}

		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});
	}

	assert.fail(`Timed out waiting for ${what}.`);
}

async function selectQuickActions(
	page: Page,
	menu: Locator,
	labels: string[],
	kind: 'session' | 'bookmark',
) {
	for (const label of labels) {
		const option = menu.getByRole('button', {
			name: `Add ${label}`,
			exact: true,
		});
		await option.focus();
		await page.keyboard.press('Enter');
		await until(
			async () => (await option.count()) === 0,
			`${label} ${kind} action to be selected`,
		);
	}
}

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

async function readDevStore(page: Page) {
	const base = await page.evaluate(async () => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		return chrome.runtime.sendMessage({type: 'GET_STATE'});
	});
	const {ok: _ok, ...store} = base as {ok: boolean} & DevStore;
	return store;
}

async function countTabs(page: Page, url: string) {
	return page.evaluate(async (address) => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		return (await chrome.tabs.query({url: address})).length;
	}, url);
}

async function writeDevStore(page: Page, store: DevStore) {
	await page.evaluate(async (data) => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		await chrome.storage.local.set({'tablodge.state': data});
	}, store);
}

async function seed(page: Page) {
	const fixture = createDevFixture(await readDevStore(page));
	fixture.settings = {
		...fixture.settings,
		limitBookmarksPerColumn: false,
		bookmarkColumnPageSize: 10,
	};
	await writeDevStore(page, fixture);
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

// Tiny local pages, so the test window has web tabs that a replace or append can read.
async function startPageServer() {
	const server = createServer((request, response) => {
		response.setHeader('content-type', 'text/html');
		response.end(`<title>Local ${request.url}</title><h1>${request.url}</h1>`);
	});
	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', resolve);
	});
	return {
		server,
		origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
	};
}

async function closeServer(server: Server) {
	await new Promise<void>((resolve) => {
		server.close(() => {
			resolve();
		});
	});
}

async function sessionUrls(page: Page, groupId: string) {
	const store = await readDevStore(page);
	return store.groups
		.find((group) => group.id === groupId)
		?.tabs.map((tab) => tab.url);
}

async function groupFolderId(page: Page, groupId: string) {
	const state = (await page.evaluate(async () => {
		const {chrome} = globalThis as typeof globalThis & {chrome: ExtensionApi};
		return chrome.runtime.sendMessage({type: 'GET_STATE'});
	})) as {groups: Array<{id: string; folderId: string}>};
	return state.groups.find((group) => group.id === groupId)?.folderId;
}

// The pages follow the system theme by default, so emulating the color scheme switches them.
async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
	await page.emulateMedia({colorScheme: theme});
	// Colors transition between themes; measure contrast after they settle.
	await page.evaluate(async () => {
		const {document, requestAnimationFrame} =
			globalThis as typeof globalThis & {
				document: {getAnimations(): Array<{finished: Promise<unknown>}>};
				requestAnimationFrame(callback: () => void): number;
			};
		// The style change applies on the next frame, which is when its transitions start.
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					resolve();
				});
			});
		});
		await Promise.allSettled(
			document.getAnimations().map(async (animation) => animation.finished),
		);
	});
}

// Opens a menu from its trigger by keyboard. A card can redraw right after the page settles and drop
// focus, so the key press is repeated until a menu is open. An open menu hides the trigger from the
// accessibility tree, so the menu itself is checked rather than the trigger.
async function openMenuByKeyboard(page: Page, trigger: Locator) {
	const menu = page.getByRole('menu');
	await until(async () => {
		if ((await menu.count()) > 0) {
			return true;
		}

		await trigger.focus();
		await page.keyboard.press('Enter');
		return (await menu.count()) > 0;
	}, 'the menu to open');
}

async function openMenuItemByKeyboard(
	page: Page,
	trigger: Locator,
	name: string,
) {
	await openMenuByKeyboard(page, trigger);
	await page.getByRole('menuitem', {name, exact: true}).focus();
	await page.keyboard.press('Enter');
}

async function openPage(
	context: BrowserContext,
	extensionId: string,
	name: string,
) {
	const page = await context.newPage();
	watchConsole(page, `${name} page`);
	page.on('pageerror', (error) => {
		failures.push(`${name}: ${error.message}`);
		console.log(`FAIL ${name} page error: ${error.message}`);
	});
	await page.setViewportSize({width: 1280, height: 900});
	await page.goto(`chrome-extension://${extensionId}/${name}.html`);
	await page.waitForLoadState('networkidle');
	return page;
}

async function captureMobileExportEvidence(extensionId: string) {
	const profile = await mkdtemp(join(tmpdir(), 'tablodge-mobile-evidence-'));
	const context = await chromium.launchPersistentContext(profile, {
		channel: 'chromium',
		headless: true,
		viewport: {width: 440, height: 956},
		deviceScaleFactor: 3,
		isMobile: true,
		args: [
			`--disable-extensions-except=${OUT_DIR}`,
			`--load-extension=${OUT_DIR}`,
		],
	});
	try {
		const page = await context.newPage();
		await page.goto(`chrome-extension://${extensionId}/newtab.html`);
		await page.waitForLoadState('networkidle');
		await seed(page);
		await page.reload();
		await setTheme(page, 'light');
		const trigger = page
			.locator('#session-dev-session-1 [data-move-focus]')
			.first();
		await openMenuItemByKeyboard(page, trigger, 'Export session');
		await page.getByRole('menu').waitFor({state: 'hidden'});
		await page.getByRole('radiogroup', {name: 'What to export'}).waitFor();
		await mkdir(fromRoot('.dev/evidence'), {recursive: true});
		await page.screenshot({
			path: fromRoot('.dev/evidence/session-export-440x956-dsf3.png'),
			animations: 'disabled',
		});
	} finally {
		await context.close();
		await rm(profile, {recursive: true, force: true});
	}
}

async function axeViolationLines(
	page: Page,
	source: string,
	runOnly: AxeOptions['runOnly'] = {type: 'tag', values: AXE_TAGS},
) {
	// Evaluated through the protocol because the extension CSP blocks inline scripts.
	await page.evaluate(source);
	const results = await page.evaluate(
		async (options: AxeOptions['runOnly']) =>
			(globalThis as typeof globalThis & AxeGlobal).axe.run({
				runOnly: options,
			}),
		runOnly,
	);
	return results.violations.map(
		(violation) =>
			`${violation.id}: ${violation.help} (${violation.nodes.length}) targets: ${violation.nodes.map((node) => `${node.target.join(' ')} ${node.failureSummary ?? ''}`).join(', ')}`,
	);
}

const attributes = (page: Page, selector: string, name: string) =>
	page
		.locator(selector)
		.evaluateAll(
			(
				nodes: Array<{getAttribute(name: string): string | null}>,
				attribute: string,
			) => nodes.map((node) => node.getAttribute(attribute)),
			name,
		);

// The control holding keyboard focus, by its accessible name.
const focusedLabel = (page: Page) =>
	page.locator(':focus').getAttribute('aria-label');

type DevtoolsSession = Awaited<ReturnType<BrowserContext['newCDPSession']>>;

async function withMobileEmulation(
	page: Page,
	viewport: {width: number; height: number},
	capture: (device: DevtoolsSession) => Promise<void>,
	withTouch = false,
) {
	const device = await page.context().newCDPSession(page);
	try {
		await device.send('Emulation.setDeviceMetricsOverride', {
			...viewport,
			deviceScaleFactor: 3,
			mobile: true,
			screenWidth: viewport.width,
			screenHeight: viewport.height,
			screenOrientation: {angle: 0, type: 'portraitPrimary'},
		});
		if (withTouch) {
			await device.send('Emulation.setTouchEmulationEnabled', {
				enabled: true,
				maxTouchPoints: 1,
			});
		}

		await capture(device);
	} finally {
		if (withTouch) {
			await device.send('Emulation.setTouchEmulationEnabled', {enabled: false});
		}

		await device.send('Emulation.clearDeviceMetricsOverride');
		await device.detach();
	}
}

// Screenshots of the current page state at the four evidence profiles; the phone profile uses device emulation.
async function captureViewports(page: Page, name: string, theme: string) {
	await mkdir(fromRoot('.dev/evidence'), {recursive: true});
	for (const [width, height] of EVIDENCE_VIEWPORTS) {
		await page.setViewportSize({width, height});
		if (width === 440) {
			await withMobileEmulation(page, {width, height}, async (device) => {
				// The toast fades in; let it settle so the capture shows it opaque.
				await page.waitForTimeout(600);
				const {data} = await device.send('Page.captureScreenshot', {
					format: 'png',
					captureBeyondViewport: false,
				});
				await writeFile(
					fromRoot(
						`.dev/evidence/${name}-${width}x${height}-dsf3-${theme}.png`,
					),
					Buffer.from(data, 'base64'),
				);
			});
		} else {
			await page.screenshot({
				animations: 'disabled',
				path: fromRoot(`.dev/evidence/${name}-${width}x${height}-${theme}.png`),
			});
		}
	}

	await page.setViewportSize({width: 1440, height: 900});
}

async function captureEvidence(
	page: Page,
	name: string,
	target?: Locator,
	hoverTarget?: Locator,
) {
	if (process.env.TABLODGE_CAPTURE_EVIDENCE !== '1') {
		return;
	}

	const directory = fromRoot('.dev/evidence');
	const viewport = page.viewportSize();
	assert.ok(viewport);
	await mkdir(directory, {recursive: true});
	for (const [width, height] of EVIDENCE_VIEWPORTS) {
		await page.setViewportSize({width, height});
		if (target) {
			await target.scrollIntoViewIfNeeded();
		}

		if (hoverTarget) {
			await hoverTarget.hover();
			await hoverTarget.evaluate(
				async (node: {
					getAnimations(options: {subtree: boolean}): Array<{
						finished: Promise<unknown>;
					}>;
				}) =>
					Promise.all(
						node
							.getAnimations({subtree: true})
							.map((animation) => animation.finished),
					),
			);
		}

		const sizedName = `${name.slice(0, -4)}-${width}x${height}.png`;
		const capture = async () => {
			await target?.scrollIntoViewIfNeeded();
			await page.screenshot({
				path: join(directory, sizedName),
				scale: 'device',
			});
		};

		if (width === 440) {
			await withMobileEmulation(
				page,
				{width, height},
				async () => {
					if (target) {
						await target.scrollIntoViewIfNeeded();
					}

					if (hoverTarget) {
						await hoverTarget.hover();
						await hoverTarget.evaluate(
							async (node: {
								getAnimations(options: {subtree: boolean}): Array<{
									finished: Promise<unknown>;
								}>;
							}) =>
								Promise.all(
									node
										.getAnimations({subtree: true})
										.map((animation) => animation.finished),
								),
						);
					}

					const deviceScaleFactor = await page.locator('body').evaluate(
						(node: {
							ownerDocument: {
								defaultView: {devicePixelRatio: number} | null;
							};
						}) => {
							const view = node.ownerDocument.defaultView;
							return view?.devicePixelRatio ?? 1;
						},
					);
					assert.equal(deviceScaleFactor, 3, 'phone evidence uses DPR 3');
					await capture();
				},
				true,
			);
		} else {
			await capture();
		}
	}

	await page.setViewportSize(viewport);
}

async function captureNarrowEvidence(
	page: Page,
	name: string,
	target: Locator,
) {
	if (process.env.TABLODGE_CAPTURE_EVIDENCE !== '1') {
		return;
	}

	const viewport = page.viewportSize();
	assert.ok(viewport);
	await mkdir(fromRoot('.dev/evidence'), {recursive: true});
	try {
		await page.setViewportSize({width: 375, height: 812});
		await target.scrollIntoViewIfNeeded();
		assert.ok(
			await page
				.locator('html')
				.evaluate(
					(node: {scrollWidth: number; clientWidth: number}) =>
						node.scrollWidth <= node.clientWidth,
				),
			'page overflows at 375px',
		);
		await page.screenshot({
			path: fromRoot(`.dev/evidence/${name}`),
			scale: 'css',
		});
	} finally {
		await page.setViewportSize(viewport);
	}
}

async function assertInline(
	label: Locator,
	control: Locator,
	description: string,
) {
	const labelBounds = await label.boundingBox();
	const controlBounds = await control.boundingBox();
	assert.ok(labelBounds);
	assert.ok(controlBounds);
	assert.ok(
		Math.abs(
			labelBounds.y +
				labelBounds.height / 2 -
				(controlBounds.y + controlBounds.height / 2),
		) <= 2,
		`${description} should share a line`,
	);
	assert.ok(
		controlBounds.x >= labelBounds.x + labelBounds.width,
		`${description} should follow its label`,
	);
	assert.ok(
		controlBounds.x - (labelBounds.x + labelBounds.width) <= 24,
		`${description} should sit beside its label`,
	);
}

async function captureResetEvidence(
	page: Page,
	target: Locator,
	theme: string,
) {
	if (process.env.TABLODGE_CAPTURE_RESET_EVIDENCE !== '1') {
		return;
	}

	const directory = fromRoot('.dev/evidence');
	const viewport = page.viewportSize();
	assert.ok(viewport);
	await mkdir(directory, {recursive: true});
	for (const [width, height] of EVIDENCE_VIEWPORTS) {
		if (width === 440) {
			continue;
		}

		await page.setViewportSize({width, height});
		await target.scrollIntoViewIfNeeded();
		await page.screenshot({
			path: join(directory, `reset-setting-${theme}-${width}x${height}.png`),
		});
	}

	await page.setViewportSize({width: 440, height: 956});
	try {
		await withMobileEmulation(
			page,
			{width: 440, height: 956},
			async (device) => {
				await target.scrollIntoViewIfNeeded();
				assert.ok(
					await page
						.locator('html')
						.evaluate(
							(node: {scrollWidth: number; clientWidth: number}) =>
								node.scrollWidth <= node.clientWidth,
						),
					'settings overflow at 440px',
				);
				const {data} = await device.send('Page.captureScreenshot', {
					format: 'png',
					captureBeyondViewport: false,
				});
				await writeFile(
					join(directory, `reset-setting-${theme}-440x956-dsf3.png`),
					Buffer.from(data, 'base64'),
				);
			},
		);
	} finally {
		await page.setViewportSize(viewport);
	}
}

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

		const seedPage = await openPage(context, extensionId, 'newtab');
		await seed(seedPage);
		await seedPage.close();
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

		for (const theme of THEMES) {
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
					await quickActionsMenu
						.getByRole('button', {name: 'Add Delete'})
						.focus();
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
					await sessionActions
						.getByRole('button', {name: 'Add Archive'})
						.focus();
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
								button.ownerDocument.defaultView?.getComputedStyle(button)
									.color,
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
					const deleteHoverBackground = async () =>
						sessionDeleteButton.evaluate(
							(button: {
								ownerDocument: {
									defaultView: {
										getComputedStyle(element: unknown): {
											backgroundColor: string;
										};
									} | null;
								};
							}) =>
								button.ownerDocument.defaultView?.getComputedStyle(button)
									.backgroundColor,
						);
					const expectedDeleteHoverBackground =
						theme === 'light'
							? 'rgba(220, 38, 38, 0.1)'
							: 'rgba(248, 113, 113, 0.1)';
					await until(
						async () =>
							(await deleteHoverBackground()) === expectedDeleteHoverBackground,
						'Delete button hover background transition',
					);
					assert.equal(
						await deleteHoverBackground(),
						expectedDeleteHoverBackground,
					);
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
							(await groupFolderId(page, 'dev-session-1')) ===
							'archived-sessions',
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

		for (const theme of THEMES) {
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

						const settingsPage = await openPage(
							context,
							extensionId,
							'options',
						);
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

		for (const theme of THEMES) {
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
					await captureEvidence(
						options,
						`clear-quick-actions-${theme}.png`,
						menu,
					);
					assert.equal(
						await options.locator('body').evaluate(
							(node: {
								ownerDocument: {
									activeElement: {
										getAttribute(name: string): string | null;
									} | null;
								};
							}) =>
								node.ownerDocument.activeElement?.getAttribute('aria-label'),
						),
						'Find quick actions on session cards',
						'clearing quick actions returns focus to the search field',
					);
					await menu.getByRole('button', {name: 'Add Archive'}).click();
					await selectQuickActions(
						options,
						menu,
						['Share', 'Export session', 'Edit details', 'Move down'],
						'session',
					);
					for (const label of [
						'Archive',
						'Share',
						'Export session',
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

					for (const label of ['Delete', 'Move up', 'Switch to this session']) {
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
							JSON.stringify([
								'archive',
								'share',
								'export',
								'edit',
								'move-down',
							])
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
						'Export session',
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

			await check(
				`dashboard header and buttons fit narrow windows (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'newtab');
					await setTheme(page, theme);
					for (const width of [320, 480]) {
						await page.setViewportSize({width, height: 900});
						await mkdir(fromRoot('.dev/evidence'), {recursive: true});
						await page.screenshot({
							path: fromRoot(`.dev/evidence/dashboard-${width}-${theme}.png`),
						});
						for (const control of await page
							.locator('main > header a, main button')
							.all()) {
							const rect = await control.boundingBox();
							if (!rect) {
								continue;
							}

							assert.ok(
								rect.x >= 0,
								`control starts inside ${width}px viewport`,
							);
							assert.ok(
								rect.x + rect.width <= width,
								`control ends inside ${width}px viewport`,
							);
						}

						const header = page.locator('main > header');
						const brand = await header
							.getByRole('link', {name: 'TabLodge', exact: true})
							.boundingBox();
						const nav = await header.getByRole('navigation').boundingBox();
						assert.ok(brand);
						assert.ok(nav);
						assert.ok(
							nav.y >= brand.y + brand.height,
							'narrow navigation has its own row',
						);
					}

					await page.close();
				},
			);

			await check(
				`side panel header icons work by keyboard (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'sidepanel');
					await page.setViewportSize({width: 320, height: 900});
					await setTheme(page, theme);
					for (const label of ['Recent snapshots', 'Trash bin']) {
						const button = page.getByRole('button', {name: label, exact: true});
						assert.equal(
							await button.count(),
							1,
							`${label} has a direct button`,
						);
						await button.focus();
						await page.keyboard.press('Enter');
						await page.getByRole('dialog').waitFor();
						await page.keyboard.press('Escape');
						await until(
							async () => (await focusedLabel(page)) === label,
							'focus returns to the header icon',
						);
					}

					for (const [label, destination] of [
						['Open dashboard', 'newtab'],
						['Open settings', 'options'],
					]) {
						const link = page.getByRole('link', {name: label, exact: true});
						await link.focus();
						const opened = context.waitForEvent('page');
						await page.keyboard.press('Enter');
						const tab = await opened;
						await tab.waitForLoadState();
						assert.equal(
							tab.url(),
							`chrome-extension://${extensionId}/${destination}.html`,
						);
						assert.equal(
							page.url(),
							`chrome-extension://${extensionId}/sidepanel.html`,
						);
						await tab.close();
					}

					for (const control of await page
						.locator('header a, header button')
						.all()) {
						const rect = await control.boundingBox();
						assert.ok(rect);
						assert.ok(rect.x >= 0);
						assert.ok(rect.x + rect.width <= 320);
						assert.ok(rect.width >= 24);
						assert.ok(rect.height >= 24);
					}

					await page.close();
				},
			);

			await check(
				`side panel title opens a dashboard tab (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'sidepanel');
					await page.setViewportSize({width: 320, height: 900});
					await setTheme(page, theme);
					const brand = page.getByRole('link', {name: 'TabLodge', exact: true});
					await brand.waitFor();
					await mkdir(fromRoot('.dev/evidence'), {recursive: true});
					await page.screenshot({
						path: fromRoot(`.dev/evidence/sidebar-${theme}.png`),
					});
					await brand.focus();
					assert.equal(await brand.getAttribute('target'), '_blank');
					const opened = context.waitForEvent('page');
					await page.keyboard.press('Enter');
					const dashboard = await opened;
					await dashboard.waitForLoadState();
					assert.equal(
						dashboard.url(),
						`chrome-extension://${extensionId}/newtab.html`,
					);
					assert.equal(
						page.url(),
						`chrome-extension://${extensionId}/sidepanel.html`,
					);
					await dashboard.close();
					await page.close();
				},
			);
		}

		for (const theme of THEMES) {
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
					assert.equal(
						await fourth.isDisabled(),
						true,
						'a fourth action is disabled while three are selected',
					);
					await until(
						async () =>
							JSON.stringify(
								(await readDevStore(settingsPage)).settings
									.bookmarkQuickActions,
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
							(await board.locator('[data-bookmark-title="Gmail"]').count()) ===
							1,
						'Undo to restore the bookmark from the trash',
					);
					await seedQuickActions(board, ['open-new']);
					await board.close();
				},
			);

			await check(
				`bookmark menu actions are available as quick actions (${theme})`,
				async () => {
					const quickActionSeed = await openPage(
						context,
						extensionId,
						'newtab',
					);
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
						['Move to', 'Move down'],
						'bookmark',
					);

					const fourthAction = menu.getByRole('button', {
						name: 'Add Move up',
						exact: true,
					});
					assert.equal(
						await fourthAction.isDisabled(),
						true,
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
						['Open in new tab', 'Move down', 'Move to'],
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
						name: 'Move to: Gmail',
						exact: true,
					});
					assert.equal(await moveTo.isEnabled(), true);
					await moveTo.focus();
					assert.equal(await focusedLabel(board), 'Move to: Gmail');
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
					const unfiled = board.locator(
						'section[data-column-id="bookmark-unfiled"]',
					);
					const unfiledCards = unfiled.locator('[data-bookmark-id]');
					await until(
						async () => (await cards.count()) === 65,
						'all bookmarks in the capped column',
					);
					await until(
						async () => (await unfiledCards.count()) === 65,
						'all unfiled bookmarks in the capped column',
					);
					assert.equal(
						await column.getByRole('button', {name: /^Show \d+ more$/}).count(),
						0,
						'a capped column draws every bookmark instead of asking to load more',
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
					await board.screenshot({
						path: `.dev/evidence/bookmark-limit-${theme}.png`,
					});
					await board.close();

					const resetPage = await openPage(context, extensionId, 'newtab');
					await seed(resetPage);
					await resetPage.close();
				},
			);

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

					const daily = rail.getByRole('button', {name: /^Daily/});
					const dev = rail.getByRole('button', {name: /^Dev/});
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
								(await page.locator(':focus').getAttribute('aria-label')) ===
								label,
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
					await dialog
						.getByRole('term')
						.filter({hasText: 'Open tabs'})
						.waitFor();
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

			await check(
				`changing import scope cancels a pending read (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'options');
					await setTheme(page, theme);
					await page.getByRole('button', {name: 'Import', exact: true}).click();
					const dialog = page.getByRole('dialog');
					await dialog
						.getByRole('radio', {name: 'Sessions'})
						.check({force: true});
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
					const everything = dialog.getByRole('radio', {name: 'Everything'});
					await everything.focus();
					await page.keyboard.press('Space');
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

			await check(
				`a protected full backup is exported and opened by keyboard (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'options');
					await setTheme(page, theme);
					await page
						.getByRole('button', {name: 'Back up', exact: true})
						.click();
					const dialog = page.getByRole('dialog');
					const protect = dialog.getByRole('checkbox', {
						name: 'Protect with a PIN or password',
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
					await page.keyboard.type('short');
					assert.match(
						(await dialog.textContent()) ?? '',
						/needs at least 8 characters/,
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
					const pinChoice = dialog.getByRole('radio', {name: 'PIN'});
					await pinChoice.focus();
					await page.keyboard.press('Space');
					assert.match(
						(await dialog.textContent()) ?? '',
						/A PIN is weak/,
						'a PIN shows the offline cracking warning',
					);
					assert.equal(
						await download.isDisabled(),
						true,
						'switching type clears the entry',
					);
					await dialog.getByRole('radio', {name: 'Password'}).focus();
					await page.keyboard.press('Space');
					await password.fill('shorter horse battery');
					await confirm.fill('shorter horse battery');
					await acknowledge.focus();
					await page.keyboard.press('Space');
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
					await importDialog
						.getByRole('radio', {name: 'Everything'})
						.check({force: true});
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
							(await page.locator(':focus').getAttribute('type')) ===
							'password',
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
							(await page.locator(':focus').getAttribute('type')) ===
							'password',
						'focus to stay in the credential field after an error',
					);
					await importDialog
						.getByRole('textbox', {name: 'PIN or password'})
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

			await check(
				`the locked area is set up, used, locked and unlocked by keyboard (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'newtab');
					const credential = 'correct horse battery';
					try {
						await setTheme(page, theme);
						const trigger = page.getByRole('button', {
							name: 'Import, back up and share bookmarks',
						});
						await openMenuItemByKeyboard(page, trigger, 'Locked bookmarks');
						await page
							.getByRole('dialog', {name: 'Set up the locked area'})
							.waitFor();
						// The dialog's name changes with each step, so the steps below address it without one.
						const dialog = page.getByRole('dialog');
						await until(
							async () =>
								(await page.locator(':focus').getAttribute('type')) ===
								'password',
							'focus to land in the first field of the setup',
						);
						assert.match(
							await dialog.innerText(),
							/cannot be recovered/,
							'the loss warning shows before the lock is created',
						);
						assert.deepEqual(
							await axeViolationLines(page, axeSource),
							[],
							'the setup step should pass axe',
						);
						const fields = dialog.locator('input[type="password"]');
						await fields.nth(0).fill(credential);
						await fields.nth(1).fill(credential);
						const create = dialog.getByRole('button', {
							name: 'Create locked area',
						});
						assert.equal(
							await create.isDisabled(),
							true,
							'creating needs the acknowledgement',
						);
						await dialog.getByRole('checkbox').focus();
						await page.keyboard.press('Space');
						await create.focus();
						await page.keyboard.press('Enter');
						const heading = dialog.getByRole('heading', {
							name: '0 locked bookmarks',
						});
						await heading.waitFor();
						await until(
							async () =>
								(await page.locator(':focus').textContent()) ===
								'0 locked bookmarks',
							'focus to move to the list heading after setup',
						);
						await dialog
							.getByRole('button', {name: 'Add', exact: true})
							.focus();
						await page.keyboard.press('Enter');
						await until(
							async () =>
								(await page.locator(':focus').getAttribute('id')) ===
								'locked-edit-title',
							'focus to move into the add form',
						);
						await page.keyboard.type('Locked diary');
						await page.keyboard.press('Tab');
						await page.keyboard.type('https://diary.example/entry');
						assert.deepEqual(
							await axeViolationLines(page, axeSource),
							[],
							'the add step should pass axe',
						);
						await page.keyboard.press('Enter');
						await dialog.getByRole('link', {name: /Locked diary/}).waitFor();
						assert.deepEqual(
							await axeViolationLines(page, axeSource),
							[],
							'the list should pass axe',
						);
						await captureEvidence(page, `locked-area-list-${theme}.png`);

						// Lock now, then the unlock screen takes focus and a wrong entry is announced.
						await dialog.getByRole('button', {name: 'Lock now'}).focus();
						await page.keyboard.press('Enter');
						await dialog.getByRole('button', {name: 'Unlock'}).waitFor();
						await until(
							async () =>
								(await page.locator(':focus').getAttribute('type')) ===
								'password',
							'focus to move to the credential field after locking',
						);
						assert.deepEqual(
							await axeViolationLines(page, axeSource),
							[],
							'the unlock screen should pass axe',
						);
						await page.keyboard.type('wrong horse battery');
						await page.keyboard.press('Enter');
						await dialog
							.getByRole('alert')
							.filter({hasText: 'wrong'})
							.waitFor();
						assert.equal(
							await dialog.getByRole('link').count(),
							0,
							'a wrong entry shows nothing',
						);
						await captureEvidence(page, `locked-area-unlock-${theme}.png`);
						await dialog.locator('input').first().fill(credential);
						await page.keyboard.press('Enter');
						await dialog.getByRole('link', {name: /Locked diary/}).waitFor();

						// Escape closes the dialog and hands focus back to the menu button.
						await page.keyboard.press('Escape');
						await dialog.waitFor({state: 'hidden'});
						await until(
							async () =>
								(await page.locator(':focus').getAttribute('aria-label')) ===
								'Import, back up and share bookmarks',
							'focus to return to the bookmark menu button',
						);
					} finally {
						await page.evaluate(async (secret: string) => {
							const {chrome} = globalThis as typeof globalThis & {
								chrome: ExtensionApi;
							};
							await chrome.runtime.sendMessage({
								type: 'LOCKED_REMOVE_LOCK',
								credential: secret,
								bookmarks: 'delete',
							});
						}, credential);
						await page.close();
					}
				},
			);

			await check(
				`a forgotten PIN or password is reset by keyboard after wrong entries (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'newtab');
					const secret = 'correct horse battery';
					const resetWord = 'delete-everything-in-the-locked-area';
					try {
						await setTheme(page, theme);
						await page.evaluate(
							async ({pass, label}: {pass: string; label: string}) => {
								const {chrome} = globalThis as typeof globalThis & {
									chrome: ExtensionApi;
								};
								await chrome.runtime.sendMessage({
									type: 'LOCKED_SETUP',
									kind: 'password',
									value: pass,
								});
								await chrome.runtime.sendMessage({
									type: 'LOCKED_ADD',
									bookmarks: [
										{
											title: `Private ${label} diary`,
											url: `https://diary-${label}.example/entry`,
										},
									],
								});
								await chrome.runtime.sendMessage({type: 'LOCKED_LOCK'});
							},
							{pass: secret, label: theme},
						);
						const trigger = page.getByRole('button', {
							name: 'Import, back up and share bookmarks',
						});
						await openMenuItemByKeyboard(page, trigger, 'Locked bookmarks');
						const dialog = page.getByRole('dialog');
						await dialog.getByRole('button', {name: 'Unlock'}).waitFor();
						const offer = dialog.getByRole('button', {
							name: 'Reset the locked area',
						});

						// Two wrong entries are a slip of the fingers: no way to delete anything is offered yet.
						for (let attempt = 1; attempt <= 2; attempt += 1) {
							await until(
								async () =>
									(await page.locator(':focus').getAttribute('type')) ===
									'password',
								'focus to be in the credential field',
							);
							await page.keyboard.type(`wrong entry ${attempt}`);
							await page.keyboard.press('Enter');
							await dialog
								.getByRole('alert')
								.filter({hasText: 'wrong'})
								.waitFor();
							assert.equal(await offer.count(), 0);
							await dialog.locator('input').first().fill('');
							await dialog.locator('input').first().focus();
						}

						await page.keyboard.type('wrong entry 3');
						await page.keyboard.press('Enter');
						await offer.waitFor();
						assert.deepEqual(
							await axeViolationLines(page, axeSource),
							[],
							'the unlock screen with the reset offer should pass axe',
						);
						await captureEvidence(page, `locked-reset-offer-${theme}.png`);

						// The offer is reachable by keyboard and leads to a confirmation that takes focus.
						await offer.focus();
						await page.keyboard.press('Enter');
						await dialog
							.getByRole('heading', {name: 'Reset the locked area'})
							.waitFor();
						await until(
							async () =>
								(await page.locator(':focus').getAttribute('id'))?.endsWith(
									'-word',
								) === true,
							'focus to move to the confirmation field',
						);
						const confirmText = await dialog.innerText();
						assert.match(confirmText, /permanently deletes everything/);
						assert.match(confirmText, /cannot be undone/);
						assert.match(confirmText, /new PIN or password/);
						const destroy = dialog.getByRole('button', {
							name: 'Delete everything and reset',
						});
						assert.equal(
							await destroy.isDisabled(),
							true,
							'the button needs the typed word',
						);
						await page.keyboard.type('rese');
						assert.equal(await destroy.isDisabled(), true);
						assert.deepEqual(
							await axeViolationLines(page, axeSource),
							[],
							'the confirmation should pass axe',
						);
						await page.keyboard.type('t');
						assert.equal(await destroy.isDisabled(), false);
						await captureEvidence(page, `locked-reset-confirm-${theme}.png`);

						// Back returns to the unlock screen with focus in the credential field and the data untouched.
						await dialog.getByRole('button', {name: 'Back'}).focus();
						await page.keyboard.press('Enter');
						await dialog.getByRole('button', {name: 'Unlock'}).waitFor();
						await until(
							async () =>
								(await page.locator(':focus').getAttribute('type')) ===
								'password',
							'focus to return to the credential field',
						);
						await offer.focus();
						await page.keyboard.press('Enter');
						await until(
							async () =>
								(await page.locator(':focus').getAttribute('id'))?.endsWith(
									'-word',
								) === true,
							'focus to move to the confirmation field again',
						);
						await page.keyboard.type('RESET');
						await page.keyboard.press('Enter');

						// Straight to the setup form, with focus in it and the reset announced.
						await dialog
							.getByRole('heading', {name: 'Set up the locked area'})
							.waitFor();
						await until(
							async () =>
								(await page.locator(':focus').getAttribute('type')) ===
								'password',
							'focus to move to the first field of the setup',
						);
						assert.match(
							await dialog
								.locator('[role="status"]')
								.allInnerTexts()
								.then(String),
							/was reset and everything in it deleted/,
						);
						// The confirmation toast fades in; measure contrast once it has settled.
						await page.waitForTimeout(600);
						assert.deepEqual(
							await axeViolationLines(page, axeSource),
							[],
							'the setup form after a reset should pass axe',
						);
						await captureEvidence(page, `locked-reset-setup-${theme}.png`);

						// Nothing of the old area is left in storage.
						const leftovers = await page.evaluate(async () => {
							const {chrome} = globalThis as typeof globalThis & {
								chrome: {
									storage: {
										local: {get(keys: null): Promise<Record<string, unknown>>};
										session: {
											get(keys: null): Promise<Record<string, unknown>>;
										};
									};
								};
							};
							const [local, session] = await Promise.all([
								chrome.storage.local.get(null),
								chrome.storage.session.get(null),
							]);
							return {
								keys: [...Object.keys(local), ...Object.keys(session)].filter(
									(key) => key.startsWith('tablodge.locked'),
								),
								text: JSON.stringify({local, session}),
							};
						});
						assert.deepEqual(
							leftovers.keys.filter((key) => key !== 'tablodge.locked.flag'),
							[],
						);
						assert.equal(leftovers.text.includes('diary'), false);
						assert.equal(leftovers.text.includes(secret), false);
						await page.keyboard.press('Escape');
						await dialog.waitFor({state: 'hidden'});
					} finally {
						await page.evaluate(async (confirm: string) => {
							const {chrome} = globalThis as typeof globalThis & {
								chrome: ExtensionApi;
							};
							await chrome.runtime.sendMessage({type: 'LOCKED_RESET', confirm});
						}, resetWord);
						await page.close();
					}
				},
			);

			await check(
				`saving to the locked area from the popup passes axe and keeps focus in the dialog (${theme})`,
				async () => {
					const credential = 'correct horse battery';
					const setup = await openPage(context, extensionId, 'newtab');
					await setup.evaluate(async (secret: string) => {
						const {chrome} = globalThis as typeof globalThis & {
							chrome: ExtensionApi;
						};
						await chrome.runtime.sendMessage({
							type: 'LOCKED_SETUP',
							kind: 'password',
							value: secret,
						});
						await chrome.runtime.sendMessage({type: 'LOCKED_LOCK'});
					}, credential);
					await setup.close();
					const url = `https://example.com/popup-locked-${theme}`;
					const webPage = await context.newPage();
					await webPage.route(url, async (route) =>
						route.fulfill({
							contentType: 'text/html',
							body: '<title>Locked popup test</title>',
						}),
					);
					await webPage.goto(url);
					const popup = await openPopupOver(context, extensionId, url);
					try {
						await setTheme(popup, theme);
						// The popup saves the active tab, so the page goes to the front first.
						await webPage.bringToFront();
						const button = popup.getByRole('button', {
							name: 'Bookmark to locked area',
						});
						await button.focus();
						await popup.keyboard.press('Enter');
						const dialog = popup.getByRole('dialog', {
							name: 'Bookmark to locked area',
						});
						await dialog.waitFor();
						await until(
							async () =>
								(await popup.locator(':focus').getAttribute('type')) ===
								'password',
							'focus to land in the credential field',
						);
						assert.deepEqual(
							await axeViolationLines(popup, axeSource),
							[],
							'the locked save should pass axe',
						);
						await popup.keyboard.type(credential);
						await popup.keyboard.press('Enter');
						await popup
							.getByText('Saved to the locked area.')
							.first()
							.waitFor();
						await dialog.waitFor({state: 'hidden'});
					} finally {
						await popup.close();
						await webPage.close();
						const cleanup = await openPage(context, extensionId, 'newtab');
						await cleanup.evaluate(async (secret: string) => {
							const {chrome} = globalThis as typeof globalThis & {
								chrome: ExtensionApi;
							};
							await chrome.runtime.sendMessage({
								type: 'LOCKED_UNLOCK',
								credential: secret,
							});
							await chrome.runtime.sendMessage({
								type: 'LOCKED_REMOVE_LOCK',
								credential: secret,
								bookmarks: 'delete',
							});
						}, credential);
						await cleanup.close();
					}
				},
			);

			await check(
				`moving a bookmark, a column and a session into the locked area works by keyboard and passes axe (${theme})`,
				async () => {
					const credential = 'correct horse battery';
					const page = await openPage(context, extensionId, 'newtab');
					await setTheme(page, theme);
					await page.evaluate(async (secret: string) => {
						const {chrome} = globalThis as typeof globalThis & {
							chrome: ExtensionApi;
						};
						await chrome.runtime.sendMessage({
							type: 'LOCKED_SETUP',
							kind: 'password',
							value: secret,
						});
						await chrome.runtime.sendMessage({
							type: 'LOCKED_UNLOCK',
							credential: secret,
						});
					}, credential);
					const dialog = page.getByRole('dialog', {
						name: 'Move to locked area',
					});
					// A column and a session open the same confirmation. Each passes axe and Escape closes it.
					await openMenuItemByKeyboard(
						page,
						page
							.locator(
								'button[aria-label^="Options for "][aria-label$=" column"]',
							)
							.first(),
						'Move to locked area',
					);
					await dialog.waitFor();
					// The dialog fades in; axe judges contrast on the final colors.
					await page.waitForTimeout(600);
					assert.deepEqual(
						await axeViolationLines(page, axeSource),
						[],
						'the column move should pass axe',
					);
					await captureEvidence(page, `locked-move-column-${theme}.png`);
					await page.keyboard.press('Escape');
					await dialog.waitFor({state: 'hidden'});
					await openMenuItemByKeyboard(
						page,
						page.locator('button[aria-label^="More actions for "]').first(),
						'Move links to locked area',
					);
					await dialog.waitFor();
					// The dialog fades in; axe judges contrast on the final colors.
					await page.waitForTimeout(600);
					assert.deepEqual(
						await axeViolationLines(page, axeSource),
						[],
						'the session move should pass axe',
					);
					await captureEvidence(page, `locked-move-session-${theme}.png`);
					await page.keyboard.press('Escape');
					await dialog.waitFor({state: 'hidden'});
					// A bookmark moves with the keyboard alone, and focus does not fall back to the page body.
					await openMenuItemByKeyboard(
						page,
						page.locator('button[aria-label^="Actions for "]').first(),
						'Move to locked area',
					);
					await dialog.waitFor();
					// The dialog fades in; axe judges contrast on the final colors.
					await page.waitForTimeout(600);
					assert.deepEqual(
						await axeViolationLines(page, axeSource),
						[],
						'the bookmark move should pass axe',
					);
					await dialog.getByRole('button', {name: 'Move 1 bookmark'}).focus();
					await page.keyboard.press('Enter');
					await dialog.waitFor({state: 'hidden'});
					await page
						.getByText('Moved 1 bookmark to the locked area.')
						.first()
						.waitFor();
					await until(
						async () => (await page.locator('body:focus').count()) === 0,
						'focus to stay on the page after the move',
					);
					const count = await page.evaluate(async () => {
						const {chrome} = globalThis as typeof globalThis & {
							chrome: ExtensionApi;
						};
						const result = (await chrome.runtime.sendMessage({
							type: 'LOCKED_LIST',
						})) as {bookmarks: unknown[]};
						return result.bookmarks.length;
					});
					assert.equal(count, 1, 'one bookmark should be in the locked area');
					await page.evaluate(async (secret: string) => {
						const {chrome} = globalThis as typeof globalThis & {
							chrome: ExtensionApi;
						};
						await chrome.runtime.sendMessage({
							type: 'LOCKED_REMOVE_LOCK',
							credential: secret,
							bookmarks: 'board',
						});
					}, credential);
					await page.close();
				},
			);

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
					store.bookmarks = [
						extra('one', 1),
						extra('two', 2),
						extra('three', 3),
					];
					await writeDevStore(page, store);
					await page.reload();
					await setTheme(page, theme);
					const trigger = page.getByRole('button', {
						name: 'Import, back up and share bookmarks',
					});
					await openMenuItemByKeyboard(
						page,
						trigger,
						'Find duplicate bookmarks',
					);
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
					await openMenuItemByKeyboard(
						page,
						trigger,
						'Find duplicate bookmarks',
					);
					await dialog.waitFor();
					await dialog
						.getByRole('button', {name: 'Remove 2 extra copies'})
						.focus();
					await page.keyboard.press('Enter');
					await dialog.waitFor({state: 'hidden'});
					await until(
						async () =>
							(await page.locator('[data-bookmark-title^="Copy "]').count()) ===
							1,
						'the extra copies to be removed',
					);
					const undo = page.getByRole('button', {name: 'Undo', exact: true});
					await undo.focus();
					await page.keyboard.press('Enter');
					await until(
						async () =>
							(await page.locator('[data-bookmark-title^="Copy "]').count()) ===
							3,
						'Undo to restore the copies',
					);
					await openMenuItemByKeyboard(
						page,
						trigger,
						'Find duplicate bookmarks',
					);
					await dialog.waitFor();
					await dialog.getByRole('button', {name: 'Cancel'}).waitFor();
					await page.keyboard.press('Escape');
					await page.close();
				},
			);

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
					await dialog
						.getByRole('radio', {name: 'Columns from folders'})
						.count(),
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
					await assertInline(
						targetLabel,
						targetColumn,
						'bookmark column picker',
					);
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
							(node: ScrollElement) =>
								node.scrollHeight <= node.clientHeight + 1,
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
						(
							node: ScrollElement & {scrollWidth: number; clientWidth: number},
						) => node.scrollWidth <= node.clientWidth + 1,
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
						await dialog
							.getByRole('radio', {name: 'Columns from folders'})
							.count(),
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
					await dialog
						.getByRole('textbox', {name: 'New column name'})
						.fill(name);
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
			await check(
				`bookmark a saved tab into a new column (${theme})`,
				async () => {
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
					await dialog
						.getByRole('textbox', {name: 'New column name'})
						.fill(name);
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
				},
			);
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
					for (const name of ['Export', 'Share', 'Delete']) {
						await bookmarks.getByRole('button', {name, exact: true}).waitFor();
					}

					const sessionTargetSelect = bookmarks.getByRole('combobox', {
						name: 'Add selected bookmarks to session',
						exact: true,
					});
					await sessionTargetSelect.waitFor();
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

					await sessionTargetSelect.focus();
					await page.keyboard.press('Enter');
					const homeLabTarget = page.getByRole('option', {
						name: 'Home lab rebuild',
						exact: true,
					});
					await homeLabTarget.waitFor();
					assert.equal(
						await homeLabTarget.getAttribute('data-highlighted'),
						'',
					);
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
					for (const name of [
						'Lisbon trip itinerary',
						'Train times and tickets',
					]) {
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
					for (const name of ['Export', 'Share']) {
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
						async () =>
							(await selectAll.getAttribute('aria-checked')) === 'mixed',
						'partially selected state on the session checkbox',
					);
					await selectAll.focus();
					await page.keyboard.press('Space');
					await until(
						async () =>
							(await selectAll.getAttribute('aria-checked')) === 'true',
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
						async () =>
							(await selectAll.getAttribute('aria-checked')) === 'false',
						'session links to be cleared',
					);
					await page.close();
				},
			);
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
					const columnPicker = dialog.getByRole('combobox', {
						name: 'Column',
						exact: true,
					});
					await columnPicker.press('Enter');
					const options = page.getByRole('option');
					await options.first().waitFor();
					const optionNames = (await options.allTextContents()).map((name) =>
						name.trim(),
					);
					assert.deepEqual(optionNames, [
						'Daily',
						'Dev',
						'Reading',
						'Add column',
					]);
					assert.ok(!optionNames.includes('Unfiled'));
					await page
						.getByRole('option', {name: 'Add column', exact: true})
						.press('Enter');
					const columnName = `Bulk move ${theme}`;
					await dialog
						.getByRole('textbox', {name: 'New column name'})
						.fill(columnName);
					await dialog
						.getByRole('button', {name: 'Move bookmarks', exact: true})
						.press('Enter');
					await dialog.waitFor({state: 'hidden'});
					const store = await readDevStore(page);
					const column = store.bookmarkColumns.find(
						(entry) => entry.name === columnName,
					);
					assert.ok(
						column,
						'the selected destination column should be created',
					);
					assert.deepEqual(
						store.bookmarks
							.filter((bookmark) =>
								['dev-bookmark-1', 'dev-bookmark-2'].includes(bookmark.id),
							)
							.map((bookmark) => bookmark.columnId),
						[column.id, column.id],
					);
					await page.close();
				},
			);

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

					for (const name of [
						'Lisbon trip itinerary',
						'Train times and tickets',
					]) {
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
					assert.equal(
						await tripTabs.first().getAttribute('draggable'),
						'true',
					);
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
			await check(
				`share and export one session from its menu by keyboard (${theme})`,
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

					await openMenuItemByKeyboard(page, trigger, 'Export session');
					const exportDialog = page.getByRole('dialog');
					await exportDialog.waitFor();
					assert.equal(
						await exportDialog
							.getByRole('heading', {name: 'Export session'})
							.count(),
						1,
					);
					assert.equal(
						await exportDialog
							.getByRole('radiogroup', {name: 'What to back up'})
							.count(),
						0,
					);
					const exportScope = exportDialog.getByRole('radiogroup', {
						name: 'What to export',
					});
					assert.equal(await exportScope.count(), 1);
					const allSessions = exportScope.getByRole('radio', {
						name: 'All sessions',
					});
					await exportScope
						.getByRole('radio', {name: 'Current session'})
						.focus();
					await page.keyboard.press('ArrowRight');
					assert.equal(await allSessions.isChecked(), true);
					assert.equal(
						await exportDialog
							.getByRole('heading', {name: 'Back up sessions'})
							.count(),
						1,
					);
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
					assert.ok(
						allSessionsJson.groups.some((group) => group.name === name),
					);
					assert.ok(allSessionsJson.groups.length > 1);
					await exportDialog.waitFor({state: 'hidden'});

					await openMenuItemByKeyboard(page, trigger, 'Export session');
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
					if (
						process.env.TABLODGE_CAPTURE_EVIDENCE === '1' &&
						theme === 'light'
					) {
						for (const [width, height] of EVIDENCE_VIEWPORTS) {
							await page.setViewportSize({width, height});
							await page.screenshot({
								path: fromRoot(
									`.dev/evidence/session-export-${width}x${height}.png`,
								),
							});
						}

						await page.setViewportSize({width: 1280, height: 900});
					}

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
					await dialog
						.getByRole('button', {name: 'Download', exact: true})
						.focus();
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
			await check(
				`bookmark column export offers this column or all bookmarks (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'newtab');
					await seed(page);
					await page.reload();
					await setTheme(page, theme);
					const column = page.locator('section[data-column-id]').first();
					const trigger = column.locator('header [data-move-focus]');
					await openMenuItemByKeyboard(page, trigger, 'Export column');
					const dialog = page.getByRole('dialog');
					await dialog.waitFor();
					const choices = dialog.getByRole('radiogroup', {
						name: 'What to export',
					});
					assert.equal(await choices.count(), 1);
					const current = choices.getByRole('radio', {name: 'Daily'});
					const allBookmarks = choices.getByRole('radio', {
						name: 'All bookmarks',
					});
					await current.focus();
					await page.keyboard.press('ArrowRight');
					assert.equal(await allBookmarks.isChecked(), true);
					assert.equal(
						await dialog
							.getByRole('heading', {name: 'Back up bookmarks'})
							.count(),
						1,
					);
					await page.keyboard.press('ArrowLeft');
					assert.equal(await current.isChecked(), true);
					assert.equal(
						await dialog.getByRole('heading', {name: 'Export column'}).count(),
						1,
					);
					await mkdir(fromRoot('.dev/evidence'), {recursive: true});
					await dialog.screenshot({
						path: fromRoot(`.dev/evidence/bookmark-export-${theme}.png`),
					});

					const downloadPromise = page.waitForEvent('download');
					await dialog
						.getByRole('button', {name: 'Download', exact: true})
						.focus();
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

		await check(
			'toolbar popup disables page buttons on unsavable pages',
			async () => {
				const popup = await openPopupOver(
					context,
					extensionId,
					'chrome://newtab/',
				);
				for (const name of [
					'Bookmark this page',
					'Add this page to a session',
				]) {
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

		for (const theme of THEMES) {
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
						await dialog
							.getByText('Popup bookmark test', {exact: true})
							.waitFor();
						await dialog.getByRole('combobox').press('Space');
						await popup
							.getByRole('option', {name: 'New column', exact: true})
							.press('Enter', {timeout: 2000});
						await dialog
							.getByRole('textbox', {name: 'New column name'})
							.fill(name);
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
							assert.equal(
								await column
									.locator(`[data-bookmark-id] a[href="${url}"]`)
									.count(),
								1,
							);
						} else {
							assert.equal(await column.count(), 0, 'Cancel creates no column');
						}

						await board.close();
					}

					await popup.close();
					await webPage.close();
				},
			);
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
						await page
							.getByRole('textbox', {name: 'New column name'})
							.fill(name);
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
						assert.equal(
							await column
								.locator(`[data-bookmark-id] a[href="${url}"]`)
								.count(),
							1,
						);
						await board.close();
						if (!page.isClosed()) {
							await page.close();
						}
					},
				);
			}

			await check(
				`browser bookmarks import into a new column (${theme})`,
				async () => {
					const url = `https://example.com/browser-import-${theme}`;
					const browserBookmarkId = await worker.evaluate(
						async (bookmarkUrl) => {
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
						},
						url,
					);
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
						await dialog
							.getByRole('textbox', {name: 'New column name'})
							.fill(name);
						await dialog
							.getByRole('button', {name: 'Import 1 bookmark', exact: true})
							.press('Enter');
						await dialog.waitFor({state: 'hidden'});
						const column = page
							.locator('section[data-column-id]')
							.filter({has: page.getByRole('heading', {name, exact: true})});
						await column.waitFor();
						assert.equal(
							await column
								.locator(`[data-bookmark-id] a[href="${url}"]`)
								.count(),
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

		for (const name of PAGES) {
			for (const theme of THEMES) {
				await check(`axe ${name} (${theme})`, async () => {
					const page = await openPage(context, extensionId, name);
					await setTheme(page, theme);
					const lines = await axeViolationLines(page, axeSource);
					await page.close();
					assert.deepEqual(lines, []);
				});
			}
		}

		for (const theme of THEMES) {
			await check(`palette window keyboard use (${theme})`, async () => {
				const page = await openPage(context, extensionId, 'palette');
				await setTheme(page, theme);
				const input = page.getByRole('combobox', {name: 'Search'});
				await input.waitFor({timeout: 5000});
				await page.locator('input[role="combobox"]:focus').waitFor({
					timeout: 2000,
				});
				const listbox = page.getByRole('listbox', {name: 'Results'});
				assert.equal(
					await input.getAttribute('aria-controls'),
					await listbox.getAttribute('id'),
				);
				const first = await input.getAttribute('aria-activedescendant');
				await page.keyboard.press('ArrowDown');
				const second = await input.getAttribute('aria-activedescendant');
				assert.ok(first, 'A result is active when the palette opens');
				assert.notEqual(second, first, 'Arrow keys move');
				assert.equal(
					await page.locator(`#${second}`).getAttribute('aria-selected'),
					'true',
				);
				await page.keyboard.type('zzzz');
				await page
					.getByRole('option', {name: /Search the web for/})
					.waitFor({timeout: 2000});
				assert.equal(
					await page.getByRole('status').filter({hasText: 'result'}).count(),
					1,
					'A new search announces how many results it found',
				);
				// With a single result the spare room is between the list and the shortcut bar, not below the bar.
				const gap = await page.evaluate(() => {
					const {document, innerHeight} = globalThis as typeof globalThis & {
						document: {
							querySelector(selector: string): {
								getBoundingClientRect(): {bottom: number};
							} | null;
						};
						innerHeight: number;
					};
					const bar = document.querySelector('main div.border-t');
					return (
						innerHeight - Math.round(bar?.getBoundingClientRect().bottom ?? 0)
					);
				});
				assert.equal(
					gap,
					0,
					'The shortcut bar sits at the bottom of the window',
				);
				await page.screenshot({
					path: `.dev/evidence/palette-keyboard-${theme}.png`,
				});
				// Escape closes the window, which ends the key press call itself.
				const closed = page.waitForEvent('close', {timeout: 3000});
				await page.keyboard.press('Escape').catch(() => {});
				await closed;
			});
		}

		for (const theme of THEMES) {
			await check(`palette overlay frame keyboard use (${theme})`, async () => {
				// The overlay is palette.html in a frame; a stand-in parent page receives its close request.
				const page = await openPage(context, extensionId, 'help');
				await setTheme(page, theme);
				await page.evaluate((address) => {
					const {document, addEventListener} =
						globalThis as typeof globalThis & {
							document: {
								title: string;
								body: {append(element: unknown): void};
								createElement(tag: string): {
									title: string;
									src: string;
									style: {cssText: string};
								};
							};
							addEventListener(
								type: string,
								listener: (event: {data?: {type?: string}}) => void,
							): void;
						};
					addEventListener('message', (event) => {
						if (event.data?.type === 'tablodge-palette-close') {
							document.title = 'palette-close-requested';
						}
					});
					const frame = document.createElement('iframe');
					frame.title = 'Search TabLodge';
					frame.src = address;
					frame.style.cssText =
						'position:fixed;top:40px;left:40px;width:640px;height:520px;z-index:99';
					document.body.append(frame);
				}, `chrome-extension://${extensionId}/palette.html?overlay=1`);
				const frame = page.frameLocator('iframe[title="Search TabLodge"]');
				const input = frame.getByRole('combobox', {name: 'Search'});
				await input.waitFor({timeout: 5000});
				// The service worker's injected script hands focus to the frame; the search box takes it from there.
				await input.focus();
				await page.keyboard.press('Tab');
				await page.keyboard.press('Shift+Tab');
				assert.equal(
					await input.evaluate(
						(element: {ownerDocument: {activeElement: unknown}}) =>
							element === element.ownerDocument.activeElement,
					),
					true,
					'Tab and Shift+Tab stay in the palette frame',
				);
				await page.keyboard.press('Escape');
				await page.waitForFunction(
					() =>
						(globalThis as typeof globalThis & {document: {title: string}})
							.document.title === 'palette-close-requested',
				);
				await page.close();
			});
		}

		for (const theme of THEMES) {
			await check(
				`opening settings layout and palette default (${theme})`,
				async () => {
					const page = await openPage(context, extensionId, 'options');
					await setTheme(page, theme);
					const row = (name: string) =>
						page.locator(`[data-setting-row="${name}"]`);
					const location = row('paletteLocation').getByRole('combobox');
					await location.waitFor();
					assert.match(
						(await location.innerText()).trim(),
						/In the current page/,
						'the palette opens in the current page by default',
					);
					const hangs = async (name: string) =>
						Boolean(
							(await row(name).getAttribute('class'))?.includes('border-l-2'),
						);
					assert.ok(
						await hangs('autoFocusSearchOnNewTab'),
						'a dependent setting hangs from its parent',
					);
					for (const name of [
						'newTabEnabled',
						'paletteLocation',
						'keepLodgePinned',
						'openDashboardOnStartup',
						'actionMode',
						'dashboardBehavior',
					]) {
						assert.ok(
							!(await hangs(name)),
							`${name} is not drawn as a dependent setting`,
						);
					}

					await page.close();
				},
			);
		}

		for (const theme of THEMES) {
			await check(`palette actions menu keyboard use (${theme})`, async () => {
				const seeding = await openPage(context, extensionId, 'newtab');
				await seed(seeding);
				await seeding.close();
				const page = await openPage(context, extensionId, 'palette');
				await setTheme(page, theme);
				const input = page.getByRole('combobox', {name: 'Search'});
				await input.waitFor({timeout: 5000});
				await page.keyboard.type('Lisbon trip');
				await page
					.getByRole('option', {name: /Lisbon trip/})
					.first()
					.waitFor({timeout: 2000});
				const results = await input.getAttribute('aria-controls');
				await page.keyboard.press('ArrowRight');
				const menu = page.getByRole('listbox', {name: /^Actions for/});
				await menu.waitFor({timeout: 2000});
				assert.equal(
					await page
						.getByRole('combobox', {name: 'Filter actions'})
						.getAttribute('aria-controls'),
					await menu.getAttribute('id'),
				);
				assert.notStrictEqual(
					await menu.getAttribute('id'),
					results,
					'The menu is its own listbox',
				);
				await page
					.getByRole('navigation', {name: 'Breadcrumb'})
					.waitFor({timeout: 1000});
				assert.match(
					(await page.getByRole('status').allTextContents()).join(' '),
					/Actions for .*\d actions/,
					'Opening the menu is announced',
				);
				const first = await page
					.getByRole('combobox', {name: 'Filter actions'})
					.getAttribute('aria-activedescendant');
				await page.keyboard.press('ArrowDown');
				assert.notEqual(
					await page
						.getByRole('combobox', {name: 'Filter actions'})
						.getAttribute('aria-activedescendant'),
					first,
					'Arrow keys move through actions',
				);
				await page.screenshot({
					path: `.dev/evidence/palette-actions-${theme}.png`,
				});
				await page.keyboard.type('window');
				assert.equal(
					await menu.getByRole('option').count(),
					1,
					'Typing filters the actions',
				);
				await page.keyboard.press('Backspace');
				for (let at = 0; at < 'window'.length - 1; at++) {
					await page.keyboard.press('Backspace');
				}

				await page.keyboard.press('Backspace');
				await menu.waitFor({state: 'hidden', timeout: 1000});
				assert.equal(
					await page.locator('input[role="combobox"]:focus').count(),
					1,
					'Focus stays in the search box going back',
				);
				assert.equal(await input.inputValue(), 'Lisbon trip');
				await page.keyboard.press('ArrowRight');
				await menu.waitFor({timeout: 1000});
				// Escape goes up one level first, so the window is still there afterwards.
				await page.keyboard.press('Escape');
				await menu.waitFor({state: 'hidden', timeout: 1000});
				const closed = page.waitForEvent('close', {timeout: 3000});
				await page.keyboard.press('Escape').catch(() => {});
				await closed;
			});
		}

		for (const theme of THEMES) {
			await check(`bookmark selection mode and ranges (${theme})`, async () => {
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
					context.waitForEvent('page', {timeout: 2000}),
					cards
						.first()
						.locator('a')
						.click({modifiers: ['Control']}),
				]);
				await opened.close();
				assert.equal(
					await cards
						.first()
						.getByRole('checkbox')
						.getAttribute('aria-checked'),
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
					context.waitForEvent('page', {timeout: 2000}),
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
			});

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
					await page
						.getByRole('combobox', {name: 'Column', exact: true})
						.focus();
					await page.keyboard.press('Enter');
					await page.keyboard.press('r');
					await until(
						async () =>
							(await page.locator('[role="option"]:focus').textContent()) ===
							'Reading',
						'the last column option to receive focus',
					);
					await page.keyboard.press('Enter');
					await page
						.getByRole('button', {name: 'Move bookmarks', exact: true})
						.focus();
					await page.keyboard.press('Enter');
					await page.getByRole('dialog').waitFor({state: 'hidden'});
					const destination = page.locator('section[data-column-id]').last();
					const columnId = await destination.getAttribute('data-column-id');
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
					await until(
						async () => (await focusedLabel(page)) === 'Move bookmarks',
						'focus after moving',
					);
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
					path: fromRoot(
						`.dev/evidence/bookmark-selection-mobile-${theme}.png`,
					),
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
				const movedCard = page.locator(
					`[data-bookmark-id="${ids[0]}"] article`,
				);
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
						.getByRole('button', {name: 'Export', exact: true})
						.isVisible(),
					true,
				);
				await page.keyboard.press('Escape');
				assert.equal(await selection.count(), 0);
				await page.close();
			});
		}

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

		await check(
			'appearance is one tab stop with arrow key selection',
			async () => {
				const page = await openPage(context, extensionId, 'options');
				await page
					.getByRole('button', {name: 'Accent color: Default', exact: true})
					.click();
				assert.equal(
					await page
						.getByRole('option', {name: 'Default', exact: true})
						.count(),
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
				await page
					.getByRole('radio', {name: 'System', checked: true})
					.waitFor();
				await page.close();
			},
		);
		for (const theme of THEMES) {
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
					assert.equal(
						await page.locator(':focus').getAttribute('role'),
						'switch',
					);
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
					assert.equal(
						currentSettings.restoreTarget,
						'new-window-unless-only-tab',
					);
					await page.close();
				},
			);
		}

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
							(await groupFolderId(page, sessionId)) === 'folder-work',
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

		for (const theme of THEMES) {
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

					await page
						.locator('[data-session-folder-chip="folder-work"]')
						.click();
					const movedCard = page.locator('#session-dev-session-1');
					const nextCard = page.locator('#session-dev-session-2');
					await movedCard.waitFor();
					await nextCard.waitFor();
					const trigger = movedCard.locator('[data-move-focus]');
					await openMenuByKeyboard(page, trigger);
					await page.getByRole('menuitem', {name: 'Move to folder'}).focus();
					await page.keyboard.press('ArrowRight');
					await page
						.getByRole('menuitem', {name: 'Trips', exact: true})
						.focus();
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

		for (const theme of THEMES) {
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
					await until(
						async () => (await copiesOpen()) === 1,
						'duplicates closed',
					);
					const undo = panel.getByRole('button', {name: 'Undo'});
					await undo.waitFor();
					await panel
						.getByRole('button', {name: 'No duplicate tabs'})
						.waitFor();
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
						await sidepanel
							.getByText('Archived example', {exact: true})
							.count(),
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

		for (const theme of THEMES) {
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
						// Puts the seeded sessions back between the evidence captures.
						const reset = async () => {
							await writeDevStore(page, snapshot);
							await page.reload();
						};

						assert.ok(original.length > 2);
						const trigger = page.getByRole('button', {
							name: 'More actions for Home lab rebuild',
						});
						const undoButton = page.getByRole('button', {name: 'Undo'});
						const sessionMenuItem = async (name: string) => {
							await trigger.focus();
							await page.keyboard.press('Enter');
							await page.getByRole('menuitem', {name, exact: true}).focus();
							await page.keyboard.press('Enter');
						};

						await until(async () => {
							await trigger.focus();
							await page.keyboard.press('Enter');
							const enabled = await page
								.getByRole('menuitem', {name: 'Replace with this window'})
								.isEnabled();
							await page.keyboard.press('Escape');
							return enabled;
						}, 'the window actions to become available');

						await trigger.focus();
						await page.keyboard.press('Enter');
						await page
							.getByRole('menuitem', {name: 'Replace with this window'})
							.waitFor();
						await captureViewports(page, 'session-window-actions-menu', theme);
						await page.keyboard.press('Escape');

						await page.setViewportSize({width: 1440, height: 900});
						await sessionMenuItem('Add this window');
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

						await sessionMenuItem('Add this window');
						await undoButton.waitFor();
						await captureViewports(page, 'session-append-result', theme);
						await reset();

						await sessionMenuItem('Replace with this window');
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

						await sessionMenuItem('Replace with this window');
						await undoButton.waitFor();
						await captureViewports(page, 'session-replace-result', theme);
						await reset();

						const expand = page.getByRole('button', {
							name: 'Show tabs in Home lab rebuild',
						});
						const collapse = page.getByRole('button', {
							name: 'Hide tabs in Home lab rebuild',
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
							split.find((group) => group.name === 'Home lab rebuild (split)')
								?.tabs.length,
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
					await openMenuItemByKeyboard(page, trigger, 'Share all sessions');
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
							await withMobileEmulation(
								page,
								{width, height},
								async (device) => {
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
								},
							);
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

		await check('dialogs hand focus back to what opened them', async () => {
			const page = await openPage(context, extensionId, 'newtab');
			const add = page.getByRole('button', {name: 'Add bookmark'}).first();
			await add.focus();
			await page.keyboard.press('Enter');
			await page.getByRole('dialog').waitFor();
			await page.keyboard.press('Escape');
			await until(
				async () => (await focusedLabel(page)) === 'Add bookmark',
				'focus to return to the Add bookmark button',
			);
			// A dialog opened from a menu item returns to the menu's button.
			const trigger = page
				.locator('[data-bookmark-id] [data-move-focus]')
				.first();
			const label = await trigger.getAttribute('aria-label');
			await trigger.focus();
			await page.keyboard.press('Enter');
			await page.getByRole('menuitem', {name: 'Edit', exact: true}).click();
			await page.getByRole('dialog').waitFor();
			await page.keyboard.press('Escape');
			await until(async () => (await focusedLabel(page)) === label, 'focus');
			await page.close();
		});

		await check('searches announce how many results they found', async () => {
			const page = await openPage(context, extensionId, 'newtab');
			await page.getByRole('button', {name: 'Search bookmarks'}).click();
			await page.keyboard.type('zzzqq');
			await until(
				async () =>
					(await page.getByRole('status').allTextContents()).includes(
						'No bookmarks match',
					),
				'the no results announcement',
			);
			await page.keyboard.press('Escape');
			await until(
				async () => (await focusedLabel(page)) === 'Search bookmarks',
				'focus to return to the search button',
			);
			await page.close();
		});

		await check('a bookmark is added to a session from its menu', async () => {
			const page = await openPage(context, extensionId, 'newtab');
			const trigger = page
				.locator('[data-bookmark-id] [data-move-focus]')
				.first();
			await trigger.focus();
			await page.keyboard.press('Enter');
			await page.getByRole('menuitem', {name: 'Add to session'}).focus();
			await page.keyboard.press('ArrowRight');
			assert.equal(
				await page.getByRole('menuitem', {name: 'Archived example'}).count(),
				0,
				'archived sessions should not be targets for adding bookmarks',
			);
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
