import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	BOOKMARKS_FORMAT_ID,
	SESSIONS_FORMAT_ID,
	fileNamePrefix,
} from '../src/app/backup-format';
import {
	buildExport,
	csvCell,
	exportCounts,
	exportFilename,
	bookmarkColumnExportChoices,
	sessionExportChoices,
	type ExportData,
	type ExportFormat,
} from '../src/app/export-formats';
import {
	ImportFormatError,
	MAX_IMPORT_BYTES,
	bookmarkImportPayload,
	cleanTitle,
	decodeEntities,
	parseBookmarkTree,
	parseCsvRows,
	parseImportFile,
	previewImport,
	sessionImportPayload,
	toTimestamp,
	type ParsedImport,
} from '../src/app/import-formats';
import {webUrl} from '../src/app/web-url';
import type {
	Bookmark,
	BookmarkColumn,
	Folder,
	SavedTab,
	Session,
} from '../src/app/types';

const urls = (
	parsed: ParsedImport,
	kind: 'sessions' | 'bookmarks' = 'sessions',
) => parsed[kind].flatMap((group) => group.links.map((link) => link.url));
const names = (
	parsed: ParsedImport,
	kind: 'sessions' | 'bookmarks' = 'sessions',
) => parsed[kind].map((group) => group.name);
const rejects = (source: string, filename: string, pattern: RegExp) =>
	assert.throws(
		() => parseImportFile(source, filename),
		(error: unknown) =>
			error instanceof ImportFormatError && pattern.test(error.message),
	);

const tab = (
	id: string,
	title: string,
	url: string,
	extra: Partial<SavedTab> = {},
): SavedTab => ({
	id,
	title,
	url,
	notes: '',
	pinned: false,
	nativeGroup: null,
	savedAt: 1_760_000_000_000,
	originalIndex: 0,
	...extra,
});
const session = (
	id: string,
	name: string,
	tabs: SavedTab[],
	extra: Partial<Session> = {},
): Session => ({
	id,
	name,
	folderId: 'unfiled',
	description: '',
	createdAt: 1_760_000_000_000,
	updatedAt: 1_760_000_000_000,
	sourceWindowName: '',
	sourceWindowId: null,
	tabs,
	...extra,
});
const folders: Folder[] = [
	{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true},
	{id: 'f-work', name: 'Work', createdAt: 1, isDefault: false},
];
const groups: Session[] = [
	session(
		'g1',
		'Research, "quoted" & <b>bold</b>',
		[
			tab('t1', 'Split left', 'https://a.example/left', {
				split: {id: 'p', position: 0},
			}),
			tab('t2', 'Split right', 'https://a.example/right', {
				split: {id: 'p', position: 1},
				notes: 'Read later\nsecond line',
			}),
			tab(
				't3',
				'=SUM(A1) formula-looking title',
				'https://a.example/sum?x=1,2',
			),
		],
		{folderId: 'f-work', description: 'Session notes'},
	),
	session('g2', 'Second [session]', [
		tab('t4', 'Pipes | in | title', 'https://b.example/path_(with)_parens'),
	]),
];
const columns: BookmarkColumn[] = [
	{id: 'bookmark-default', name: 'Bookmarks', createdAt: 1, isDefault: true},
	{id: 'c-dev', name: 'Dev', createdAt: 2, isDefault: false},
];
const bookmarks: Bookmark[] = [
	{
		id: 'b1',
		title: 'GitHub',
		url: 'https://github.com/',
		columnId: 'bookmark-default',
		createdAt: 1_760_000_000_000,
		updatedAt: 1_760_000_000_000,
	},
	{
		id: 'b2',
		title: 'MDN; docs',
		url: 'https://developer.mozilla.org/en-US/',
		columnId: 'c-dev',
		createdAt: 1_760_000_000_000,
		updatedAt: 1_760_000_000_000,
	},
	{
		id: 'b3',
		title: 'Loose',
		url: 'https://loose.example/',
		columnId: 'bookmark-unfiled',
		createdAt: 1_760_000_000_000,
		updatedAt: 1_760_000_000_000,
	},
];
const sessionsData: ExportData = {kind: 'sessions', groups, folders};
const bookmarksData: ExportData = {kind: 'bookmarks', columns, bookmarks};
const now = new Date(2026, 9, 25, 12, 0, 0);

