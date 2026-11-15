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
	searchFinder,
} from '../../../extension/src/shared/global-search';
import type {Store} from '../../../extension/src/shared/types';

export type Place = 'sessions' | 'bookmarks';

/**
What each screen offers from the other places. Bookmarks does not list its own columns, which the screen's chips already show.
*/
const ELSEWHERE: Record<Place, readonly FinderKind[]> = {
	sessions: ['bookmark', 'column', 'saved-tab', 'session'],
	bookmarks: ['session', 'saved-tab'],
};

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
	});
	const kinds = ELSEWHERE[here];
	return searchFinder(query, index).filter((section) =>
		kinds.includes(section.kind),
	);
}

/**
Where a result that is not a link leads: a session on the Sessions screen, a column on Bookmarks.
*/
export type Jump =
	| {screen: 'sessions'; sessionId: string}
	| {screen: 'bookmarks'; columnId: string};

export function jumpFor(item: FinderItem): Jump | undefined {
	if (item.ref === undefined) {
		return undefined;
	}

	if (item.kind === 'session') {
		return {screen: 'sessions', sessionId: item.ref};
	}

	return item.kind === 'column'
		? {screen: 'bookmarks', columnId: item.ref}
		: undefined;
}
