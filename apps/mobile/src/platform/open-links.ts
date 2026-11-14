import {Linking} from 'react-native';
import {type OpenHow, openLinksTogether} from '../../modules/open-links';
import {confirm} from '../ui/dialog';
import {getPreferences, type OpenWith} from '../settings/preferences';
import {isPrivateView} from '../library/view';

const DELAY_MS = 350;
const ASK_ABOVE = 3;

const pause = async (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

/**
How links open now: what the settings say for the library on screen. The private library follows its own choice, which
can point at another browser.
*/
function currentOpener(): {how: OpenHow; app: string} {
	const prefs = getPreferences();
	const own = isPrivateView() && prefs.privateOpenWith !== 'same';
	const how = own ? (prefs.privateOpenWith as OpenWith) : prefs.openWith;
	return {how, app: own ? prefs.privateOpenApp : prefs.openApp};
}

/**
Opens every link the way the settings ask. The native call hands them all to Android at once, which is the only way to
keep going after the first one puts the browser in front. When the chosen way fails (the browser was removed, or no
in-app tab is available), the default browser takes them. Builds without native support open them one at a time, and
that needs the app to stay in front, so only the first is reliable.
*/
async function openLinks(urls: string[]): Promise<void> {
	const {how, app} = currentOpener();
	if (
		openLinksTogether(urls, how, app) ||
		(how !== 'system' && openLinksTogether(urls))
	) {
		return;
	}

	for (const [index, url] of urls.entries()) {
		if (index > 0) {
			await pause(DELAY_MS);
		}

		try {
			await Linking.openURL(url);
		} catch {
			// A link no app can open is skipped.
		}
	}
}

/**
Opens one link the way the settings ask.
*/
export function openLink(url: string): void {
	void openLinks([url]);
}

/**
Opens several links, asking first when there are more than a few, since each one leaves this app.
*/
export function openAll(urls: string[], from: string): void {
	if (urls.length === 0) {
		return;
	}

	if (urls.length <= ASK_ABOVE) {
		void openLinks(urls);
		return;
	}

	confirm(
		`Open ${urls.length} links?`,
		`${from} will open in your browser.`,
		{label: 'Open all'},
		() => {
			void openLinks(urls);
		},
	);
}
