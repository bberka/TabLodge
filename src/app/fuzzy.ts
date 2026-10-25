// Pure fuzzy-search helpers shared by Settings search and the global finder: which items match a query, how well, and which characters to highlight.
// Matching is case-insensitive, treats hyphens, underscores and curly quotes like spaces/apostrophes, and every
// word of the query must match somewhere. Each word is scored by its best match type, best first:
//   the whole text ("sessions" in "Sessions")                           1000
//   a whole word ("tabs" in "Include tabs")                              900
//   the start of a word ("book" in "Bookmarks")                          800
//   inside a word ("side" in "inside")                                   700
//   the initials of a label's words ("sbd" in "Show bookmark dock")      600
//   letters in order inside one word ("bkmrk" in "bookmark")             500, less for a wide span
//   a typo ("bokmark", "sesions"): one edit for 4+ letters (two for 7+)  200 / 150
// A field lowers the score a little (label 0, help 15, options and keywords 30), never enough to cross into
// the next match type. A typo is only used when the word has no other kind of match anywhere in the texts,
// so typos can never outrank a real match. Fuzzy matches need at least three letters ("up" stays strict).

/**
Lower-cases and unifies punctuation without changing the text's length, so match offsets still fit the original.
*/
export function fold(value: string): string {
	return value
		.toLocaleLowerCase()
		.replaceAll(/[‘’]/g, "'")
		.replaceAll(/[-_–—]/g, ' ');
}

const isWordChar = (char: string | undefined) =>
	char !== undefined && /[\p{Letter}\p{Number}]/u.test(char);

type Range = [start: number, end: number];
type Hit = {score: number; ranges: Range[]; typo: boolean};

const FULL = 1000;
const WORD = 900;
const PREFIX = 800;
const INSIDE = 700;
const INITIALS = 600;
const SUBSEQUENCE = 500;
const TYPO_ONE = 200;
const TYPO_TWO = 150;
const ORDER_BONUS = 10;
const ADJACENT_BONUS = 10;
const FULL_QUERY_BONUS = 40;

/**
How much a field lowers a match: the label (first text) none, the help (second text) a little, others more.
*/
const fieldPenalty = (index: number) =>
	index === 0 ? 0 : index === 1 ? 15 : 30;

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
Literal occurrences of `term` (it may contain punctuation such as an apostrophe): the whole text, a whole
word, the start of a word, or inside a word (three letters or more).
*/
function literalHits(haystack: string, term: string): Hit[] {
	const hits: Hit[] = [];
	for (
		let at = haystack.indexOf(term);
		at !== -1;
		at = haystack.indexOf(term, at + 1)
	) {
		const end = at + term.length;
		let score: number;
		if (isWordChar(haystack[at - 1])) {
			if (term.length < 3) {
				continue;
			}

			score = INSIDE;
		} else if (isWordChar(haystack[end])) {
			score = PREFIX;
		} else {
			score = haystack.trim() === term ? FULL : WORD;
		}

		hits.push({score, ranges: [[at, end]], typo: false});
	}

	return hits;
}

function abbreviate(
	word: {start: number; text: string},
	term: string,
): Hit | undefined {
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

	const width = ranges.at(-1)![1] - ranges[0][0];
	return {
		score: SUBSEQUENCE - Math.min(50, (width - term.length) * 8),
		ranges,
		typo: false,
	};
}

function fuzzyHits(
	haystack: string,
	term: string,
	allowInitials: boolean,
	allowTypos: boolean,
): Hit[] {
	if (term.length < 3 || /[^\p{Letter}\p{Number}]/u.test(term)) {
		return [];
	}

	const hits: Hit[] = [];
	const words = wordsOf(haystack);
	const maxEdits = term.length >= 7 ? 2 : 1;
	for (const word of words) {
		// A typo or missing letter, compared with the word's start (so "sesion" finds "sessions").
		if (allowTypos && term.length >= 4) {
			for (const size of [term.length, term.length - 1, term.length + 1]) {
				const part = word.text.slice(0, size);
				const distance = editDistance(term, part, maxEdits);
				if (distance >= 1 && distance <= maxEdits) {
					hits.push({
						score: distance === 1 ? TYPO_ONE : TYPO_TWO,
						ranges: [[word.start, word.start + part.length]],
						typo: true,
					});
				}
			}
		}

		const abbreviation = abbreviate(word, term);
		if (abbreviation) {
			hits.push(abbreviation);
		}
	}

	// Initials of words ("sbd" for "Show bookmark dock"), in order; skipping words costs a little.
	if (allowInitials) {
		const ranges: Range[] = [];
		let index = 0;
		let skipped = 0;
		for (const char of term) {
			const from = index;
			while (index < words.length && !words[index].text.startsWith(char)) {
				index++;
			}

			if (index >= words.length) {
				ranges.length = 0;
				break;
			}

			skipped += ranges.length > 0 ? index - from : 0;
			ranges.push([words[index].start, words[index].start + 1]);
			index++;
		}

		if (ranges.length === term.length) {
			hits.push({
				score: INITIALS - Math.min(30, skipped * 5),
				ranges,
				typo: false,
			});
		}
	}

	return hits;
}