test('helpers keep only web URLs, clean titles, and read timestamps in s, ms, µs, or ISO form', () => {
	assert.equal(webUrl(' https://example.com '), 'https://example.com/');
	for (const bad of [
		'javascript:alert(1)',
		'data:text/html,x',
		'file:///etc/passwd',
		'chrome://settings',
		'ftp://x.example/',
		'not a url',
		'',
		42,
		null,
		`https://x.example/${'a'.repeat(17_000)}`,
	]) {
		assert.equal(webUrl(bad), null);
	}

	assert.equal(cleanTitle('  A\u0000\tB\u200B\nC  '), 'A B C');
	assert.equal(cleanTitle('x'.repeat(900)).length, 500);
	assert.equal(toTimestamp(1_700_000_000), 1_700_000_000_000);
	assert.equal(toTimestamp('1700000000000'), 1_700_000_000_000);
	assert.equal(toTimestamp(1_700_000_000_000_000), 1_700_000_000_000);
	assert.equal(
		toTimestamp('2024-03-13T10:00:00.000Z'),
		Date.parse('2024-03-13T10:00:00.000Z'),
	);
	assert.equal(toTimestamp('yesterday'), undefined);
	assert.equal(toTimestamp(5), undefined);
	assert.equal(
		decodeEntities('&amp;&lt;&#39;&#x1F600;&bogus;&#0;'),
		"&<'😀&bogus;",
	);
});

test('file names are lower-case, dated, and use the display name as prefix', () => {
	assert.equal(fileNamePrefix('TabLodge'), 'tablodge');
	assert.equal(fileNamePrefix('Tab Lodge — Pro!'), 'tab-lodge-pro');
	assert.equal(
		exportFilename('TabLodge', 'sessions', 'json', now),
		'tablodge-sessions-2026-10-25.json',
	);
	assert.equal(
		exportFilename('TabLodge', 'bookmarks', 'markdown', now),
		'tablodge-bookmarks-2026-10-25.md',
	);
	assert.equal(
		exportFilename('TabLodge', 'selected', 'txt', now),
		'tablodge-selected-tabs-2026-10-25.txt',
	);
	assert.equal(
		exportFilename('TabLodge', 'sessions', 'json', now, 'Second [session]'),
		'tablodge-sessions-second-session-2026-10-25.json',
	);
	assert.deepEqual(exportCounts(sessionsData), {groups: 2, items: 4});
	assert.deepEqual(exportCounts(bookmarksData), {groups: 2, items: 3});
});

test("JSON backups keep the importer's format ids and every field", () => {
	const sessionsJson = JSON.parse(
		buildExport(sessionsData, 'json', {appName: 'TabLodge', now}).content,
	) as {format: string; groups: Session[]; folders: Folder[]};
	assert.equal(sessionsJson.format, SESSIONS_FORMAT_ID);
	assert.deepEqual(sessionsJson.groups, groups);
	assert.deepEqual(sessionsJson.folders.map((folder) => folder.id).toSorted(), [
		'f-work',
		'unfiled',
	]);
	const bookmarksJson = JSON.parse(
		buildExport(bookmarksData, 'json', {appName: 'TabLodge', now}).content,
	) as {
		format: string;
		bookmarks: Bookmark[];
		bookmarkColumns: BookmarkColumn[];
	};
	assert.equal(bookmarksJson.format, BOOKMARKS_FORMAT_ID);
	assert.deepEqual(bookmarksJson.bookmarks, bookmarks);
	assert.deepEqual(bookmarksJson.bookmarkColumns, columns);
});

test('our JSON backups are recognized by structure under any format id and passed through intact', () => {
	for (const format of [
		SESSIONS_FORMAT_ID,
		'example-sessions',
		'some-future-id',
		undefined,
	]) {
		const data = {...(format && {format}), version: 1, folders, groups};
		const parsed = parseImportFile(JSON.stringify(data), 'backup.json');
		assert.equal(parsed.format, 'backup');
		assert.equal(parsed.native?.sessions, true);
		assert.deepEqual(sessionImportPayload(parsed), data);
		assert.deepEqual(names(parsed), [
			groups[0].name.replaceAll(/\s+/g, ' '),
			'Second [session]',
		]);
		assert.equal(parsed.sessions[0].folder, 'Work');
	}

	for (const format of [
		BOOKMARKS_FORMAT_ID,
		'example-bookmarks',
		'some-future-id',
		undefined,
	]) {
		const data = {
			...(format && {format}),
			bookmarkColumns: columns,
			bookmarks,
		};
		const parsed = parseImportFile(JSON.stringify(data), 'bookmarks.json');
		assert.equal(parsed.native?.bookmarks, true);
		assert.deepEqual(bookmarkImportPayload(parsed), data);
		assert.deepEqual(names(parsed, 'bookmarks'), ['Bookmarks', 'Dev', '']);
		// Imported as sessions, columns become sessions and the payload is converted.
		assert.deepEqual(names(parsed), ['Bookmarks', 'Dev', 'Bookmarks']);
		assert.ok(
			parsed.warnings.some((warning) => warning.includes('bookmarks only')),
		);
	}

	// Bare shapes: a bare array of tabs and an object with `tabs`.
	assert.deepEqual(
		urls(
			parseImportFile(
				JSON.stringify({
					groupName: 'Old',
					tabs: [{url: 'https://old.example/', title: 'Old'}],
				}),
				'old.json',
			),
		),
		['https://old.example/'],
	);
	assert.deepEqual(
		urls(
			parseImportFile(
				JSON.stringify([
					{href: 'https://a.example/'},
					'https://b.example/',
					{url: 'javascript:void 0'},
				]),
				'links.json',
			),
		),
		['https://a.example/', 'https://b.example/'],
	);
});

