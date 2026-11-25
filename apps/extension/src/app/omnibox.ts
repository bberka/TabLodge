import {highlightSegments} from '../shared/fuzzy';
import {escapeHtml} from '../shared/escape-html';
import {highlightWords} from '../shared/search-query';
import {
	buildFinderIndex,
	flattenSections,
	searchFinder,
	type FinderItem,
	type FinderKind,
	type FinderSources,
} from '../shared/global-search';

export const OMNIBOX_KEYWORD = 'tl';

export type OmniboxSources = Omit<FinderSources, 'commands'>;

export type OmniboxSuggestion = {
	content: string;
	description: string;
};

const LABELS: Partial<Record<FinderKind, string>> = {
	tab: 'Tab',
	bookmark: 'Bookmark',
	'saved-tab': 'Saved tab',
	session: 'Session',
};

const MAX_SUGGESTIONS = 8;
const MAX_PER_KIND = 4;

export const omniboxIndex = (sources: OmniboxSources): FinderItem[] =>
	buildFinderIndex({...sources, commands: []}).filter(
		(item) => LABELS[item.kind] !== undefined,
	);

function describe(item: FinderItem, query: string): string {
	const title = highlightSegments(item.title, query)
		.map((part) =>
			part.match
				? `<match>${escapeHtml(part.text)}</match>`
				: escapeHtml(part.text),
		)
		.join('');
	const detail = item.detail ? ` <dim>${escapeHtml(item.detail)}</dim>` : '';
	return `<dim>${LABELS[item.kind]}:</dim> ${title}${detail}`;
}

export function omniboxSuggestions(
	query: string,
	index: readonly FinderItem[],
): OmniboxSuggestion[] {
	const perKind = new Map<FinderKind, number>();
	const suggestions: OmniboxSuggestion[] = [];
	for (const item of flattenSections(searchFinder(query, index))) {
		const seen = perKind.get(item.kind) ?? 0;
		if (LABELS[item.kind] === undefined || seen >= MAX_PER_KIND) {
			continue;
		}

		perKind.set(item.kind, seen + 1);
		suggestions.push({
			content: item.id,
			description: describe(item, highlightWords(query)),
		});
		if (suggestions.length === MAX_SUGGESTIONS) {
			break;
		}
	}

	return suggestions;
}

export const findOmniboxItem = (
	content: string,
	index: readonly FinderItem[],
): FinderItem | undefined => index.find((item) => item.id === content);
