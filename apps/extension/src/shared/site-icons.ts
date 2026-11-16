// Icons of sites the user has opened, kept per host on this device. Firefox has no favicon service, so a bookmark
// to a site that is not open would show a letter tile; a remembered icon from an earlier tab of that site fills in.
// Firefox hands a tab's icon over as a data address, so showing one never asks the site for anything.
import {hostOf, webUrl} from './web-url';

export const SITE_ICONS_KEY = 'tablodge.siteIcons';
export const MAX_SITE_ICONS = 300;
export const MAX_ICON_ADDRESS = 8192;
const IMAGE_DATA_ADDRESS =
	/^data:image\/(?:png|gif|jpeg|webp|x-icon|vnd\.microsoft\.icon|svg\+xml);base64,[\d+/=a-z]+$/i;

/**
Icon address by host, oldest first.
*/
export type SiteIcons = Record<string, string>;

/**
Reads stored icons, which are untrusted: anything that is not a small base64 image address is dropped.
*/
export function normalizeSiteIcons(value: unknown): SiteIcons {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return {};
	}

	const icons: SiteIcons = {};
	for (const [host, icon] of Object.entries(value).slice(-MAX_SITE_ICONS)) {
		if (host && iconAddress(icon)) {
			icons[host] = icon as string;
		}
	}

	return icons;
}

/**
The icons with the one from `iconUrl` set for the host of `pageUrl` and moved to the newest place, dropping the
oldest past the limit. Returns `icons` itself when nothing changes.
*/
export function rememberSiteIcon(
	icons: SiteIcons,
	pageUrl: string,
	iconUrl: unknown,
): SiteIcons {
	const page = webUrl(pageUrl);
	const icon = iconAddress(iconUrl);
	if (!page || !icon) {
		return icons;
	}

	const host = hostOf(page);
	const entries = Object.entries(icons);
	if (entries.at(-1)?.[0] === host && icons[host] === icon) {
		return icons;
	}

	const next = entries.filter(([known]) => known !== host);
	next.push([host, icon]);
	return Object.fromEntries(next.slice(-MAX_SITE_ICONS));
}

/**
The remembered icon address for the site of `pageUrl`, if any.
*/
export function siteIconFor(icons: SiteIcons, pageUrl: string) {
	const page = webUrl(pageUrl);
	return page ? icons[hostOf(page)] : undefined;
}

function iconAddress(value: unknown) {
	return typeof value === 'string' &&
		value.length <= MAX_ICON_ADDRESS &&
		IMAGE_DATA_ADDRESS.test(value)
		? value
		: undefined;
}
