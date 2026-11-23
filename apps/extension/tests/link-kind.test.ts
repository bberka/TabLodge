import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {linkKind, type LinkKind} from '../src/shared/link-kind';
import type {SiteSourceId} from '../src/shared/source-columns';
import {
	blueskyPostUrl,
	devtoArticleUrl,
	githubRepoUrl,
	goodreadsBookUrl,
	hackerNewsItemUrl,
	imdbTitleUrl,
	instagramPostUrl,
	letterboxdFilmUrl,
	lobstersStoryUrl,
	mediumPostUrl,
	redditPermalinkUrl,
	soundcloudItemUrl,
	spotifyItemUrl,
	stackOverflowQuestionUrl,
	substackPostUrl,
	xPostUrl,
	youtubeVideoUrl,
} from '../src/app/site-sources';

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

	test('knows the common video sites, and arXiv PDFs, by their paths', () => {
		assert.equal(linkKind('https://www.youtube.com/watch?v=abc'), 'video');
		assert.equal(linkKind('https://m.youtube.com/shorts/abc'), 'video');
		assert.equal(linkKind('https://youtu.be/abc'), 'video');
		assert.equal(linkKind('https://vimeo.com/12345'), 'video');
		assert.equal(linkKind('https://www.youtube.com/'), 'page');
		assert.equal(linkKind('https://www.youtube.com/@channel'), 'page');
		assert.equal(linkKind('https://vimeo.com/about'), 'page');
		assert.equal(linkKind('https://arxiv.org/pdf/1706.03762'), 'pdf');
		assert.equal(linkKind('https://arxiv.org/abs/1706.03762'), 'page');
	});

	test('leaves data, blob, and unreadable addresses alone', () => {
		assert.equal(linkKind('data:image/png;base64,AAAA'), 'page');
		assert.equal(linkKind('blob:https://example.com/1234.png'), 'page');
		assert.equal(linkKind('file:///home/me/photo.jpg'), 'page');
		assert.equal(linkKind('not a url.png'), 'page');
		assert.equal(linkKind(''), 'page');
	});

	test('reads each kind from the site and path', () => {
		const cases: Array<[string, LinkKind]> = [
			['https://www.imdb.com/title/tt0111161/', 'movie'],
			['https://letterboxd.com/someone/film/arrival-2016/', 'movie'],
			['https://www.themoviedb.org/tv/1399', 'show'],
			['https://trakt.tv/shows/severance', 'show'],
			['https://music.youtube.com/watch?v=abc', 'music'],
			[
				'https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy',
				'music',
			],
			['https://artist.bandcamp.com/album/first', 'music'],
			['https://example.com/song.mp3', 'music'],
			['https://www.instagram.com/reel/Cabc123/', 'video'],
			['https://i.imgur.com/abc123', 'image'],
			['https://github.com/bberka/TabLodge/issues/344', 'repo'],
			['https://codeberg.org/forgejo/forgejo', 'repo'],
			['https://someone.substack.com/p/a-post', 'read'],
			['https://medium.com/@writer/a-title-1a2b3c4d5e6f', 'read'],
			['https://docs.python.org/3/library/re.html', 'docs'],
			['https://developer.mozilla.org/en-US/docs/Web/API', 'docs'],
			['https://requests.readthedocs.io/en/latest/', 'docs'],
			['https://old.reddit.com/r/rust/comments/abc/title/', 'discussion'],
			['https://math.stackexchange.com/questions/123/why', 'discussion'],
			['https://www.amazon.co.uk/Some-Book/dp/0123456789', 'shop'],
			['https://www.etsy.com/listing/123456/a-mug', 'shop'],
			['https://www.allrecipes.com/recipe/12345/pancakes/', 'recipe'],
		];
		for (const [url, kind] of cases) {
			assert.equal(linkKind(url), kind, url);
		}
	});

	test('a site rule wins over a file ending, and site pages that are not items stay pages', () => {
		assert.equal(linkKind('https://github.com/a/b/blob/main/logo.png'), 'repo');
		assert.equal(linkKind('https://github.com/settings/profile'), 'page');
		assert.equal(linkKind('https://github.com/bberka'), 'page');
		assert.equal(linkKind('https://soundcloud.com/discover/sets'), 'page');
		assert.equal(linkKind('https://www.amazon.com/gp/help/customer'), 'page');
		assert.equal(
			linkKind('https://docs.google.com/document/d/abc/edit'),
			'page',
		);
		assert.equal(linkKind('https://www.reddit.com/r/rust/'), 'page');
		assert.equal(linkKind('https://www.imdb.com/chart/top/'), 'page');
	});

	test('every Sources site has a kind for the links it saves', () => {
		const saved: Record<SiteSourceId, [string | null, LinkKind]> = {
			youtube: [youtubeVideoUrl('https://youtu.be/dQw4w9WgXcQ'), 'video'],
			reddit: [
				redditPermalinkUrl('https://old.reddit.com/r/rust/comments/abc/title'),
				'discussion',
			],
			x: [xPostUrl('https://twitter.com/someone/status/123'), 'discussion'],
			instagram: [
				instagramPostUrl('https://www.instagram.com/p/Cabc123/'),
				'image',
			],
			github: [
				githubRepoUrl('https://github.com/bberka/TabLodge/pulls'),
				'repo',
			],
			hackernews: [
				hackerNewsItemUrl('https://news.ycombinator.com/item?id=1'),
				'discussion',
			],
			stackoverflow: [
				stackOverflowQuestionUrl('https://stackoverflow.com/q/123'),
				'discussion',
			],
			devto: [devtoArticleUrl('https://dev.to/someone/a-post-1abc'), 'read'],
			lobsters: [
				lobstersStoryUrl('https://lobste.rs/s/abc123/a_story'),
				'discussion',
			],
			bluesky: [
				blueskyPostUrl('https://bsky.app/profile/a.bsky.social/post/3abc'),
				'discussion',
			],
			soundcloud: [
				soundcloudItemUrl('https://soundcloud.com/artist/a-track'),
				'music',
			],
			spotify: [
				spotifyItemUrl('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'),
				'music',
			],
			letterboxd: [
				letterboxdFilmUrl('https://letterboxd.com/film/arrival-2016/'),
				'movie',
			],
			imdb: [imdbTitleUrl('https://m.imdb.com/title/tt0111161/'), 'movie'],
			goodreads: [
				goodreadsBookUrl('https://www.goodreads.com/book/show/5907.The_Hobbit'),
				'read',
			],
			medium: [
				mediumPostUrl('https://medium.com/@writer/a-title-1a2b3c4d5e6f'),
				'read',
			],
			substack: [
				substackPostUrl('https://someone.substack.com/p/a-post'),
				'read',
			],
		};
		for (const [site, [url, kind]] of Object.entries(saved)) {
			assert.ok(url, `${site} saves this address`);
			assert.equal(linkKind(url), kind, `${site}: ${url}`);
		}
	});
});
