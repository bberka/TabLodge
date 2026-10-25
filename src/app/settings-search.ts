// Pure helpers for the Settings search box: which rows match a query, how well, and which characters to highlight.
// Matching is case-insensitive, treats hyphens, underscores and curly quotes like spaces/apostrophes, and every
// word of the query must match somewhere. A word matches, best first, as:
//   an exact word ("tabs" in "Include tabs")                         100
//   the start of a word ("book" in "Bookmarks")                        80
//   the initials of a label's words ("sbd" in "Show bookmark dock")    55
//   a typo or missing letter ("bokmark", "sesions")                    ~45
//   an abbreviation inside one word ("bkmrk" in "bookmark")            40
// Fuzzy matches need at least three letters, so short words stay strict ("up" does not match "backup").

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

type Range = [start: number, end: number];
type Hit = {score: number; ranges: Range[]};

const EXACT = 100;
const PREFIX = 80;
const INITIALS = 55;
const TYPO = 50;
const SUBSEQUENCE = 40;
/**
Weight of a match in the row's label (the first searched text) versus its help and other texts.
*/
const SECONDARY_WEIGHT = 0.75;

/**
Words of a query, folded; empty when the query is blank.
*/
export function searchTerms(query: string): string[] {
	return fold(query).split(/\s+/).filter(Boolean);
}

function wordsOf(haystack: string): Array<{start: number; text: string}> {
	const words: Array<{start: number; text: string}> = Array.from(
		haystack.matchAll(/[\p{Letter}\p{Number}]+/gu),
		(match) => ({start: match.index, text: match[0]}),
	);

	return words;
}

/**
Optimal-string-alignment edit distance (insert, delete, replace, swap neighbours), stopping early past `max`.
*/
function editDistance(a: string, b: string, max: number): number {
	if (Math.abs(a.length - b.length) > max) {
		return max + 1;
	}

	const rows: number[][] = [];
	for (let i = 0; i <= a.length; i++) {
		rows.push([i]);
	}

	for (let j = 1; j <= b.length; j++) {
		rows[0][j] = j;
	}

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let value = Math.min(
				rows[i - 1][j] + 1,
				rows[i][j - 1] + 1,
				rows[i - 1][j - 1] + cost,
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				value = Math.min(value, rows[i - 2][j - 2] + 1);
			}

			rows[i][j] = value;
		}
	}

	return rows[a.length][b.length];
}

/**
Exact-word and word-prefix occurrences of `term` (it may contain punctuation such as an apostrophe).
*/
function literalHits(haystack: string, term: string): Hit[] {
	const hits: Hit[] = [];
	for (
		let at = haystack.indexOf(term);
		at !== -1;
		at = haystack.indexOf(term, at + 1)
	) {
		if (isWordChar(haystack[at - 1])) {
			continue;
		}

		const end = at + term.length;
		hits.push({
			score: isWordChar(haystack[end]) ? PREFIX : EXACT,
			ranges: [[at, end]],
		});
	}

	return hits;
}

function abbreviate(
	word: {start: number; text: string},
	term: string,
): Range[] | undefined {
	if (!word.text.startsWith(term[0]) || term.length * 2 < word.text.length) {
		return undefined;
	}

	const ranges: Range[] = [[word.start, word.start + 1]];
	let from = 1;
	for (let i = 1; i < term.length; i++) {
		const at = word.text.indexOf(term[i], from);
		if (at === -1) {
			return undefined;
		}

		ranges.push([word.start + at, word.start + at + 1]);
		from = at + 1;
	}

	return ranges;
}

