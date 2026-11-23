import type {ActionResult} from '../shared/types';
import type {ShowStatus} from './common';
import {send} from './message-client';
import type {SiteSource} from './site-sources';

type SiteAccess = {ok: true} | {ok: false; error: string};

async function requestSiteAccess(
	sources: readonly SiteSource[],
): Promise<SiteAccess> {
	const granted = await chrome.permissions
		.request({origins: sources.flatMap((source) => source.origins)})
		.catch(() => false);
	if (granted) {
		return {ok: true};
	}

	const hosts = sources.map((source) => source.hosts[0]).join(', ');
	return {
		ok: false,
		error:
			sources.length === 1
				? `The browser did not grant access to ${hosts}, so ${sources[0].label} is not on here.`
				: `The browser did not grant access to ${hosts}, so those sites are not on here.`,
	};
}

/**
Asks for the sites' permissions in one prompt and turns them on in this browser: Settings › Sources › Add a site,
Allow again, Turn on, and the dashboard's Turn on for sites that are on in another browser. Call it straight from the
click or key press: Firefox refuses the permission request after another await.
*/
export async function turnOnSiteSources(
	sources: readonly SiteSource[],
): Promise<ActionResult<'SET_SITE_SOURCE'>> {
	const access = await requestSiteAccess(sources);
	if (!access.ok) {
		return access;
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

export type StoppedSiteSource = {
	source: SiteSource;
	columnId?: string;
	keepOffSite?: true;
};

async function putStoppedSourceBack(
	stop: StoppedSiteSource,
	access: Promise<SiteAccess>,
): Promise<string> {
	const granted = await access;
	if (!granted.ok) {
		return `${granted.error} Add ${stop.source.label} again in Settings › Sources.`;
	}

	const on = await send('SET_SITE_SOURCE', {
		source: stop.source.id,
		enabled: true,
	});
	if (!on.ok) {
		return `${on.error} Add ${stop.source.label} again in Settings › Sources.`;
	}

	const failures: string[] = [];
	if (stop.columnId) {
		const chosen = await send('SET_SITE_SOURCE_COLUMN', {
			source: stop.source.id,
			columnId: stop.columnId,
		});
		if (!chosen.ok) {
			failures.push(chosen.error);
		}
	}

	if (stop.keepOffSite) {
		const kept = await send('SET_SITE_SOURCE_KEEP_OFF', {
			source: stop.source.id,
			keepOffSite: true,
		});
		if (!kept.ok) {
			failures.push(kept.error);
		}
	}

	return failures.length === 0
		? `${stop.source.label} is on again.`
		: `${stop.source.label} is on again, but not as it was: ${failures.join(' ')}`;
}

export async function undoStoppedSource(
	trashId: string | undefined,
	stop: StoppedSiteSource,
	showStatus: ShowStatus,
	reload: () => unknown,
) {
	if (!trashId) {
		return;
	}

	const access = requestSiteAccess([stop.source]);
	const restored = await send('RESTORE_TRASH', {id: trashId});
	if (!restored.ok) {
		showStatus(restored.error, true);
		return;
	}

	await reload();
	showStatus(
		`Restored to ${restored.placed}. ${await putStoppedSourceBack(stop, access)}`,
		false,
		{toast: true},
	);
}
