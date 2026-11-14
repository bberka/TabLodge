// The column site matcher, used by the pages and the service worker. A column's
// `domains` entries are a host ("github.com", which also covers its subdomains) or a host with a path prefix
// ("github.com/bberka"). The longest path wins, then the longest host, then the earlier column.

import type {BookmarkColumn} from './types';

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
