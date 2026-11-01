// Pure builders for every backup/export format (no DOM or chrome.* access), shared by the backup
// dialog and tested in Vitest. JSON is the full, re-importable backup; the others trade fidelity
// for portability (HTML), analysis (CSV) or readability (Markdown, plain URLs).
import {
	BACKUP_VERSION,
	BOOKMARKS_FORMAT_ID,
	SESSIONS_FORMAT_ID,
	fileNamePrefix,
} from './backup-format';
import {escapeHtml} from './escape-html';
import type {Bookmark, BookmarkColumn, Folder, Session} from './types';

export type ExportFormat = 'json' | 'html' | 'csv' | 'markdown' | 'txt';
/**
"selected" is a sessions export limited to the tabs picked on the dashboard.
*/
export type ExportKind = 'sessions' | 'bookmarks' | 'selected';

export type ExportData = {
	kind: ExportKind;
	groups?: Session[];
	folders?: Folder[];
	columns?: BookmarkColumn[];
	bookmarks?: Bookmark[];
};

export type ExportFile = {
	content: string;
	mime: string;
	filename: string;
};

const EXPORT_FORMATS: ReadonlyArray<{
	id: ExportFormat;
	extension: string;
	mime: string;
}> = [
	{id: 'json', extension: 'json', mime: 'application/json'},
	{id: 'html', extension: 'html', mime: 'text/html;charset=utf-8'},
	{id: 'csv', extension: 'csv', mime: 'text/csv;charset=utf-8'},
	{id: 'markdown', extension: 'md', mime: 'text/markdown;charset=utf-8'},
	{id: 'txt', extension: 'txt', mime: 'text/plain;charset=utf-8'},
];

const UNFILED_COLUMN_ID = 'bookmark-unfiled';
const pad = (value: number) => String(value).padStart(2, '0');
/**
Local calendar date as YYYY-MM-DD.
*/
export const dateStamp = (date: Date) =>
	`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
For example `tablodge-sessions-2026-10-25.json`: lower-case display name, what was exported, and the date. A session name is included for individual session exports.
*/
export function exportFilename(
	appName: string,
	kind: ExportKind,
	format: ExportFormat,
	date = new Date(),
	name?: string,
) {
	const extension =
		EXPORT_FORMATS.find((entry) => entry.id === format)?.extension ?? 'txt';
	const what = kind === 'selected' ? 'selected-tabs' : kind;
	const namePart = name?.trim() ? `-${fileNamePrefix(name)}` : '';
	return `${fileNamePrefix(appName)}-${what}${namePart}-${dateStamp(date)}.${extension}`;
}

/**
Sessions and tabs, or columns and bookmarks, in an export.
*/
export function exportCounts(data: ExportData): {
	groups: number;
	items: number;
} {
	if (data.kind === 'bookmarks') {
		return {
			groups: (data.columns ?? []).length,
			items: (data.bookmarks ?? []).length,
		};
	}

	const groups = data.groups ?? [];
	return {
		groups: groups.length,
		items: groups.reduce((sum, group) => sum + group.tabs.length, 0),
	};
}

/**
Bookmark columns in board order with their bookmarks; Unfiled (or unknown-column) bookmarks come last under `null`.
*/
function bookmarkSections(
	data: ExportData,
): Array<{column: BookmarkColumn | null; bookmarks: Bookmark[]}> {
	const columns = data.columns ?? [];
	const known = new Set(columns.map((column) => column.id));
	const bookmarks = data.bookmarks ?? [];
	const sections: Array<{
		column: BookmarkColumn | null;
		bookmarks: Bookmark[];
	}> = columns.map((column) => ({
		column,
		bookmarks: bookmarks.filter((bookmark) => bookmark.columnId === column.id),
	}));
	const loose = bookmarks.filter(
		(bookmark) =>
			bookmark.columnId === UNFILED_COLUMN_ID || !known.has(bookmark.columnId),
	);
	if (loose.length > 0) {
		sections.push({column: null, bookmarks: loose});
	}

	return sections;
}

const seconds = (ms: number | undefined) =>
	ms && Number.isFinite(ms) && ms > 0 ? String(Math.floor(ms / 1000)) : '';
const addDate = (ms: number | undefined) => {
	const value = seconds(ms);
	return value ? ` ADD_DATE="${value}"` : '';
};

const isoDate = (ms: number | undefined) =>
	ms && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : '';

function toJson(data: ExportData, now: Date): string {
	if (data.kind === 'bookmarks') {
		return JSON.stringify(
			{
				format: BOOKMARKS_FORMAT_ID,
				version: BACKUP_VERSION,
				exportedAt: now.toISOString(),
				bookmarkColumns: data.columns ?? [],
				bookmarks: data.bookmarks ?? [],
			},
			null,
			2,
		);
	}

	const groups = data.groups ?? [];
	const folderIds = new Set(groups.map((group) => group.folderId));
	return JSON.stringify(
		{
			format: SESSIONS_FORMAT_ID,
			version: BACKUP_VERSION,
			exportedAt: now.toISOString(),
			folders: (data.folders ?? []).filter((folder) =>
				folderIds.has(folder.id),
			),
			groups,
		},
		null,
		2,
	);
}

// Netscape bookmark file, the format every browser imports. Sessions and columns become folders.
function toHtml(data: ExportData, appName: string): string {
	const link = (url: string, title: string, created?: number) =>
		`<DT><A HREF="${escapeHtml(url)}"${addDate(created)}>${escapeHtml(title || url)}</A>`;
	const folder = (
		name: string,
		created: number | undefined,
		items: string[],
	) => [
		`<DT><H3${addDate(created)}>${escapeHtml(name)}</H3>`,
		'<DL><p>',
		...items.map((item) => `    ${item}`),
		'</DL><p>',
	];
	const body: string[] = [];
	if (data.kind === 'bookmarks') {
		for (const {column, bookmarks} of bookmarkSections(data)) {
			const items = bookmarks.map((bookmark) =>
				link(bookmark.url, bookmark.title, bookmark.createdAt),
			);
			if (column) {
				body.push(...folder(column.name, column.createdAt, items));
			} else {
				body.push(...items);
			}
		}
	} else {
		for (const group of data.groups ?? []) {
			body.push(
				...folder(
					group.name,
					group.createdAt,
					group.tabs.map((tab) => link(tab.url, tab.title, tab.savedAt)),
				),
			);
		}
	}

	return [
		'<!DOCTYPE NETSCAPE-Bookmark-file-1>',
		`<!-- Exported from ${escapeHtml(appName)}. Import it in any browser's bookmark manager. -->`,
		'<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
		'<TITLE>Bookmarks</TITLE>',
		'<H1>Bookmarks</H1>',
		'<DL><p>',
		...body.map((line) => `    ${line}`),
		'</DL><p>',
		'',
	].join('\n');
}

