import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	shareHtmlPage,
	sharePreview,
	type ShareGroup,
} from '../src/app/share-formats';

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
	assert.notEqual(markdown.text, links.text);
	assert.notEqual(links.text, rich.text);
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
	assert.doesNotMatch(html, /<h2>Research<\/h2>/);
	assert.doesNotMatch(html, /<article><header>/);
	assert.match(html, /<a href="https:\/\/example\.com\/"[^>]*>Research<\/a>/);
});
