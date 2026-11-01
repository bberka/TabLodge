import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium, type Page} from 'playwright';
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
		shared: 'Share normal storage',
		saved: 'Separate, saved storage',
		temporary: 'Separate, temporary storage',
	};
	const choice = normal.getByRole('radio', {
		name: new RegExp(`^${titles[mode]}`),
	});
	await choice.focus();
	await Promise.all([
		privatePage.waitForEvent('load'),
		normal.keyboard.press('Space'),
	]);
	await normal
		.getByRole('status')
		.getByText(`Private window storage set to ${titles[mode]}.`, {exact: true})
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
		.getByRole('radiogroup', {name: 'Private window storage'})
		.getByRole('radio');
	await privateSettingsRadios.first().waitFor();
	await normal
		.getByText(
			'Private storage settings are disabled until Allow in Incognito is enabled in your browser’s extension settings.',
			{exact: true},
		)
		.waitFor();
	for (const radio of await privateSettingsRadios.all()) {
		assert.equal(
			await radio.isDisabled(),
			true,
			'Private settings must be disabled without incognito access.',
		);
	}

	assert.equal(
		await normal.getByRole('button', {name: /Save private settings/}).count(),
		0,
		'Settings should apply private storage changes without a Save button.',
	);
	await normal.setViewportSize({width: 1000, height: 900});
	for (const theme of ['Light', 'Dark']) {
		await normal.getByRole('radio', {name: theme, exact: true}).click();
		await normal
			.getByText(
				'Private storage settings are disabled until Allow in Incognito is enabled in your browser’s extension settings.',
				{exact: true},
			)
			.scrollIntoViewIfNeeded();
		await normal.locator('#settings-private-windows').screenshot({
			path: join(evidence, `settings-${theme.toLowerCase()}.png`),
		});
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
		.getByRole('radiogroup', {name: 'Private window storage'})
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
			.getByRole('radio', {name: /Share normal storage/})
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
	for (const theme of ['light', 'dark']) {
		await normal
			.getByRole('radio', {
				name: theme === 'light' ? 'Light' : 'Dark',
				exact: true,
			})
			.click();
		await privatePage.locator(`html[data-theme="${theme}"]`).waitFor();
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
			.getByRole('radio', {name: /Share normal storage/})
			.focus();
		await privatePage.keyboard.press('ArrowDown');
		assert.equal(
			await privatePage
				.getByRole('radio', {name: /Separate, saved storage/})
				.isChecked(),
			true,
		);
		await privatePage.keyboard.press('ArrowUp');
		assert.equal(
			await privatePage
				.getByRole('radio', {name: /Share normal storage/})
				.isChecked(),
			true,
		);
		await privatePage.keyboard.press('Escape');
		assert.equal(await dialog.isVisible(), true);
		for (const width of [1440, 375]) {
			await privatePage.setViewportSize({width, height: 900});
			await privatePage.screenshot({
				path: join(evidence, `private-setup-${theme}-${width}.png`),
			});
		}
	}

	await privatePage.setViewportSize({width: 1440, height: 900});

	await privatePage.getByRole('radio', {name: /Share normal storage/}).focus();
	await privatePage.keyboard.press('ArrowDown');
	assert.equal(
		await privatePage
			.getByRole('radio', {name: /Separate, saved storage/})
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
	await privatePage
		.getByRole('link', {name: 'Change private storage'})
		.waitFor();
	assert.match(
		(await privatePage.getByLabel('Private storage').textContent()) ?? '',
		/Separate, saved storage/,
	);
	assert.equal(
		await privatePage.locator(':focus').textContent(),
		'Change private storage',
	);
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
