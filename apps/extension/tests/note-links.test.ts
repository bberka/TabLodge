import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, test} from 'vite-plus/test';
import {NoteText} from '../src/app/note-text';
import {
	firstPassage,
	isPassageLink,
	notePieces,
	passageName,
	spokenNote,
} from '../src/shared/note-links';
import {appendQuote} from '../src/shared/quotes';

const page = 'https://en.wikipedia.org/wiki/Lisbon';

function twoQuotes() {
	const first = appendQuote(
		undefined,
		page,
		'the second-oldest European capital city (after Athens), predating other modern European capitals by centuries.',
	);
	assert.ok(first.ok);
	const second = appendQuote(
		first.notes,
		page,
		'It is also the centre of Portuguese diplomacy',
	);
	assert.ok(second.ok);
	return second.notes;
}

describe('isPassageLink', () => {
	test('finds text fragment links, including after other directives', () => {
		assert.ok(isPassageLink(`${page}#:~:text=Lisbon`));
		assert.ok(isPassageLink(`${page}#History:~:text=Lisbon`));
		assert.ok(isPassageLink(`${page}#:~:note=x&text=Lisbon`));
		assert.ok(isPassageLink('HTTP://example.com/#:~:text=a'));
	});

	test('leaves other addresses alone', () => {
		assert.ok(!isPassageLink(page));
		assert.ok(!isPassageLink(`${page}#History`));
		assert.ok(!isPassageLink(`${page}?q=:~:text=x`));
		assert.ok(!isPassageLink(`${page}#:~:text=`));
		assert.ok(!isPassageLink('javascript:alert(1)//#:~:text=a'));
		assert.ok(!isPassageLink('ftp://example.com/#:~:text=a'));
	});
});

describe('passageName', () => {
	test('names the link with the first words of the passage', () => {
		assert.equal(
			passageName(`${page}#:~:text=It%20is%20also%20the%20centre`),
			'Go to passage: It is also the centre',
		);
	});

	test('cuts a long or start,end passage and drops its prefix and suffix', () => {
		assert.equal(
			passageName(
				`${page}#:~:text=the%20second%2Doldest%20European%20capital%20city%20after%20Athens`,
			),
			'Go to passage: the second-oldest European capital city after…',
		);
		assert.equal(
			passageName(`${page}#:~:text=capital%2C-,the%20city,of%20Portugal,-and`),
			'Go to passage: the city…',
		);
	});

	test('survives a stray percent sign in a hand-edited note', () => {
		assert.equal(
			passageName(`${page}#:~:text=100%%20sure`),
			'Go to passage: 100%%20sure',
		);
	});
});

describe('notePieces', () => {
	test('a note with two saved quotes keeps both quotes and turns each link into a passage', () => {
		const notes = twoQuotes();
		const pieces = notePieces(notes);
		assert.deepEqual(
			pieces.map((piece) => piece.kind),
			['text', 'passage', 'text', 'passage'],
		);
		assert.equal(
			pieces[1].kind === 'passage' && pieces[1].name,
			'Go to passage: the second-oldest European capital…',
		);
		assert.equal(
			pieces
				.map((piece) => (piece.kind === 'text' ? piece.text : piece.url))
				.join(''),
			notes,
		);
	});

	test('firstPassage finds the first passage link, or none', () => {
		assert.equal(
			firstPassage(twoQuotes())?.name,
			'Go to passage: the second-oldest European capital…',
		);
		assert.equal(firstPassage(`See ${page}`), undefined);
	});

	test('plain addresses stay in the text', () => {
		const notes = 'Read https://example.com/a#intro and https://example.com/b';
		assert.deepEqual(notePieces(notes), [{kind: 'text', text: notes}]);
	});

	test('spokenNote reads the label instead of the encoded address', () => {
		assert.equal(
			spokenNote(`Keep\n${page}#:~:text=Lisbon%20is`),
			'Keep\nGo to passage: Lisbon is',
		);
	});
});

describe('NoteText', () => {
	const render = (notes: string, className = 'line-clamp-2') =>
		renderToStaticMarkup(
			createElement(NoteText, {notes, className, onOpen() {}}),
		);

	test('draws passage links as labelled links inside the clamped note', () => {
		const html = render(twoQuotes());
		assert.match(html, /^<p class="line-clamp-2">/);
		assert.equal(html.match(/<a /g)?.length, 2);
		assert.match(html, /aria-label="Go to passage: It is also the centre of…"/);
		assert.match(html, />Go to passage<\/a>/);
		assert.doesNotMatch(html, />https:/);
		assert.equal(html.match(/<p /g)?.length, 1);
	});

	test('never renders note text as HTML', () => {
		const html = render('<b>bold</b> <img src=x onerror=alert(1)>');
		assert.doesNotMatch(html, /<b>|<img/);
		assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
	});
});
