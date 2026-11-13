import {Alert, Linking} from 'react-native';
import {openLinksTogether} from '../modules/open-links';

const DELAY_MS = 350;
const ASK_ABOVE = 3;

const pause = async (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

/**
Opens every link in the default browser. The native call hands them all to Android at once, which is the only way
to keep going after the first one puts the browser in front. Builds without it open them one at a time, and that
needs the app to stay in front, so only the first is reliable.
*/
async function openLinks(urls: string[]): Promise<void> {
	if (openLinksTogether(urls)) {
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

	Alert.alert(
		`Open ${urls.length} links?`,
		`${from} will open in your browser.`,
		[
			{text: 'Cancel', style: 'cancel'},
			{
				text: 'Open all',
				onPress() {
					void openLinks(urls);
				},
			},
		],
	);
}
