import {NOTES_MAX} from './library-normalize';
import type {Bookmark, Session} from './types';

const QUOTE_EXACT_WORDS = 8;
const QUOTE_EXACT_CHARS = 80;
const QUOTE_EDGE_WORDS = 4;
const QUOTE_EDGE_CHARS = 30;

export function encodeFragmentTerm(term: string) {
	return encodeURIComponent(term).replaceAll('-', '%2D');
}

export function pageAddress(url: string) {
	const hashAt = url.indexOf('#');
	if (hashAt === -1) {
		return url;
	}

	const directiveAt = url.indexOf(':~:', hashAt);
	if (directiveAt === -1) {
		return url;
	}

	const kept = url.slice(0, directiveAt);
	return kept.endsWith('#') ? kept.slice(0, -1) : kept;
}

function edges(line: string, from: 'start' | 'end', count = QUOTE_EDGE_WORDS) {
	const words = line.split(' ');
	if (words.length > 1) {
		return (
			from === 'start' ? words.slice(0, count) : words.slice(-count)
		).join(' ');
	}

	if (line.length <= QUOTE_EDGE_CHARS) {
		return line;
	}

	return from === 'start'
		? line.slice(0, QUOTE_EDGE_CHARS)
		: line.slice(-QUOTE_EDGE_CHARS);
}

function quoteLines(quote: string) {
	return quote
		.replaceAll('\u0000', '')
		.split(/\r\n|[\n\r\u2028\u2029]/)
		.map((line) => line.replaceAll(/\s+/g, ' ').trim())
		.filter(Boolean);
}

export function textFragmentLink(url: string, quote: string) {
	const lines = quoteLines(quote);
	const page = pageAddress(url);
	if (lines.length === 0) {
		return page;
	}

	const first = lines[0];
	const last = lines.at(-1)!;
	let directive: string;
	if (
		lines.length === 1 &&
		first.split(' ').length <= QUOTE_EXACT_WORDS &&
		first.length <= QUOTE_EXACT_CHARS
	) {
		directive = encodeFragmentTerm(first);
	} else {
		const count =
			lines.length === 1
				? Math.min(QUOTE_EDGE_WORDS, Math.floor(first.split(' ').length / 2))
				: QUOTE_EDGE_WORDS;
		const start = edges(first, 'start', count);
		const end = edges(last, 'end', count);
		directive = `${encodeFragmentTerm(start)},${encodeFragmentTerm(end)}`;
	}

	return `${page}${page.includes('#') ? '' : '#'}:~:text=${directive}`;
}

export function quoteEntry(url: string, quote: string) {
	const lines = quoteLines(quote);
	return [
		...lines.map((line) => `> ${line}`),
		textFragmentLink(url, quote),
	].join('\n');
}

export type QuoteNote = {ok: true; notes: string} | {ok: false; error: string};

export function appendQuote(
	notes: string | undefined,
	url: string,
	quote: string,
): QuoteNote {
	if (quoteLines(quote).length === 0) {
		return {ok: false, error: 'Select some text to save as a quote.'};
	}

	const entry = quoteEntry(url, quote);
	if (entry.length > NOTES_MAX) {
		return {
			ok: false,
			error: `This quote is too long to save. A note holds up to ${NOTES_MAX.toLocaleString('en-US')} characters.`,
		};
	}

	const before = (notes ?? '').trimEnd();
	const next = before ? `${before}\n\n${entry}` : entry;
	if (next.length > NOTES_MAX) {
		return {
			ok: false,
			error: `The note for this page is full (${NOTES_MAX.toLocaleString('en-US')} characters). Shorten it to add this quote.`,
		};
	}

	return {ok: true, notes: next};
}

export type QuoteTarget =
	| {kind: 'bookmark'; bookmark: Bookmark}
	| {kind: 'tab'; group: Session; tabId: string}
	| {kind: 'new'; url: string};

export function quoteTarget(
	library: {bookmarks: readonly Bookmark[]; groups: readonly Session[]},
	pageUrl: string,
): QuoteTarget {
	const url = pageAddress(pageUrl);
	const bookmark = library.bookmarks.find(
		(entry) => pageAddress(entry.url) === url,
	);
	if (bookmark) {
		return {kind: 'bookmark', bookmark};
	}

	for (const group of library.groups) {
		const tab = group.tabs.find((entry) => pageAddress(entry.url) === url);
		if (tab) {
			return {kind: 'tab', group, tabId: tab.id};
		}
	}

	return {kind: 'new', url};
}
