/*
A saved quote keeps its passage link in the note as a full text fragment address (`…#:~:text=…`, see quotes.ts). Both
apps draw notes from notePieces, which turns each such link into a short "Go to passage" label. The stored note never
changes, so export, sync and copy still give the full address.
*/

export const PASSAGE_LABEL = 'Go to passage';

/**
How many words of the quote the label's accessible name repeats.
*/
const EXCERPT_WORDS = 6;

const WEB_ADDRESS = /https?:\/\/\S+/giu;

export type NotePiece =
	{kind: 'text'; text: string} | {kind: 'passage'; url: string; name: string};

/**
The `text=` directive of a text fragment link, still encoded, or undefined when the address has none.
*/
function textDirective(url: string) {
	const hashAt = url.indexOf('#');
	if (hashAt === -1) {
		return undefined;
	}

	const directiveAt = url.indexOf(':~:', hashAt);
	if (directiveAt === -1) {
		return undefined;
	}

	return url
		.slice(directiveAt + 3)
		.split('&')
		.find((part) => part.startsWith('text=') && part.length > 5)
		?.slice(5);
}

/**
True for a web address with a text fragment (`#:~:text=`), the link a saved quote ends with.
*/
export function isPassageLink(url: string) {
	return /^https?:\/\//iu.test(url) && textDirective(url) !== undefined;
}

function decode(term: string) {
	try {
		return decodeURIComponent(term);
	} catch {
		// A note edited by hand can hold a stray `%`.
		return term;
	}
}

/**
The accessible name of a passage link: the label and the first words of the passage it finds, such as
"Go to passage: Lisbon is one of the oldest…".
*/
export function passageName(url: string) {
	const terms = (textDirective(url) ?? '').split(',');
	// `prefix-,start,end,-suffix`: the prefix and suffix only narrow the match.
	if (terms.length > 1 && terms[0].endsWith('-')) {
		terms.shift();
	}

	if (terms.length > 1 && terms.at(-1)!.startsWith('-')) {
		terms.pop();
	}

	const words = decode(terms[0]).split(/\s+/u).filter(Boolean);
	if (words.length === 0) {
		return PASSAGE_LABEL;
	}

	const more = words.length > EXCERPT_WORDS || terms.length > 1;
	return `${PASSAGE_LABEL}: ${words.slice(0, EXCERPT_WORDS).join(' ')}${more ? '…' : ''}`;
}

/**
The note split into its text and its passage links, in order. Other web addresses stay in the text.
*/
export function notePieces(notes: string): NotePiece[] {
	const pieces: NotePiece[] = [];
	let textFrom = 0;
	for (const match of notes.matchAll(WEB_ADDRESS)) {
		const url = match[0];
		if (!isPassageLink(url)) {
			continue;
		}

		if (match.index > textFrom) {
			pieces.push({kind: 'text', text: notes.slice(textFrom, match.index)});
		}

		pieces.push({kind: 'passage', url, name: passageName(url)});
		textFrom = match.index + url.length;
	}

	if (textFrom < notes.length) {
		pieces.push({kind: 'text', text: notes.slice(textFrom)});
	}

	return pieces;
}

/**
The note's first passage link, for the rows that offer it as a screen reader action.
*/
export function firstPassage(notes: string) {
	for (const piece of notePieces(notes)) {
		if (piece.kind === 'passage') {
			return piece;
		}
	}

	return undefined;
}

/**
The note as a screen reader should hear it: each passage link read as its name instead of the encoded address.
*/
export function spokenNote(notes: string) {
	return notePieces(notes)
		.map((piece) => (piece.kind === 'text' ? piece.text : piece.name))
		.join('');
}
