import * as Clipboard from 'expo-clipboard';
import {
	parseConfig,
	SYNC_CONFIG_KEY,
	type SyncConfig,
} from '../../../extension/src/shared/sync/client';
import {
	deleteSharedPage,
	listSharedPages,
	type SharedPage,
	uploadSharedPage,
} from '../../../extension/src/shared/sync/shared-pages-client';
import {SHARED_PAGES_FEATURE} from '../../../extension/src/shared/sync/shared-pages';
import {readJson} from '../platform/storage';
import {showSnack} from '../ui/snackbar';
import {useServerFeatures} from './server-features';
import {useSyncStatus} from './library-store';

async function target(): Promise<SyncConfig> {
	const config = parseConfig(await readJson(SYNC_CONFIG_KEY));
	if (!config) {
		throw new Error('Connect a sync server to share pages by link.');
	}

	return config;
}

/**
`ready` when the connected server takes shared pages, `old` when it is too old for them, `unknown` while it has not
answered or cannot be reached, `none` without a server.
*/
export function useSharedPagesServer(): 'none' | 'unknown' | 'old' | 'ready' {
	const {connected} = useSyncStatus();
	const features = useServerFeatures();
	if (!connected) {
		return 'none';
	}

	if (features === undefined) {
		return 'unknown';
	}

	return features.includes(SHARED_PAGES_FEATURE) ? 'ready' : 'old';
}

export async function uploadPage(
	title: string,
	html: string,
): Promise<SharedPage> {
	return uploadSharedPage(fetch, await target(), title, html);
}

export async function sharedPages(): Promise<SharedPage[]> {
	return listSharedPages(fetch, await target());
}

export async function deletePage(id: string): Promise<void> {
	await deleteSharedPage(fetch, await target(), id);
}

export async function copyLink(url: string): Promise<void> {
	await Clipboard.setStringAsync(url);
	showSnack('Link copied');
}
