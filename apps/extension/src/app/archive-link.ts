import {stripTrackingParameters} from '../shared/tracking-parameters';
import {webUrl} from '../shared/web-url';

export const ARCHIVE_ORIGIN = 'https://web.archive.org/web/';

export function archiveUrl(url: string, dropTracking = false): string | null {
	const address = webUrl(url);
	return address
		? `${ARCHIVE_ORIGIN}${dropTracking ? stripTrackingParameters(address) : address}`
		: null;
}

export async function openArchivedCopy(
	url: string,
	settings?: {removeTrackingParameters?: boolean},
): Promise<void> {
	const target = archiveUrl(url, settings?.removeTrackingParameters === true);
	if (target) {
		await chrome.tabs.create({url: target});
	}
}
