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
	SHARED_PAGE_LIVE_PASSWORD_FEATURE,
	SHARED_PAGES_FEATURE,
	type SharedPageMode,
} from '../../../extension/src/shared/sync/shared-pages';
import {refreshLiveSharedPages} from '../../../extension/src/shared/live-shared-pages';
import type {Store} from '../../../extension/src/shared/types';
import {readJson} from '../platform/storage';
import {serverFeatures, useServerFeatures} from './server-features';
import {useSyncStatus} from './library-store';

const APP_NAME = 'TabLodge';
const livePageFingerprints = new Map<string, string>();

async function target(): Promise<SyncConfig> {
	const config = parseConfig(await readJson(SYNC_CONFIG_KEY));
	if (!config) {
		throw new Error('Connect a sync server to share pages by link.');
	}

	return config;
}

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

export function useSharedPagesCapabilities(): {
	server: 'none' | 'unknown' | 'old' | 'ready';
	keepsIds: boolean;
	supportsLivePassword: boolean;
} {
	const server = useSharedPagesServer();
	const features = useServerFeatures();
	return {
		server,
		keepsIds: Boolean(features?.includes(SHARED_PAGE_IMPORT_FEATURE)),
		supportsLivePassword: Boolean(
			features?.includes(SHARED_PAGE_LIVE_PASSWORD_FEATURE),
		),
	};
}

export async function uploadPage(
	title: string,
	build: (url?: string) => string,
	{
		source,
		mode,
		password,
	}: {
		source?: string;
		mode?: SharedPageMode;
		password?: string;
	} = {},
): Promise<SharedPage> {
	const config = await target();
	const features = await serverFeatures(config.url);
	const keepsIds = Boolean(features?.includes(SHARED_PAGE_IMPORT_FEATURE));
	const supportsLivePassword = Boolean(
		features?.includes(SHARED_PAGE_LIVE_PASSWORD_FEATURE),
	);
	if (
		!supportsLivePassword &&
		(mode === 'live' || (password !== undefined && password !== ''))
	) {
		throw new Error(
			'Update your sync server to use live links and password protection.',
		);
	}

	const id = keepsIds ? newSharedPageId(getRandomBytes) : undefined;
	return uploadSharedPage(
		fetch,
		config,
		title,
		build(id && sharedPageUrl(config.url, id)),
		{
			id,
			source: id && source,
			mode: supportsLivePassword ? mode : undefined,
			password: supportsLivePassword ? password : undefined,
		},
	);
}

export async function syncLiveSharedPages(
	config: SyncConfig,
	store: Pick<Store, 'bookmarkColumns' | 'bookmarks' | 'groups'>,
): Promise<void> {
	await refreshLiveSharedPages(
		fetch,
		config,
		store,
		APP_NAME,
		livePageFingerprints,
	);
}

export async function sharedPages(): Promise<SharedPage[]> {
	return listSharedPages(fetch, await target());
}

export async function deletePage(id: string): Promise<void> {
	await deleteSharedPage(fetch, await target(), id);
	livePageFingerprints.delete(id);
}