/**
Every way `term` matches the text; typos are dropped when the text has any other kind of match.
*/
function hitsIn(
	haystack: string,
	term: string,
	allowInitials: boolean,
	allowTypos = true,
): Hit[] {
	const literal = literalHits(haystack, term);
	// Every literal match outranks every fuzzy one (and typos are dropped whenever another kind of match
	// exists), so fuzzy matching only runs when the text has no literal match.
	if (literal.length > 0) {
		return literal;
	}

	// Initials and in-word letter matches need the term's letters in order somewhere in the text.
	if (!allowTypos && !hasLettersInOrder(haystack, term)) {
		return [];
	}

	const hits = fuzzyHits(haystack, term, allowInitials, allowTypos);
	return hits.some((hit) => !hit.typo) ? hits.filter((hit) => !hit.typo) : hits;
}

function hasLettersInOrder(haystack: string, term: string): boolean {
	let from = 0;
	for (const char of term) {
		from = haystack.indexOf(char, from) + 1;
		if (from === 0) {
			return false;
		}
	}

	return true;
}

/**
The best match type of a text: the score and the ranges of every hit of that type.
*/
function bestHit(
	haystack: string,
	term: string,
	allowInitials: boolean,
	allowTypos = true,
): Hit | undefined {
	const hits = hitsIn(haystack, term, allowInitials, allowTypos);
	if (hits.length === 0) {
		return undefined;
	}

	let {score} = hits[0];
	for (const hit of hits) {
		if (hit.score > score) {
			score = hit.score;
		}
	}

	const ranges: Range[] = [];
	let typo = false;
	for (const hit of hits) {
		if (hit.score !== score) {
			continue;
		}

		if (ranges.length === 0) {
			typo = hit.typo;
		}

		ranges.push(...hit.ranges);
	}

	return {score, ranges, typo};
}

type TermMatch = {score: number; field: number; start: number; end: number};

/**
The best place for a term among all texts: a typo only counts when no text has a better kind of match.
*/
function bestMatch(
	folded: readonly string[],
	term: string,
	allowTypos: boolean,
): TermMatch | undefined {
	let best: (TermMatch & {typo: boolean}) | undefined;
	for (const [field, haystack] of folded.entries()) {
		if (!haystack) {
			continue;
		}

		const hit = bestHit(haystack, term, field === 0, allowTypos);
		if (!hit) {
			continue;
		}

		const score = hit.score - fieldPenalty(field);
		if (
			!best ||
			(best.typo && !hit.typo) ||
			(best.typo === hit.typo && score > best.score)
		) {
			best = {
				score,
				field,
				start: hit.ranges[0][0],
				end: hit.ranges[0][1],
				typo: hit.typo,
			};
		}
	}

	return best;
}

/**
How well the query matches the texts: 0 for no match (or a missing word), otherwise higher is better.
The first text is the row's label, the second its help; later texts (options, keywords) count least. Matches
are ordered by kind (see the top of this file), then by field. Each word scores its best match and the scores
add up, with a bonus when the words appear in order or side by side. A blank query scores 1.
*/
export function scoreQuery(
	query: string,
	texts: ReadonlyArray<string | null | undefined>,
): number {
	return scoreFolded(
		searchTerms(query),
		texts.map((text) => fold(text ?? '')),
	);
}

/**
Like scoreQuery for a query already split into `searchTerms` and texts already `fold`ed, so a long list can be
scored without folding every text again on every keystroke. `typos: false` skips the (slower) typo matching;
scores of texts that match without typos are the same either way.
*/
export function scoreFolded(
	terms: readonly string[],
	folded: readonly string[],
	typos = true,
): number {
	if (terms.length === 0) {
		return 1;
	}

	const matches: TermMatch[] = [];
	let total = 0;
	for (const term of terms) {
		const match = bestMatch(folded, term, typos);
		if (!match) {
			return 0;
		}

		matches.push(match);
		total += match.score;
	}

	if (terms.length > 1) {
		const joined = terms.join(' ');
		if (
			folded.some(
				(text) => text.split(/\s+/).filter(Boolean).join(' ') === joined,
			)
		) {
			total += FULL_QUERY_BONUS;
		}

		const sameField = matches.every(
			(match) => match.field === matches[0].field,
		);
		const gap = (i: number) => matches[i].start - matches[i - 1].end;
		const inOrder = matches.every((_, i) => i === 0 || gap(i) >= 0);
		if (sameField && inOrder) {
			total += ORDER_BONUS;
			if (matches.every((_, i) => i === 0 || gap(i) <= 1)) {
				total += ADJACENT_BONUS;
			}
		}
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
Keeps the items that match and orders them best first (ties: shorter label first, then original order).
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
		.map((item, index) => {
			const texts = textOf(item);
			return {
				item,
				index,
				score: scoreQuery(query, texts),
				length: (texts[0] ?? '').length,
			};
		})
		.filter((entry) => entry.score > 0)
		.toSorted(
			(a, b) => b.score - a.score || a.length - b.length || a.index - b.index,
		)
		.map((entry) => entry.item);
}

/**
Orders all items best match first, keeping the ones that do not match (after the matches, in their original order).
*/
export function sortByQuery<T>(
	query: string,
	items: readonly T[],
	textOf: (item: T) => ReadonlyArray<string | null | undefined>,
): T[] {
	return items
		.map((item, index) => {
			const texts = textOf(item);
			return {
				item,
				index,
				score: scoreQuery(query, texts),
				length: (texts[0] ?? '').length,
			};
		})
		.toSorted(
			(a, b) =>
				b.score - a.score ||
				(a.score > 0 ? a.length - b.length : 0) ||
				a.index - b.index,
		)
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
