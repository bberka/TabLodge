import {getRandomBytes} from 'expo-crypto';
import {
	parseConfig,
	SYNC_CONFIG_KEY,
	type SyncConfig,
} from '../../../extension/src/shared/sync/client';
import {
	deleteSharedPage,
	listSharedPages,
	type SharedPage,
	sharedPageUrl,
	uploadSharedPage,
} from '../../../extension/src/shared/sync/shared-pages-client';
import {
	newSharedPageId,
	SHARED_PAGE_IMPORT_FEATURE,
	SHARED_PAGES_FEATURE,
} from '../../../extension/src/shared/sync/shared-pages';
import {readJson} from '../platform/storage';
import {serverFeatures, useServerFeatures} from './server-features';
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
	build: (url?: string) => string,
	source?: string,
): Promise<SharedPage> {
	const config = await target();
	const keepsIds = (await serverFeatures(config.url))?.includes(
		SHARED_PAGE_IMPORT_FEATURE,
	);
	const id = keepsIds ? newSharedPageId(getRandomBytes) : undefined;
	return uploadSharedPage(
		fetch,
		config,
		title,
		build(id && sharedPageUrl(config.url, id)),
		{id, source: id && source},
	);
}

export async function sharedPages(): Promise<SharedPage[]> {
	return listSharedPages(fetch, await target());
}

export async function deletePage(id: string): Promise<void> {
	await deleteSharedPage(fetch, await target(), id);
}
