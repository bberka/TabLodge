import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {parseImportFile} from '../src/shared/import-formats';
import {
	shareHtmlPage,
	shareMarkdown,
	sharePreview,
	type ShareGroup,
} from '../src/shared/share-formats';

const groups: ShareGroup[] = Array.from({length: 4}, (_group, groupIndex) => ({
	name: `Group ${groupIndex + 1}`,
	tabs: Array.from({length: 4}, (_tab, tabIndex) => ({
		title: `Link ${groupIndex + 1}.${tabIndex + 1}`,
		url: `https://example.com/${groupIndex + 1}/${tabIndex + 1}`,
	})),
}));

test('share preview is bounded to three groups and three links per group', () => {
	const preview = sharePreview(groups, 'html');

	assert.equal(preview.groups.length, 3);
	assert.deepEqual(
		preview.groups.map((group) => ({
			name: group.name,
			links: group.tabs.map((tab) => tab.title),
			moreLinks: group.moreLinks,
		})),
		[
			{
				name: 'Group 1',
				links: ['Link 1.1', 'Link 1.2', 'Link 1.3'],
				moreLinks: 1,
			},
			{
				name: 'Group 2',
				links: ['Link 2.1', 'Link 2.2', 'Link 2.3'],
				moreLinks: 1,
			},
			{
				name: 'Group 3',
				links: ['Link 3.1', 'Link 3.2', 'Link 3.3'],
				moreLinks: 1,
			},
		],
	);
	assert.equal(preview.format, 'html');
	assert.equal(preview.moreGroups, 1);
	assert.equal(preview.omittedLinks, 7);
});

test('share preview keeps smaller selections intact and reports no extra items', () => {
	const selected = groups.slice(0, 1).map((group) => ({
		...group,
		tabs: group.tabs.slice(0, 2),
	}));
	const preview = sharePreview(selected, 'html');

	assert.deepEqual(preview, {
		groups: [
			{
				name: 'Group 1',
				tabs: selected[0].tabs,
				moreLinks: 0,
			},
		],
		moreGroups: 0,
		omittedLinks: 0,
		format: 'html',
	});
});

test('share preview matches each selected output format', () => {
	const selected = [
		{
			name: 'Research',
			tabs: [{title: 'Browser APIs', url: 'https://example.com/browser'}],
		},
	];
	const html = sharePreview(selected, 'html');
	const markdown = sharePreview(selected, 'markdown');
	const links = sharePreview(selected, 'links');
	const rich = sharePreview(selected, 'rich');

	assert.equal(html.format, 'html');
	assert.equal(markdown.format, 'markdown');
	assert.ok('text' in markdown);
	assert.equal(
		markdown.text,
		'# Research\n\n- [Browser APIs](https://example.com/browser)',
	);
	assert.equal(links.format, 'links');
	assert.ok('text' in links);
	assert.equal(links.text, 'https://example.com/browser');
	assert.equal(rich.format, 'rich');
	assert.ok('text' in rich);
	assert.equal(
		rich.text,
		'Research\nBrowser APIs\nhttps://example.com/browser',
	);
});

test('single-group share HTML does not repeat the page title as a group heading', () => {
	const html = shareHtmlPage(
		'Research',
		[
			{
				name: 'Research',
				tabs: [{title: 'Research', url: 'https://example.com/'}],
			},
		],
		'TabLodge',
	);

	assert.match(html, /<h1>Research<\/h1>/);
	assert.doesNotMatch(html, /<h2[^>]*>Research<\/h2>/);
	assert.doesNotMatch(html, /<nav/);
	assert.match(html, /<a href="https:\/\/example\.com\/"[^>]*>Research<\/a>/);
});

test('markdown links keep addresses with parentheses intact', () => {
	const markdown = shareMarkdown([
		{
			name: 'Films',
			tabs: [{title: 'Thing', url: 'https://example.com/wiki/Thing_(film)'}],
		},
	]);

	assert.equal(
		markdown,
		'# Films\n\n- [Thing](https://example.com/wiki/Thing_%28film%29)',
	);
});

const columns: ShareGroup[] = [
	{
		name: 'Reading <list>',
		description: 'For the weekend',
		tabs: [
			{title: 'Example', url: 'https://www.example.com/a?b=1'},
			{title: '', url: 'https://news.example.org/'},
		],
	},
	{name: 'Videos', tabs: [{title: 'Clip', url: 'https://video.example.net/1'}]},
];

