// Address bar search ("tl <query>"): turns the finder's ranking (global-search.ts) into omnibox suggestions
// and maps an entered suggestion back to the item it stands for. Pure, so the service worker only has to
// gather the data and open the result.
import {escapeHtml} from './escape-html';
import {highlightSegments} from './fuzzy';
import {
	buildFinderIndex,
	flattenSections,
	searchFinder,
	type FinderItem,
	type FinderKind,
	type FinderSources,
} from './global-search';

/**
The address bar keyword. It is also the `omnibox.keyword` in shell/manifest.json.
*/
export const OMNIBOX_KEYWORD = 'tl';

export type OmniboxSources = Omit<FinderSources, 'commands'>;

export type OmniboxSuggestion = {
	/**
	The finder item id, which comes back in `onInputEntered` when the suggestion is chosen.
	*/
	content: string;
	/**
	XML in the omnibox dialect (`<match>`, `<dim>`).
	*/
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

/**
Everything the address bar can find. It has no commands, columns or folders to open.
*/
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

/**
The best matches for the typed text, in the finder's order but with at most a few of each kind so bookmarks
cannot push sessions off the list. An empty query lists the recent sessions and open tabs.
*/
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
		suggestions.push({content: item.id, description: describe(item, query)});
		if (suggestions.length === MAX_SUGGESTIONS) {
			break;
		}
	}

	return suggestions;
}

/**
The item a chosen suggestion stands for. Text that is not a suggestion's content (Enter on what was typed)
gives undefined.
*/
export const findOmniboxItem = (
	content: string,
	index: readonly FinderItem[],
): FinderItem | undefined => index.find((item) => item.id === content);
