import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {stripTrackingParameters} from '../src/app/tracking-parameters';

test('removes common tracking parameters while keeping useful query values and fragments', () => {
	assert.equal(
		stripTrackingParameters(
			'https://example.com/article?utm_source=newsletter&q=hello%20world&FBCLID=abc&gclid=def&dclid=ghi#details',
		),
		'https://example.com/article?q=hello%20world#details',
	);
});

test('removes encoded tracking names and tracker-only queries', () => {
	assert.equal(
		stripTrackingParameters(
			'https://example.com/?%75tm_campaign=sale&msclkid=123',
		),
		'https://example.com/',
	);
});

test('keeps links unchanged when there are no known trackers or the URL is unsupported', () => {
	const ordinary = 'https://example.com/?source=app&ref=story#top';
	assert.equal(stripTrackingParameters(ordinary), ordinary);
	assert.equal(
		stripTrackingParameters('mailto:person@example.com?utm_source=app'),
		'mailto:person@example.com?utm_source=app',
	);
	assert.equal(stripTrackingParameters('not a URL'), 'not a URL');
});

test('removes X share parameters on status links only', () => {
	assert.equal(
		stripTrackingParameters(
			'https://x.com/AndradeBHMG/status/2115708925555216547?s=20&t=AbC123&lang=en',
		),
		'https://x.com/AndradeBHMG/status/2115708925555216547?lang=en',
	);
	assert.equal(
		stripTrackingParameters(
			'https://mobile.twitter.com/user/status/1?ref_src=twsrc%5Etfw&cxt=abc',
		),
		'https://mobile.twitter.com/user/status/1',
	);
	const search = 'https://x.com/search?q=cats&s=typed&t=1';
	assert.equal(stripTrackingParameters(search), search);
	const lookalike = 'https://notx.com/post/status/1?s=1&t=2';
	assert.equal(stripTrackingParameters(lookalike), lookalike);
});

test('removes share ids on the sites that add them and leaves other sites alone', () => {
	assert.equal(
		stripTrackingParameters('https://youtu.be/abc?si=xyz&t=42'),
		'https://youtu.be/abc?t=42',
	);
	assert.equal(
		stripTrackingParameters('https://open.spotify.com/track/1?si=xyz'),
		'https://open.spotify.com/track/1',
	);
	assert.equal(
		stripTrackingParameters('https://www.instagram.com/p/abc/?igsh=xyz'),
		'https://www.instagram.com/p/abc/',
	);
	const other = 'https://example.com/?si=1&s=2&t=3';
	assert.equal(stripTrackingParameters(other), other);
});
