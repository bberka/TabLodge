import {readCompat} from '../../../extension/src/shared/sync/compat';
import {syncClient, useSyncStatus} from './library-store';

export async function serverFeatures(
	url: string,
): Promise<readonly string[] | undefined> {
	const status = await syncClient.status();
	return status.connected && status.url === url
		? readCompat(status).server?.features
		: undefined;
}

export function useServerFeatures(): readonly string[] | undefined {
	const status = useSyncStatus();
	return status.connected ? readCompat(status).server?.features : undefined;
}
