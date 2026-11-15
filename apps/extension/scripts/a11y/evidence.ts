import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';
import {
	type BrowserContext,
	chromium,
	type Locator,
	type Page,
} from 'playwright';
import {fromRoot, OUT_DIR} from '../vite-shared.ts';
import {seed} from './fixtures.ts';
import {openMenuItemByKeyboard, setTheme} from './pages.ts';

export const EVIDENCE_VIEWPORTS = [
	[440, 956],
	[768, 1024],
	[1440, 900],
	[1920, 1080],
] as const;

export async function captureMobileExportEvidence(extensionId: string) {
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
		await openMenuItemByKeyboard(page, trigger, 'Share');
		await page.getByRole('menu').waitFor({state: 'hidden'});
		await page.getByRole('radiogroup', {name: 'What to share'}).waitFor();
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

type DevtoolsSession = Awaited<ReturnType<BrowserContext['newCDPSession']>>;

export async function withMobileEmulation(
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
export async function captureViewports(
	page: Page,
	name: string,
	theme: string,
) {
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

export async function captureEvidence(
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

export async function captureNarrowEvidence(
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

export async function assertInline(
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

export async function captureResetEvidence(
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