test('HTML export is a Netscape bookmark file that browsers and this importer read back', () => {
	const html = buildExport(sessionsData, 'html', {
		appName: 'TabLodge',
		now,
	}).content;
	assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
	assert.match(
		html,
		/<H3 ADD_DATE="1760000000">Research, &quot;quoted&quot; &amp; &lt;b&gt;bold&lt;\/b&gt;<\/H3>/,
	);
	assert.doesNotMatch(html, /<b>bold/);
	const parsed = parseImportFile(html, 'export.html');
	assert.equal(parsed.format, 'netscape-html');
	assert.deepEqual(names(parsed), [
		'Research, "quoted" & <b>bold</b>',
		'Second [session]',
	]);
	assert.equal(parsed.sessions[0].links[0].createdAt, 1_760_000_000_000);
	const bookmarkHtml = parseImportFile(
		buildExport(bookmarksData, 'html', {appName: 'TabLodge', now}).content,
		'b.html',
	);
	assert.deepEqual(names(bookmarkHtml, 'bookmarks'), ['Bookmarks', 'Dev']);
});

test('browser bookmark HTML: nested folders, entities, descriptions, and unsafe content', () => {
	const chromeExport = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. <A HREF="https://comment.example/">no</A> -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://news.example/?a=1&amp;b=2" ADD_DATE="1700000001" ICON="data:image/png;base64,AAA">News &amp; views</A>
        <DD>Morning reading
        <DT><H3>Dev &lt;tools&gt;</H3>
        <DL><p>
            <DT><A HREF='https://dev.example/'>Dev</A>
            <DT><A HREF="javascript:alert(document.cookie)">Bookmarklet</A>
            <DT><A HREF="place:sort=8">Firefox smart folder</A>
        </DL><p>
        <DT><H3>Empty</H3>
        <DL><p>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://top.example/">Top level</A>
    <script>document.write('<a href="https://script.example/">x</a>')</script>
</DL><p>`;
	const parsed = parseImportFile(chromeExport, 'bookmarks_10_25_26.html');
	assert.equal(parsed.label, 'Browser bookmark file (HTML)');
	assert.equal(parsed.confidence, 'verified');
	assert.deepEqual(names(parsed, 'bookmarks'), [
		'Bookmarks bar',
		'Dev <tools>',
	]);
	assert.deepEqual(urls(parsed, 'bookmarks'), [
		'https://news.example/?a=1&b=2',
		'https://top.example/',
		'https://dev.example/',
	]);
	assert.equal(parsed.bookmarks[0].links[0].title, 'News & views');
	assert.equal(parsed.bookmarks[0].links[0].notes, 'Morning reading');
	assert.equal(parsed.invalid, 2);
	assert.equal(parsed.bookmarks[0].createdAt, 1_700_000_000_000);
	// Converted payload: folders become columns, and loose links join the first column.
	const payload = bookmarkImportPayload(parsed) as {
		bookmarkColumns: Array<{id: string; name: string}>;
		bookmarks: Array<{url: string; columnId?: string}>;
	};
	assert.deepEqual(
		payload.bookmarkColumns.map((column) => column.name),
		['Bookmarks bar', 'Dev <tools>'],
	);
	assert.equal(
		payload.bookmarks.find(
			(bookmark) => bookmark.url === 'https://top.example/',
		)?.columnId,
		'import-column-1',
	);

	const page = parseImportFile(
		'<html><body><ul><li><a href="https://one.example/" onclick="evil()">One</a><li><a href=https://two.example/>Two</a></ul><img src=x onerror=alert(1)></body></html>',
		'page.html',
	);
	assert.equal(page.confidence, 'best-effort');
	assert.deepEqual(urls(page), [
		'https://one.example/',
		'https://two.example/',
	]);
	rejects(
		'<html><a href="javascript:x()">x</a></html>',
		'x.html',
		/No web links/,
	);
	rejects('<html><p>No links here</p></html>', 'x.html', /no links/);
});

test('CSV: export round trip, quoting, formula guards, other delimiters, and bad files', () => {
	const csv = buildExport(sessionsData, 'csv', {
		appName: 'TabLodge',
		now,
	}).content;
	assert.ok(csv.startsWith('\uFEFFtitle,url,session,folder,notes,created\r\n'));
	assert.match(csv, /'=SUM\(A1\) formula-looking title/);
	assert.match(csv, /"Read later\nsecond line"/);
	const parsed = parseImportFile(csv, 'tablodge-sessions.csv');
	assert.equal(parsed.format, 'csv');
	assert.deepEqual(names(parsed), [groups[0].name, 'Second [session]']);
	assert.equal(parsed.sessions[0].folder, 'Work');
	assert.equal(
		parsed.sessions[0].links[2].title,
		'=SUM(A1) formula-looking title',
	);
	assert.equal(parsed.sessions[0].links[1].notes, 'Read later\nsecond line');
	const payload = sessionImportPayload(parsed) as {
		folders: Array<{id: string; name: string}>;
		groups: Array<{folderId?: string; tabs: Array<{notes?: string}>}>;
	};
	assert.deepEqual(
		payload.folders.map((folder) => folder.name),
		['Work'],
	);
	assert.equal(payload.groups[0].folderId, payload.folders[0].id);
	assert.equal(payload.groups[1].folderId, undefined);

	assert.equal(csvCell('plain'), 'plain');
	assert.equal(csvCell('a,b'), '"a,b"');
	assert.equal(csvCell('say "hi"'), '"say ""hi"""');
	assert.equal(csvCell('@cmd'), "'@cmd");
	assert.deepEqual(parseCsvRows('a,"b,""c"""\r\n\r\nd,e', ','), [
		['a', 'b,"c"'],
		['d', 'e'],
	]);

	const semicolon = parseImportFile(
		'Name;URL;Folder;Date added\nSite A;https://a.example/;Reading;2024-01-02\nBroken;not-a-url;Reading;\n',
		'export.csv',
	);
	assert.deepEqual(names(semicolon, 'bookmarks'), ['Reading']);
	assert.equal(semicolon.invalid, 1);
	assert.equal(
		semicolon.bookmarks[0].links[0].createdAt,
		Date.parse('2024-01-02'),
	);
	const tsv = parseImportFile('title\turl\nA\thttps://a.example/\n', 'x.tsv');
	assert.deepEqual(urls(tsv), ['https://a.example/']);
	rejects('name,comment\nfoo,bar\n', 'notes.csv', /“url” column/);
	rejects(
		'title,url\n"unterminated,https://a.example/\n',
		'broken.csv',
		/No web links/,
	);
});

test('Markdown export reads back with its headings, titles, and notes', () => {
	const markdown = buildExport(sessionsData, 'markdown', {
		appName: 'TabLodge',
		now,
	}).content;
	assert.match(markdown, /^# TabLodge sessions\n/);
	assert.match(
		markdown,
		/- \[Pipes \\\| in \\\| title\]\(<https:\/\/b\.example\/path_\(with\)_parens>\)/,
	);
	const parsed = parseImportFile(markdown, 'tablodge-sessions.md');
	assert.equal(parsed.format, 'markdown');
	assert.deepEqual(names(parsed), [groups[0].name, 'Second [session]']);
	assert.equal(parsed.sessions[1].links[0].title, 'Pipes | in | title');
	assert.equal(parsed.sessions[0].links[1].notes, 'Read later second line');
	assert.equal(
		parsed.sessions[1].links[0].url,
		'https://b.example/path_(with)_parens',
	);
	const bookmarkMarkdown = buildExport(bookmarksData, 'markdown', {
		appName: 'TabLodge',
		now,
	}).content;
	assert.deepEqual(
		names(parseImportFile(bookmarkMarkdown, 'b.md'), 'bookmarks'),
		['Bookmarks', 'Dev', 'Unfiled'],
	);
});

test('plain URL lists: export round trip and tolerant reading', () => {
	const text = buildExport(sessionsData, 'txt', {
		appName: 'TabLodge',
		now,
	}).content;
	assert.equal(
		text,
		`${groups.flatMap((group) => group.tabs.map((entry) => entry.url)).join('\n')}\n`,
	);
	const parsed = parseImportFile(text, 'urls.txt');
	assert.equal(parsed.format, 'url-list');
	const messy = parseImportFile(
		'# my links\r\nhttps://a.example/page, Page A\r\nSee https://b.example/x.\r\njust words\r\nftp://old.example/\r\n\r\nhttps://c.example/ - Title C',
		'notes.txt',
	);
	assert.deepEqual(urls(messy), [
		'https://a.example/page',
		'https://b.example/x',
		'https://c.example/',
	]);
	assert.deepEqual(
		messy.sessions[0].links.map((link) => link.title),
		['Page A', 'See', 'Title C'],
	);
	assert.equal(messy.invalid, 2);
	rejects('', 'empty.txt', /empty/);
	rejects('   \n\n  ', 'blank.txt', /empty/);
	rejects('hello\nworld\n', 'words.txt', /No web links/);
	rejects('\u0000\u0001\u0002binaryÿ', 'photo.bin', /No web links/);
});

test('OneTab text export: groups, missing titles, pipes in titles, and junk lines', () => {
	const onetab = [
		'https://a.example/one | First tab',
		'https://a.example/two | Title | with | pipes',
		'https://a.example/three',
		'https://a.example/four | ',
		'',
		'',
		'https://b.example/ | Second group',
		'chrome://extensions/ | Not importable',
		'garbage line',
		'',
	].join('\n');
	const parsed = parseImportFile(onetab, 'onetab.txt');
	assert.equal(parsed.format, 'onetab');
	assert.equal(parsed.label, 'OneTab export');
	assert.deepEqual(names(parsed), ['OneTab group 1', 'OneTab group 2']);
	assert.deepEqual(
		parsed.sessions[0].links.map((link) => link.title),
		['First tab', 'Title | with | pipes', '', ''],
	);
	assert.equal(parsed.invalid, 2);
	const single = parseImportFile(
		'https://x.example/ | X\nhttps://y.example/ | Y',
		'onetab.txt',
	);
	assert.deepEqual(names(single), ['OneTab']);
});

test('Session Buddy v4 and v3 exports', () => {
	const v4 = {
		format: 'nxs.json.v2',
		exportId: 'e',
		created: '2025-02-23T16:25:25.006Z',
		scope: 'selected',
		source: {type: 'client', version: '4.0.4'},
		collections: [
			{
				id: 'c1',
				title: 'WORDPRESS',
				created: 1_740_327_900_920,
				folders: [
					{
						id: 'w1',
						links: [
							{id: 'l1', url: 'https://wordpress.org/', title: 'WordPress'},
							{id: 'l2', url: 'chrome://newtab/', title: 'New Tab'},
						],
					},
					{
						id: 'w2',
						links: [{url: 'https://w2.example/', title: 'Second window'}],
					},
				],
			},
			{id: 'c2', folders: [{links: [{url: 'https://untitled.example/'}]}]},
		],
	};
	const parsed = parseImportFile(
		JSON.stringify(v4),
		'session_buddy_export.json',
	);
	assert.equal(parsed.format, 'session-buddy');
	assert.deepEqual(names(parsed), ['WORDPRESS', 'Session Buddy 2']);
	assert.deepEqual(urls(parsed), [
		'https://wordpress.org/',
		'https://w2.example/',
		'https://untitled.example/',
	]);
	assert.equal(parsed.sessions[0].createdAt, 1_740_327_900_920);
	assert.equal(parsed.invalid, 1);
	const v3 = {
		format: 'nxs.json.v1',
		created: '2019-05-01T10:00:00.000Z',
		sessions: [
			{
				type: 'saved',
				id: 12,
				name: 'Work',
				created: '2019-05-01T10:00:00.000Z',
				windows: [
					{
						id: 1,
						tabs: [{url: 'https://work.example/', title: 'Work', pinned: true}],
					},
				],
			},
			{
				type: 'current',
				windows: [{tabs: [{url: 'https://now.example/', title: 'Now'}]}],
			},
		],
	};
	const old = parseImportFile(JSON.stringify(v3), 'sb.json');
	assert.deepEqual(names(old), ['Work', 'Session Buddy: open tabs']);
	assert.equal(
		old.sessions[0].createdAt,
		Date.parse('2019-05-01T10:00:00.000Z'),
	);
	// Pinned state from other tools is dropped, so the importer never filters those tabs out.
	assert.equal(old.sessions[0].links[0].pinned, undefined);
});

test('Tab Session Manager export: windows keyed by id, tab order, and lazy-load placeholder URLs', () => {
	const tsm = [
		{
			name: 'Morning',
			date: 1_700_000_000_000,
			tag: ['auto', 'work'],
			sessionStartTime: 1,
			tabsNumber: 3,
			windowsNumber: 2,
			id: 'u',
			windows: {
				'123': {
					'9': {
						id: 9,
						index: 1,
						url: 'https://second.example/',
						title: 'Second',
					},
					'4': {
						id: 4,
						index: 0,
						url: 'moz-extension://abc/replaced/index.html?state=redirect&title=Lazy%20Tab&url=https%3A%2F%2Flazy.example%2Fpage%3Fq%3D1&favIconUrl=',
						title: '',
					},
				},
				'200': {
					'1': {
						index: 0,
						url: 'chrome-extension://xyz/replaced/replaced.html?url=about%3Areader%3Furl%3Dhttps%253A%252F%252Freader.example%252F',
						title: 'Reader',
					},
				},
			},
			windowsInfo: {'123': {id: 123}},
		},
		{
			name: '',
			date: 'not a date',
			tag: '',
			sessionStartTime: 2,
			windows: {'1': {'1': {url: 'about:blank'}}},
		},
	];
	const parsed = parseImportFile(
		JSON.stringify(tsm),
		'Tab Session Manager - Backup.json',
	);
	assert.equal(parsed.format, 'tab-session-manager');
	assert.deepEqual(names(parsed), ['Morning']);
	assert.deepEqual(urls(parsed), [
		'https://lazy.example/page?q=1',
		'https://second.example/',
		'https://reader.example/',
	]);
	assert.equal(parsed.sessions[0].links[0].title, 'Lazy Tab');
	assert.equal(parsed.sessions[0].description, 'Tags: work');
	assert.equal(parsed.invalid, 1);
});

test('Toby exports: flat lists and workspace groups', () => {
	const toby = {
		version: 3,
		lists: [
			{
				title: 'News',
				labels: [],
				cards: [
					{
						title: 'Original',
						customTitle: 'Custom',
						url: 'https://news.example/',
						customDescription: 'Daily',
					},
					{title: 'Bad', url: 'about:config'},
				],
			},
			{title: 'Empty', cards: []},
		],
	};
	const parsed = parseImportFile(JSON.stringify(toby), 'toby.json');
	assert.equal(parsed.format, 'toby');
	assert.equal(parsed.confidence, 'verified');
	assert.deepEqual(names(parsed), ['News']);
	assert.equal(parsed.sessions[0].links[0].title, 'Custom');
	assert.equal(parsed.sessions[0].links[0].notes, 'Daily');
	assert.equal(parsed.invalid, 1);
	const v4 = {
		version: 4,
		labels: {},
		groups: [
			{
				name: 'Space',
				lists: [
					{title: 'List', cards: [{title: 'A', url: 'https://a.example/'}]},
				],
			},
		],
	};
	const workspace = parseImportFile(JSON.stringify(v4), 'toby.json');
	assert.equal(workspace.confidence, 'best-effort');
	assert.deepEqual(names(workspace), ['Space / List']);
});

test('malformed and unsupported input fails with a readable message', () => {
	rejects('{ not json', 'x.json', /isn’t valid JSON/);
	rejects(
		JSON.stringify({hello: 'world'}),
		'x.json',
		/isn’t a format we recognize/,
	);
	rejects(
		JSON.stringify({groups: [{name: 'x', tabs: [{url: 'javascript:1'}]}]}),
		'x.json',
		/No web links/,
	);
	rejects(JSON.stringify([]), 'x.json', /isn’t a format we recognize/);
	rejects('x'.repeat(MAX_IMPORT_BYTES + 1), 'huge.txt', /larger than 45 MB/);
	// Deeply nested or hostile JSON values never throw anything but ImportFormatError.
	rejects(
		JSON.stringify({
			lists: [{cards: [null, 5, 'x', {url: {toString: 'https://x'}}]}],
		}),
		't.json',
		/No web links/,
	);
	// Without a .json extension, invalid JSON falls back to text parsing.
	assert.deepEqual(
		urls(parseImportFile('[https://a.example/ link]', 'x.txt')),
		['https://a.example/'],
	);
});

test('link limits and session size: groups over 1000 tabs are split, extra links are counted as skipped', () => {
	const many = Array.from(
		{length: 2500},
		(_, index) => `https://many.example/${index}`,
	).join('\n');
	const parsed = parseImportFile(many, 'many.txt');
	assert.deepEqual(
		parsed.sessions.map((group) => group.links.length),
		[1000, 1000, 500],
	);
	assert.deepEqual(names(parsed), [
		'Imported tabs (1)',
		'Imported tabs (2)',
		'Imported tabs (3)',
	]);
	assert.equal(parsed.bookmarks[0].links.length, 2500);
	const tooMany = Array.from(
		{length: 50_010},
		(_, index) => `https://x.example/${index}`,
	).join('\n');
	assert.equal(parseImportFile(tooMany, 'x.txt').invalid, 10);
});

