// Pure helpers for the Settings search box: which rows match a query, and which parts of a text to highlight.
// Matching is case-insensitive, treats hyphens, underscores and curly quotes like spaces/apostrophes,
// and every word of the query must match the start of a word somewhere in the searched text ("book" finds
// "Bookmarks" but "mark" does not, which keeps results from filling up with accidental hits).

/**
Lower-cases and unifies punctuation without changing the text's length, so match offsets still fit the original.
*/
function fold(value: string): string {
	return value
		.toLocaleLowerCase()
		.replaceAll(/[‘’]/g, "'")
		.replaceAll(/[-_–—]/g, ' ');
}

const isWordChar = (char: string | undefined) =>
	char !== undefined && /[\p{Letter}\p{Number}]/u.test(char);

/**
Index of the next occurrence of `term` at the start of a word in `haystack`, or -1.
*/
function indexOfWordStart(haystack: string, term: string, from = 0): number {
	for (
		let at = haystack.indexOf(term, from);
		at !== -1;
		at = haystack.indexOf(term, at + 1)
	) {
		if (!isWordChar(haystack[at - 1])) {
			return at;
		}
	}

	return -1;
}

/**
Words of a query, folded; empty when the query is blank.
*/
export function searchTerms(query: string): string[] {
	return fold(query).split(/\s+/).filter(Boolean);
}

/**
True when the query is blank, or every one of its words occurs in at least one of the texts.
*/
export function matchesQuery(
	query: string,
	texts: ReadonlyArray<string | null | undefined>,
): boolean {
	const terms = searchTerms(query);
	if (terms.length === 0) {
		return true;
	}

	const haystack = fold(
		texts.filter((text): text is string => Boolean(text)).join('\n'),
	);
	return terms.every((term) => indexOfWordStart(haystack, term) !== -1);
}

/**
True when the text contains at least one word of the query (used to list matching select options).
*/
export function matchesAnyTerm(query: string, text: string): boolean {
	const terms = searchTerms(query);
	const haystack = fold(text);
	return terms.some((term) => indexOfWordStart(haystack, term) !== -1);
}

export type HighlightSegment = {
	text: string;
	match: boolean;
};

/**
Splits a text into plain and matching parts for every word of the query; overlapping matches merge.
*/
export function highlightSegments(
	text: string,
	query: string,
): HighlightSegment[] {
	const terms = searchTerms(query);
	const haystack = fold(text);
	if (terms.length === 0 || haystack.length !== text.length) {
		return [{text, match: false}];
	}

	const ranges: Array<[number, number]> = [];
	for (const term of terms) {
		for (
			let from = indexOfWordStart(haystack, term);
			from !== -1;
			from = indexOfWordStart(haystack, term, from + term.length)
		) {
			ranges.push([from, from + term.length]);
		}
	}

	if (ranges.length === 0) {
		return [{text, match: false}];
	}

	ranges.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [];
	for (const range of ranges) {
		const last = merged.at(-1);
		if (last && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
		} else {
			merged.push([...range]);
		}
	}

	const segments: HighlightSegment[] = [];
	let cursor = 0;
	for (const [start, end] of merged) {
		if (start > cursor) {
			segments.push({text: text.slice(cursor, start), match: false});
		}

		segments.push({text: text.slice(start, end), match: true});
		cursor = end;
	}

	if (cursor < text.length) {
		segments.push({text: text.slice(cursor), match: false});
	}

	return segments;
}
