// Pure logic for the global finder (command palette): builds a flat index of everything searchable, ranks it
// with the shared fuzzy scorer, groups the hits by type, and recognizes typed web addresses.
import {scoreQuery, searchTerms} from './fuzzy';
import type {Bookmark, BookmarkColumn, Folder, Session} from './types';

export type FinderKind =
	| 'url'
	| 'tab'
	| 'bookmark'
	| 'saved-tab'
	| 'session'
	| 'column'
	| 'folder'
	| 'command'
	| 'web';

export type FinderItem = {
	/**
	Unique within the index; also the React key.
	*/
	id: string;
	kind: FinderKind;
	title: string;
	/**
	Second line: a host, a session name, a short description.
	*/
	detail?: string;
	/**
	Web address to open (and to show a favicon for).
	*/
	url?: string;
	/**
	Texts the query is matched against; the first counts most.
	*/
	texts: ReadonlyArray<string | undefined>;
	/**
	What the item refers to: a session, column, folder, command or browser-tab id.
	*/
	ref?: string;
	windowId?: number;
};

export type FinderSection = {
	kind: FinderKind;
	label: string;
	items: FinderItem[];
};

export type OpenTabInfo = {
	id: number;
	windowId: number;
	title: string;
	url: string;
};

export type FinderCommand = {
	id: string;
	title: string;
	keywords?: string[];
};

export const SECTION_LABELS: Record<FinderKind, string> = {
	url: 'Go to address',
	tab: 'Switch to tab',
	bookmark: 'Bookmarks',
	'saved-tab': 'Saved tabs',
	session: 'Sessions',
	column: 'Bookmark columns',
	folder: 'Session folders',
	command: 'Commands',
	web: 'Web search',
};

/**
Fixed order of the groups; the group holding the best match goes first, ties follow this order.
*/
const KIND_ORDER: FinderKind[] = [
	'url',
	'tab',
	'bookmark',
	'saved-tab',
	'session',
	'column',
	'folder',
	'command',
	'web',
];

const SECTION_LIMIT: Partial<Record<FinderKind, number>> = {
	tab: 6,
	bookmark: 8,
	'saved-tab': 8,
	session: 5,
	column: 4,
	folder: 4,
	command: 6,
};

/**
How many open tabs and commands the finder lists before anything is typed.
*/
const EMPTY_LIMIT: Partial<Record<FinderKind, number>> = {
	tab: 5,
	command: 8,
};

const MAX_TEXT = 400;
const clip = (value: string | undefined) => (value ?? '').slice(0, MAX_TEXT);

export function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./i, '');
	} catch {
		return url;
	}
}

/**
The URL as text to match: the host and path without the scheme, so "https" never matches everything.
*/
function matchableUrl(url: string): string {
	return clip(url.replace(/^[a-z][\d+\-.a-z]*:\/\/(?:www\.)?/i, ''));
}

export type FinderSources = {
	groups: readonly Session[];
	folders: readonly Folder[];
	bookmarks: readonly Bookmark[];
	columns: readonly BookmarkColumn[];
	tabs: readonly OpenTabInfo[];
	commands: readonly FinderCommand[];
	bookmarksEnabled?: boolean;
	sessionsEnabled?: boolean;
};

const UNFILED = 'bookmark-unfiled';

/**
Everything the finder can find, in a flat list. Disabled systems (sessions, bookmarks) contribute nothing.
*/
export function buildFinderIndex(sources: FinderSources): FinderItem[] {
	const items: FinderItem[] = [];
	const columnName = new Map(
		sources.columns.map((column) => [column.id, column.name]),
	);
	columnName.set(UNFILED, 'Unfiled');
	for (const command of sources.commands) {
		items.push({
			id: `command:${command.id}`,
			kind: 'command',
			title: command.title,
			texts: [command.title, ...(command.keywords ?? [])],
			ref: command.id,
		});
	}

	for (const tab of sources.tabs) {
		items.push({
			id: `tab:${tab.id}`,
			kind: 'tab',
			title: tab.title || hostOf(tab.url),
			detail: hostOf(tab.url),
			url: tab.url,
			texts: [clip(tab.title), matchableUrl(tab.url)],
			ref: String(tab.id),
			windowId: tab.windowId,
		});
	}

	if (sources.bookmarksEnabled !== false) {
		for (const bookmark of sources.bookmarks) {
			const column = columnName.get(bookmark.columnId) ?? '';
			items.push({
				id: `bookmark:${bookmark.id}`,
				kind: 'bookmark',
				title: bookmark.title || hostOf(bookmark.url),
				detail: column ? `${hostOf(bookmark.url)} · ${column}` : undefined,
				url: bookmark.url,
				texts: [clip(bookmark.title), matchableUrl(bookmark.url), column],
				ref: bookmark.id,
			});
		}

		for (const column of sources.columns) {
			items.push({
				id: `column:${column.id}`,
				kind: 'column',
				title: column.name,
				texts: [column.name],
				ref: column.id,
			});
		}
	}

	if (sources.sessionsEnabled !== false) {
		for (const folder of sources.folders) {
			items.push({
				id: `folder:${folder.id}`,
				kind: 'folder',
				title: folder.name,
				texts: [folder.name],
				ref: folder.id,
			});
		}

		for (const group of sources.groups) {
			const count = group.tabs.length;
			items.push({
				id: `session:${group.id}`,
				kind: 'session',
				title: group.name,
				detail: `${count} ${count === 1 ? 'tab' : 'tabs'}${group.archived ? ' · Archived' : ''}`,
				texts: [group.name, clip(group.description), clip(group.notes)],
				ref: group.id,
			});
			for (const tab of group.tabs) {
				items.push({
					id: `saved-tab:${group.id}:${tab.id}`,
					kind: 'saved-tab',
					title: tab.title || hostOf(tab.url),
					detail: `${hostOf(tab.url)} · ${group.name}`,
					url: tab.url,
					texts: [
						clip(tab.title),
						matchableUrl(tab.url),
						group.name,
						clip(group.notes),
					],
					ref: group.id,
				});
			}
		}
	}

	return items;
}

