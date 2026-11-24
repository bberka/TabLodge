import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {readPastedImport} from '../src/app/pasted-import';
import {buildExport, type ExportData} from '../src/shared/export-formats';
import {parseImportFile, type ParsedImport} from '../src/shared/import-formats';
import {
	shareLinks,
	shareMarkdown,
	shareRich,
	type ShareGroup,
} from '../src/shared/share-formats';
import type {SavedTab, Session} from '../src/shared/types';

const copyGroups: ShareGroup[] = [
	{
		name: 'Reading',
		tabs: [
			{title: 'Example', url: 'https://www.example.com/a?b=1'},
			{title: 'Notes, with a comma', url: 'https://notes.example.org/x'},
		],
	},
	{name: 'Videos', tabs: [{title: 'Clip', url: 'https://video.example.net/1'}]},
];
const copySessions: Session[] = copyGroups.map((group, groupIndex) => ({
	id: `session-${groupIndex}`,
	name: group.name,
	folderId: 'unfiled',
	description: '',
	createdAt: 1_760_000_000_000,
	updatedAt: 1_760_000_000_000,
	sourceWindowName: '',
	sourceWindowId: null,
	tabs: group.tabs.map((entry, tabIndex): SavedTab => ({
		id: `tab-${groupIndex}-${tabIndex}`,
		title: entry.title ?? '',
		url: entry.url,
		notes: '',
		pinned: false,
		nativeGroup: null,
		savedAt: 1_760_000_000_000,
		originalIndex: tabIndex,
	})),
}));
const copyData: ExportData = {
	kind: 'sessions',
	groups: copySessions,
	folders: [{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true}],
};
const now = new Date(2026, 9, 25, 12, 0, 0);

const linksOf = (parsed: ParsedImport) =>
	parsed.sessions.flatMap((group) =>
		group.links.map((link) => [link.title, link.url]),
	);

function pasted(text: string): ParsedImport {
	const attempt = readPastedImport(text);
	if (!attempt?.ok) {
		throw new Error(attempt ? attempt.message : 'there was nothing to read');
	}

	return attempt.parsed;
}

function fileMessage(text: string): string {
	try {
		parseImportFile(text, 'words.txt');
	} catch (error) {
		return (error as Error).message;
	}

	throw new Error('the file text should not read');
}

test('rich text copied from Share pastes back with every link and its title', () => {
	const parsed = pasted(shareRich(copyGroups).text);

	assert.equal(parsed.format, 'url-list');
	assert.deepEqual(linksOf(parsed), [
		['Example', 'https://www.example.com/a?b=1'],
		['Notes, with a comma', 'https://notes.example.org/x'],
		['Clip', 'https://video.example.net/1'],
	]);
	assert.equal(parsed.invalid, 2, 'only the two column names are skipped');
});

test('markdown copied from Share pastes back as the links the markdown file export gives', () => {
	const fromFile = pasted(
		buildExport(copyData, 'markdown', {appName: 'TabLodge', now}).content,
	);
	assert.equal(fromFile.format, 'markdown');
	const fromClipboard = pasted(shareMarkdown(copyGroups));

	assert.deepEqual(linksOf(fromClipboard), linksOf(fromFile));
});

test('plain links copied from Share paste back as the links the txt file export gives', () => {
	const fromFile = pasted(
		buildExport(copyData, 'txt', {appName: 'TabLodge', now}).content,
	);
	const fromClipboard = pasted(shareLinks(copyGroups));

	assert.equal(fromClipboard.format, 'url-list');
	assert.deepEqual(linksOf(fromClipboard), linksOf(fromFile));
});

test('addresses and Markdown links pasted from anywhere import', () => {
	assert.deepEqual(
		linksOf(pasted('https://a.example/one\nhttps://b.example/two\n')),
		[
			['', 'https://a.example/one'],
			['', 'https://b.example/two'],
		],
	);
	assert.deepEqual(
		linksOf(
			pasted(
				'First page\nhttps://a.example/one\n\nSecond page\nhttps://b.example/two\n',
			),
		),
		[
			['First page', 'https://a.example/one'],
			['Second page', 'https://b.example/two'],
		],
	);
	const titledBytes = pasted(
		'Unused heading\nhttps://a.example/one Inline title\n',
	);
	assert.deepEqual(linksOf(titledBytes), [
		['Inline title', 'https://a.example/one'],
	]);
	assert.equal(
		titledBytes.invalid,
		1,
		'the heading the inline title replaced is counted as skipped',
	);
	const markdown = pasted(
		'- [One](https://a.example/one)\n- [Two](https://b.example/two)\n',
	);
	assert.equal(markdown.format, 'markdown');
	assert.deepEqual(linksOf(markdown), [
		['One', 'https://a.example/one'],
		['Two', 'https://b.example/two'],
	]);
});

test('unrecognized text says what an unrecognized file says, and imports nothing', () => {
	assert.deepEqual(readPastedImport('hello\nworld\n'), {
		ok: false,
		message: fileMessage('hello\nworld\n'),
	});
	assert.deepEqual(
		readPastedImport('chrome://extensions/\nftp://old.example/'),
		{
			ok: false,
			message: fileMessage('chrome://extensions/\nftp://old.example/'),
		},
	);
});

test('empty and whitespace-only text leaves nothing to import', () => {
	assert.equal(readPastedImport(''), undefined);
	assert.equal(readPastedImport(' '.repeat(3)), undefined);
	assert.equal(readPastedImport(' \n\t\r\n '), undefined);
});
