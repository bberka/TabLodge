/*
The phone's two search boxes each look through one screen. When that finds nothing, or the person asks, the same
query also runs through the extension's ranked search over the other places, so a link saved in a session can be
found from Bookmarks and the other way round.
*/
import {
	buildFinderIndex,
	type FinderItem,
	type FinderKind,
	type FinderSection,
	type FinderSetting,
	searchFinder,
} from '../../../extension/src/shared/global-search';
import type {Store} from '../../../extension/src/shared/types';

export type Place = 'sessions' | 'bookmarks';

/**
What each screen offers from the other places. Bookmarks does not list its own columns, which the screen's chips already show.
*/
const ELSEWHERE: Record<Place, readonly FinderKind[]> = {
	sessions: ['bookmark', 'column', 'saved-tab', 'session', 'setting'],
	bookmarks: ['session', 'saved-tab', 'setting'],
};

/**
The Settings screen's sections as search results: found by their title, other names, and the settings they hold.
*/
export function settingsForSearch(
	sections: Record<
		string,
		{
			title: string;
			aliases: readonly string[];
			rows: ReadonlyArray<{label: string}>;
		}
	>,
): FinderSetting[] {
	return Object.entries(sections).map(([key, section]) => ({
		id: key,
		title: section.title,
		detail: 'Settings',
		keywords: [...section.aliases, ...section.rows.map((row) => row.label)],
	}));
}

export const PLACE_NAME: Record<Place, string> = {
	sessions: 'Sessions',
	bookmarks: 'Bookmarks',
};

/**
Ranked matches for a query outside the given screen, grouped by kind. An empty query matches nothing.
*/
export function searchElsewhere(
	store: Store,
	query: string,
	here: Place,
	settings: readonly FinderSetting[] = [],
): FinderSection[] {
	if (query.trim() === '') {
		return [];
	}

	const index = buildFinderIndex({
		groups: store.groups,
		folders: store.folders,
		bookmarks: store.bookmarks,
		columns: store.bookmarkColumns,
		tabs: [],
		commands: [],
		settings,
	});
	const kinds = ELSEWHERE[here];
	return searchFinder(query, index).filter((section) =>
		kinds.includes(section.kind),
	);
}

/**
Where a result that is not a link leads: a session on the Sessions screen, a column on Bookmarks, a section of
Settings (its search filled in with the section's name).
*/
export type Jump =
	| {screen: 'sessions'; sessionId: string}
	| {screen: 'bookmarks'; columnId: string}
	| {screen: 'settings'; query: string};

export function jumpFor(item: FinderItem): Jump | undefined {
	if (item.ref === undefined) {
		return undefined;
	}

	if (item.kind === 'session') {
		return {screen: 'sessions', sessionId: item.ref};
	}

	if (item.kind === 'setting') {
		return {screen: 'settings', query: item.title};
	}

	return item.kind === 'column'
		? {screen: 'bookmarks', columnId: item.ref}
		: undefined;
}
