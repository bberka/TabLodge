/*
What the phone's copy of the library is: the `Store` check and the empty store, the links in shared text, and the
statistics of a library. Edits are in `board-edits.ts` and `session-edits.ts`.
*/
import type {Settings, Store} from '../../../extension/src/shared/types';
import {LAYOUT_VERSION} from '../../../extension/src/shared/library-index';

export const isStore = (value: unknown): value is Store =>
	typeof value === 'object' &&
	value !== null &&
	Array.isArray((value as Store).bookmarks) &&
	Array.isArray((value as Store).bookmarkColumns) &&
	Array.isArray((value as Store).groups) &&
	Array.isArray((value as Store).folders);

export function emptyStore(now: number): Store {
	return {
		schemaVersion: LAYOUT_VERSION,
		groups: [],
		folders: [],
		bookmarkColumns: [],
		bookmarks: [],
		// Portable preferences arrive from the server; this app reads none of them.
		settings: {} as Settings,
		updatedAt: now,
	};
}

/**
The first web address in a piece of shared text, or undefined when there is none. Share sheets often send
"Title https://example.com" rather than a bare link.
*/
export function extractUrl(text: string): string | undefined {
	for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
		const candidate = match[0].replace(/[!),.:;?\]]+$/, '');
		try {
			const url = new URL(candidate);
			if (url.protocol === 'http:' || url.protocol === 'https:') {
				return url.href;
			}
		} catch {
			// Try the next match.
		}
	}

	return undefined;
}

/**
Every web link in some text, in order and without repeats. Browsers share a list of tabs this way.
*/
export function extractUrls(text: string): string[] {
	const urls = new Set<string>();
	for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
		const url = extractUrl(match[0]);
		if (url) {
			urls.add(url);
		}
	}

	return [...urls];
}

export function hostOf(url: string): string {
	try {
		return new URL(url).host.replace(/^www\./, '');
	} catch {
		return url;
	}
}

export type LibraryStats = {
	sessions: number;
	/**
	Saved tabs, across every session.
	*/
	tabs: number;
	folders: number;
	bookmarks: number;
	columns: number;
	/**
	The sites that hold the most saved links (bookmarks and saved tabs), most first.
	*/
	topSites: Array<{host: string; count: number}>;
	largestSession?: {name: string; tabs: number};
	/**
	When the oldest session or bookmark was saved, if any has a date.
	*/
	since?: number;
};

const TOP_SITES = 5;

/**
What the library holds, for the Statistics sheet.
*/
export function libraryStats(store: Store): LibraryStats {
	const counts = new Map<string, number>();
	const count = (url: string) => {
		const host = hostOf(url);
		counts.set(host, (counts.get(host) ?? 0) + 1);
	};

	let tabs = 0;
	let largest: {name: string; tabs: number} | undefined;
	let since: number | undefined;
	const seen = (time: number | undefined) => {
		if (
			time !== undefined &&
			time > 0 &&
			(since === undefined || time < since)
		) {
			since = time;
		}
	};

	for (const session of store.groups) {
		tabs += session.tabs.length;
		for (const tab of session.tabs) {
			count(tab.url);
		}

		if (!largest || session.tabs.length > largest.tabs) {
			largest = {name: session.name, tabs: session.tabs.length};
		}

		seen(session.createdAt);
	}

	for (const bookmark of store.bookmarks) {
		count(bookmark.url);
		seen(bookmark.createdAt);
	}

	return {
		sessions: store.groups.length,
		tabs,
		folders: store.folders.length,
		bookmarks: store.bookmarks.length,
		columns: store.bookmarkColumns.length,
		topSites: [...counts]
			.map(([host, total]) => ({host, count: total}))
			.toSorted((a, b) => b.count - a.count || a.host.localeCompare(b.host))
			.slice(0, TOP_SITES),
		largestSession: largest,
		since,
	};
}

/**
Splits text shared from another app into its link and a title. Browsers share "Page title https://example.com",
so the words around the link become the title.
*/
export function splitShared(text: string): {url?: string; title: string} {
	const url = extractUrl(text);
	if (!url) {
		return {title: ''};
	}

	const match = /https?:\/\/[^\s"'<>]+/i.exec(text);
	const rest = match
		? `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`
		: text;
	return {url, title: rest.replaceAll(/\s+/g, ' ').trim()};
}
