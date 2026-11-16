import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	MAX_ICON_ADDRESS,
	MAX_SITE_ICONS,
	normalizeSiteIcons,
	rememberSiteIcon,
	siteIconFor,
} from '../src/shared/site-icons';

const REDDIT_ICON = 'data:image/png;base64,iVBORw0KGgo=';

test('an icon remembered from one reddit page serves any other reddit link', () => {
	const icons = rememberSiteIcon(
		{},
		'https://www.reddit.com/r/typescript/',
		REDDIT_ICON,
	);
	assert.equal(
		siteIconFor(icons, 'https://www.reddit.com/r/rust/'),
		REDDIT_ICON,
	);
	assert.equal(siteIconFor(icons, 'https://old.reddit.com/'), undefined);
	assert.equal(siteIconFor(icons, 'not a url'), undefined);
});

test('only small image data addresses of http(s) pages are remembered', () => {
	const none = {};
	assert.equal(rememberSiteIcon(none, 'https://a.example/', ''), none);
	assert.equal(rememberSiteIcon(none, 'https://a.example/', undefined), none);
	assert.equal(
		rememberSiteIcon(none, 'https://a.example/', 'https://a.example/icon.ico'),
		none,
	);
	assert.equal(
		rememberSiteIcon(
			none,
			'https://a.example/',
			`data:image/png;base64,${'A'.repeat(MAX_ICON_ADDRESS)}`,
		),
		none,
	);
	assert.equal(rememberSiteIcon(none, 'about:blank', REDDIT_ICON), none);
});

test('repeating the newest icon changes nothing, a new one replaces it', () => {
	const first = rememberSiteIcon({}, 'https://a.example/x', REDDIT_ICON);
	assert.equal(
		rememberSiteIcon(first, 'https://a.example/y', REDDIT_ICON),
		first,
	);
	const changed = rememberSiteIcon(
		first,
		'https://a.example/',
		'data:image/gif;base64,R0lGODlh',
	);
	assert.deepEqual(changed, {'a.example': 'data:image/gif;base64,R0lGODlh'});
});

test('the oldest host is dropped past the limit and a revisit keeps a host', () => {
	let icons = rememberSiteIcon({}, 'https://keep.example/', REDDIT_ICON);
	for (let index = 0; index < MAX_SITE_ICONS - 1; index += 1) {
		icons = rememberSiteIcon(icons, `https://h${index}.example/`, REDDIT_ICON);
	}

	icons = rememberSiteIcon(icons, 'https://keep.example/', REDDIT_ICON);
	icons = rememberSiteIcon(icons, 'https://new.example/', REDDIT_ICON);
	assert.equal(Object.keys(icons).length, MAX_SITE_ICONS);
	assert.ok(icons['keep.example']);
	assert.equal(icons['h0.example'], undefined);
});

test('stored icons are validated on read', () => {
	assert.deepEqual(normalizeSiteIcons(undefined), {});
	assert.deepEqual(normalizeSiteIcons(['x']), {});
	assert.deepEqual(
		normalizeSiteIcons({
			'a.example': REDDIT_ICON,
			'b.example': 'javascript:alert(1)',
			'c.example': 7,
		}),
		{'a.example': REDDIT_ICON},
	);
});