test('preview counts duplicates against saved and repeated links, keeps pinned tabs of a TabLodge export, and samples items', () => {
	const data = {
		groups: [
			{
				name: 'S',
				tabs: [
					{url: 'https://saved.example/'},
					{url: 'https://new.example/'},
					{url: 'https://new.example/'},
					{url: 'https://pinned.example/', pinned: true},
				],
			},
		],
	};
	const parsed = parseImportFile(JSON.stringify(data), 's.json');
	const preview = previewImport(parsed, 'sessions', {
		existingUrls: ['https://saved.example/'],
		sampleSize: 2,
	});
	assert.deepEqual(
		{
			groups: preview.groups,
			links: preview.links,
			duplicates: preview.duplicates,
			pinned: preview.pinnedSkipped,
		},
		{groups: 1, links: 4, duplicates: 2, pinned: 0},
	);
	assert.equal(preview.sample.length, 2);
	// Other formats still follow the setting.
	const foreign = {...parsed, native: undefined};
	assert.equal(
		previewImport(foreign, 'sessions', {existingUrls: []}).pinnedSkipped,
		1,
	);
	assert.equal(
		previewImport(foreign, 'sessions', {existingUrls: [], includePinned: true})
			.links,
		4,
	);
	const html = parseImportFile(
		'<DL><DT><H3>A</H3><DL><DT><A HREF="https://a.example/">a</A></DL><DT><H3>B</H3><DL><DT><A HREF="https://c.example/">c</A></DL><DT><A HREF="https://b.example/">b</A></DL>',
		'b.html',
	);
	assert.equal(previewImport(html, 'bookmarks', {existingUrls: []}).groups, 2);
	assert.equal(
		previewImport(html, 'bookmarks', {existingUrls: [], singleColumn: true})
			.groups,
		1,
	);
});

