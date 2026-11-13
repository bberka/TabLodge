// "Open in Internet Archive": the address of the Wayback Machine's newest capture of a saved link. The page is
// opened only when someone chooses the menu item, so the address goes to archive.org on that click and nowhere else,
// and TabLodge stores nothing about it.
import {stripTrackingParameters} from './tracking-parameters';
import {webUrl} from './web-url';

export const ARCHIVE_ORIGIN = 'https://web.archive.org/web/';

/**
Where the Internet Archive keeps the newest capture of `url`, or null for an address that is not a web page. With
`removeTracking`, tracking parameters are dropped first, the same as for opening the link, so they are not sent either.
The Archive shows its own "not archived" page when it has no capture.
*/
export function archiveUrl(url: string, dropTracking = false): string | null {
	const address = webUrl(url);
	return address
		? `${ARCHIVE_ORIGIN}${dropTracking ? stripTrackingParameters(address) : address}`
		: null;
}

/**
Opens the archived copy of a link in a new tab. Does nothing for an address that is not a web page.
*/
export async function openArchivedCopy(
	url: string,
	settings?: {removeTrackingParameters?: boolean},
): Promise<void> {
	const target = archiveUrl(url, settings?.removeTrackingParameters === true);
	if (target) {
		await chrome.tabs.create({url: target});
	}
}
