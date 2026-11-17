import {memo, useEffect, useState, useSyncExternalStore} from 'react';
import {FileText, Film, Image, type LucideIcon} from 'lucide-react';
import {isFirefox} from '../shared/browser';
import {LINK_KIND_LABELS, linkKind, type LinkKind} from '../shared/link-kind';
import {displayUrl} from '../shared/url-display';
import type {Settings} from '../shared/types';
import {
	SITE_ICONS_KEY,
	normalizeSiteIcons,
	siteIconFor,
	type SiteIcons,
} from '../shared/site-icons';
import {STATE_KEY} from '../shared/library-index';
import {SYNC_CONFIG_KEY} from '../shared/sync/client';
import {hostOf} from '../shared/web-url';
import {send} from './message-client';
import {InsecureMarkFor} from './insecure-mark';

const devFaviconFor = (url: string) => {
	try {
		const appWindow = globalThis as typeof globalThis & {
			__TABLODGE_DEV_FAVICONS__?: Record<string, string>;
		};
		return appWindow.__TABLODGE_DEV_FAVICONS__?.[new URL(url).origin];
	} catch {
		return undefined;
	}
};

// Chromium serves cached site icons to extensions at _favicon/. Firefox has no such service, so there the tab's own
// icon is shown where one is known, else an icon remembered from an earlier tab of the site. With a sync server
// connected, the server is asked for the icon of a site the browser does not know; the extension never asks a site.
export const faviconUrl = (url: string) =>
	isFirefox
		? ''
		: chrome.runtime.getURL(
				`_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`,
			);

// The icons kept on this device, loaded once per page and kept current: remembered tab icons on Firefox, icons from
// the sync server on both browsers.
const NO_ICONS: SiteIcons = {};
let siteIcons = NO_ICONS;
const iconListeners = new Set<() => void>();
let iconsWatched = false;
// Whether this page may ask the server for icons, asked of the worker again when the setting or the server changes.
let serverIcons = false;
const SERVER_ICON_KEYS = [
	SYNC_CONFIG_KEY,
	STATE_KEY,
	'tablodge.private.config',
];

function publishIcons() {
	for (const listener of iconListeners) {
		listener();
	}
}

function askServerIcons() {
	void send('GET_SERVER_ICONS').then((answer) => {
		const on = answer.ok && answer.on;
		if (on === serverIcons) {
			return;
		}

		serverIcons = on;
		publishIcons();
	});
}

function watchSiteIcons() {
	iconsWatched = true;
	void chrome.storage.local.get([SITE_ICONS_KEY]).then((saved) => {
		siteIcons = normalizeSiteIcons(saved[SITE_ICONS_KEY]);
		publishIcons();
	});
	askServerIcons();
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local') {
			return;
		}

		const change = changes[SITE_ICONS_KEY] as
			chrome.storage.StorageChange | undefined;
		if (change) {
			siteIcons = normalizeSiteIcons(change.newValue);
			publishIcons();
		}

		if (SERVER_ICON_KEYS.some((key) => Object.hasOwn(changes, key))) {
			askServerIcons();
		}
	});
}

function subscribeToSiteIcons(listener: () => void) {
	if (!iconsWatched) {
		watchSiteIcons();
	}

	iconListeners.add(listener);
	return () => {
		iconListeners.delete(listener);
	};
}

const useSiteIcon = (url: string) =>
	useSyncExternalStore(subscribeToSiteIcons, () => siteIconFor(siteIcons, url));

const useServerIcons = () =>
	useSyncExternalStore(subscribeToSiteIcons, () => serverIcons);

// Chromium's favicon service answers a site it has no icon for with its default globe, never an error. The globe is
// read once per page from an address no site can have, and an icon equal to it counts as missing.
let defaultIcon: Promise<string> | undefined;
const iconBytes = async (src: string) => {
	const response = await fetch(src);
	return new Uint8Array(await response.arrayBuffer()).join(',');
};

async function browserHasNoIcon(url: string) {
	defaultIcon ??= iconBytes(faviconUrl('https://tablodge.invalid/'));
	try {
		return (await iconBytes(faviconUrl(url))) === (await defaultIcon);
	} catch {
		return false;
	}
}

// Sites asked for from this page, so a list with many links to one site asks once.
const askedHosts = new Set<string>();

// Watches when an icon scrolls into view, so only the links on screen are asked about.
const visibleCallbacks = new WeakMap<Element, () => void>();
let visibility: IntersectionObserver | undefined;
function onceVisible(element: Element, callback: () => void) {
	visibility ??= new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (!entry.isIntersecting) {
				continue;
			}

			visibility?.unobserve(entry.target);
			visibleCallbacks.get(entry.target)?.();
		}
	});
	visibleCallbacks.set(element, callback);
	visibility.observe(element);
	return () => {
		visibleCallbacks.delete(element);
		visibility?.unobserve(element);
	};
}

/**
The icon the sync server gave for the site of `url`, for a link the browser has no icon for. With Site icons on Through
my server and a server connected, the server is asked once the element given to the returned ref is on screen;
`known` says the browser already has an icon, so nothing is asked. Undefined otherwise, and while the server has none.
*/
export function useServerIcon(
	url: string,
	known: boolean,
): [icon: string | undefined, ref: (element: Element | null) => void] {
	const on = useServerIcons();
	const stored = useSiteIcon(url);
	const [element, setElement] = useState<Element | null>(null);
	const [missing, setMissing] = useState('');
	useEffect(() => {
		if (!on || known || !element) {
			return;
		}

		let live = true;
		const stop = onceVisible(element, () => {
			void (async () => {
				// Firefox has no browser icon to look at: an unknown site is missing by definition.
				if (!isFirefox && !(await browserHasNoIcon(url))) {
					return;
				}

				if (live) {
					setMissing(url);
				}

				const host = hostOf(url);
				if (siteIconFor(siteIcons, url) || askedHosts.has(host)) {
					return;
				}

				askedHosts.add(host);
				await send('GET_SERVER_ICON', {url});
			})();
		});
		return () => {
			live = false;
			stop();
		};
	}, [on, known, element, url]);
	// On Chromium a stored icon replaces the browser's only when the browser has none.
	const show = on && (isFirefox || missing === url) ? stored : undefined;
	return [show, setElement];
}

