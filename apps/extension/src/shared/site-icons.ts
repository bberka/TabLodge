// Site icons kept per host on this device, for links the browser has no icon for. Firefox has no favicon service, so
// there the icon of each site the user opens is remembered from its tab (handed over as a data address, so showing it
// asks the site for nothing). On both browsers, with a sync server connected, the server fetches the icon of a site
// the browser does not know, and the answer is kept here too: the icon, or for a day the fact that there is none.
import {toBase64} from './private-lock';
import type {SyncConfig} from './sync/client';
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
	return !page || !icon ? icons : rememberHostIcon(icons, hostOf(page), icon);
}

function rememberHostIcon(icons: SiteIcons, host: string, icon: string) {
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

export const MISSING_ICONS_KEY = 'tablodge.siteIcons.missing';
export const MISSING_ICON_MS = 24 * 60 * 60 * 1000;
const SERVER_ICON_REQUESTS = 4;
// After the server fails to answer (offline, refused, rate limited), it is not asked again for this long.
const SERVER_PAUSE_MS = 5 * 60 * 1000;

/**
When the server last said a host has no icon, by host, oldest first.
*/
export type MissingIcons = Record<string, number>;

/**
Reads the stored "no icon" times, which are untrusted.
*/
export function normalizeMissingIcons(value: unknown): MissingIcons {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return {};
	}

	const missing: MissingIcons = {};
	for (const [host, time] of Object.entries(value).slice(-MAX_SITE_ICONS)) {
		if (host && typeof time === 'number' && Number.isFinite(time)) {
			missing[host] = time;
		}
	}

	return missing;
}

/**
The icon store after the server answered for `host`: the icon when there is a storable one, otherwise a day of "none".
Both lists keep the newest {@link MAX_SITE_ICONS} hosts.
*/
export function rememberServerAnswer(
	stored: {icons: SiteIcons; missing: MissingIcons},
	host: string,
	answer: string | undefined,
	now: number,
): {icons: SiteIcons; missing: MissingIcons} {
	const {[host]: _, ...missing} = stored.missing;
	const icon = iconAddress(answer);
	if (icon) {
		return {icons: rememberHostIcon(stored.icons, host, icon), missing};
	}

	const entries = Object.entries(missing);
	entries.push([host, now]);
	return {
		icons: stored.icons,
		missing: Object.fromEntries(entries.slice(-MAX_SITE_ICONS)),
	};
}

/**
The host to ask the server about for `pageUrl`: a plain domain name, as the server and the Android app accept. Not an
address with a port, a bare name like `localhost`, or a page that is not a website.
*/
export function serverIconHost(pageUrl: string) {
	const page = webUrl(pageUrl);
	const host = page ? hostOf(page).toLowerCase() : '';
	return /^[\da-z][\d\-.a-z]*\.[\d\-a-z]{2,}$/.test(host) && host.length <= 253
		? host
		: undefined;
}

/**
The bytes of an image as a data address.
*/
export const imageDataAddress = (bytes: Uint8Array, type: string) =>
	`data:${type};base64,${toBase64(bytes)}`;

export type ServerIconDeps = {
	fetch: typeof fetch;
	/**
	The server to ask, or undefined when icons must not be asked for (no server, the setting off, a private window
	that does not sync the connected library).
	*/
	server(): Promise<SyncConfig | undefined>;
	load(): Promise<{icons: SiteIcons; missing: MissingIcons}>;
	/**
	Stores the server's answer for `host` (see {@link rememberServerAnswer}).
	*/
	save(host: string, icon: string | undefined): Promise<void>;
	/**
	A data address small enough to store for an image too big to store as it is, if the browser can redraw it.
	*/
	shrink(image: Blob): Promise<string | undefined>;
	now(): number;
};

/**
Asks the sync server for site icons, at most a few at a time and once per host: a stored icon or a recent "none" is
answered from storage. Only a 404 counts as "none" (an older server without the route answers that too). Any other
failure pauses asking for a few minutes and stores nothing, so the next look asks again.
*/
export function createServerIcons(deps: ServerIconDeps) {
	const pending = new Map<string, Promise<string | undefined>>();
	const queue: Array<() => void> = [];
	let running = 0;
	let pausedUntil = 0;

	const turn = async () => {
		if (running >= SERVER_ICON_REQUESTS) {
			await new Promise<void>((resolve) => {
				queue.push(resolve);
			});
		}

		running += 1;
	};

	const done = () => {
		running -= 1;
		queue.shift()?.();
	};

	async function ask(host: string): Promise<string | undefined> {
		const server = await deps.server();
		if (!server) {
			return undefined;
		}

		const {icons, missing} = await deps.load();
		const known = icons[host];
		if (known !== undefined) {
			return known;
		}

		if (
			deps.now() < pausedUntil ||
			deps.now() - (missing[host] ?? -Infinity) < MISSING_ICON_MS
		) {
			return undefined;
		}

		await turn();
		try {
			const response = await deps.fetch(
				`${server.url}/v1/icon?host=${encodeURIComponent(host)}`,
				{headers: [['Authorization', `Bearer ${server.token}`]]},
			);
			if (response.status === 404) {
				await deps.save(host, undefined);
				return undefined;
			}

			if (!response.ok) {
				pausedUntil = deps.now() + SERVER_PAUSE_MS;
				return undefined;
			}

			const image = await response.blob();
			const type = (response.headers.get('content-type') ?? '')
				.split(';', 1)[0]
				.trim()
				.toLowerCase();
			const whole = imageDataAddress(
				new Uint8Array(await image.arrayBuffer()),
				type,
			);
			const icon = iconAddress(whole) ?? (await deps.shrink(image));
			await deps.save(host, icon);
			return iconAddress(icon);
		} catch {
			pausedUntil = deps.now() + SERVER_PAUSE_MS;
			return undefined;
		} finally {
			done();
		}
	}

	return {
		/**
		The icon for the site of `pageUrl`, asking the server when nothing is known about it.
		*/
		async iconFor(pageUrl: string): Promise<string | undefined> {
			const host = serverIconHost(pageUrl);
			if (!host) {
				return undefined;
			}

			let answer = pending.get(host);
			if (!answer) {
				answer = ask(host).finally(() => pending.delete(host));
				pending.set(host, answer);
			}

			return answer;
		},
	};
}