test("browser bookmark trees read like the service worker's browser import", () => {
	const parsed = parseBookmarkTree([
		{
			id: '0',
			title: '',
			children: [
				{
					id: '1',
					title: 'Bookmarks bar',
					children: [
						{
							id: '3',
							title: 'A',
							url: 'https://a.example/',
							dateAdded: 1_700_000_000_000,
						},
						{
							id: '4',
							title: 'Sub',
							children: [{id: '5', title: 'B', url: 'https://b.example/'}],
						},
					],
				},
				{
					id: '2',
					title: 'Other bookmarks',
					children: [{id: '6', title: 'JS', url: 'javascript:void(0)'}],
				},
			],
		},
	]);
	assert.deepEqual(names(parsed, 'bookmarks'), ['Bookmarks bar', 'Sub']);
	assert.equal(parsed.invalid, 1);
	assert.equal(parsed.bookmarks[0].links[0].createdAt, 1_700_000_000_000);
});

test('bookmark folders merge by name and folderless links land in the first column', () => {
	const parsed = parseBookmarkTree([
		{
			id: '0',
			children: [
				{id: '10', title: 'Loose', url: 'https://loose.example/'},
				{
					id: '1',
					title: 'Socials',
					children: [
						{id: '2', title: 'First', url: 'https://first.example/'},
						{
							id: '3',
							title: 'Nested',
							children: [
								{id: '4', title: 'Second', url: 'https://second.example/'},
							],
						},
					],
				},
				{
					id: '5',
					title: 'Socials',
					children: [{id: '6', title: 'Third', url: 'https://third.example/'}],
				},
			],
		},
	]);

	assert.deepEqual(
		parsed.bookmarks.map((entry) => [
			entry.name,
			entry.links.map((link) => link.url),
		]),
		[
			[
				'Socials',
				[
					'https://first.example/',
					'https://third.example/',
					'https://loose.example/',
				],
			],
			['Nested', ['https://second.example/']],
		],
	);

	const payload = bookmarkImportPayload(parsed) as {
		bookmarkColumns: Array<{id: string; name: string}>;
		bookmarks: Array<{url: string; columnId?: string}>;
	};
	assert.deepEqual(payload.bookmarkColumns, [
		{id: 'import-column-1', name: 'Socials'},
		{id: 'import-column-2', name: 'Nested'},
	]);
	assert.equal(
		payload.bookmarks.find(
			(bookmark) => bookmark.url === 'https://loose.example/',
		)?.columnId,
		'import-column-1',
	);
});