type FaviconProps = {
	url: string;
	/**
	Text whose first letter fills the tile shown when the icon cannot load (defaults to the site's host).
	*/
	label?: string;
	/**
	Size, rounding and spacing (the icon sits on a transparent background).
	*/
	className?: string;
	/**
	Tried when the extension's favicon service has no icon, for example the tab's own `favIconUrl`. On Firefox an icon remembered from an earlier tab of the same site fills in when this is not given.
	*/
	fallbackSrc?: string;
};

/**
A site icon from the browser's favicon cache, or from the sync server when the browser has none. It loads lazily
(long lists do not fetch off-screen icons), decodes off the main thread, and falls back to a letter tile when no icon
can be loaded.
*/
export const Favicon = memo(
	({url, label, className = '', fallbackSrc: tabIcon}: FaviconProps) => {
		const rememberedIcon = useSiteIcon(url);
		const firefoxIcon = isFirefox ? rememberedIcon : undefined;
		const devFallbackSrc = devFaviconFor(url);
		const [serverIcon, observe] = useServerIcon(
			url,
			Boolean(devFallbackSrc || tabIcon || firefoxIcon),
		);
		const fallbackSrc = tabIcon || firefoxIcon;
		const serviceSrc = faviconUrl(url);
		const [failed, setFailed] = useState('');
		const [triedFallback, setTriedFallback] = useState(false);
		// Without an icon service the tab's own icon is the first choice.
		const useFallback = Boolean(fallbackSrc) && (triedFallback || !serviceSrc);
		if (
			failed === url ||
			(!devFallbackSrc && !serviceSrc && !fallbackSrc && !serverIcon)
		) {
			return (
				<span
					ref={observe}
					aria-hidden="true"
					className={`grid shrink-0 place-items-center overflow-hidden bg-muted text-[10px] font-semibold text-muted-foreground ${className}`}
				>
					{(String(label || hostOf(url)).trim()[0] || '↗').toUpperCase()}
				</span>
			);
		}

		return (
			<img
				ref={observe}
				className={`shrink-0 object-contain ${className}`}
				src={
					devFallbackSrc ||
					(useFallback ? fallbackSrc : serverIcon || serviceSrc)
				}
				alt=""
				data-favicon=""
				loading="lazy"
				decoding="async"
				onError={() => {
					if (fallbackSrc && serviceSrc && !triedFallback) {
						setTriedFallback(true);
						return;
					}

					setFailed(url);
				}}
			/>
		);
	},
);

const KIND_ICONS: Record<Exclude<LinkKind, 'page'>, LucideIcon> = {
	image: Image,
	pdf: FileText,
	video: Film,
};

/**
A small mark on the corner of an icon for a link to an image, a PDF, or a video, and the same word for screen
readers ahead of the link's name. Place it inside a `relative` box that holds the icon. Nothing for a page.
*/
export function LinkKindBadge({url}: {url: string}) {
	const kind = linkKind(url);
	if (kind === 'page') {
		return null;
	}

	const Icon = KIND_ICONS[kind];
	return (
		<>
			<span
				aria-hidden="true"
				title={LINK_KIND_LABELS[kind]}
				data-link-kind={kind}
				className="absolute -right-1.5 -bottom-1 grid size-4 place-items-center rounded-full bg-background text-foreground shadow-xs ring-1 ring-border"
			>
				<Icon className="size-3" strokeWidth={2.25} />
			</span>
			<span className="sr-only">{`${LINK_KIND_LABELS[kind]}: `}</span>
		</>
	);
}

/**
A bookmark's site icon with its kind mark. `className` sizes and places the icon.
*/
export function BookmarkIcon({
	url,
	label,
	className = '',
}: {
	url: string;
	label?: string;
	className?: string;
}) {
	return linkKind(url) === 'page' ? (
		<Favicon url={url} label={label} className={className} />
	) : (
		<span className={`relative shrink-0 ${className}`}>
			<Favicon
				url={url}
				label={label}
				className="size-full rounded-[inherit]"
			/>
			<LinkKindBadge url={url} />
		</span>
	);
}

const NO_SETTINGS: Partial<Settings> = {};

/**
The link a dialog is about, drawn like a list row: icon, title, and the full address (wrapped, never cut).
*/
export function LinkSummary({
	title,
	url,
	settings = NO_SETTINGS,
}: {
	title?: string;
	url: string;
	settings?: Partial<Settings>;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-left">
			<Favicon url={url} label={title} className="h-6 w-6 rounded-sm" />
			<span className="min-w-0 flex-1">
				{title && title !== url && (
					<strong
						className="block truncate text-[13px] font-semibold text-foreground"
						title={title}
					>
						{title}
					</strong>
				)}
				<small
					className="block text-[11px] leading-4 text-muted-foreground wrap-anywhere"
					title={url}
				>
					<InsecureMarkFor url={url} settings={settings} />
					{displayUrl(url, settings.simplifyUrls !== false)}
				</small>
			</span>
		</span>
	);
}
