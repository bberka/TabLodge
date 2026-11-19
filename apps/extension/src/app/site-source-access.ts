import {send} from './common';
import type {SiteSource} from './site-sources';

/**
Switches a site off on this device and gives its site permission back: Settings › Sources › Remove, and the answer
yes to the stop question when its source column is deleted.
*/
export async function removeSiteSource(source: SiteSource) {
	const result = await send('SET_SITE_SOURCE', {
		source: source.id,
		enabled: false,
	});
	await chrome.permissions
		.remove({origins: source.origins})
		.catch(() => undefined);
	return result;
}