test('bookmark HTML folders merge by name and unfiled links use the first column', () => {
	const data: ExportData = {
		kind: 'bookmarks',
		columns: [
			{id: 'social-one', name: 'Socials', createdAt: 0, isDefault: false},
			{id: 'work', name: 'Work', createdAt: 0, isDefault: false},
			{id: 'social-two', name: 'Socials', createdAt: 0, isDefault: false},
		],
		bookmarks: [
			{...bookmarks[0], id: 'one', columnId: 'social-one'},
			{...bookmarks[1], id: 'two', columnId: 'work'},
			{...bookmarks[2], id: 'three', columnId: 'social-two'},
			{...bookmarks[0], id: 'loose', columnId: 'bookmark-unfiled'},
		],
	};
	const parsed = parseImportFile(
		buildExport(data, 'html', {appName: 'TabLodge'}).content,
		'bookmarks.html',
	);

	assert.deepEqual(names(parsed, 'bookmarks'), ['Socials', 'Work']);
	assert.deepEqual(urls(parsed, 'bookmarks'), [
		bookmarks[0].url,
		bookmarks[2].url,
		bookmarks[0].url,
		bookmarks[1].url,
	]);
	const payload = bookmarkImportPayload(parsed) as {
		bookmarkColumns: Array<{id: string; name: string}>;
		bookmarks: Array<{url: string; columnId: string}>;
	};
	assert.deepEqual(payload.bookmarkColumns, [
		{id: 'import-column-1', name: 'Socials'},
		{id: 'import-column-2', name: 'Work'},
	]);
	assert.ok(
		payload.bookmarks
			.filter((entry) => entry.url === bookmarks[0].url)
			.every((entry) => entry.columnId === 'import-column-1'),
	);
});

