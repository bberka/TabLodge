import {readCompat} from '../../../extension/src/shared/sync/compat';
import {syncClient, useSyncStatus} from './library-store';

/**
What the server at `url` can do, as the sync client last heard at /v1/status; undefined while it is not known: another
server, not connected, or not asked yet.
*/
export async function serverFeatures(
	url: string,
): Promise<readonly string[] | undefined> {
	const status = await syncClient.status();
	return status.connected && status.url === url
		? readCompat(status).server?.features
		: undefined;
}

/**
The optional parts the connected server has (`private`, `key`, `preview`, `trash`, `notes`, `page-source`,
`shared-pages`), as the sync client last heard at /v1/status, or undefined while it is not known: not connected, or
not asked yet. Share › HTML page › Get a link needs `shared-pages`.
*/
export function useServerFeatures(): readonly string[] | undefined {
	const status = useSyncStatus();
	return status.connected ? readCompat(status).server?.features : undefined;
}
