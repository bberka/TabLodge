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

const ELSEWHERE: Record<Place, readonly FinderKind[]> = {
	sessions: ['bookmark', 'column', 'saved-tab', 'session', 'setting'],
	bookmarks: ['session', 'saved-tab', 'setting'],
};

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
