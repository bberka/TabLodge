import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {
	chromium,
	type BrowserContext,
	type Locator,
	type Page,
} from 'playwright';
import {OUT_DIR, fromRoot} from './vite-shared.ts';

type ChromeGlobal = {
	chrome: {
		runtime: {sendMessage(message: Record<string, unknown>): Promise<unknown>};
		extension: {inIncognitoContext: boolean};
		windows: {
			create(options: {incognito: boolean; url: string}): Promise<unknown>;
			getAll(): Promise<Array<{id?: number; incognito: boolean}>>;
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

type StorageGlobal = {
	chrome: {
		storage: {
			local: {get(keys: null): Promise<Record<string, unknown>>};
			session: {
				get(keys: string[]): Promise<Record<string, unknown>>;
				set(values: Record<string, unknown>): Promise<void>;
			};
		};
	};
};

async function sendRaw(
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
	return result;
}

async function openPrivatePage(normal: Page, url: string): Promise<Page> {
	const pagePromise = normal.context().waitForEvent('page');
	void pagePromise.catch(() => undefined);
	await normal.evaluate(
		async (target) =>
			(globalThis as typeof globalThis & ChromeGlobal).chrome.windows.create({
				incognito: true,
				url: target,
			}),
		url,
	);
	const page = await pagePromise;
	await page.waitForLoadState();
	return page;
}

const LOCK_KEY = 'tablodge.privatelock.key';
const LOCK_ACTIVE_KEY = 'tablodge.privatelock.active';
const LOCK_WINDOWS_KEY = 'tablodge.privatelock.windows';
const LOCK_PASSWORD = 'correct horse battery';

/**
The ids of the private windows, as a private page sees them.
*/
async function privateWindowIds(privatePage: Page): Promise<number[]> {
	const ids = await privatePage.evaluate(async () => {
		const windows = await (
			globalThis as typeof globalThis & ChromeGlobal
		).chrome.windows.getAll();
		return windows.flatMap((win) =>
			win.incognito && win.id !== undefined ? [win.id] : [],
		);
	});
	return ids.toSorted((a, b) => a - b);
}

/**
What the private lock keeps in session storage: the key, the last use, and the private windows it tracks.
*/
async function lockSession(normal: Page) {
	const saved = await normal.evaluate(
		async (keys) =>
			(
				globalThis as typeof globalThis & StorageGlobal
			).chrome.storage.session.get(keys),
		[LOCK_KEY, LOCK_ACTIVE_KEY, LOCK_WINDOWS_KEY],
	);
	return {
		hasKey: saved[LOCK_KEY] !== undefined,
		hasActive: saved[LOCK_ACTIVE_KEY] !== undefined,
		windows: Array.isArray(saved[LOCK_WINDOWS_KEY])
			? (saved[LOCK_WINDOWS_KEY] as number[]).toSorted((a, b) => a - b)
			: undefined,
	};
}

async function waitFor<T>(
	read: () => Promise<T>,
	done: (value: T) => boolean,
	what: string,
	timeout = 10_000,
): Promise<T> {
	const deadline = Date.now() + timeout;
	for (;;) {
		const value = await read();
		if (done(value)) {
			return value;
		}

		if (Date.now() > deadline) {
			assert.fail(`Timed out waiting for ${what}: ${JSON.stringify(value)}`);
		}

		await new Promise((resolve) => {
			setTimeout(resolve, 100);
		});
	}
}

async function stopWorkers(context: BrowserContext, id: string) {
	const probe = await context.newPage();
	await probe.goto(`chrome-extension://${id}/options.html`);
	const cdp = await context.newCDPSession(probe);
	await cdp.send('ServiceWorker.enable');
	await cdp.send('ServiceWorker.stopAllWorkers');
	await probe.close();
}

async function storedPrivateValues(normal: Page) {
	return normal.evaluate(async () => {
		const all = await (
			globalThis as typeof globalThis & StorageGlobal
		).chrome.storage.local.get(null);
		return Object.entries(all).filter(
			([key]) =>
				key.startsWith('tablodge.private.') &&
				key !== 'tablodge.private.config' &&
				key !== 'tablodge.private.lock',
		);
	});
}

async function axeViolations(page: Page, axeSource: string) {
	await page.evaluate(axeSource);
	return page.evaluate(async () => {
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
}

type DocumentGlobal = {
	document: {
		activeElement: {tagName: string; textContent: string | null} | null;
	};
};

async function focused(page: Page) {
	return page.evaluate(() => {
		const {activeElement} = (globalThis as typeof globalThis & DocumentGlobal)
			.document;
		return {
			tag: activeElement?.tagName ?? '',
			text: activeElement?.textContent,
		};
	});
}

const lockedHeading = (page: Page) =>
	page.getByRole('heading', {name: /Private TabLodge is locked/});

async function unlockWith(page: Page, value: string) {
	await page.getByLabel('PIN or password', {exact: true}).fill(value);
	await page.keyboard.press('Enter');
}

/**
The PIN or password lock of the saved separate private library, in a real browser (issue #142).
*/
async function runLockChecks(
	context: BrowserContext,
	id: string,
	errors: string[],
	phase: 'enable' | 'afterBrowserRestart',
) {
	const axeSource = await readFile(
		fromRoot('node_modules/axe-core/axe.min.js'),
		'utf8',
	);
	const normal = await context.newPage();
	await normal.goto(
		`chrome-extension://${id}/options.html#settings-private-windows`,
	);

	if (phase === 'afterBrowserRestart') {
		// The browser closed with the library unlocked, so the key is gone and the library opens locked.
		const page = await openPrivatePage(
			normal,
			`chrome-extension://${id}/newtab.html`,
		);
		page.on('pageerror', (error) => {
			errors.push(error.message);
		});
		await lockedHeading(page).waitFor();
		assert.equal(
			(
				await normal.evaluate(
					async (key) =>
						(
							globalThis as typeof globalThis & StorageGlobal
						).chrome.storage.session.get([key]),
					LOCK_KEY,
				)
			)[LOCK_KEY],
			undefined,
		);
		await unlockWith(page, 'wrong wrong wrong');
		await page.getByRole('alert').getByText('not correct').waitFor();
		await unlockWith(page, LOCK_PASSWORD);
		await page.getByText('Saved private', {exact: true}).waitFor();
		console.log(
			'ok a browser restart locks the library and the password opens it',
		);
		// Removing the lock leaves the original plain data.
		const removed = await sendRaw(page, {
			type: 'REMOVE_PRIVATE_LOCK',
			credential: LOCK_PASSWORD,
		});
		assert.equal(removed.ok, true);
		const values = await storedPrivateValues(normal);
		assert.ok(values.length > 0);
		assert.ok(
			values.every(([, value]) => !(isRecord(value) && value.tlock === 1)),
			'every value is plain again',
		);
		assert.match(JSON.stringify(values), /saved-private\.example/);
		console.log('ok removing the lock restores plain, readable private data');
		await page.close();
		await normal.close();
		return;
	}

	assert.equal(
		(await sendRaw(normal, {type: 'SET_PRIVATE_CONFIG', mode: 'saved'})).ok,
		true,
	);
	const privatePage = await openPrivatePage(
		normal,
		`chrome-extension://${id}/options.html#settings-private-windows`,
	);
	privatePage.on('pageerror', (error) => {
		errors.push(error.message);
	});
	const turnOn = privatePage.getByRole('button', {name: 'Turn on lock…'});
	await turnOn.waitFor();
	// A regular window shows the status but cannot change the lock.
	await normal.reload();
	await normal
		.getByText('Open Settings in a private window to turn the lock on', {
			exact: false,
		})
		.waitFor();
	assert.equal(
		await normal.getByRole('button', {name: 'Turn on lock…'}).count(),
		0,
	);

	// Turn the lock on by keyboard, in both themes, at every viewport.
	for (const theme of ['light', 'dark'] as const) {
		await setPrivatePageTheme(normal, privatePage, theme);
		await captureEvidence(
			privatePage,
			privatePage.locator('[data-private-lock-settings]'),
			`lock-settings-off-${theme}`,
		);
	}

	await turnOn.focus();
	await privatePage.keyboard.press('Enter');
	const enableDialog = privatePage.getByRole('dialog', {
		name: 'Lock private windows',
	});
	await enableDialog.waitFor();
	assert.ok(
		await enableDialog
			.getByText('Nothing can recover', {exact: false})
			.or(enableDialog.getByText('cannot be recovered', {exact: false}))
			.first()
			.isVisible(),
		'the lost credential warning shows before enabling',
	);
	const submit = enableDialog.getByRole('button', {name: 'Turn on lock'});
	assert.equal(await submit.isDisabled(), true);
	for (const theme of ['light', 'dark'] as const) {
		await setPrivatePageTheme(normal, privatePage, theme);
		await captureEvidence(
			privatePage,
			enableDialog,
			`lock-enable-dialog-${theme}`,
		);
		assert.deepEqual(await axeViolations(privatePage, axeSource), []);
	}

	await enableDialog.getByText('PIN', {exact: true}).click();
	assert.ok(
		await enableDialog
			.getByText('Short PINs are weak against copied profile files', {
				exact: false,
			})
			.isVisible(),
	);
	await enableDialog.getByText('Password', {exact: true}).first().click();
	await enableDialog
		.getByRole('textbox', {name: 'Password', exact: true})
		.fill(LOCK_PASSWORD);
	await enableDialog
		.getByRole('textbox', {name: 'Confirm Password'})
		.fill(LOCK_PASSWORD);
	await enableDialog.getByRole('checkbox').check();
	await submit.click();
	await privatePage
		.getByRole('status')
		.getByText('Private windows are locked.', {exact: true})
		.waitFor();
	await enableDialog.waitFor({state: 'hidden'});
	const sealed = await storedPrivateValues(normal);
	assert.ok(sealed.length >= 2);
	assert.ok(
		sealed.every(([, value]) => isRecord(value) && value.tlock === 1),
		'every private library value is encrypted at rest',
	);
	assert.doesNotMatch(
		JSON.stringify(sealed),
		/saved-private\.example|Saved private/,
	);
	assert.ok(
		isRecord(
			(
				await normal.evaluate(
					async (key) =>
						(
							globalThis as typeof globalThis & StorageGlobal
						).chrome.storage.session.get([key]),
					LOCK_KEY,
				)
			)[LOCK_KEY],
		),
		'the key is in session storage',
	);
	console.log(
		'ok turning the lock on encrypts every private library value at rest',
	);

	// The mode cannot change while the lock is on, from a regular window or by message.
	await normal.reload();
	const modeRadios = normal
		.getByRole('radiogroup', {name: 'Choose a library for private windows'})
		.getByRole('radio');
	for (const radio of await modeRadios.all()) {
		assert.equal(await radio.isDisabled(), true);
	}

	await normal
		.getByText(
			'Remove the lock in a private window before choosing another storage mode',
			{
				exact: false,
			},
		)
		.first()
		.waitFor();
	const blocked = await sendRaw(normal, {
		type: 'SET_PRIVATE_CONFIG',
		mode: 'shared',
	});
	assert.equal(blocked.ok, false);
	assert.match(String(blocked.error), /remove the lock/);
	await captureEvidence(
		normal,
		normal.locator('#settings-private-windows'),
		'lock-mode-blocked',
		true,
	);
	console.log('ok the storage mode cannot change while the library is locked');

	// Lock now, from the header by keyboard.
	await privatePage.goto(`chrome-extension://${id}/newtab.html`);
	await privatePage.getByText('Saved private', {exact: true}).waitFor();
	const lockNow = privatePage.getByRole('button', {
		name: 'Lock private windows now',
	});
	await lockNow.focus();
	await privatePage.keyboard.press('Enter');
	await lockedHeading(privatePage).waitFor();
	assert.equal(
		(await focused(privatePage)).tag,
		'INPUT',
		'focus lands in the credential field',
	);
	assert.equal(await privatePage.getByText('Saved private').count(), 0);
	for (const theme of ['light', 'dark'] as const) {
		await setPrivatePageTheme(normal, privatePage, theme);
		await captureEvidence(
			privatePage,
			privatePage.locator('body'),
			`lock-screen-${theme}`,
		);
		assert.deepEqual(await axeViolations(privatePage, axeSource), []);
	}

	// Locked: the worker refuses reads, writes, and backups.
	for (const message of [
		{type: 'GET_STATE'},
		{type: 'GET_FULL_BACKUP'},
		{type: 'ADD_BOOKMARK', bookmark: {title: 'x', url: 'https://x.example/'}},
	]) {
		const refused = await sendRaw(privatePage, message);
		assert.equal(refused.ok, false, message.type);
		assert.equal(refused.locked, true, message.type);
	}

	for (const page of ['popup.html', 'sidepanel.html']) {
		await privatePage.goto(`chrome-extension://${id}/${page}`);
		await lockedHeading(privatePage).waitFor();
		if (page !== 'popup.html') {
			continue;
		}

		await privatePage.setViewportSize({width: 380, height: 600});
		await privatePage.screenshot({
			animations: 'disabled',
			path: fromRoot('.dev/evidence/lock-popup-380x600.png'),
		});
	}

	await privatePage.goto(`chrome-extension://${id}/newtab.html`);
	await lockedHeading(privatePage).waitFor();
	await privatePage.setViewportSize({width: 1440, height: 900});
	await unlockWith(privatePage, 'wrong wrong wrong');
	const wrong = privatePage.getByRole('alert').getByText('not correct');
	await wrong.waitFor();
	assert.equal(await lockedHeading(privatePage).isVisible(), true);
	await captureEvidence(
		privatePage,
		privatePage.locator('body'),
		'lock-screen-wrong-credential',
	);
	await unlockWith(privatePage, LOCK_PASSWORD);
	await privatePage.getByText('Saved private', {exact: true}).waitFor();
	for (
		let attempt = 0;
		attempt < 100 && (await focused(privatePage)).tag === 'BODY';
		attempt += 1
	) {
		await privatePage.waitForTimeout(100);
	}

	assert.notEqual(
		(await focused(privatePage)).tag,
		'BODY',
		'focus is not left on the page body after unlocking',
	);

	console.log(
		'ok the lock screen blocks the page, rejects a wrong password, and opens with the right one',
	);

	// A restarted worker keeps the library open while the browser keeps running.
	await stopWorkers(context, id);
	assert.deepEqual(await bookmarkTitles(privatePage), ['Saved private']);
	console.log('ok a restarted private worker keeps the library unlocked');

	// The idle timeout locks the page by itself.
	assert.equal(
		(await sendRaw(privatePage, {type: 'SET_PRIVATE_LOCK_IDLE', minutes: 1}))
			.ok,
		true,
	);
	await normal.evaluate(async () => {
		const {session} = (globalThis as typeof globalThis & StorageGlobal).chrome
			.storage;
		const saved = await session.get(['tablodge.privatelock.active']);
		await session.set({
			'tablodge.privatelock.active':
				(saved['tablodge.privatelock.active'] as number) - 2 * 60_000,
		});
	});
	await lockedHeading(privatePage).waitFor({timeout: 15_000});
	console.log('ok the idle timeout locks an open private page');
	await unlockWith(privatePage, LOCK_PASSWORD);
	await privatePage.getByText('Saved private', {exact: true}).waitFor();

	// Change the credential from Settings by keyboard.
	await privatePage.goto(
		`chrome-extension://${id}/options.html#settings-private-windows`,
	);
	const change = privatePage.getByRole('button', {name: /^Change password/});
	await change.focus();
	await privatePage.keyboard.press('Enter');
	const changeDialog = privatePage.getByRole('dialog', {
		name: 'Change PIN or password',
	});
	await changeDialog.waitFor();
	await captureEvidence(privatePage, changeDialog, 'lock-change-dialog');
	await privatePage.keyboard.press('Escape');
	await changeDialog.waitFor({state: 'hidden'});
	assert.equal(
		(await focused(privatePage)).text,
		await change.textContent(),
		'focus returns to the control that opened the dialog',
	);
	for (const theme of ['light', 'dark'] as const) {
		await setPrivatePageTheme(normal, privatePage, theme);
		await captureEvidence(
			privatePage,
			privatePage.locator('[data-private-lock-settings]'),
			`lock-settings-on-${theme}`,
		);
	}

	await runWindowLockChecks(context, normal, privatePage, id, errors);
	await normal.close();
}

/**
Closing the last private window locks the library; closing one of several, or restarting the worker, does not.
The private worker is not woken when a private window closes, so the lock is judged on the next wake.
*/
async function runWindowLockChecks(
	context: BrowserContext,
	normal: Page,
	first: Page,
	id: string,
	errors: string[],
) {
	const newtab = `chrome-extension://${id}/newtab.html`;
	const watch = (page: Page) => {
		page.on('pageerror', (error) => {
			errors.push(error.message);
		});
	};

	// Unlocking recorded the private window that was open.
	const [firstId] = await privateWindowIds(first);
	assert.equal((await privateWindowIds(first)).length, 1);
	await waitFor(
		() => lockSession(normal),
		(state) => state.hasKey && state.windows?.join(',') === String(firstId),
		'the unlocked library to track the open private window',
	);

	// A second private window opens unlocked, because the first is still open.
	const second = await openPrivatePage(normal, newtab);
	watch(second);
	await second.getByText('Saved private', {exact: true}).waitFor();
	const [, secondId] = await privateWindowIds(second);
	assert.ok(secondId > firstId, 'window ids only count up');
	await waitFor(
		() => lockSession(normal),
		(state) => state.windows?.join(',') === `${firstId},${secondId}`,
		'both private windows to be tracked',
	);

	// Closing one of two keeps it unlocked, and so does a worker restart with a window still open.
	await first.close();
	await stopWorkers(context, id);
	assert.deepEqual(await bookmarkTitles(second), ['Saved private']);
	await second.reload();
	await second.getByText('Saved private', {exact: true}).waitFor();
	assert.equal((await lockSession(normal)).hasKey, true);
	assert.ok((await lockSession(normal)).windows?.includes(secondId));
	console.log(
		'ok closing one of two private windows, and restarting the worker, keep the library unlocked',
	);

	// Close the only private window while the worker is stopped: nothing runs, so the key stays in memory.
	await stopWorkers(context, id);
	await second.close();
	await new Promise((resolve) => {
		setTimeout(resolve, 1500);
	});
	const afterClose = await lockSession(normal);
	console.log(
		`   after the last close with the worker stopped: key ${afterClose.hasKey ? 'still in session memory' : 'already gone'}`,
	);

	// The next private window shows the lock screen and the key is gone before it can read anything.
	const third = await openPrivatePage(normal, newtab);
	watch(third);
	await lockedHeading(third).waitFor();
	assert.deepEqual(await lockSession(normal), {
		hasKey: false,
		hasActive: false,
		windows: undefined,
	});
	const [thirdId] = await privateWindowIds(third);
	assert.ok(thirdId > secondId, 'a new window never reuses an id');
	for (const message of [{type: 'GET_STATE'}, {type: 'GET_FULL_BACKUP'}]) {
		const refused = await sendRaw(third, message);
		assert.equal(refused.ok, false, message.type);
		assert.equal(refused.locked, true, message.type);
	}

	assert.equal(await third.getByText('Saved private').count(), 0);
	await captureEvidence(
		third,
		third.locator('body'),
		'lock-screen-after-last-close',
	);
	console.log(
		'ok after the last private window closed, the next one shows the lock screen and no key remains in session storage',
	);

	// Unlocking again tracks the new window. This time the worker is awake when the last window closes.
	await unlockWith(third, LOCK_PASSWORD);
	await third.getByText('Saved private', {exact: true}).waitFor();
	await waitFor(
		() => lockSession(normal),
		(state) => state.hasKey && state.windows?.join(',') === String(thirdId),
		'the new window to be tracked',
	);
	await third.close();
	const awake = await waitFor(
		() => lockSession(normal),
		(state) => !state.hasKey,
		'an awake worker to lock when the last window closed',
		5000,
	).catch(() => undefined);
	console.log(
		`   after the last close with the worker awake: ${awake ? 'locked at once' : 'key still in session memory'}`,
	);
	const fourth = await openPrivatePage(normal, newtab);
	watch(fourth);
	await lockedHeading(fourth).waitFor();
	assert.equal((await lockSession(normal)).hasKey, false);
	console.log(
		'ok the next window after an awake close shows the lock screen too',
	);

	// Leave the library unlocked with a window open, as the browser restart check expects.
	await unlockWith(fourth, LOCK_PASSWORD);
	await fourth.getByText('Saved private', {exact: true}).waitFor();
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

	// Private pages get their own accent by default, live, and regular windows keep theirs.
	const accentVariable =
		"document.documentElement.style.getPropertyValue('--brand-primary-light')";
	await privatePage.goto(`chrome-extension://${id}/options.html`);
	assert.notEqual(await privatePage.evaluate<string>(accentVariable), '');
	assert.equal(await normal.evaluate<string>(accentVariable), '');
	const sameSaved = await send(privatePage, {
		type: 'SET_PRIVATE_ACCENT',
		accent: 'same',
	});
	assert.equal(sameSaved.ok, true);
	await privatePage.waitForFunction(
		"document.documentElement.style.getPropertyValue('--brand-primary-light') === ''",
	);
	await send(privatePage, {type: 'SET_PRIVATE_ACCENT', accent: 'teal'});
	await privatePage.waitForFunction(
		"document.documentElement.style.getPropertyValue('--brand-primary-light') !== ''",
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
		const snapshots = await send(page, {type: 'GET_SNAPSHOTS'});
		assert.equal(snapshots.enabled, false);
		assert.deepEqual(snapshots.snapshots, []);
		assert.equal(snapshots.recovery, null);
		await page.getByRole('main').waitFor();
		assert.equal(
			await page.getByRole('button', {name: 'Recent snapshots'}).count(),
			0,
		);
		await normalRestarted.reload();
		await normalRestarted
			.getByRole('button', {name: 'Recent snapshots'})
			.first()
			.waitFor();
		await captureEvidence(page, page.getByRole('main'), 'private-no-snapshots');
		console.log(
			'ok private windows show no snapshot controls and read no snapshots in shared mode',
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

	const lockContext = await launch();
	try {
		await runLockChecks(lockContext, id, errors, 'enable');
	} finally {
		await lockContext.close();
	}

	const afterRestart = await launch();
	try {
		await runLockChecks(afterRestart, id, errors, 'afterBrowserRestart');
	} finally {
		await afterRestart.close();
	}

	assert.deepEqual(errors, []);
} finally {
	await context.close();
	await rm(profile, {recursive: true, force: true});
}
