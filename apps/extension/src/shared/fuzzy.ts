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

const fieldPenalty = (index: number) =>
	index === 0 ? 0 : index === 1 ? 15 : 30;

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

function hitsIn(
	haystack: string,
	term: string,
	allowInitials: boolean,
	allowTypos = true,
): Hit[] {
	const literal = literalHits(haystack, term);
	if (literal.length > 0) {
		return literal;
	}

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

export function scoreQuery(
	query: string,
	texts: ReadonlyArray<string | null | undefined>,
): number {
	return scoreFolded(
		searchTerms(query),
		texts.map((text) => fold(text ?? '')),
	);
}

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

export function matchesQuery(
	query: string,
	texts: ReadonlyArray<string | null | undefined>,
): boolean {
	return scoreQuery(query, texts) > 0;
}

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