/**
A typed web address as a full URL, or undefined when the text looks like a normal search. Accepts http(s)
URLs, "localhost[:port]", IPv4 addresses and domains with a letters-only top-level domain ("github.com/x").
*/
export function looksLikeUrl(input: string): string | undefined {
	const text = input.trim();
	if (!text || /\s/.test(text) || text.length > 2048) {
		return undefined;
	}

	const explicit = /^https?:\/\//i.test(text);
	const candidate = explicit ? text : `https://${text}`;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return undefined;
	}

	if (!['http:', 'https:'].includes(url.protocol)) {
		return undefined;
	}

	const host = url.hostname;
	const isLocalhost = host === 'localhost';
	const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
	const isDomain = /^(?:[\da-z](?:[\d\-a-z]*[\da-z])?\.)+[a-z]{2,}$/i.test(
		host,
	);
	if (!isLocalhost && !isIpv4 && !isDomain) {
		return undefined;
	}

	// "localhost" and "host:port" without a scheme are local development servers, which rarely have TLS.
	return !explicit && (isLocalhost || isIpv4) ? `http://${text}` : candidate;
}

/**
Ranks the index for a query and groups the hits by type. A typed address adds a "Go to" group first, and a
non-empty query always ends with a web-search item, so Enter always has something to do.
*/
export function searchFinder(
	query: string,
	index: readonly FinderItem[],
): FinderSection[] {
	const trimmed = query.trim();
	const terms = searchTerms(trimmed);
	const sections: FinderSection[] = [];
	const section = (kind: FinderKind, items: FinderItem[]) => {
		if (items.length > 0) {
			sections.push({kind, label: SECTION_LABELS[kind], items});
		}
	};

	if (terms.length === 0) {
		for (const kind of KIND_ORDER) {
			const limit = EMPTY_LIMIT[kind];
			if (limit) {
				section(
					kind,
					index.filter((item) => item.kind === kind).slice(0, limit),
				);
			}
		}

		return sections.toSorted(
			(a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
		);
	}

	const scored = new Map<
		FinderKind,
		Array<{item: FinderItem; score: number}>
	>();
	for (const [position, item] of index.entries()) {
		const score = scoreQuery(trimmed, item.texts);
		if (score <= 0) {
			continue;
		}

		const title = item.title.toLocaleLowerCase();
		const needle = trimmed.toLocaleLowerCase();
		// Whole-title and title-prefix matches beat the same words buried in a longer title or in the address.
		const bonus = title === needle ? 20 : title.startsWith(needle) ? 10 : 0;
		const list = scored.get(item.kind) ?? [];
		list.push({item, score: score + bonus - position / 1_000_000});
		scored.set(item.kind, list);
	}

	const ranked = KIND_ORDER.flatMap((kind) => {
		const hits = scored.get(kind);
		if (!hits) {
			return [];
		}

		hits.sort((a, b) => b.score - a.score);
		return [
			{
				kind,
				best: hits[0].score,
				items: hits.slice(0, SECTION_LIMIT[kind] ?? 6).map((hit) => hit.item),
			},
		];
	});
	ranked.sort(
		(a, b) =>
			b.best - a.best ||
			KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
	);

	const address = looksLikeUrl(trimmed);
	if (address) {
		section('url', [
			{
				id: `url:${address}`,
				kind: 'url',
				title: `Go to ${address.replace(/^https?:\/\//, '')}`,
				detail: address.startsWith('http:') ? 'Not encrypted' : undefined,
				url: address,
				texts: [],
			},
		]);
	}

	for (const entry of ranked) {
		section(entry.kind, entry.items);
	}

	section('web', [
		{
			id: 'web',
			kind: 'web',
			title: `Search the web for “${trimmed}”`,
			detail: 'With your default search engine',
			texts: [],
			ref: trimmed,
		},
	]);
	return sections;
}

/**
The result items of all groups in display order (the order the arrow keys walk).
*/
export const flattenSections = (sections: readonly FinderSection[]) =>
	sections.flatMap((section) => section.items);
