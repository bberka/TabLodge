import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {NOTES_MAX} from '../src/shared/library-normalize';
import {
	appendQuote,
	encodeFragmentTerm,
	pageAddress,
	quoteTarget,
	textFragmentLink,
} from '../src/shared/quotes';
import type {Bookmark, Session} from '../src/shared/types';

const page = 'https://example.com/post';

describe('encodeFragmentTerm', () => {
	test('escapes the characters that separate a text directive', () => {
		assert.equal(encodeFragmentTerm('a-b'), 'a%2Db');
		assert.equal(encodeFragmentTerm('R&D'), 'R%26D');
		assert.equal(encodeFragmentTerm('one, two'), 'one%2C%20two');
	});

	test('percent-encodes spaces, quotes, hashes and non-ASCII text', () => {
		assert.equal(
			encodeFragmentTerm('“Café” #1 50% ü'),
			'%E2%80%9CCaf%C3%A9%E2%80%9D%20%231%2050%25%20%C3%BC',
		);
	});
});

describe('textFragmentLink', () => {
	test('a short quote is matched exactly', () => {
		assert.equal(
			textFragmentLink(page, 'Ship small, well-tested changes'),
			`${page}#:~:text=Ship%20small%2C%20well%2Dtested%20changes`,
		);
	});

	test('a long quote becomes its first and last four words as start,end', () => {
		const quote =
			'The quick brown fox jumps over the lazy dog while the farmer sleeps soundly';
		assert.equal(
			textFragmentLink(page, quote),
			`${page}#:~:text=The%20quick%20brown%20fox,the%20farmer%20sleeps%20soundly`,
		);
	});

	test('a quote over two paragraphs uses start,end even when short', () => {
		assert.equal(
			textFragmentLink(page, 'First paragraph ends.\n\nSecond one starts'),
			`${page}#:~:text=First%20paragraph%20ends.,Second%20one%20starts`,
		);
	});

	test('a long line without spaces is cut by characters', () => {
		const quote = 'あ'.repeat(50) + 'い'.repeat(50);
		const [, directive] = textFragmentLink(page, quote).split('#:~:text=', 2);
		const [start, end] = directive
			.split(',')
			.map((term) => decodeURIComponent(term));
		assert.equal(start, 'あ'.repeat(30));
		assert.equal(end, 'い'.repeat(30));
	});

	test('whitespace inside the quote collapses to single spaces', () => {
		assert.equal(
			textFragmentLink(page, '  split \t view  '),
			`${page}#:~:text=split%20view`,
		);
	});

	test('keeps a page hash and replaces an old directive', () => {
		assert.equal(
			textFragmentLink(`${page}#section`, 'word'),
			`${page}#section:~:text=word`,
		);
		assert.equal(
			textFragmentLink(`${page}#:~:text=old`, 'new'),
			`${page}#:~:text=new`,
		);
	});
});

describe('pageAddress', () => {
	test('drops a text fragment directive and the empty hash it leaves', () => {
		assert.equal(pageAddress(`${page}#:~:text=a,b`), page);
		assert.equal(pageAddress(`${page}#top:~:text=a`), `${page}#top`);
		assert.equal(pageAddress(`${page}#top`), `${page}#top`);
		assert.equal(pageAddress(`${page}?q=:~:`), `${page}?q=:~:`);
	});
});

describe('appendQuote', () => {
	test('the first quote becomes the note', () => {
		assert.deepEqual(appendQuote(undefined, page, 'Hello world'), {
			ok: true,
			notes: `> Hello world\n${page}#:~:text=Hello%20world`,
		});
	});

	test('a second quote follows the first after a blank line', () => {
		const first = appendQuote(undefined, page, 'One');
		assert.ok(first.ok);
		const second = appendQuote(first.notes, page, 'Line a\nLine b');
		assert.ok(second.ok);
		assert.equal(
			second.notes,
			`> One\n${page}#:~:text=One\n\n> Line a\n> Line b\n${page}#:~:text=Line%20a,Line%20b`,
		);
	});

	test('a note the user wrote stays in front of the quote', () => {
		const result = appendQuote('Read later\n\n', page, 'Hi');
		assert.ok(result.ok);
		assert.equal(result.notes, `Read later\n\n> Hi\n${page}#:~:text=Hi`);
	});

	test('a quote that would pass the cap is refused and nothing is cut', () => {
		const full = 'x'.repeat(NOTES_MAX - 20);
		const result = appendQuote(full, page, 'one more quote here');
		assert.equal(result.ok, false);
		assert.match(result.ok ? '' : result.error, /note for this page is full/);
	});

	test('a note that ends exactly at the cap is accepted', () => {
		const entry = `> Hi\n${page}#:~:text=Hi`;
		const before = 'x'.repeat(NOTES_MAX - entry.length - 2);
		const result = appendQuote(before, page, 'Hi');
		assert.ok(result.ok);
		assert.equal(result.notes.length, NOTES_MAX);
	});

	test('a quote longer than a whole note is refused', () => {
		const result = appendQuote(undefined, page, 'word '.repeat(NOTES_MAX));
		assert.equal(result.ok, false);
		assert.match(result.ok ? '' : result.error, /too long/);
	});

	test('an empty selection is refused', () => {
		assert.equal(appendQuote('', page, ' \n ').ok, false);
	});
});

describe('quoteTarget', () => {
	const bookmark = (id: string, url: string): Bookmark => ({
		id,
		url,
		title: id,
		columnId: 'c1',
		createdAt: 1,
		updatedAt: 1,
	});
	const session = (url: string) =>
		({
			id: 's1',
			name: 'S',
			tabs: [{id: 't1', url, title: 'T', notes: ''}],
		}) as unknown as Session;

	test('a bookmark of the page comes first, even opened from a quote link', () => {
		const target = quoteTarget(
			{bookmarks: [bookmark('b1', page)], groups: [session(page)]},
			`${page}#:~:text=Hi`,
		);
		assert.equal(target.kind === 'bookmark' && target.bookmark.id, 'b1');
	});

	test('a saved tab is used when no bookmark has the page', () => {
		const target = quoteTarget(
			{
				bookmarks: [bookmark('b1', 'https://other.test/')],
				groups: [session(page)],
			},
			page,
		);
		assert.equal(target.kind === 'tab' && target.tabId, 't1');
	});

	test('otherwise a new bookmark of the page address', () => {
		assert.deepEqual(
			quoteTarget({bookmarks: [], groups: []}, `${page}#:~:text=Hi`),
			{kind: 'new', url: page},
		);
	});
});
