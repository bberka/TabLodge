// Pure logic for the global finder (command palette): builds a flat index of everything searchable, ranks it
// with the shared fuzzy scorer, groups the hits by type, and recognizes typed web addresses.
import {fold, scoreFolded, searchTerms} from './fuzzy';
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
	`texts`, folded for matching (filled in by the index builder, once, instead of on every keystroke).
	*/
	folded?: readonly string[];
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

/**
Most items per group that the (slow) typo pass looks at, so a huge library cannot stall a keystroke.
*/
const TYPO_SCAN_LIMIT = 1500;

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
		items.push(
			prepared({
				id: `command:${command.id}`,
				kind: 'command',
				title: command.title,
				texts: [command.title, ...(command.keywords ?? [])],
				ref: command.id,
			}),
		);
	}

	for (const tab of sources.tabs) {
		items.push(
			prepared({
				id: `tab:${tab.id}`,
				kind: 'tab',
				title: tab.title || hostOf(tab.url),
				detail: hostOf(tab.url),
				url: tab.url,
				texts: [clip(tab.title), matchableUrl(tab.url)],
				ref: String(tab.id),
				windowId: tab.windowId,
			}),
		);
	}

	if (sources.bookmarksEnabled !== false) {
		items.push(
			...cachedBookmarkItems(sources.bookmarks, sources.columns, columnName),
		);
		for (const column of sources.columns) {
			items.push(
				prepared({
					id: `column:${column.id}`,
					kind: 'column',
					title: column.name,
					texts: [column.name],
					ref: column.id,
				}),
			);
		}
	}

	if (sources.sessionsEnabled !== false) {
		for (const folder of sources.folders) {
			items.push(
				prepared({
					id: `folder:${folder.id}`,
					kind: 'folder',
					title: folder.name,
					texts: [folder.name],
					ref: folder.id,
				}),
			);
		}

		items.push(...cachedSessionItems(sources.groups));
	}

	return items;
}

const prepared = (item: FinderItem): FinderItem => {
	item.folded = item.texts.map((text) => fold(text ?? ''));
	return item;
};

// The bookmark and session items are by far the biggest part of the index and rarely change, so the last
// build is kept and reused (state reloads keep the arrays of unchanged data) instead of rebuilt on every open.
let bookmarkCache:
	| {
			bookmarks: readonly Bookmark[];
			columns: readonly BookmarkColumn[];
			items: FinderItem[];
	  }
	| undefined;
function cachedBookmarkItems(
	bookmarks: readonly Bookmark[],
	columns: readonly BookmarkColumn[],
	columnName: Map<string, string>,
): FinderItem[] {
	if (
		bookmarkCache?.bookmarks === bookmarks &&
		bookmarkCache.columns === columns
	) {
		return bookmarkCache.items;
	}

	const items = bookmarks.map((bookmark) => {
		const column = columnName.get(bookmark.columnId) ?? '';
		return prepared({
			id: `bookmark:${bookmark.id}`,
			kind: 'bookmark',
			title: bookmark.title || hostOf(bookmark.url),
			detail: column ? `${hostOf(bookmark.url)} · ${column}` : undefined,
			url: bookmark.url,
			texts: [clip(bookmark.title), matchableUrl(bookmark.url), column],
			ref: bookmark.id,
		});
	});
	bookmarkCache = {bookmarks, columns, items};
	return items;
}

let sessionCache: {groups: readonly Session[]; items: FinderItem[]} | undefined;
function cachedSessionItems(groups: readonly Session[]): FinderItem[] {
	if (sessionCache?.groups === groups) {
		return sessionCache.items;
	}

	const items: FinderItem[] = [];
	for (const group of groups) {
		const count = group.tabs.length;
		items.push(
			prepared({
				id: `session:${group.id}`,
				kind: 'session',
				title: group.name,
				detail: `${count} ${count === 1 ? 'tab' : 'tabs'}${group.archived ? ' · Archived' : ''}`,
				texts: [group.name, clip(group.description), clip(group.notes)],
				ref: group.id,
			}),
		);
		for (const tab of group.tabs) {
			items.push(
				prepared({
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
				}),
			);
		}
	}

	sessionCache = {groups, items};
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
		Array<{item: FinderItem; score: number; position: number}>
	>();
	const foldedOf = (item: FinderItem) =>
		item.folded ?? item.texts.map((text) => fold(text ?? ''));
	// Pass 1 skips typo matching, the slowest part, over the whole index. A typo match always ranks below every
	// other kind of match, so pass 2 only looks for them (and only among the items pass 1 rejected, up to a cap
	// on very large indexes) in groups whose list is not already full.
	const misses: Array<{item: FinderItem; position: number}> = [];
	for (const [position, item] of index.entries()) {
		const score = scoreFolded(terms, foldedOf(item), false);
		if (score <= 0) {
			misses.push({item, position});
			continue;
		}

		const list = scored.get(item.kind) ?? [];
		list.push({item, score, position});
		scored.set(item.kind, list);
	}

	const scannedWithTypos = new Map<FinderKind, number>();
	for (const {item, position} of misses) {
		const limit = SECTION_LIMIT[item.kind] ?? 6;
		const list = scored.get(item.kind);
		if ((list?.length ?? 0) >= limit) {
			continue;
		}

		const scanned = scannedWithTypos.get(item.kind) ?? 0;
		if (scanned >= TYPO_SCAN_LIMIT) {
			continue;
		}

		scannedWithTypos.set(item.kind, scanned + 1);
		const score = scoreFolded(terms, foldedOf(item), true);
		if (score <= 0) {
			continue;
		}

		const entry = list ?? [];
		entry.push({item, score, position});
		scored.set(item.kind, entry);
	}

	type Hit = {item: FinderItem; score: number; position: number};
	const better = (a: Hit, b: Hit) =>
		b.score - a.score ||
		a.item.title.length - b.item.title.length ||
		a.position - b.position;
	const ranked = KIND_ORDER.flatMap((kind) => {
		const hits = scored.get(kind);
		if (!hits) {
			return [];
		}

		// Only the best few are shown, so keep a short sorted list instead of sorting every hit.
		const limit = SECTION_LIMIT[kind] ?? 6;
		const top: Hit[] = [];
		for (const hit of hits) {
			if (top.length === limit && better(hit, top[limit - 1]) >= 0) {
				continue;
			}

			let at = top.length;
			while (at > 0 && better(hit, top[at - 1]) < 0) {
				at -= 1;
			}

			top.splice(at, 0, hit);
			if (top.length > limit) {
				top.pop();
			}
		}

		return [
			{
				kind,
				best: top[0].score,
				items: top.map((hit) => hit.item),
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