test('individual export choices include current and all data', () => {
	const sessionChoices = sessionExportChoices(groups[1], groups, folders);
	assert.deepEqual(
		sessionChoices.map(({id, label}) => ({id, label})),
		[
			{id: 'current', label: 'Current session'},
			{id: 'all', label: 'All sessions'},
		],
	);
	const currentSessionExport = JSON.parse(
		buildExport(sessionChoices[0].data, 'json', {appName: 'TabLodge'}).content,
	) as {groups: Array<{name: string}>};
	assert.deepEqual(
		currentSessionExport.groups.map((entry) => entry.name),
		[groups[1].name],
	);
	const allSessionsExport = JSON.parse(
		buildExport(sessionChoices[1].data, 'json', {appName: 'TabLodge'}).content,
	) as {groups: Array<{name: string}>};
	assert.deepEqual(
		allSessionsExport.groups.map((entry) => entry.name),
		groups.map((entry) => entry.name),
	);

	const columnChoices = bookmarkColumnExportChoices(
		bookmarksData.columns![0],
		bookmarksData.columns!,
		bookmarksData.bookmarks!,
	);
	assert.deepEqual(
		columnChoices.map(({id, label}) => ({id, label})),
		[
			{id: 'column', label: bookmarksData.columns![0].name},
			{id: 'all', label: 'All bookmarks'},
		],
	);
	const columnExport = JSON.parse(
		buildExport(columnChoices[0].data, 'json', {appName: 'TabLodge'}).content,
	) as {bookmarks: Array<{url: string}>};
	assert.deepEqual(
		columnExport.bookmarks.map((entry) => entry.url),
		bookmarksData
			.bookmarks!.filter(
				(entry) => entry.columnId === bookmarksData.columns![0].id,
			)
			.map((entry) => entry.url),
	);
	assert.equal(
		columnChoices[1].data.bookmarks?.length,
		bookmarksData.bookmarks?.length,
	);
});

