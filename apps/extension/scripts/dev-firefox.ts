// The Firefox counterpart of scripts/dev-browser.ts: opens the Firefox build in a dedicated profile with the
// extension loaded, optionally with the sample data fixture and without a desktop window.
//
// Headless mode prints the geckodriver address and session id. A Selenium client can attach to that session to
// drive the extension pages (see "Browser access" in docs/agents/validation.md). End the session, or stop this
// process, to close Firefox and the build watchers.
import {mkdir} from 'node:fs/promises';
import process from 'node:process';
import {createDevFixture, type DevStore} from '../src/shared/dev-fixture.ts';
import {
	evaluateInPage,
	launchFirefox,
	openExtensionPage,
	type FirefoxSession,
} from './firefox-driver.ts';
import {fromRoot} from './vite-shared.ts';

const profileDirectory = (headless: boolean) =>
	fromRoot(headless ? '.dev/firefox-headless-profile' : '.dev/firefox-profile');

type StateReply = ({ok: true} & DevStore) | {ok: false; error: string};

async function seedDevStore({driver}: FirefoxSession) {
	const response = await evaluateInPage<StateReply>(
		driver,
		"return await chrome.runtime.sendMessage({type: 'GET_STATE'});",
	);
	if (!response.ok) {
		throw new Error(`Could not read the default store: ${response.error}`);
	}

	const {ok: _ok, ...baseStore} = response;
	await evaluateInPage(
		driver,
		`await chrome.storage.local.set({'tablodge.state': ${JSON.stringify(createDevFixture(baseStore))}});`,
	);
	const seeded = await evaluateInPage<StateReply>(
		driver,
		"return await chrome.runtime.sendMessage({type: 'GET_STATE'});",
	);
	if (
		!seeded.ok ||
		seeded.groups.length !== 6 ||
		seeded.bookmarks.length !== 16
	) {
		throw new Error('The development data fixture did not load as expected.');
	}
}

/**
Resolves once the browser session is gone: the window was closed, or the session was ended.
*/
async function sessionEnded({driver}: FirefoxSession) {
	for (;;) {
		await new Promise((resolve) => {
			setTimeout(resolve, 1000);
		});
		try {
			if ((await driver.getAllWindowHandles()).length === 0) {
				return;
			}
		} catch {
			return;
		}
	}
}

export async function openDevFirefox(
	options: {seedData?: boolean; headless?: boolean} = {},
	watchers: Array<{close(): Promise<void>}> = [],
): Promise<void> {
	const headless = options.headless ?? false;
	const profile = profileDirectory(headless);
	let session: FirefoxSession | undefined;

	try {
		await mkdir(profile, {recursive: true});
		session = await launchFirefox(profile, headless);
		const {driver} = session;
		const startTabs = await driver.getAllWindowHandles();
		await openExtensionPage(driver, 'newtab.html');
		const dashboard = await driver.getWindowHandle();
		for (const handle of startTabs) {
			await driver.switchTo().window(handle);
			await driver.close();
		}

		await driver.switchTo().window(dashboard);
		if (options.seedData) {
			await seedDevStore(session);
			await driver.navigate().refresh();
			console.log('Loaded the deterministic development data fixture.');
		}

		console.log(
			`Loaded TabLodge in ${profile}. Reload the add-on from about:debugging#/runtime/this-firefox after each rebuild.`,
		);
		if (headless) {
			console.log(
				`Dev browser WebDriver: ${session.serverUrl} (session ${session.sessionId})`,
			);
		}

		const stop = async () => {
			await driver.quit().catch(() => undefined);
		};

		process.once('SIGINT', () => void stop());
		process.once('SIGTERM', () => void stop());
		await sessionEnded(session);
		await driver.quit().catch(() => undefined);
		await Promise.all(watchers.map(async (watcher) => watcher.close()));
	} catch (error) {
		await session?.driver.quit().catch(() => undefined);
		console.warn(
			'Could not launch Firefox. Install Firefox or set FIREFOX_BIN to its executable, then run the dev:firefox task again. The build watcher is still running.',
		);
		console.warn(error instanceof Error ? error.message : String(error));
	}
}
