import type {Settings} from '../../../extension/src/shared/types';
import {DEFAULT_SETTINGS} from '../../../extension/src/shared/library-normalize';
import {stripTrackingParameters} from '../../../extension/src/shared/tracking-parameters';
import {
	displayUrl,
	showsInsecureMark,
} from '../../../extension/src/shared/url-display';
import {hostOf} from './store-shape';

export type LinkSettings = Pick<
	Settings,
	| 'cleanTitles'
	| 'removeTrackingParameters'
	| 'simplifyUrls'
	| 'urlDisplayMode'
	| 'markInsecureLinks'
	| 'markLocalLinks'
	| 'bookmarkDensity'
	| 'showAllBookmarks'
	| 'bookmarkSort'
	| 'newBookmarkPosition'
	| 'sessionSort'
	| 'showSessionFaviconPreviews'
	| 'expandSessionsByDefault'
	| 'sessionNameStyle'
	| 'sessionNameTemplate'
	| 'sessionNameFallback'
	| 'autoArchiveDays'
	| 'trashRetentionDays'
	| 'askBeforeDeleting'
	| 'defaultShareMode'
	| 'toastDuration'
	| 'siteIcons'
>;

export const DEFAULTS: LinkSettings = {
	cleanTitles: true,
	removeTrackingParameters: false,
	simplifyUrls: true,
	urlDisplayMode: 'full',
	markInsecureLinks: true,
	markLocalLinks: false,
	bookmarkDensity: 'comfortable',
	showAllBookmarks: true,
	bookmarkSort: 'manual',
	newBookmarkPosition: DEFAULT_SETTINGS.newBookmarkPosition,
	sessionSort: 'newest',
	showSessionFaviconPreviews: true,
	expandSessionsByDefault: false,
	sessionNameStyle: DEFAULT_SETTINGS.sessionNameStyle,
	sessionNameTemplate: DEFAULT_SETTINGS.sessionNameTemplate,
	sessionNameFallback: DEFAULT_SETTINGS.sessionNameFallback,
	autoArchiveDays: DEFAULT_SETTINGS.autoArchiveDays,
	trashRetentionDays: DEFAULT_SETTINGS.trashRetentionDays,
	askBeforeDeleting: DEFAULT_SETTINGS.askBeforeDeleting,
	defaultShareMode: DEFAULT_SETTINGS.defaultShareMode,
	toastDuration: 'default',
	siteIcons: 'server',
};

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

export function cleanPageTitle(title: string, clean: boolean): string {
	const text = title.trim();
	return clean ? text.replace(TITLE_JUNK, '').trim() || text : text;
}

export function linkToOpen(url: string, settings: LinkSettings): string {
	return settings.removeTrackingParameters ? stripTrackingParameters(url) : url;
}

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