// Spreadsheet-safe cell: quoted when needed, and text that a spreadsheet would run as a formula is
// prefixed with an apostrophe (the importer strips it again).
export function csvCell(value: unknown): string {
	let text = String(value ?? '');
	if (/^[\t\r+\-=@]/.test(text)) {
		text = `'${text}`;
	}

	return /[\n\r",;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(data: ExportData): string {
	const rows: unknown[][] = [];
	if (data.kind === 'bookmarks') {
		rows.push(['title', 'url', 'column', 'notes', 'created']);
		for (const {column, bookmarks} of bookmarkSections(data)) {
			for (const bookmark of bookmarks) {
				rows.push([
					bookmark.title,
					bookmark.url,
					column?.name ?? '',
					'',
					isoDate(bookmark.createdAt),
				]);
			}
		}
	} else {
		const folders = new Map(
			(data.folders ?? [])
				.filter((folder) => !folder.isDefault)
				.map((folder) => [folder.id, folder.name]),
		);
		rows.push(['title', 'url', 'session', 'folder', 'notes', 'created']);
		for (const group of data.groups ?? []) {
			for (const tab of group.tabs) {
				rows.push([
					tab.title,
					tab.url,
					group.name,
					folders.get(group.folderId) ?? '',
					tab.notes,
					isoDate(tab.savedAt || group.createdAt),
				]);
			}
		}
	}

	// A byte-order mark makes spreadsheet apps read the file as UTF-8.
	return `\uFEFF${rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\r\n')}\r\n`;
}

const escapeMarkdown = (value: string) =>
	value
		.replaceAll(/([#*<>[\\\]_`|])/g, String.raw`\$1`)
		.replaceAll(/\s+/g, ' ')
		.trim();
// Web URLs never contain spaces or angle brackets (URL parsing encodes them), so `<url>` is always safe.
const markdownUrl = (url: string) => (/[\s()]/.test(url) ? `<${url}>` : url);
const markdownLink = (title: string, url: string) =>
	`- [${escapeMarkdown(title || url)}](${markdownUrl(url)})`;

function toMarkdown(data: ExportData, appName: string): string {
	const lines: string[] = [];
	if (data.kind === 'bookmarks') {
		lines.push(`# ${escapeMarkdown(appName)} bookmarks`, '');
		for (const {column, bookmarks} of bookmarkSections(data)) {
			lines.push(
				`## ${escapeMarkdown(column?.name ?? 'Unfiled')}`,
				'',
				...(bookmarks.length > 0
					? bookmarks.map((bookmark) =>
							markdownLink(bookmark.title, bookmark.url),
						)
					: ['_No bookmarks_']),
				'',
			);
		}
	} else {
		lines.push(
			`# ${escapeMarkdown(appName)} ${data.kind === 'selected' ? 'selected tabs' : 'sessions'}`,
			'',
		);
		for (const group of data.groups ?? []) {
			lines.push(`## ${escapeMarkdown(group.name)}`, '');
			if (group.description) {
				lines.push(
					...group.description
						.split(/\r?\n/)
						.map((line) => `> ${escapeMarkdown(line)}`.trimEnd()),
					'',
				);
			}

			lines.push(
				...group.tabs.map(
					(tab) =>
						`${markdownLink(tab.title, tab.url)}${tab.notes ? ` — ${escapeMarkdown(tab.notes)}` : ''}`,
				),
				'',
			);
		}
	}

	return `${lines.join('\n').trimEnd()}\n`;
}

function toText(data: ExportData): string {
	const urls =
		data.kind === 'bookmarks'
			? bookmarkSections(data).flatMap((section) =>
					section.bookmarks.map((bookmark) => bookmark.url),
				)
			: (data.groups ?? []).flatMap((group) =>
					group.tabs.map((tab) => tab.url),
				);
	return urls.length > 0 ? `${urls.join('\n')}\n` : '';
}

/**
Builds the file for an export: its text, MIME type, and dated file name.
*/
export function buildExport(
	data: ExportData,
	format: ExportFormat,
	{
		appName,
		now = new Date(),
		name,
	}: {appName: string; now?: Date; name?: string},
): ExportFile {
	const mime =
		EXPORT_FORMATS.find((entry) => entry.id === format)?.mime ??
		'text/plain;charset=utf-8';
	const content =
		format === 'json'
			? toJson(data, now)
			: format === 'html'
				? toHtml(data, appName)
				: format === 'csv'
					? toCsv(data)
					: format === 'markdown'
						? toMarkdown(data, appName)
						: toText(data);
	return {
		content,
		mime,
		filename: exportFilename(appName, data.kind, format, now, name),
	};
}
