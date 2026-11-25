import type {Bookmark, BookmarkColumn, Folder, Session} from './types';
import {
	BACKUP_VERSION,
	BOOKMARKS_FORMAT_ID,
	SESSIONS_FORMAT_ID,
	fileNamePrefix,
} from './backup-format';
import {escapeHtml} from './escape-html';

export type ExportFormat = 'json' | 'html' | 'csv' | 'markdown' | 'txt';
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
export const dateStamp = (date: Date) =>
	`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

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

export function bookmarkShareGroups(
	data: ExportData,
): Array<{name: string; tabs: Bookmark[]}> {
	return bookmarkSections(data)
		.filter((section) => section.bookmarks.length > 0)
		.map((section) => ({
			name: section.column?.name ?? 'Unfiled',
			tabs: section.bookmarks,
		}));
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

function toHtml(data: ExportData, appName: string): string {
	const link = (
		url: string,
		title: string,
		created?: number,
		tags?: readonly string[],
	) =>
		`<DT><A HREF="${escapeHtml(url)}"${addDate(created)}${tags?.length ? ` TAGS="${escapeHtml(tags.join(','))}"` : ''}>${escapeHtml(title || url)}</A>`;
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
			const items = bookmarks.map(
				(bookmark) =>
					link(
						bookmark.url,
						bookmark.title,
						bookmark.createdAt,
						bookmark.tags,
					) + (bookmark.notes ? `\n<DD>${escapeHtml(bookmark.notes)}` : ''),
			);
			for (const line of column
				? folder(column.name, column.createdAt, items)
				: items) {
				body.push(line);
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
		rows.push(['title', 'url', 'column', 'notes', 'tags', 'created']);
		for (const {column, bookmarks} of bookmarkSections(data)) {
			for (const bookmark of bookmarks) {
				rows.push([
					bookmark.title,
					bookmark.url,
					column?.name ?? '',
					bookmark.notes ?? '',
					(bookmark.tags ?? []).join(', '),
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

	return `\uFEFF${rows.map((row) => row.map((cell) => csvCell(cell)).join(',')).join('\r\n')}\r\n`;
}

const escapeMarkdown = (value: string) =>
	value
		.replaceAll(/([#*<>[\\\]_`|])/g, String.raw`\$1`)
		.replaceAll(/\s+/g, ' ')
		.trim();
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
					? bookmarks.map(
							(bookmark) =>
								`${markdownLink(bookmark.title, bookmark.url)}${bookmark.notes ? ` — ${escapeMarkdown(bookmark.notes)}` : ''}`,
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