function fuzzyHit(
	haystack: string,
	term: string,
	allowInitials: boolean,
): Hit | undefined {
	if (term.length < 3 || /[^\p{Letter}\p{Number}]/u.test(term)) {
		return undefined;
	}

	let best: Hit | undefined;
	const consider = (hit: Hit) => {
		if (!best || hit.score > best.score) {
			best = hit;
		}
	};

	const words = wordsOf(haystack);
	const maxEdits = term.length >= 8 ? 2 : 1;
	for (const word of words) {
		// A typo or missing letter, compared with the word's start (so "sesion" finds "sessions").
		if (term.length >= 4) {
			for (const size of [term.length, term.length - 1, term.length + 1]) {
				const part = word.text.slice(0, size);
				const distance = editDistance(term, part, maxEdits);
				if (distance <= maxEdits) {
					consider({
						score: TYPO - distance * 5,
						ranges: [[word.start, word.start + part.length]],
					});
				}
			}
		}

		// An abbreviation inside one word: the same first letter, the rest in order ("bkmrk" in "bookmark").
		const abbreviation = abbreviate(word, term);
		if (abbreviation) {
			consider({score: SUBSEQUENCE, ranges: abbreviation});
		}
	}

	// Initials of consecutive words ("sbd" for "Show bookmark dock"), in order, skipping words is allowed.
	if (allowInitials) {
		const ranges: Range[] = [];
		let index = 0;
		for (const char of term) {
			while (index < words.length && !words[index].text.startsWith(char)) {
				index++;
			}

			if (index >= words.length) {
				ranges.length = 0;
				break;
			}

			ranges.push([words[index].start, words[index].start + 1]);
			index++;
		}

		if (ranges.length === term.length) {
			consider({score: INITIALS, ranges});
		}
	}

	return best;
}

function bestHit(
	haystack: string,
	term: string,
	allowInitials: boolean,
): Hit | undefined {
	const literal = literalHits(haystack, term);
	if (literal.length > 0) {
		return {
			score: Math.max(...literal.map((hit) => hit.score)),
			ranges: literal.flatMap((hit) => hit.ranges),
		};
	}

	return fuzzyHit(haystack, term, allowInitials);
}

/**
How well the query matches the texts: 0 for no match (or a missing word), otherwise higher is better.
The first text is the row's label and counts fully; later texts (help, options) count less. A blank query scores 1.
*/
export function scoreQuery(
	query: string,
	texts: ReadonlyArray<string | null | undefined>,
): number {
	const terms = searchTerms(query);
	if (terms.length === 0) {
		return 1;
	}

	const folded = texts.map((text) => fold(text ?? ''));
	let total = 0;
	for (const term of terms) {
		let best = 0;
		for (const [index, haystack] of folded.entries()) {
			if (!haystack) {
				continue;
			}

			const hit = bestHit(haystack, term, index === 0);
			if (hit) {
				best = Math.max(best, hit.score * (index === 0 ? 1 : SECONDARY_WEIGHT));
			}
		}

		if (best === 0) {
			return 0;
		}

		total += best;
	}

	return total;
}

/**
True when the query is blank, or every one of its words matches at least one of the texts.
*/
export function matchesQuery(
	query: string,
	texts: ReadonlyArray<string | null | undefined>,
): boolean {
	return scoreQuery(query, texts) > 0;
}

/**
Keeps the items that match and orders them best first (ties keep their original order).
*/
export function rankByQuery<T>(
	query: string,
	items: readonly T[],
	textOf: (item: T) => ReadonlyArray<string | null | undefined>,
): T[] {
	if (searchTerms(query).length === 0) {
		return [...items];
	}

	return items
		.map((item, index) => ({
			item,
			index,
			score: scoreQuery(query, textOf(item)),
		}))
		.filter((entry) => entry.score > 0)
		.toSorted((a, b) => b.score - a.score || a.index - b.index)
		.map((entry) => entry.item);
}

/**
True when the text matches at least one word of the query (used to list matching select options).
*/
export function matchesAnyTerm(query: string, text: string): boolean {
	const haystack = fold(text);
	return searchTerms(query).some((term) =>
		Boolean(bestHit(haystack, term, true)),
	);
}

export type HighlightSegment = {
	text: string;
	match: boolean;
};

/**
Splits a text into plain and matching parts for every word of the query; overlapping matches merge.
Fuzzy matches highlight just the characters that matched.
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

	const ranges: Range[] = [];
	for (const term of terms) {
		const hit = bestHit(haystack, term, true);
		if (hit) {
			ranges.push(...hit.ranges);
		}
	}

	if (ranges.length === 0) {
		return [{text, match: false}];
	}

	ranges.sort((a, b) => a[0] - b[0]);
	const merged: Range[] = [];
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
