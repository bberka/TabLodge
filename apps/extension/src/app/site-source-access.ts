import type {ActionResult} from '../shared/types';
import {send} from './common';
import type {SiteSource} from './site-sources';

/**
Asks for the sites' permissions in one prompt and turns them on in this browser: Settings › Sources › Add a site,
Allow again, Turn on, and the dashboard's Turn on for sites that are on in another browser. Call it straight from the
click or key press: Firefox refuses the permission request after another await.
*/
export async function turnOnSiteSources(
	sources: readonly SiteSource[],
): Promise<ActionResult<'SET_SITE_SOURCE'>> {
	const granted = await chrome.permissions
		.request({origins: sources.flatMap((source) => source.origins)})
		.catch(() => false);
	if (!granted) {
		const hosts = sources.map((source) => source.hosts[0]).join(', ');
		return {
			ok: false,
			error:
				sources.length === 1
					? `The browser did not grant access to ${hosts}, so ${sources[0].label} is not on here.`
					: `The browser did not grant access to ${hosts}, so those sites are not on here.`,
		};
	}

	let result: ActionResult<'SET_SITE_SOURCE'> = {ok: false, error: 'No site.'};
	for (const source of sources) {
		result = await send('SET_SITE_SOURCE', {source: source.id, enabled: true});
		if (!result.ok) {
			return result;
		}
	}

	return result;
}

/**
Switches a site off in every browser and gives its site permission back here: Settings › Sources › Remove, and the
answer yes to the stop question when its source column is deleted.
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
