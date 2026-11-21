import assert from 'node:assert/strict';
import type {DragEvent} from 'react';
import {describe, test} from 'vite-plus/test';
import {
	acceptsDrop,
	ALL_BOOKMARKS_ID,
	dropColumnId,
	parsePastedLinks,
	previewBookmarkDrop,
	type DropIndicator,
} from '../src/app/bookmark-drag';
import {
	BOOKMARK_DRAG_TYPE,
	COLUMN_DRAG_TYPE,
} from '../src/app/interaction-actions';

const pasted = (data: Record<string, string>) =>
	({getData: (type: string) => data[type] ?? ''}) as unknown as DataTransfer;

describe('parsePastedLinks', () => {
	test('reads one web link per line, once each, and skips the rest', () => {
		const links = parsePastedLinks(
			pasted({
				'text/plain':
					'https://a.example/\nnot a link\nhttps://b.example/x\nhttps://a.example/\nftp://c.example',
			}),
		);
		assert.deepEqual(
			links.map((link) => link.url),
			['https://a.example/', 'https://b.example/x'],
		);
	});

	test('ignores comment lines of a URI list', () => {
		const links = parsePastedLinks(
			pasted({'text/uri-list': '# saved\nhttps://a.example/'}),
		);
		assert.deepEqual(
			links.map((link) => link.url),
			['https://a.example/'],
		);
	});

	test('takes at most 500 links', () => {
		const text = Array.from(
			{length: 600},
			(_, index) => `https://site${index}.example/`,
		).join('\n');
		assert.equal(parsePastedLinks(pasted({'text/plain': text})).length, 500);
	});

	test('reads nothing from nothing', () => {
		assert.deepEqual(parsePastedLinks(null), []);
	});
});

const dragEvent = (
	types: string[],
	card?: {id: string; top: number; height: number; columnId?: string},
	clientY = 0,
) => {
	const target = {
		closest: () =>
			card && {
				dataset: {bookmarkId: card.id, columnId: card.columnId},
				getBoundingClientRect: () => ({top: card.top, height: card.height}),
			},
	};
	return {
		dataTransfer: {types, dropEffect: 'none'},
		target,
		clientX: 10,
		clientY,
		currentTarget: {
			getBoundingClientRect: () => ({left: 0, width: 100}),
		},
		preventDefault() {},
	} as unknown as DragEvent<HTMLElement>;
};

describe('bookmark drops', () => {
	test('a column accepts bookmarks, and Unfiled does not accept columns', () => {
		assert.equal(acceptsDrop(dragEvent([BOOKMARK_DRAG_TYPE]), false), true);
		assert.equal(acceptsDrop(dragEvent([COLUMN_DRAG_TYPE]), false), false);
		assert.equal(acceptsDrop(dragEvent([COLUMN_DRAG_TYPE]), true), true);
		assert.equal(
			acceptsDrop(dragEvent(['application/x-unknown']), true),
			false,
		);
	});

	test('a drop on the top half of a card lands before it, the bottom half after', () => {
		let seen: DropIndicator | null = null;
		const card = {id: 'b1', top: 100, height: 40};
		previewBookmarkDrop(
			dragEvent([BOOKMARK_DRAG_TYPE], card, 110),
			'c1',
			(value) => {
				seen = value;
			},
			true,
		);
		assert.deepEqual(seen, {
			kind: 'bookmark',
			columnId: 'c1',
			targetBookmarkId: 'b1',
			position: 'before',
		});
		previewBookmarkDrop(
			dragEvent([BOOKMARK_DRAG_TYPE], card, 130),
			'c1',
			(value) => {
				seen = value;
			},
			true,
		);
		assert.equal((seen as DropIndicator | null)?.position, 'after');
	});

	test('a column drag lands before or after a column by the pointer side', () => {
		let seen: DropIndicator | null = null;
		previewBookmarkDrop(
			dragEvent([COLUMN_DRAG_TYPE]),
			'c1',
			(value) => {
				seen = value;
			},
			true,
		);
		assert.deepEqual(seen, {
			kind: 'column',
			columnId: 'c1',
			position: 'before',
		});
	});
});

describe('drops on the All item', () => {
	test('go to the column of the card they land on, and nowhere else', () => {
		assert.equal(dropColumnId(ALL_BOOKMARKS_ID, 'c2'), 'c2');
		assert.equal(dropColumnId(ALL_BOOKMARKS_ID, undefined), null);
		assert.equal(dropColumnId('c1', undefined), 'c1');
		assert.equal(dropColumnId('c1', 'c2'), 'c1');
	});

	test('offer no slot away from a card, so the browser refuses the drop', () => {
		let seen: DropIndicator | null | undefined;
		let prevented = false;
		const event = dragEvent([BOOKMARK_DRAG_TYPE]);
		event.preventDefault = () => {
			prevented = true;
		};

		previewBookmarkDrop(
			event,
			ALL_BOOKMARKS_ID,
			(value) => {
				seen = value;
			},
			false,
		);
		assert.equal(seen, null);
		assert.equal(prevented, false);
	});

	test('offer the slot next to a card in its own column', () => {
		let seen: DropIndicator | null = null;
		previewBookmarkDrop(
			dragEvent(
				[BOOKMARK_DRAG_TYPE],
				{id: 'b1', top: 100, height: 40, columnId: 'c2'},
				110,
			),
			ALL_BOOKMARKS_ID,
			(value) => {
				seen = value;
			},
			false,
		);
		assert.deepEqual(seen, {
			kind: 'bookmark',
			columnId: ALL_BOOKMARKS_ID,
			targetBookmarkId: 'b1',
			position: 'before',
		});
	});
});

describe('drops on a sorted column', () => {
	test('offer no slot next to a card', () => {
		let seen: DropIndicator | null = null;
		previewBookmarkDrop(
			dragEvent([BOOKMARK_DRAG_TYPE], {id: 'b1', top: 100, height: 40}, 110),
			'c1',
			(value) => {
				seen = value;
			},
			true,
			false,
		);
		assert.deepEqual(seen, {
			kind: 'bookmark',
			columnId: 'c1',
			targetBookmarkId: null,
			position: 'after',
		});
	});
});
