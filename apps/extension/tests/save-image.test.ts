import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {imageSave} from '../src/shared/save-image';

const src = 'https://cdn.example/a/cat.png';
const none = new Set<string>();

describe('imageSave', () => {
	test('names the page the image came from', () => {
		assert.deepEqual(
			imageSave(
				{srcUrl: src, pageUrl: 'https://www.blog.example/post'},
				none,
				[],
			),
			{ok: true, url: src, title: 'Image from blog.example'},
		);
		assert.deepEqual(imageSave({srcUrl: src}, none, []), {
			ok: true,
			url: src,
			title: 'Image from cdn.example',
		});
	});

	test('refuses data, blob, and missing addresses', () => {
		for (const srcUrl of [
			'data:image/png;base64,AAAA',
			'blob:https://a.example/1',
			undefined,
		]) {
			assert.deepEqual(imageSave({srcUrl}, none, []), {
				ok: false,
				reason: 'unsupported',
			});
		}
	});

	test('skips an image already bookmarked or held in the trash', () => {
		assert.deepEqual(imageSave({srcUrl: src}, new Set([src]), []), {
			ok: false,
			reason: 'saved',
		});
		const deletedColumn = {
			kind: 'column',
			data: {bookmarks: [{url: 'https://other.example/'}, {url: src}]},
		};
		assert.deepEqual(imageSave({srcUrl: src}, none, [deletedColumn]), {
			ok: false,
			reason: 'trash',
		});
		assert.deepEqual(
			imageSave({srcUrl: src}, none, [
				{kind: 'bookmark', data: {bookmark: {url: src}}},
			]),
			{ok: false, reason: 'trash'},
		);
	});

	test('ignores malformed trash and other kinds of entries', () => {
		const trash = [
			null,
			{kind: 'bookmark'},
			{kind: 'column', data: {bookmarks: 'nope'}},
			{kind: 'tabs', data: {items: [{tab: {url: src}}]}},
			{kind: 'bookmark', data: {bookmark: {url: 42}}},
		];
		assert.equal(imageSave({srcUrl: src}, none, trash).ok, true);
	});
});
