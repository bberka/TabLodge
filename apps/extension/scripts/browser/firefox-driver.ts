import assert from 'node:assert/strict';
import process from 'node:process';
import firefoxModule from 'selenium-webdriver/firefox.js';
import type * as Firefox from 'selenium-webdriver/firefox.js';
import {GECKO_ID} from '../manifest-targets.ts';
import {outDirFor} from '../vite-shared.ts';

const UUID = '7a1f0c2e-5b7d-4f43-9a41-4f1c2b9d0a11';
const firefox = firefoxModule as typeof Firefox;
const EXTENSION_BASE = `moz-extension://${UUID}/`;

export type FirefoxSession = {
	driver: Firefox.Driver;
	serverUrl: string;
	sessionId: string;
};

export async function launchFirefox(
	profile: string,
	headless: boolean,
): Promise<FirefoxSession> {
	const options = new firefox.Options()
		.addArguments(...(headless ? ['-headless'] : []), '-profile', profile)
		.setPreference(
			'extensions.webextensions.uuids',
			JSON.stringify({[GECKO_ID]: UUID}),
		)
		.setPreference('xpinstall.signatures.required', false);
	if (process.env.FIREFOX_BIN) {
		options.setBinary(process.env.FIREFOX_BIN);
	}

	const service = new firefox.ServiceBuilder()
		.addArguments('--allow-system-access')
		.build();
	const driver = firefox.Driver.createSession(options, service);
	try {
		await driver.installAddon(outDirFor('firefox'), true);
		return {
			driver,
			serverUrl: await service.start(),
			sessionId: (await driver.getSession()).getId(),
		};
	} catch (error) {
		await driver.quit().catch(() => undefined);
		throw error;
	}
}

export async function openExtensionPage(driver: Firefox.Driver, page: string) {
	const before = await driver.getAllWindowHandles();
	await driver.setContext(firefox.Context.CHROME);
	await driver.executeScript(
		`const tab = gBrowser.addTab(arguments[0], {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});
		gBrowser.selectedTab = tab;`,
		EXTENSION_BASE + page,
	);
	await driver.setContext(firefox.Context.CONTENT);
	await driver.wait(async () => {
		const handles = await driver.getAllWindowHandles();
		return handles.length > before.length;
	}, 10_000);
	const added = (await driver.getAllWindowHandles()).find(
		(handle) => !before.includes(handle),
	);
	assert.ok(added);
	await driver.switchTo().window(added);
	await driver.wait(
		async () =>
			driver.executeScript<boolean>(
				"return location.protocol === 'moz-extension:' && document.readyState === 'complete';",
			),
		10_000,
		`${page} did not load`,
	);
}

const EVALUATE_WRAPPER = [
	'const done = arguments[arguments.length - 1];',
	'(async () => { /* BODY */ })().then(',
	'(result) => done(JSON.stringify({value: result})),',
	'(error) => done(JSON.stringify({error: String(error?.message ?? error)})),',
	');',
].join('\n');

export async function evaluateInPage<T>(
	driver: Firefox.Driver,
	body: string,
): Promise<T> {
	const raw = await driver.executeAsyncScript<string>(
		EVALUATE_WRAPPER.replace('/* BODY */', () => body),
	);
	const result = JSON.parse(raw) as {value?: T; error?: string};
	if (result.error !== undefined) {
		throw new Error(result.error);
	}

	return result.value as T;
}
