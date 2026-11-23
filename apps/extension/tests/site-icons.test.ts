import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	MAX_ICON_ADDRESS,
	MAX_SITE_ICONS,
	MISSING_ICON_MS,
	createServerIcons,
	normalizeMissingIcons,
	normalizeSiteIcons,
	rememberServerAnswer,
	rememberSiteIcon,
	serverIconHost,
	siteIconFor,
	type MissingIcons,
	type ServerIconDeps,
	type SiteIcons,
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

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const SERVER = {url: 'https://sync.example.test', token: 'token'};

function serverIconsWith(
	answer: (host: string) => Response | Promise<Response>,
	overrides: Partial<ServerIconDeps> = {},
) {
	let stored: {icons: SiteIcons; missing: MissingIcons} = {
		icons: {},
		missing: {},
	};
	const asked: string[] = [];
	const clock = {now: 1_000_000};
	const client = createServerIcons({
		async fetch(input, init) {
			assert.equal(
				new Headers(init?.headers).get('Authorization'),
				'Bearer token',
			);
			const host = new URL(input as string).searchParams.get('host')!;
			asked.push(host);
			return answer(host);
		},
		async server() {
			return SERVER;
		},
		async load() {
			return stored;
		},
		async save(host, icon) {
			stored = rememberServerAnswer(stored, host, icon, clock.now);
		},
		async shrink() {
			return undefined;
		},
		now: () => clock.now,
		...overrides,
	});
	return {client, asked, clock, stored: () => stored};
}

const png = () =>
	new Response(PNG_BYTES, {headers: {'Content-Type': 'image/png'}});

test('the server is asked once per site and its icon is kept as a data address', async () => {
	const {client, asked, stored} = serverIconsWith(png);
	const [first, second] = await Promise.all([
		client.iconFor('https://imported.example/a'),
		client.iconFor('https://imported.example/b'),
	]);
	assert.equal(first, 'data:image/png;base64,iVBORw==');
	assert.equal(second, first);
	assert.equal(
		await client.iconFor('https://imported.example/c'),
		first,
		'answered from storage',
	);
	assert.deepEqual(asked, ['imported.example']);
	assert.equal(siteIconFor(stored().icons, 'https://imported.example/'), first);
});

test('a 404, also what an older server without the route answers, is remembered as none for a day', async () => {
	const {client, asked, clock, stored} = serverIconsWith(
		() => new Response('{"error":"no_icon"}', {status: 404}),
	);
	assert.equal(await client.iconFor('https://no-icon.example/'), undefined);
	assert.equal(await client.iconFor('https://no-icon.example/'), undefined);
	assert.deepEqual(asked, ['no-icon.example']);
	assert.deepEqual(stored().missing, {'no-icon.example': clock.now});
	clock.now += MISSING_ICON_MS;
	await client.iconFor('https://no-icon.example/');
	assert.deepEqual(asked, ['no-icon.example', 'no-icon.example']);
});

test('a failed request stores nothing and pauses asking, so an offline server is not flooded', async () => {
	let status = 503;
	const {client, asked, clock, stored} = serverIconsWith(() =>
		status === 200 ? png() : new Response('', {status}),
	);
	assert.equal(await client.iconFor('https://a.example/'), undefined);
	assert.equal(await client.iconFor('https://b.example/'), undefined);
	assert.deepEqual(asked, ['a.example'], 'paused after the failure');
	assert.deepEqual(stored(), {icons: {}, missing: {}});
	status = 200;
	clock.now += 5 * 60 * 1000;
	assert.ok(await client.iconFor('https://b.example/'));
});

test('a network error counts as a failure, not as none', async () => {
	const {client, stored} = serverIconsWith(() => {
		throw new TypeError('Failed to fetch');
	});
	assert.equal(await client.iconFor('https://a.example/'), undefined);
	assert.deepEqual(stored().missing, {});
});

test('nothing is asked without a server, or for a host the server would refuse', async () => {
	const none = serverIconsWith(png, {
		async server() {
			return undefined;
		},
	});
	assert.equal(await none.client.iconFor('https://a.example/'), undefined);
	assert.deepEqual(none.asked, []);

	const {client, asked} = serverIconsWith(png);
	const answers = await Promise.all(
		[
			'http://localhost:3000/',
			'https://a.example:8443/',
			'about:blank',
			'file:///home/x.html',
		].map(async (url) => client.iconFor(url)),
	);
	assert.deepEqual(answers, [undefined, undefined, undefined, undefined]);
	assert.deepEqual(asked, []);
	assert.equal(serverIconHost('https://WWW.Example.com/x'), 'www.example.com');
});

test('an icon too big to store is redrawn smaller, or remembered as none when it cannot be', async () => {
	const big = () =>
		new Response(new Uint8Array(MAX_ICON_ADDRESS), {
			headers: {'Content-Type': 'image/x-icon'},
		});
	const small = serverIconsWith(big, {
		async shrink() {
			return REDDIT_ICON;
		},
	});
	assert.equal(await small.client.iconFor('https://big.example/'), REDDIT_ICON);

	const {client, asked, stored} = serverIconsWith(big);
	assert.equal(await client.iconFor('https://big.example/'), undefined);
	assert.equal(await client.iconFor('https://big.example/'), undefined);
	assert.deepEqual(asked, ['big.example'], 'not asked again for a day');
	assert.deepEqual(stored().icons, {});
});

test('at most four icons are asked for at a time', async () => {
	let open = 0;
	let most = 0;
	const {client} = serverIconsWith(async () => {
		open += 1;
		most = Math.max(most, open);
		await new Promise((resolve) => {
			setTimeout(resolve, 5);
		});
		open -= 1;
		return png();
	});
	await Promise.all(
		Array.from({length: 12}, async (_, index) =>
			client.iconFor(`https://h${index}.example/`),
		),
	);
	assert.equal(most, 4);
});

test('server answers keep the newest hosts and a host with an icon is no longer missing', () => {
	let stored: {icons: SiteIcons; missing: MissingIcons} = {
		icons: {},
		missing: {},
	};
	for (let index = 0; index <= MAX_SITE_ICONS; index += 1) {
		stored = rememberServerAnswer(
			stored,
			`m${index}.example`,
			undefined,
			index,
		);
	}

	assert.equal(Object.keys(stored.missing).length, MAX_SITE_ICONS);
	assert.equal(stored.missing['m0.example'], undefined);
	stored = rememberServerAnswer(stored, 'm5.example', REDDIT_ICON, 1);
	assert.equal(stored.missing['m5.example'], undefined);
	assert.equal(stored.icons['m5.example'], REDDIT_ICON);
	assert.deepEqual(
		normalizeMissingIcons({'a.example': 5, 'b.example': 'soon', '': 1}),
		{'a.example': 5},
	);
});
