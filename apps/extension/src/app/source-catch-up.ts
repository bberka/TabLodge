import {isRecord} from '../shared/library-values';
import {normalizeUrl} from '../shared/library-normalize';
import {SITE_SOURCES, type SiteSource, type SiteSourceId} from './site-sources';
import type {SourceLink} from './source-reader';

export const CATCH_UP_MAX_LINKS = 5000;
const TITLE_MAX = 500;

export type SavedPageReader = (document: Document) => SourceLink[] | undefined;

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

export const SOURCE_CATCH_UP_KEY = 'tablodge.sourceCatchUp';
const DISMISSED_MAX = CATCH_UP_MAX_LINKS;

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

export const catchUpAsks = (
	missing: readonly SourceLink[],
	dismissed: readonly string[] = [],
) => {
	const answered = new Set(dismissed);
	return missing.some((link) => !answered.has(link.url));
};

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
