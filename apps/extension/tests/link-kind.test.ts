import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {linkKind} from '../src/shared/link-kind';

describe('linkKind', () => {
	test('reads images, PDFs, and video files from the file extension', () => {
		assert.equal(linkKind('https://example.com/a/photo.jpg'), 'image');
		assert.equal(linkKind('https://example.com/photo.jpeg'), 'image');
		assert.equal(linkKind('https://example.com/i.webp'), 'image');
		assert.equal(linkKind('https://example.com/i.avif'), 'image');
		assert.equal(linkKind('https://example.com/i.gif'), 'image');
		assert.equal(linkKind('https://example.com/logo.svg'), 'image');
		assert.equal(linkKind('https://example.com/paper.pdf'), 'pdf');
		assert.equal(linkKind('https://example.com/clip.mp4'), 'video');
		assert.equal(linkKind('https://example.com/clip.webm'), 'video');
	});

	test('ignores case, the query, and the fragment', () => {
		assert.equal(linkKind('https://example.com/PHOTO.PNG'), 'image');
		assert.equal(linkKind('https://example.com/Report.PDF?download=1'), 'pdf');
		assert.equal(linkKind('https://example.com/a.png#zoom'), 'image');
		assert.equal(linkKind('https://example.com/view?file=photo.jpg'), 'page');
		assert.equal(linkKind('https://example.com/view#photo.jpg'), 'page');
	});

	test('treats folders and other files as pages', () => {
		assert.equal(linkKind('https://example.com/'), 'page');
		assert.equal(linkKind('https://example.com/docs.pdf/'), 'page');
		assert.equal(linkKind('https://example.com/index.html'), 'page');
		assert.equal(linkKind('https://example.com/.png'), 'page');
		assert.equal(linkKind('https://photos.png.example.com/'), 'page');
	});

	test('knows the common video sites by their video paths', () => {
		assert.equal(linkKind('https://www.youtube.com/watch?v=abc'), 'video');
		assert.equal(linkKind('https://m.youtube.com/shorts/abc'), 'video');
		assert.equal(linkKind('https://youtu.be/abc'), 'video');
		assert.equal(linkKind('https://vimeo.com/12345'), 'video');
		assert.equal(linkKind('https://www.youtube.com/'), 'page');
		assert.equal(linkKind('https://www.youtube.com/@channel'), 'page');
		assert.equal(linkKind('https://vimeo.com/about'), 'page');
	});

	test('leaves data, blob, and unreadable addresses alone', () => {
		assert.equal(linkKind('data:image/png;base64,AAAA'), 'page');
		assert.equal(linkKind('blob:https://example.com/1234.png'), 'page');
		assert.equal(linkKind('file:///home/me/photo.jpg'), 'page');
		assert.equal(linkKind('not a url.png'), 'page');
		assert.equal(linkKind(''), 'page');
	});
});