test('every export format re-imports with the same links', () => {
	for (const format of [
		'json',
		'html',
		'csv',
		'markdown',
		'txt',
	] satisfies ExportFormat[]) {
		const sessionsFile = buildExport(sessionsData, format, {
			appName: 'TabLodge',
			now,
		});
		assert.deepEqual(
			urls(parseImportFile(sessionsFile.content, sessionsFile.filename)),
			groups.flatMap((group) => group.tabs.map((entry) => entry.url)),
			format,
		);
		const bookmarksFile = buildExport(bookmarksData, format, {
			appName: 'TabLodge',
			now,
		});
		assert.deepEqual(
			urls(
				parseImportFile(bookmarksFile.content, bookmarksFile.filename),
				'bookmarks',
			).toSorted(),
			bookmarks.map((entry) => entry.url).toSorted(),
			format,
		);
	}
});

test('single-session exports contain only that session and use its name in the filename', () => {
	const data: ExportData = {
		kind: 'sessions',
		groups: [groups[1]],
		folders,
	};
	for (const format of [
		'json',
		'html',
		'csv',
		'markdown',
		'txt',
	] satisfies ExportFormat[]) {
		const file = buildExport(data, format, {
			appName: 'TabLodge',
			now,
			name: groups[1].name,
		});
		assert.match(
			file.filename,
			/^tablodge-sessions-second-session-2026-10-25\./,
		);
		assert.deepEqual(
			urls(parseImportFile(file.content, file.filename)),
			groups[1].tabs.map((entry) => entry.url),
			format,
		);
	}
});

test('an old session export with both description and notes imports as one description', () => {
	const old = JSON.stringify({
		format: 'tablodge-sessions',
		version: 3,
		groups: [
			{
				name: 'Old',
				description: 'Short',
				notes: 'Longer note',
				tabs: [{url: 'https://a.example/', title: 'A', notes: 'tab note'}],
			},
			{
				name: 'Same',
				description: 'Equal',
				notes: 'Equal',
				tabs: [{url: 'https://b.example/', title: 'B'}],
			},
		],
	});
	const parsed = parseImportFile(old, 'old.json');
	assert.equal(parsed.sessions[0].description, 'Short\n\nLonger note');
	assert.equal(parsed.sessions[0].notes, undefined);
	assert.equal(parsed.sessions[0].links[0].notes, 'tab note');
	assert.equal(parsed.sessions[1].description, 'Equal');
	// The backup goes to the service worker as is; it does the same merge there.
	assert.equal(sessionImportPayload(parsed), parsed.native?.data);
});
