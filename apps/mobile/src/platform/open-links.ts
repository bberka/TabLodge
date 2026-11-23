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

async function openLinks(urls: string[], opener?: Opener): Promise<boolean> {
	const {how, app} =
		opener ?? settingsOpener(getPreferences(), isPrivateView());
	if (
		openLinksTogether(urls, how, app) ||
		(how !== 'system' && openLinksTogether(urls))
	) {
		return true;
	}

	let opened = false;
	for (const [index, url] of urls.entries()) {
		if (index > 0) {
			await pause(DELAY_MS);
		}

		try {
			await Linking.openURL(url);
			opened = true;
		} catch {}
	}

	return opened;
}

export function openLink(url: string, opener?: Opener): void {
	void openLinks([url], opener);
}

export function openAll(
	urls: string[],
	from: string,
	opener?: Opener,
	onOpen?: () => void,
): void {
	if (urls.length === 0) {
		return;
	}

	const send = async () => {
		if (await openLinks(urls, opener)) {
			onOpen?.();
		}
	};

	if (urls.length <= ASK_ABOVE) {
		void send();
		return;
	}

	const wasPrivate = isPrivateView();

	confirm(
		`Open ${urls.length} links?`,
		`${from} will open in your browser.`,
		{label: 'Open all'},
		() => {
			if (wasPrivate && !isPrivateView()) {
				return;
			}

			void send();
		},
	);
}
