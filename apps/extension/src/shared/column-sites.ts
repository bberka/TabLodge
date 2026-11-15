// The column site matcher and the checks on a column's site entries, used by the pages, the service worker, and the
// Android app, with no browser APIs. A column's `domains` entries are a host ("github.com", which also covers its
// subdomains) or a host with a path prefix ("github.com/bberka"). The longest path wins, then the longest host, then
// the earlier column.

import {normalizeExcludedHost} from './excluded-sites';
import type {BookmarkColumn} from './types';

export const MAX_COLUMN_DOMAINS = 50;

/**
A column site entry: a bare host ("github.com"), or a host with a path prefix ("github.com/bberka"). Query and fragment
are dropped and a trailing slash is ignored. Null when the host is not usable.
*/
export function normalizeColumnSite(value: unknown): string | null {
	const host = normalizeExcludedHost(value);
	if (!host || typeof value !== 'string') {
		return null;
	}

	let path = '';
	try {
		const text = value.trim().replace(/^([a-z][\d+\-.a-z]*:\/\/)?\*\./i, '$1');
		path = new URL(
			/^[a-z][\d+\-.a-z]*:\/\//i.test(text) ? text : `https://${text}`,
		).pathname.replace(/\/+$/, '');
	} catch {
		return null;
	}

	return `${host}${path}`;
}

/**
A column's sites as distinct entries, or `{}` when none remain, so a column without sites stores no field.
*/
export function domainsField(value: unknown): {domains?: string[]} {
	const sites = new Set<string>();
	for (const entry of Array.isArray(value) ? value : []) {
		const site = normalizeColumnSite(entry);
		if (site) {
			sites.add(site);
		}
	}

	return sites.size > 0
		? {domains: [...sites].slice(0, MAX_COLUMN_DOMAINS)}
		: {};
}

export type ColumnSiteCheck = {site: string} | {error: string};

/**
Checks one typed site against a column's current list: its normalized entry, or the reason it cannot be added. A column
holds at most `MAX_COLUMN_DOMAINS` sites, the same limit the extension enforces when it saves.
*/
export function checkColumnSite(
	sites: readonly string[],
	text: string,
): ColumnSiteCheck {
	const site = normalizeColumnSite(text);
	if (!site) {
		return {
			error: 'Enter a website such as github.com, or github.com/bberka.',
		};
	}

	if (sites.includes(site)) {
		return {error: `${site} is already in this column.`};
	}

	if (sites.length >= MAX_COLUMN_DOMAINS) {
		return {
			error: `A column holds at most ${MAX_COLUMN_DOMAINS} websites.`,
		};
	}

	return {site};
}

export function columnForUrl(
	columns: readonly BookmarkColumn[],
	url: string,
): BookmarkColumn | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}

	const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
	let best: BookmarkColumn | undefined;
	let bestScore = -1;
	for (const column of columns) {
		for (const site of column.domains ?? []) {
			const slash = site.indexOf('/');
			const siteHost = slash === -1 ? site : site.slice(0, slash);
			const sitePath = slash === -1 ? '' : site.slice(slash);
			if (
				(host !== siteHost && !host.endsWith(`.${siteHost}`)) ||
				(sitePath &&
					parsed.pathname !== sitePath &&
					!parsed.pathname.startsWith(`${sitePath}/`))
			) {
				continue;
			}

			const score = sitePath.length * 1000 + siteHost.length;
			if (!(score > bestScore)) {
				continue;
			}

			best = column;
			bestScore = score;
		}
	}

	return best;
}
