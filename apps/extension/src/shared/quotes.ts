/*
Saving a quote: text the user selected on a page goes into the note of that page's bookmark (or of its saved tab),
followed by a text fragment link (`#:~:text=`) that scrolls to the passage and highlights it. Shared by the extension's
"Save quote" menu item and the Android share sheet, so both write the same note.
*/
import {NOTES_MAX} from './library-normalize';
import type {Bookmark, Session} from './types';

/**
Quotes longer than this many words, or than QUOTE_EXACT_CHARS, or spread over several lines, link as `start,end`:
a long exact match breaks on any change to the page, and an exact match cannot span two paragraphs.
*/
const QUOTE_EXACT_WORDS = 8;
const QUOTE_EXACT_CHARS = 80;
/**
How many words the start and the end of a `start,end` fragment take.
*/
const QUOTE_EDGE_WORDS = 4;
/**
A line with no spaces (Chinese, Japanese, a long token) is cut to this many characters at each end instead.
*/
const QUOTE_EDGE_CHARS = 30;

/**
One fragment term: percent-encoded, with `-`, `&` and `,` escaped as well, because they separate the parts of a text
directive. encodeURIComponent already escapes `&` and `,`.
*/
export function encodeFragmentTerm(term: string) {
	return encodeURIComponent(term).replaceAll('-', '%2D');
}

/**
The page's own address: a text fragment directive (`:~:` and what follows) is dropped, and so is a hash left empty by
that. Pages opened from a saved quote link report their address with it.
*/
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

function edges(line: string, from: 'start' | 'end') {
	const words = line.split(' ');
	if (words.length > QUOTE_EDGE_WORDS) {
		return (
			from === 'start'
				? words.slice(0, QUOTE_EDGE_WORDS)
				: words.slice(-QUOTE_EDGE_WORDS)
		).join(' ');
	}

	if (line.length <= QUOTE_EDGE_CHARS) {
		return line;
	}

	return from === 'start'
		? line.slice(0, QUOTE_EDGE_CHARS)
		: line.slice(-QUOTE_EDGE_CHARS);
}

/**
The quote's lines with their spacing collapsed, empty lines left out.
*/
function quoteLines(quote: string) {
	return quote
		.replaceAll('\u0000', '')
		.split(/\r\n|[\n\r\u2028\u2029]/)
		.map((line) => line.replaceAll(/\s+/g, ' ').trim())
		.filter(Boolean);
}

/**
The page address with a text fragment for the quote: the whole quote when it is short and on one line, otherwise its
first and last words as `start,end`.
*/
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
		const start = edges(first, 'start');
		let end = edges(last, 'end');
		// One line that is long but has few words would give the same start and end; cut it by characters instead.
		if (lines.length === 1 && start === end) {
			end = first.slice(-QUOTE_EDGE_CHARS);
		}

		directive = `${encodeFragmentTerm(start)},${encodeFragmentTerm(end)}`;
	}

	return `${page}${page.includes('#') ? '' : '#'}:~:text=${directive}`;
}

/**
One saved quote in a note: each line of the quote after `> `, then the link to the passage on a line of its own.
*/
export function quoteEntry(url: string, quote: string) {
	const lines = quoteLines(quote);
	return [
		...lines.map((line) => `> ${line}`),
		textFragmentLink(url, quote),
	].join('\n');
}

export type QuoteNote = {ok: true; notes: string} | {ok: false; error: string};

/**
The note with the quote added after what it already holds, separated by a blank line. Nothing is ever cut: a quote that
would take the note past NOTES_MAX is refused, and the note stays as it was.
*/
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

/**
Where a quote from this page goes: its bookmark, else a saved tab of it in a session, else a new bookmark. Addresses
are compared without a text fragment directive.
*/
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
