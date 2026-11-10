import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {chromium, type Locator, type Page} from 'playwright';
import {OUT_DIR, fromRoot} from './vite-shared.ts';

type ChromeGlobal = {
	chrome: {
		runtime: {sendMessage(message: Record<string, unknown>): Promise<unknown>};
		extension: {inIncognitoContext: boolean};
		windows: {
			create(options: {incognito: boolean; url: string}): Promise<unknown>;
		};
		developerPrivate: {
			updateProfileConfiguration(options: {
				inDeveloperMode: boolean;
			}): Promise<void>;
			updateExtensionConfiguration(options: {
				extensionId: string;
				incognitoAccess: boolean;
			}): Promise<void>;
		};
	};
};

async function configure(
	normal: Page,
	privatePage: Page,
	mode: 'shared' | 'saved' | 'temporary',
) {
	await normal.goto(
		new URL('options.html#settings-private-windows', normal.url()).href,
	);
	const titles = {
		shared: 'Use the same library as regular windows',
		saved: 'Use a separate saved library',
		temporary: 'Use a separate temporary library',
	};
	const choice = normal.getByRole('radio', {
		name: new RegExp(`^${titles[mode]}`),
	});
	await choice.focus();
	await Promise.all([
		privatePage.waitForEvent('load'),
		normal.keyboard.press('Space'),
	]);
	const status = {
		shared: 'Private windows will use the same library as regular windows.',
		saved: 'Private windows will use a separate saved library.',
		temporary: 'Private windows will use a separate temporary library.',
	};
	await normal
		.getByRole('status')
		.getByText(status[mode], {exact: true})
		.waitFor();
	await privatePage.getByRole('main').waitFor();
}

async function send(
	page: Page,
	message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const result = await page.evaluate(
		async (payload) =>
			(
				globalThis as typeof globalThis & ChromeGlobal
			).chrome.runtime.sendMessage(payload),
		message,
	);
	assert.ok(isRecord(result));
	assert.equal(result.ok, true, JSON.stringify(result));
	return result;
}

async function openPrivateNewTab(normal: Page): Promise<Page> {
	const pagePromise = normal.context().waitForEvent('page');
	void pagePromise.catch(() => undefined);
	await normal.evaluate(async () =>
		(globalThis as typeof globalThis & ChromeGlobal).chrome.windows.create({
			incognito: true,
			url: 'chrome://newtab/',
		}),
	);
	return pagePromise;
}

