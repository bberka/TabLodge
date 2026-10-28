import {memo, useState} from 'react';
import {displayUrl} from './url-display';
import {hostOf} from './web-url';
import {InsecureMarkFor} from './insecure-mark';
import type {Settings} from './types';

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
	chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);

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
	Tried when the extension's favicon service has no icon, for example the tab's own `favIconUrl`.
	*/
	fallbackSrc?: string;
};

/**
A site icon from the browser's favicon cache. It loads lazily (long lists do not fetch off-screen icons),
decodes off the main thread, and falls back to a letter tile when no icon can be loaded.
*/
export const Favicon = memo(
	({url, label, className = '', fallbackSrc}: FaviconProps) => {
		const devFallbackSrc = devFaviconFor(url);
		const [failed, setFailed] = useState('');
		const [triedFallback, setTriedFallback] = useState(false);
		if (failed === url) {
			return (
				<span
					aria-hidden="true"
					className={`grid shrink-0 place-items-center overflow-hidden bg-muted text-[10px] font-semibold text-muted-foreground ${className}`}
				>
					{(String(label || hostOf(url)).trim()[0] || '↗').toUpperCase()}
				</span>
			);
		}

		return (
			<img
				className={`shrink-0 object-contain ${className}`}
				src={
					devFallbackSrc ||
					(triedFallback && fallbackSrc ? fallbackSrc : faviconUrl(url))
				}
				alt=""
				data-favicon=""
				loading="lazy"
				decoding="async"
				onError={() => {
					if (fallbackSrc && !triedFallback) {
						setTriedFallback(true);
						return;
					}

					setFailed(url);
				}}
			/>
		);
	},
);

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
			<Favicon url={url} label={title} className="h-6 w-6 rounded" />
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
					className="block text-[11px] leading-4 text-muted-foreground [overflow-wrap:anywhere]"
					title={url}
				>
					<InsecureMarkFor url={url} settings={settings} />
					{displayUrl(url, settings.simplifyUrls !== false)}
				</small>
			</span>
		</span>
	);
}
