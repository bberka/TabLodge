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
