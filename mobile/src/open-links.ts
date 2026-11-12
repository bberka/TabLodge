import {Alert, Linking} from 'react-native';

const DELAY_MS = 350;
const ASK_ABOVE = 3;

const pause = async (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

/**
Opens each link in the default browser, one after another so they keep their order. Android hands every link to
the browser separately, and most browsers add each as a new tab.
*/
async function openLinks(urls: string[]): Promise<void> {
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
		`${from} will open in your browser one after another.`,
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
