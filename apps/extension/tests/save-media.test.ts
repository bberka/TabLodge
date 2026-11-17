import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {mediaSave} from '../src/shared/save-media';

const src = 'https://cdn.example/a/cat.png';
const none = new Set<string>();

describe('mediaSave', () => {
	test('saves an image or a media file by its own address, named after the page', () => {
		assert.deepEqual(
			mediaSave(
				{
					mediaType: 'image',
					srcUrl: src,
					pageUrl: 'https://www.blog.example/post',
				},
				none,
				[],
			),
			{ok: true, url: src, title: 'Image from blog.example'},
		);
		assert.deepEqual(
			mediaSave(
				{
					mediaType: 'video',
					srcUrl: 'https://media.example/clip.mp4',
					pageUrl: 'https://news.example/story',
					pageTitle: 'A story',
				},
				none,
				[],
			),
			{
				ok: true,
				url: 'https://media.example/clip.mp4',
				title: 'Video from news.example',
			},
		);
		assert.deepEqual(
			mediaSave(
				{mediaType: 'audio', srcUrl: 'https://a.example/x.mp3'},
				none,
				[],
			),
			{ok: true, url: 'https://a.example/x.mp3', title: 'Audio from a.example'},
		);
	});

	test('a streamed video or sound saves the page with its title', () => {
		const page = 'https://www.youtube.com/watch?v=abc';
		for (const srcUrl of [
			'blob:https://www.youtube.com/1234',
			'data:video/mp4;base64,AAAA',
			undefined,
		]) {
			assert.deepEqual(
				mediaSave(
					{
						mediaType: 'video',
						srcUrl,
						pageUrl: page,
						pageTitle: ' A talk - YouTube ',
					},
					none,
					[],
				),
				{ok: true, url: page, title: 'A talk - YouTube'},
			);
		}

		assert.deepEqual(
			mediaSave(
				{
					mediaType: 'audio',
					srcUrl: 'blob:x',
					pageUrl: 'https://radio.example/live',
				},
				none,
				[],
			),
			{ok: true, url: 'https://radio.example/live', title: 'radio.example'},
		);
	});

	test('refuses an image without a web address and media on a page that is not a web page', () => {
		assert.deepEqual(
			mediaSave(
				{
					mediaType: 'image',
					srcUrl: 'data:image/png;base64,AAAA',
					pageUrl: 'https://a.example/',
				},
				none,
				[],
			),
			{ok: false, reason: 'unsupported'},
		);
		assert.deepEqual(
			mediaSave(
				{
					mediaType: 'video',
					srcUrl: 'blob:x',
					pageUrl: 'file:///home/me/v.html',
				},
				none,
				[],
			),
			{ok: false, reason: 'unsupported'},
		);
	});

	test('skips an address already bookmarked or held in the trash', () => {
		assert.deepEqual(mediaSave({srcUrl: src}, new Set([src]), []), {
			ok: false,
			reason: 'saved',
		});
		const deletedColumn = {
			kind: 'column',
			data: {bookmarks: [{url: 'https://other.example/'}, {url: src}]},
		};
		assert.deepEqual(mediaSave({srcUrl: src}, none, [deletedColumn]), {
			ok: false,
			reason: 'trash',
		});
		const page = 'https://www.youtube.com/watch?v=abc';
		assert.deepEqual(
			mediaSave({mediaType: 'video', srcUrl: 'blob:x', pageUrl: page}, none, [
				{kind: 'bookmark', data: {bookmark: {url: page}}},
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
		assert.equal(mediaSave({srcUrl: src}, none, trash).ok, true);
	});
});
