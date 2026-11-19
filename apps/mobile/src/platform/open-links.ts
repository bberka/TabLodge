import {Linking} from 'react-native';
import {openLinksTogether} from '../../modules/open-links';
import {confirm} from '../ui/dialog';
import {getPreferences} from '../settings/preferences';
import {isPrivateView} from '../library/view';
import {type Opener, settingsOpener} from './open-choices';

const DELAY_MS = 350;
const ASK_ABOVE = 3;

const pause = async (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

/**
Opens every link the way `opener` says, or the settings when it is missing. The native call hands them all to Android
at once, which is the only way to keep going after the first one puts the browser in front. When the chosen way fails
(the browser was removed, or no in-app tab is available), the default browser takes them. Builds without native support open them one at a time, and
that needs the app to stay in front, so only the first is reliable.
*/
async function openLinks(urls: string[], opener?: Opener): Promise<void> {
	const {how, app} =
		opener ?? settingsOpener(getPreferences(), isPrivateView());
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
Opens one link the way the settings ask, or the way `opener` says for this once.
*/
export function openLink(url: string, opener?: Opener): void {
	void openLinks([url], opener);
}

/**
Opens several links, asking first when there are more than a few, since each one leaves this app. `opener` overrides
the settings for this once, and `onOpen` runs once they were sent off, never after Cancel.
*/
export function openAll(
	urls: string[],
	from: string,
	opener?: Opener,
	onOpen?: () => void,
): void {
	if (urls.length === 0) {
		return;
	}

	if (urls.length <= ASK_ABOVE) {
		void openLinks(urls, opener);
		onOpen?.();
		return;
	}

	confirm(
		`Open ${urls.length} links?`,
		`${from} will open in your browser.`,
		{label: 'Open all'},
		() => {
			void openLinks(urls, opener);
			onOpen?.();
		},
	);
}
