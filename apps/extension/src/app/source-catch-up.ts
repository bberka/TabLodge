// Catching up on saves made elsewhere (#377): on a site's own saved page, the content script reads the items the
// page lists and the worker counts, and on the user's word adds, the ones TabLodge does not have yet. Both steps
// follow a click-save's rules, so an address in the library or in the trash bin never counts as missing.
import {isRecord} from '../shared/library-values';
import {normalizeUrl} from '../shared/library-normalize';
import {SITE_SOURCES, type SiteSource, type SiteSourceId} from './site-sources';
import type {SourceLink} from './source-reader';

/**
The most items one saved page may send. Old Reddit lists 25 to 100 a page; new Reddit keeps adding as the user
scrolls, so the limit is far above a long scroll. The page sends no more than this, and the toast says when it
cut the list.
*/
export const CATCH_UP_MAX_LINKS = 5000;
const TITLE_MAX = 500;

/**
Reads a saved page: the items it lists, in its order, or undefined when the page is not that site's saved page.
*/
export type SavedPageReader = (document: Document) => SourceLink[] | undefined;

/**
The items of a saved page that TabLodge lacks, at their stored addresses, in the page's order and without repeats.
`known` says whether an address is in the library or the trash bin. The list comes from a web page, so anything
that is not a link of this source is dropped.
*/
export function missingSourceLinks(
	source: SiteSource,
	links: unknown,
	known: (url: string) => boolean,
): SourceLink[] {
	if (!Array.isArray(links)) {
		return [];
	}

	const seen = new Set<string>();
	const missing: SourceLink[] = [];
	for (const link of links.slice(0, CATCH_UP_MAX_LINKS)) {
		if (!isRecord(link) || typeof link.url !== 'string') {
			continue;
		}

		const url = normalizeUrl(source.canonicalUrl(link.url));
		if (!url || seen.has(url)) {
			continue;
		}

		seen.add(url);
		if (!known(url)) {
			missing.push({
				url,
				title:
					typeof link.title === 'string' ? link.title.slice(0, TITLE_MAX) : '',
				...(typeof link.discussion === 'string' && {
					discussion: link.discussion,
				}),
			});
		}
	}

	return missing;
}

/**
Per device, outside the library and never synced: for each site, the missing addresses the user answered
Not now** to. The toast comes back only for an address that is not in that list.
*/
export const SOURCE_CATCH_UP_KEY = 'tablodge.sourceCatchUp';
const DISMISSED_MAX = 2000;

export type CatchUpState = Partial<Record<SiteSourceId, string[]>>;

export function parseCatchUpState(raw: unknown): CatchUpState {
	const saved = isRecord(raw) && isRecord(raw.dismissed) ? raw.dismissed : {};
	const state: CatchUpState = {};
	for (const {id} of SITE_SOURCES) {
		const value = saved[id];
		if (Array.isArray(value)) {
			state[id] = value
				.filter((url): url is string => typeof url === 'string')
				.slice(-DISMISSED_MAX);
		}
	}

	return state;
}

export const catchUpValue = (state: CatchUpState) => ({
	version: 1,
	dismissed: state,
});

/**
Whether the toast should ask: some missing address was never dismissed.
*/
export const catchUpAsks = (
	missing: readonly SourceLink[],
	dismissed: readonly string[] = [],
) => {
	const answered = new Set(dismissed);
	return missing.some((link) => !answered.has(link.url));
};

/**
The dismissed list after **Not now** on these missing addresses, newest last and capped.
*/
export function dismissMissing(
	dismissed: readonly string[] | undefined,
	missing: readonly SourceLink[],
) {
	const urls = new Set(missing.map((link) => link.url));
	return [...(dismissed ?? []).filter((url) => !urls.has(url)), ...urls].slice(
		-DISMISSED_MAX,
	);
}

export const catchUpCountText = (count: number, appName: string) =>
	count === 1
		? `1 saved item on this page isn't in ${appName}.`
		: `${count} saved items on this page aren't in ${appName}.`;