test('a shared page has a dated header, a jump to each column, and a row per link with its site', () => {
	const html = shareHtmlPage('Team links', columns, 'TabLodge', {
		sharedAt: Date.UTC(2026, 10, 21),
		formatDate: () => '21 Nov 2026',
	});

	assert.match(
		html,
		/<h1>Team links<\/h1><p class="meta">Links shared from TabLodge on 21 Nov 2026 · 2 columns · 3 links<\/p>/,
	);
	assert.match(
		html,
		/<nav aria-labelledby="nav-h"><h2 id="nav-h">Columns<\/h2><ol><li><a href="#g1">Reading &lt;list&gt; <span>2<\/span><\/a><\/li><li><a href="#g2">Videos <span>1<\/span>/,
	);
	assert.match(
		html,
		/<section class="group" id="g1" aria-labelledby="g1-h"><header><h2 id="g1-h">Reading &lt;list&gt;<\/h2><span>2 links<\/span>/,
	);
	assert.match(
		html,
		/<span class="tile t\d" aria-hidden="true">E<\/span><a href="https:\/\/www\.example\.com\/a\?b=1"[^>]*>Example<\/a><small>example\.com<\/small>/,
	);
	// A link with no title shows its address.
	assert.match(
		html,
		/>https:\/\/news\.example\.org\/<\/a><small>news\.example\.org<\/small>/,
	);
	assert.match(html, /<a class="top" href="#top">Back to top<\/a>/);
	assert.match(html, /prefers-color-scheme:dark/);
	assert.match(html, /Made with <a href="https:\/\/tablodge\.bbay\.dev\/"/);
	// A page that does not know its own link offers nothing to add.
	assert.doesNotMatch(html, /Add to TabLodge|id="add"/);
});

test('a page that knows its link offers Add to TabLodge, with the Android app link and the address to paste', () => {
	const url = 'https://sync.example.test/p/AAAAAAAAAAAAAAAAAAAAAA';
	const html = shareHtmlPage('Team links', columns, 'TabLodge', {url});

	assert.match(html, /<a class="button" href="#add">Add to TabLodge<\/a>/);
	assert.match(html, /<section id="add" class="add"/);
	assert.ok(
		html.includes(
			`href="intent://import?url=${encodeURIComponent(url)}#Intent;scheme=tablodge;package=com.bberka.tablodge;S.browser_fallback_url=${encodeURIComponent('https://tablodge.bbay.dev/#android')};end"`,
		),
	);
	assert.ok(html.includes(`<code>${url}</code>`));
	assert.match(html, /Get TabLodge<\/a>/);
});

test('import reads a shared page back as its columns, or as sessions when it was shared as sessions', () => {
	const page = shareHtmlPage(
		'Team links',
		[
			...columns,
			{
				name: 'Mixed',
				tabs: [
					{title: 'Bad', url: 'javascript:alert(1)'},
					{title: 'Good', url: 'https://ok.example/'},
				],
			},
		],
		'TabLodge',
	);
	const parsed = parseImportFile(page, 'page.html');

	assert.equal(parsed.format, 'shared-page');
	assert.equal(parsed.kind, 'bookmarks');
	assert.deepEqual(
		parsed.bookmarks.map((group) => [
			group.name,
			group.links.map((link) => link.url),
		]),
		[
			[
				'Reading <list>',
				['https://www.example.com/a?b=1', 'https://news.example.org/'],
			],
			['Videos', ['https://video.example.net/1']],
			['Mixed', ['https://ok.example/']],
		],
	);
	assert.equal(parsed.bookmarks[0].description, 'For the weekend');
	assert.equal(parsed.invalid, 1);

	const sessions = parseImportFile(
		shareHtmlPage(
			'Trip',
			[
				{
					name: 'Trip',
					createdAt: Date.UTC(2026, 0, 2),
					tabs: [{title: 'Map', url: 'https://maps.example/', pinned: true}],
				},
			],
			'TabLodge',
			{kind: 'sessions'},
		),
		'',
	);
	assert.equal(sessions.kind, 'sessions');
	assert.deepEqual(sessions.sessions[0].links[0], {
		...sessions.sessions[0].links[0],
		url: 'https://maps.example/',
		title: 'Map',
		pinned: true,
	});
	assert.equal(sessions.sessions[0].createdAt, Date.UTC(2026, 0, 2));
});

test('a title cannot end the data block early', () => {
	const page = shareHtmlPage(
		'x</script><b>',
		[
			{
				name: '</script>',
				tabs: [{title: '</script>', url: 'https://a.example/'}],
			},
		],
		'TabLodge',
	);
	assert.equal(page.match(/<\/script>/g)?.length, 1);
	assert.equal(parseImportFile(page, '').bookmarks[0].name, '</script>');
});

test("a page of 623 links in 11 columns stays well under the server's 1 MB page cap", () => {
	let n = 0;
	const big: ShareGroup[] = Array.from({length: 11}, (_group, index) => ({
		name: `Column ${index + 1}`,
		tabs: Array.from({length: index === 0 ? 133 : 49}, () => {
			n += 1;
			return {
				title: `A fairly ordinary article title number ${n} about something`,
				url: `https://www.example${n % 15}.com/some/path/to/article-${n}?ref=share`,
			};
		}),
	}));
	const html = shareHtmlPage('Team links', big, 'TabLodge', {
		sharedAt: Date.UTC(2026, 10, 21),
		url: 'https://sync.example.test/p/AAAAAAAAAAAAAAAAAAAAAA',
	});
	const bytes = new TextEncoder().encode(html).length;
	assert.equal(n, 623);
	assert.ok(bytes < 400_000, `${bytes} bytes`);
	assert.equal(
		parseImportFile(html, '').bookmarks.flatMap((group) => group.links).length,
		623,
	);
});
