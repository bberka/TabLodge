export const PASSAGE_LABEL = 'Go to passage';

const EXCERPT_WORDS = 6;

const WEB_ADDRESS = /https?:\/\/\S+/giu;

export type NotePiece =
	{kind: 'text'; text: string} | {kind: 'passage'; url: string; name: string};

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

export function isPassageLink(url: string) {
	return /^https?:\/\//iu.test(url) && textDirective(url) !== undefined;
}

function decode(term: string) {
	try {
		return decodeURIComponent(term);
	} catch {
		return term;
	}
}

export function passageName(url: string) {
	const terms = (textDirective(url) ?? '').split(',');
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

export function firstPassage(notes: string) {
	for (const piece of notePieces(notes)) {
		if (piece.kind === 'passage') {
			return piece;
		}
	}

	return undefined;
}

export function spokenNote(notes: string) {
	return notePieces(notes)
		.map((piece) => (piece.kind === 'text' ? piece.text : piece.name))
		.join('');
}
