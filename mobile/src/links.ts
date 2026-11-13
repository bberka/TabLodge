/*
How links and titles are cleaned and shown, following the extension settings that sync with the library. Pure, so
the rules are tested without the app.
*/
import type {Settings} from '../../src/app/types';
import {stripTrackingParameters} from '../../src/app/tracking-parameters';
import {displayUrl, showsInsecureMark} from '../../src/app/url-display';
import {hostOf} from './library';

export type LinkSettings = Pick<
	Settings,
	| 'cleanTitles'
	| 'removeTrackingParameters'
	| 'simplifyUrls'
	| 'urlDisplayMode'
	| 'markInsecureLinks'
	| 'markLocalLinks'
	| 'bookmarkDensity'
	| 'sessionSort'
	| 'showSessionFaviconPreviews'
	| 'expandSessionsByDefault'
>;

// The extension's own defaults, so a phone that has not synced yet behaves the same.
const DEFAULTS: LinkSettings = {
	cleanTitles: true,
	removeTrackingParameters: false,
	simplifyUrls: true,
	urlDisplayMode: 'full',
	markInsecureLinks: true,
	markLocalLinks: false,
	bookmarkDensity: 'comfortable',
	sessionSort: 'newest',
	showSessionFaviconPreviews: true,
	expandSessionsByDefault: false,
};

/**
The settings this app uses, with the extension's default for anything the library has not set.
*/
export function linkSettings(stored: Partial<Settings>): LinkSettings {
	const merged = {...DEFAULTS};
	for (const key of Object.keys(DEFAULTS) as Array<keyof LinkSettings>) {
		if (stored[key] !== undefined) {
			Object.assign(merged, {[key]: stored[key]});
		}
	}

	return merged;
}

const TITLE_JUNK = /^(?:\s*(?:\(\d{1,5}\+?\)|\[\d{1,5}\+?\]|[*•●✱]))+\s+/u;

/**
Drops a leading notification counter such as "(3) " from a page title.
*/
export function cleanPageTitle(title: string, clean: boolean): string {
	const text = title.trim();
	return clean ? text.replace(TITLE_JUNK, '').trim() || text : text;
}

/**
The address to hand to the browser: without tracking parameters when that setting is on.
*/
export function linkToOpen(url: string, settings: LinkSettings): string {
	return settings.removeTrackingParameters ? stripTrackingParameters(url) : url;
}

/**
The two lines of a bookmark row. `address` mode shows the web address as the main line and has no second one.
*/
export function rowText(
	bookmark: {title: string; url: string},
	settings: LinkSettings,
): {main: string; sub?: string; insecure: boolean} {
	const address = displayUrl(bookmark.url, settings.simplifyUrls);
	const insecure = showsInsecureMark(bookmark.url, settings);
	switch (settings.urlDisplayMode) {
		case 'url-only': {
			return {main: address, insecure};
		}

		case 'none': {
			return {main: bookmark.title, insecure};
		}

		case 'domain': {
			return {main: bookmark.title, sub: hostOf(bookmark.url), insecure};
		}

		default: {
			return {main: bookmark.title, sub: address, insecure};
		}
	}
}
