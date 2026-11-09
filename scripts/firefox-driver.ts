// Shared Selenium plumbing for the scripts that run the Firefox build in a real Firefox
// (scripts/firefox-smoke-check.ts and the dev launcher in scripts/dev-firefox.ts).
//
// Needs Firefox (FIREFOX_BIN overrides the one Selenium finds) and a matching geckodriver, which Selenium
// downloads when none is on the PATH. The add-on is installed as a temporary add-on, so Firefox does not
// need to sign it. It is pinned to a fixed internal UUID so its pages have a known address.
import assert from 'node:assert/strict';
import process from 'node:process';
import firefox from 'selenium-webdriver/firefox.js';
import {GECKO_ID} from './manifest-targets.ts';
import {outDirFor} from './vite-shared.ts';

const UUID = '7a1f0c2e-5b7d-4f43-9a41-4f1c2b9d0a11';
export const EXTENSION_BASE = `moz-extension://${UUID}/`;

export type FirefoxSession = {
	driver: firefox.Driver;
	/**
	The geckodriver address; a WebDriver client can attach to the session through it.
	*/
	serverUrl: string;
	sessionId: string;
};

/**
Starts Firefox on `profile` (a directory that persists between launches) with dist/tablodge-firefox installed.
*/
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

	// WebDriver cannot open moz-extension:// pages; chrome-scoped scripts can, which needs system access.
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

/**
Opens an extension page in a new tab and switches to it.
*/
export async function openExtensionPage(driver: firefox.Driver, page: string) {
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
	// The tab exists before its page has loaded; scripts run on whatever document is there.
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

/**
Runs an async function body in the current extension page, where `chrome.*` is the add-on's own API.
*/
export async function evaluateInPage<T>(
	driver: firefox.Driver,
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
