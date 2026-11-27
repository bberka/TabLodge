import {
	memo,
	useCallback,
	useState,
	useSyncExternalStore,
	type RefCallback,
} from 'react';
import {FileText, Film, Image, type LucideIcon} from 'lucide-react';
import {isFirefox} from '../shared/browser';
import {
	isMediaKind,
	LINK_KIND_LABELS,
	linkKind,
	type MediaKind,
} from '../shared/link-kind';
import {displayUrl} from '../shared/url-display';
import type {Settings} from '../shared/types';
import {
	SITE_ICONS_KEY,
	normalizeSiteIcons,
	serverIconHost,
	siteIconFor,
	type SiteIcons,
} from '../shared/site-icons';
import {STATE_KEY} from '../shared/library-index';
import {SYNC_CONFIG_KEY} from '../shared/sync/client';
import {hostOf} from '../shared/web-url';
import {createMissingIconCache, type MissingIconCache} from './favicon-check';
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

export const faviconUrl = (url: string) =>
	isFirefox
		? ''
		: chrome.runtime.getURL(
				`_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`,
			);

const NO_ICONS: SiteIcons = {};
let siteIcons = NO_ICONS;
const iconListeners = new Set<() => void>();
let iconsWatched = false;
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

const noopSubscribe = () => () => {};

const useFirefoxIcon = (url: string) =>
	useSyncExternalStore(isFirefox ? subscribeToSiteIcons : noopSubscribe, () =>
		isFirefox ? siteIconFor(siteIcons, url) : undefined,
	);

const useServerIcons = () =>
	useSyncExternalStore(subscribeToSiteIcons, () => serverIcons);

const fetchIconBytes = async (src: string) => {
	const response = await fetch(src);
	return new Uint8Array(await response.arrayBuffer());
};

let missingIconCache: MissingIconCache | undefined;
function browserIconCache() {
	missingIconCache ??= createMissingIconCache({
		fetchBytes: fetchIconBytes,
		defaultUrl: faviconUrl('https://tablodge.invalid/'),
		onResolved(host, missing) {
			if (missing && Object.hasOwn(siteIcons, host)) {
				publishIcons();
			}
		},
	});
	return missingIconCache;
}

const askedHosts = new Set<string>();

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

function serverIconSnapshot(host: string | undefined): string | undefined {
	if (!serverIcons || !host) {
		return undefined;
	}

	return !isFirefox && browserIconCache().knownMissing(host) !== true
		? undefined
		: siteIcons[host];
}

export function useServerIcon(
	url: string,
	known: boolean,
): [icon: string | undefined, ref: RefCallback<Element> | undefined] {
	const host = known ? undefined : serverIconHost(url);
	const on = useServerIcons();
	const show = useSyncExternalStore(subscribeToSiteIcons, () =>
		serverIconSnapshot(host),
	);
	const knownMissing =
		on && host && !isFirefox
			? browserIconCache().knownMissing(host)
			: undefined;
	const needsCheck =
		on &&
		Boolean(host) &&
		(isFirefox
			? !show && !askedHosts.has(host!)
			: knownMissing === undefined ||
				(knownMissing && !show && !askedHosts.has(host!)));
	const observe = useCallback<RefCallback<Element>>(
		(element) => {
			if (!element || !host) {
				return;
			}

			return onceVisible(element, () => {
				void (async () => {
					if (
						(!isFirefox &&
							!(await browserIconCache().isMissing(host, faviconUrl(url)))) ||
						Object.hasOwn(siteIcons, host) ||
						askedHosts.has(host)
					) {
						return;
					}

					askedHosts.add(host);
					await send('GET_SERVER_ICON', {url});
				})();
			});
		},
		[host, url],
	);
	return [show, needsCheck ? observe : undefined];
}

type FaviconProps = {
	url: string;
	label?: string;
	className?: string;
	fallbackSrc?: string;
};

export const Favicon = memo(
	({url, label, className = '', fallbackSrc: tabIcon}: FaviconProps) => {
		const firefoxIcon = useFirefoxIcon(url);
		const devFallbackSrc = devFaviconFor(url);
		const [serverIcon, observe] = useServerIcon(
			url,
			Boolean(devFallbackSrc || tabIcon || firefoxIcon),
		);
		const fallbackSrc = tabIcon || firefoxIcon;
		const serviceSrc = faviconUrl(url);
		const [failed, setFailed] = useState('');
		const [triedFallback, setTriedFallback] = useState(false);
		const useFallback = Boolean(fallbackSrc) && (triedFallback || !serviceSrc);
		if (
			failed === url ||
			(!devFallbackSrc && !serviceSrc && !fallbackSrc && !serverIcon)
		) {
			return (
				<span
					ref={observe}
					aria-hidden="true"
					className={`grid shrink-0 place-items-center overflow-hidden bg-muted text-[0.625rem] font-semibold text-muted-foreground ${className}`}
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

const KIND_ICONS: Record<MediaKind, LucideIcon> = {
	image: Image,
	pdf: FileText,
	video: Film,
};

export function LinkKindBadge({url}: {url: string}) {
	const kind = linkKind(url);
	if (!isMediaKind(kind)) {
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

export function BookmarkIcon({
	url,
	label,
	className = '',
}: {
	url: string;
	label?: string;
	className?: string;
}) {
	return isMediaKind(linkKind(url)) ? (
		<span className={`relative shrink-0 ${className}`}>
			<Favicon
				url={url}
				label={label}
				className="size-full rounded-[inherit]"
			/>
			<LinkKindBadge url={url} />
		</span>
	) : (
		<Favicon url={url} label={label} className={className} />
	);
}

const NO_SETTINGS: Partial<Settings> = {};

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
						className="block truncate text-[0.8125rem] font-semibold text-foreground"
						title={title}
					>
						{title}
					</strong>
				)}
				<small
					className="block text-[0.6875rem] leading-[1.4545] text-muted-foreground wrap-anywhere"
					title={url}
				>
					<InsecureMarkFor url={url} settings={settings} />
					{displayUrl(url, settings.simplifyUrls !== false)}
				</small>
			</span>
		</span>
	);
}