async function setPrivatePageTheme(
	settingsPage: Page,
	privatePage: Page,
	theme: 'light' | 'dark',
) {
	await settingsPage
		.getByRole('radio', {
			name: theme === 'light' ? 'Light' : 'Dark',
			exact: true,
		})
		.click();
	await privatePage.locator(`html[data-theme="${theme}"]`).waitFor();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const evidenceViewports = [
	{width: 768, height: 1024},
	{width: 1440, height: 900},
	{width: 1920, height: 1080},
] as const;

async function captureEvidence(
	page: Page,
	target: Locator,
	name: string,
	captureElement = false,
) {
	for (const {width, height} of evidenceViewports) {
		await page.setViewportSize({width, height});
		await target.scrollIntoViewIfNeeded();
		const path = fromRoot(`.dev/evidence/${name}-${width}x${height}.png`);
		if (captureElement) {
			await target.screenshot({animations: 'disabled', path});
		} else {
			await page.screenshot({animations: 'disabled', path});
		}
	}

	const device = await page.context().newCDPSession(page);
	try {
		await device.send('Emulation.setDeviceMetricsOverride', {
			width: 440,
			height: 956,
			deviceScaleFactor: 3,
			mobile: true,
			screenOrientation: {angle: 0, type: 'portraitPrimary'},
		});
		await target.scrollIntoViewIfNeeded();
		assert.ok(
			await page
				.locator('html')
				.evaluate(
					(node: {scrollWidth: number; clientWidth: number}) =>
						node.scrollWidth <= node.clientWidth,
				),
			'screen overflows at 440px',
		);
		const {data} = await device.send('Page.captureScreenshot', {
			format: 'png',
			captureBeyondViewport: false,
		});
		await writeFile(
			fromRoot(`.dev/evidence/${name}-440x956-dsf3.png`),
			Buffer.from(data, 'base64'),
		);
	} finally {
		await device.send('Emulation.clearDeviceMetricsOverride');
		await device.detach();
	}

	await page.setViewportSize(evidenceViewports[1]);
}

async function bookmarkTitles(page: Page): Promise<string[]> {
	const state = await send(page, {type: 'GET_STATE'});
	assert.ok(Array.isArray(state.bookmarks));
	return state.bookmarks.map((bookmark: unknown) => {
		assert.ok(isRecord(bookmark));
		if (typeof bookmark.title !== 'string') {
			assert.fail('Saved bookmark has no title.');
		}

		return bookmark.title;
	});
}

const evidence = fromRoot('.dev/evidence');
await mkdir(evidence, {recursive: true});
const profile = await mkdtemp(fromRoot('.dev/private-check-'));
const errors: string[] = [];
const launch = async () =>
	chromium.launchPersistentContext(profile, {
		channel: 'chromium',
		headless: true,
		deviceScaleFactor: 2,
		args: [
			`--disable-extensions-except=${OUT_DIR}`,
			`--load-extension=${OUT_DIR}`,
		],
	});
const context = await launch();
try {
	const worker =
		context.serviceWorkers()[0] ??
		(await context.waitForEvent('serviceworker'));
	const id = new URL(worker.url()).hostname;
	let normal = await context.newPage();
	await normal.goto(`chrome-extension://${id}/newtab.html`);
	const normalBookmark = await send(normal, {
		type: 'ADD_BOOKMARK',
		bookmark: {title: 'Normal only', url: 'https://normal.example/'},
	});
	assert.equal(normalBookmark.ok, true);
	await normal.goto(`chrome-extension://${id}/options.html`);
	const privateSettingsRadios = normal
		.getByRole('radiogroup', {name: 'Choose a library for private windows'})
		.getByRole('radio');
	await normal
		.getByText(
			'Enable Allow in Incognito in your browser’s extension settings to configure private storage.',
			{exact: true},
		)
		.waitFor();
	const disabledMessage = normal.getByText(
		'Enable Allow in Incognito in your browser’s extension settings to configure private storage.',
		{exact: true},
	);
	assert.equal(
		(await disabledMessage.getAttribute('class'))
			?.split(/\s+/)
			.includes('mb-4'),
		false,
		'Disabled private settings should not add margin below the message.',
	);
	assert.equal(
		await privateSettingsRadios.count(),
		0,
		'Private storage choices should be hidden without incognito access.',
	);

	assert.equal(
		await normal.getByRole('button', {name: /Save private settings/}).count(),
		0,
		'Settings should apply private storage changes without a Save button.',
	);
	for (const theme of ['Light', 'Dark']) {
		await normal.getByRole('radio', {name: theme, exact: true}).click();
		await captureEvidence(
			normal,
			normal.locator('#settings-private-windows'),
			`settings-${theme.toLowerCase()}`,
			true,
		);
	}

	const extensions = await context.newPage();
	await extensions.goto('chrome://extensions');
	const reloadedWorker = context.waitForEvent('serviceworker');
	void reloadedWorker.catch(() => undefined);
	await extensions.evaluate(async (extensionId) => {
		const api = (globalThis as typeof globalThis & ChromeGlobal).chrome;
		await api.developerPrivate.updateProfileConfiguration({
			inDeveloperMode: true,
		});
		await api.developerPrivate.updateExtensionConfiguration({
			extensionId,
			incognitoAccess: true,
		});
	}, id);
	await reloadedWorker;
	await extensions.close();
	normal = await context.newPage();
	await normal.goto(`chrome-extension://${id}/options.html`);
	const enabledPrivateSettingsRadios = normal
		.getByRole('radiogroup', {name: 'Choose a library for private windows'})
		.getByRole('radio');
	for (const radio of await enabledPrivateSettingsRadios.all()) {
		assert.equal(
			await radio.isDisabled(),
			false,
			'Private settings must be enabled with incognito access.',
		);
	}

	assert.equal(
		await normal.getByRole('button', {name: /Save private settings/}).count(),
		0,
		'Settings should apply private storage changes without a Save button.',
	);
	for (const theme of ['Light', 'Dark'] as const) {
		await normal.getByRole('radio', {name: theme, exact: true}).click();
		await captureEvidence(
			normal,
			normal.locator('#settings-private-windows'),
			`private-window-settings-${theme.toLowerCase()}`,
			true,
		);
	}

	const redirectSwitch = normal.getByRole('switch', {
		name: 'Redirect private new tabs to the dashboard',
	});
	assert.equal(await redirectSwitch.getAttribute('aria-checked'), 'true');
	const redirectedPage = await openPrivateNewTab(normal);
	redirectedPage.on('pageerror', (error) => {
		errors.push(error.message);
	});
	await redirectedPage.waitForURL(`chrome-extension://${id}/newtab.html`);
	assert.equal(
		await redirectedPage.evaluate(
			() =>
				(globalThis as typeof globalThis & ChromeGlobal).chrome.extension
					.inIncognitoContext,
		),
		true,
	);
	console.log('ok a new private tab redirects to the TabLodge dashboard');
	await redirectedPage.close();
	await redirectSwitch.click();
	await normal
		.getByRole('status')
		.getByText('New private tabs will use the browser’s page.', {exact: true})
		.waitFor();
	const nativePage = await openPrivateNewTab(normal);
	await nativePage.waitForLoadState();
	assert.equal(nativePage.url(), 'chrome://newtab/');
	await nativePage.close();
	console.log(
		'ok disabling the setting keeps the browser private new tab page',
	);
	await normal.goto(`chrome-extension://${id}/newtab.html`);
	const popupPromise = context.waitForEvent('page');
	void popupPromise.catch(() => undefined);
	await normal.evaluate(
		async (url) =>
			(globalThis as typeof globalThis & ChromeGlobal).chrome.windows.create({
				incognito: true,
				url,
			}),
		`chrome-extension://${id}/popup.html`,
	);
	const popup = await popupPromise;
	await popup.waitForLoadState();
	const privatePagePromise = context.waitForEvent('page');
	void privatePagePromise.catch(() => undefined);
	await popup.getByRole('button', {name: 'Open Dashboard'}).click();
	const privatePage = await privatePagePromise;
	privatePage.on('pageerror', (error) => {
		errors.push(error.message);
	});
	await privatePage.waitForLoadState();
	assert.equal(
		await privatePage.evaluate(
			() =>
				(globalThis as typeof globalThis & ChromeGlobal).chrome.extension
					.inIncognitoContext,
		),
		true,
	);
	const dialog = privatePage.getByRole('dialog', {
		name: 'Configure private TabLodge',
	});
	await dialog.waitFor();
	assert.equal(
		(
			await privatePage.getByRole('main', {includeHidden: true}).textContent()
		)?.trim(),
		'',
		'Setup should appear over an empty background, without a second heading behind the dialog.',
	);
	assert.equal(
		await privatePage
			.getByRole('radio', {name: /Use the same library as regular windows/})
			.isChecked(),
		true,
	);
	await privatePage.keyboard.press('Escape');
	assert.equal(await dialog.isVisible(), true);
	await privatePage.mouse.click(5, 5);
	assert.equal(await dialog.isVisible(), true);
	const axeSource = await readFile(
		fromRoot('node_modules/axe-core/axe.min.js'),
		'utf8',
	);
	await normal.goto(`chrome-extension://${id}/options.html`);
	for (const theme of ['light', 'dark'] as const) {
		await setPrivatePageTheme(normal, privatePage, theme);
		await privatePage.evaluate(async () => {
			const {document, requestAnimationFrame} =
				globalThis as typeof globalThis & {
					document: {
						getAnimations(): Array<{finished: Promise<unknown>}>;
					};
					requestAnimationFrame(callback: () => void): number;
				};
			const nextFrame = () =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => resolve());
				});
			await nextFrame();
			await nextFrame();
			await Promise.allSettled(
				document.getAnimations().map((animation) => animation.finished),
			);
		});
		await privatePage.evaluate(axeSource);
		const violations = await privatePage.evaluate(async () => {
			const {axe} = globalThis as typeof globalThis & {
				axe: {
					run(
						options: unknown,
					): Promise<{violations: Array<{id: string; help: string}>}>;
				};
			};
			return (
				await axe.run({
					runOnly: {
						type: 'tag',
						values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
					},
				})
			).violations;
		});
		assert.deepEqual(violations, []);
		await privatePage
			.getByRole('radio', {name: /Use the same library as regular windows/})
			.focus();
		await privatePage.keyboard.press('ArrowDown');
		assert.equal(
			await privatePage
				.getByRole('radio', {name: /Use a separate saved library/})
				.isChecked(),
			true,
		);
		await privatePage.keyboard.press('ArrowUp');
		assert.equal(
			await privatePage
				.getByRole('radio', {name: /Use the same library as regular windows/})
				.isChecked(),
			true,
		);
		await privatePage.keyboard.press('Escape');
		assert.equal(await dialog.isVisible(), true);
		await captureEvidence(privatePage, dialog, `private-setup-${theme}`);
	}

	await privatePage.setViewportSize({width: 1440, height: 900});

	await privatePage
		.getByRole('radio', {name: /Use the same library as regular windows/})
		.focus();
	await privatePage.keyboard.press('ArrowDown');
	assert.equal(
		await privatePage
			.getByRole('radio', {name: /Use a separate saved library/})
			.isChecked(),
		true,
	);
	await privatePage.keyboard.press('Tab');
	assert.equal(
		await privatePage.getByRole('button', {name: 'Continue'}).isVisible(),
		true,
	);
	await privatePage.keyboard.press('Enter');
	await privatePage.getByRole('dialog').waitFor({state: 'hidden'});
	await privatePage.getByRole('main').waitFor();
	const privateBanner = privatePage.locator(
		'aside[aria-label="Private window"]',
	);
	await privateBanner.getByText('You’re in a private window').waitFor();
	await privateBanner
		.getByText('Separate library saved on this device', {exact: true})
		.waitFor();
	assert.equal(await privateBanner.count(), 1);
	await privatePage
		.getByRole('link', {name: 'Private window settings'})
		.waitFor();
	assert.match(
		(await privatePage.getByLabel('Private window').textContent()) ?? '',
		/You’re in a private window[\s\S]*Separate library saved on this device/,
	);
	assert.equal(
		await privatePage.locator(':focus').textContent(),
		'Private window settings',
	);
	for (const theme of ['light', 'dark'] as const) {
		await setPrivatePageTheme(normal, privatePage, theme);
		await captureEvidence(
			privatePage,
			privatePage.locator('body'),
			`private-dashboard-${theme}`,
		);
	}

	for (const theme of ['light', 'dark'] as const) {
		await setPrivatePageTheme(normal, privatePage, theme);
		for (const page of [
			'options.html',
			'help.html',
			'popup.html',
			'sidepanel.html',
			'add-bookmark.html',
			'name-session.html',
		]) {
			await privatePage.goto(`chrome-extension://${id}/${page}`);
			// The popup and side panel show a compact badge in their header instead of the banner frame.
			await privatePage
				.locator(
					page === 'popup.html' || page === 'sidepanel.html'
						? '[role="img"][aria-label="Private window"]'
						: '[data-private-window-appearance]',
				)
				.waitFor();
			assert.equal(
				await privatePage.evaluate(
					() =>
						(globalThis as typeof globalThis & ChromeGlobal).chrome.extension
							.inIncognitoContext,
				),
				true,
				`${page} should know it is in a private window`,
			);
			const compact = page === 'popup.html' || page === 'sidepanel.html';
			if (compact) {
				assert.equal(
					await privatePage
						.locator('aside[aria-label="Private window"]')
						.count(),
					0,
					`${page} should not show the private banner`,
				);
			} else {
				const banner = privatePage.locator(
					'aside[aria-label="Private window"]',
				);
				assert.equal(
					await banner.count(),
					1,
					`${page} should show one private banner`,
				);
				await banner
					.getByText('You’re in a private window', {exact: true})
					.waitFor();
				await banner
					.getByText('Separate library saved on this device', {exact: true})
					.waitFor();
				assert.equal(
					await banner
						.getByText('You’re in a private window', {exact: true})
						.count(),
					1,
					`${page} should label the private window`,
				);
				assert.equal(
					await banner
						.getByText('Separate library saved on this device', {exact: true})
						.count(),
					1,
					`${page} should explain the active storage mode`,
				);
			}

			if (page === 'popup.html') {
				await privatePage.setViewportSize({width: 380, height: 600});
				const documentHeight = await privatePage
					.locator('html')
					.evaluate((node: {scrollHeight: number}) => node.scrollHeight);
				assert.ok(
					documentHeight <= 600,
					`private popup content exceeds Chrome's 600px height limit (${documentHeight}px)`,
				);
				await privatePage.screenshot({
					animations: 'disabled',
					path: fromRoot(`.dev/evidence/private-popup-${theme}-380x600.png`),
				});
			}

			if (page === 'options.html' || page === 'help.html') {
				await captureEvidence(
					privatePage,
					privatePage.locator('body'),
					`private-${page.slice(0, -5)}-${theme}`,
				);
			}
		}
	}

	// A private accent tints private pages live and leaves regular windows alone.
	const accentVariable =
		"document.documentElement.style.getPropertyValue('--brand-primary-light')";
	await privatePage.goto(`chrome-extension://${id}/options.html`);
	assert.equal(await privatePage.evaluate<string>(accentVariable), '');
	const tealSaved = await send(privatePage, {
		type: 'SET_PRIVATE_ACCENT',
		accent: 'teal',
	});
	assert.equal(tealSaved.ok, true);
	await privatePage.waitForFunction(
		"document.documentElement.style.getPropertyValue('--brand-primary-light') !== ''",
	);
	assert.equal(await normal.evaluate<string>(accentVariable), '');
	await send(privatePage, {type: 'SET_PRIVATE_ACCENT', accent: 'same'});
	await privatePage.waitForFunction(
		"document.documentElement.style.getPropertyValue('--brand-primary-light') === ''",
	);

	await privatePage.goto(`chrome-extension://${id}/newtab.html`);
	await privatePage.getByRole('main').waitFor();

	assert.equal(
		await privatePage.getByRole('button', {name: /Don.t show again/}).count(),
		0,
	);
	assert.deepEqual(await bookmarkTitles(privatePage), []);
	assert.equal(
		(
			await send(privatePage, {
				type: 'ADD_BOOKMARK',
				bookmark: {
					title: 'Saved private',
					url: 'https://saved-private.example/',
				},
			})
		).ok,
		true,
	);
	console.log(
		'ok private dashboard opens; setup is required, keyboard operable, and accessible in both themes',
	);
	console.log(
		'ok saved private library starts empty and does not expose the normal library',
	);
	await configure(normal, privatePage, 'temporary');
	assert.equal(
		(
			await send(privatePage, {
				type: 'ADD_BOOKMARK',
				bookmark: {
					title: 'Temporary private',
					url: 'https://temporary-private.example/',
				},
			})
		).ok,
		true,
	);
	await privatePage.getByText('Temporary private', {exact: true}).waitFor();
	await privatePage.close();
	const reopenedPromise = context.waitForEvent('page');
	await normal.evaluate(
		async (url) =>
			(globalThis as typeof globalThis & ChromeGlobal).chrome.windows.create({
				incognito: true,
				url,
			}),
		`chrome-extension://${id}/newtab.html`,
	);
	const reopenedPage = await reopenedPromise;
	await reopenedPage.waitForLoadState();
	assert.deepEqual(await bookmarkTitles(reopenedPage), ['Temporary private']);
	console.log('ok temporary library survives closing all private windows');
	await context.close();
	const restarted = await launch();
	try {
		const normalRestarted = await restarted.newPage();
		await normalRestarted.goto(`chrome-extension://${id}/newtab.html`);
		const privateRestartedPromise = restarted.waitForEvent('page');
		await normalRestarted.evaluate(
			async (url) =>
				(globalThis as typeof globalThis & ChromeGlobal).chrome.windows.create({
					incognito: true,
					url,
				}),
			`chrome-extension://${id}/newtab.html`,
		);
		const page = await privateRestartedPromise;
		await page.waitForLoadState();
		assert.deepEqual(await bookmarkTitles(page), []);
		await configure(normalRestarted, page, 'saved');
		assert.deepEqual(await bookmarkTitles(page), ['Saved private']);
		await configure(normalRestarted, page, 'shared');
		assert.deepEqual(await bookmarkTitles(page), ['Normal only']);
		await page
			.locator('aside[aria-label="Private window"]')
			.getByText('Same library as regular windows', {exact: true})
			.waitFor();
		await Promise.all(
			Array.from({length: 10}, async (_, index) =>
				send(index % 2 === 0 ? page : normalRestarted, {
					type: 'ADD_BOOKMARK',
					bookmark: {
						title: `Concurrent ${index}`,
						url: `https://concurrent-${index}.example/`,
					},
				}),
			),
		);
		assert.deepEqual(
			(await bookmarkTitles(page)).toSorted(),
			[
				'Normal only',
				...Array.from({length: 10}, (_, index) => `Concurrent ${index}`),
			].toSorted(),
		);
		console.log(
			'ok concurrent normal and private saves preserve every bookmark in shared mode',
		);
		await page.close();
		await send(normalRestarted, {
			type: 'ADD_BOOKMARK',
			bookmark: {
				title: 'After private close',
				url: 'https://after-private-close.example/',
			},
		});
		assert.equal(
			(await bookmarkTitles(normalRestarted)).includes('After private close'),
			true,
		);
		console.log(
			'ok browser restart clears temporary data, preserves saved private data, and leaves normal data untouched',
		);
	} finally {
		await restarted.close();
	}

	assert.deepEqual(errors, []);
} finally {
	await context.close();
	await rm(profile, {recursive: true, force: true});
}
