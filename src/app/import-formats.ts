// Pure parsers for every importable file format. No DOM, chrome.* or network access: input is the
// file's text, output is plain data, so the module runs in pages and in Vitest alike.
//
// Every format is reduced to groups of links (a session, a bookmark folder, a OneTab group, a Toby
// list…). Native backups are also passed through untouched so a JSON restore keeps everything the
// service worker understands (notes, split pairs, folders, column order).
//
import {
	BACKUP_VERSION,
	BOOKMARKS_FORMAT_ID,
	SESSIONS_FORMAT_ID,
} from './backup-format';

// Safety: only http/https URLs survive, titles are stripped of control characters and capped, the
// input size is limited, and HTML is tokenized as text (never parsed into a live document).

/**
Largest file the import accepts, in bytes (also checked against the text length).
*/
export const MAX_IMPORT_BYTES = 45 * 1024 * 1024;
/**
Links read from one file; anything beyond is reported as skipped.
*/
export const MAX_IMPORT_LINKS = 50_000;
/**
Matches the service worker's per-session cap; larger groups are split into numbered parts.
*/
const MAX_TABS_PER_SESSION = 1000;
const MAX_TITLE = 500;
const MAX_GROUP_NAME = 120;
const MAX_NOTES = 10_000;

export type ImportKind = 'sessions' | 'bookmarks';
export type ImportFormatId =
	| 'backup'
	| 'netscape-html'
	| 'csv'
	| 'markdown'
	| 'url-list'
	| 'onetab'
	| 'session-buddy'
	| 'tab-session-manager'
	| 'toby'
	| 'json-links';
/**
How well a format's structure is known: checked against the tool's source or real files, or a best-effort reading.
*/
export type FormatConfidence = 'verified' | 'best-effort';

export type ImportLink = {
	url: string;
	title: string;
	notes?: string;
	createdAt?: number;
	pinned?: boolean;
};
/**
A session, bookmark folder or list. An empty `name` means "no group" (the default column, or a generic session name).
*/
export type ImportGroup = {
	name: string;
	folder?: string;
	description?: string;
	notes?: string;
	createdAt?: number;
	links: ImportLink[];
};

export type ParsedImport = {
	format: ImportFormatId;
	/**
	Human-readable format name, for example "OneTab export".
	*/
	label: string;
	confidence: FormatConfidence;
	/**
	The file's content as sessions (groups of tabs).
	*/
	sessions: ImportGroup[];
	/**
	The file's content as bookmark folders; `name: ""` holds links without a folder.
	*/
	bookmarks: ImportGroup[];
	/**
	Rows or entries that were skipped: non-web links, malformed rows, or over the size limit.
	*/
	invalid: number;
	/**
	Notes about the file, for example that it holds bookmarks but no sessions.
	*/
	warnings: string[];
	/**
	For native backups: the parsed JSON, sent to the importer as is (keeps everything).
	*/
	native?: {data: unknown; sessions: boolean; bookmarks: boolean};
};

export class ImportFormatError extends Error {}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asArray = (value: unknown): unknown[] =>
	Array.isArray(value) ? value : [];
const text = (value: unknown) =>
	typeof value === 'string'
		? value
		: typeof value === 'number'
			? String(value)
			: '';

/**
An http(s) URL in canonical form, or null. Mirrors the service worker's normalizeUrl.
*/
export function webUrl(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const raw = value.trim();
	if (!raw || raw.length > 16_384) {
		return null;
	}

	try {
		const url = new URL(raw);
		return url.protocol === 'http:' || url.protocol === 'https:'
			? url.href
			: null;
	} catch {
		return null;
	}
}

/**
Plain one-line text: control and zero-width characters removed, whitespace collapsed, length capped.
*/
export function cleanTitle(value: unknown, max = MAX_TITLE): string {
	return text(value)
		.replaceAll(
			/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2064\uFEFF]/g,
			' ',
		)
		.replaceAll(/\s+/g, ' ')
		.trim()
		.slice(0, max);
}

const cleanNotes = (value: unknown) =>
	text(value)
		.replaceAll('\u0000', '')
		.replaceAll(/\r\n?/g, '\n')
		.trim()
		.slice(0, MAX_NOTES);

/**
Epoch milliseconds from seconds, milliseconds, or a date string; undefined when unusable.
*/
export function toTimestamp(value: unknown): number | undefined {
	if (value == null || value === '') {
		return undefined;
	}

	const number =
		typeof value === 'number'
			? value
			: /^\s*\d+(?:\.\d+)?\s*$/.test(text(value))
				? Number(value)
				: NaN;
	let ms = Number.isFinite(number)
		? number < 1e11
			? number * 1000
			: number < 1e14
				? number
				: number / 1000
		: Date.parse(text(value));
	if (!Number.isFinite(ms) || ms <= 0) {
		return undefined;
	}

	ms = Math.round(ms);
	// Ignore obviously wrong dates (before 1995 or far in the future).
	return ms > 788_918_400_000 && ms < 4_102_444_800_000 ? ms : undefined;
}

// Collects links with the shared limits and counts what was skipped.
class Collector {
	invalid = 0;
	total = 0;
	link(
		rawUrl: unknown,
		rawTitle?: unknown,
		extra: Omit<ImportLink, 'url' | 'title'> = {},
	): ImportLink | null {
		const url = webUrl(rawUrl);
		if (!url) {
			this.invalid += 1;
			return null;
		}

		if (this.total >= MAX_IMPORT_LINKS) {
			this.invalid += 1;
			return null;
		}

		this.total += 1;
		const link: ImportLink = {url, title: cleanTitle(rawTitle)};
		if (extra.notes) {
			const notes = cleanNotes(extra.notes);
			if (notes) {
				link.notes = notes;
			}
		}

		if (extra.createdAt) {
			link.createdAt = extra.createdAt;
		}

		if (extra.pinned) {
			link.pinned = true;
		}

		return link;
	}

	/**
	Counts an entry that is not a usable link and returns null in its place.
	*/
	skip(): null {
		this.invalid += 1;
		return null;
	}

	links(entries: Iterable<ImportLink | null>) {
		return [...entries].filter((entry): entry is ImportLink => entry !== null);
	}
}

function group(
	name: unknown,
	links: ImportLink[],
	extra: Omit<ImportGroup, 'name' | 'links'> = {},
): ImportGroup {
	const created: ImportGroup = {name: cleanTitle(name, MAX_GROUP_NAME), links};
	if (extra.folder) {
		created.folder = cleanTitle(extra.folder, 60);
	}

	if (extra.description) {
		created.description = cleanTitle(extra.description);
	}

	if (extra.notes) {
		created.notes = cleanNotes(extra.notes);
	}

	if (extra.createdAt) {
		created.createdAt = extra.createdAt;
	}

	return created;
}

/**
Splits groups over the service worker's per-session limit into numbered parts and drops empty ones.
*/
function sessionSized(groups: ImportGroup[]): ImportGroup[] {
	return groups.flatMap((entry) => {
		if (entry.links.length === 0) {
			return [];
		}

		if (entry.links.length <= MAX_TABS_PER_SESSION) {
			return [entry];
		}

		const parts: ImportGroup[] = [];
		for (
			let index = 0;
			index < entry.links.length;
			index += MAX_TABS_PER_SESSION
		) {
			parts.push({
				...entry,
				name: `${entry.name || 'Imported tabs'} (${parts.length + 1})`,
				links: entry.links.slice(index, index + MAX_TABS_PER_SESSION),
			});
		}

		return parts;
	});
}

function result(
	format: ImportFormatId,
	label: string,
	confidence: FormatConfidence,
	groups: ImportGroup[],
	collector: Collector,
	extra: Partial<ParsedImport> = {},
): ParsedImport {
	const nonEmpty = groups.filter((entry) => entry.links.length);
	return {
		format,
		label,
		confidence,
		sessions: sessionSized(nonEmpty),
		bookmarks: nonEmpty,
		invalid: collector.invalid,
		warnings: [],
		...extra,
	};
}

// ---------------------------------------------------------------- JSON formats

function parseNative(data: unknown, collector: Collector): ParsedImport | null {
	// Recognized by structure, not by the `format` id, so backups written under any id import.
	const record = isObject(data) ? data : null;
	const groups = Array.isArray(data) ? data : asArray(record?.groups);
	const looksLikeSessions =
		groups.length > 0 &&
		groups.every((entry) => isObject(entry) && Array.isArray(entry.tabs));
	const hasBookmarks = Boolean(
		record &&
		(Array.isArray(record.bookmarks) || Array.isArray(record.bookmarkColumns)),
	);
	const hasTabsList = Boolean(record && Array.isArray(record.tabs));
	const emptyBackup = Boolean(
		record && Array.isArray(record.groups) && Array.isArray(record.folders),
	);
	if (!looksLikeSessions && !hasBookmarks && !hasTabsList && !emptyBackup) {
		return null;
	}

	const folders = new Map(
		asArray(record?.folders)
			.filter(isObject)
			.map((folder) => [text(folder.id), cleanTitle(folder.name, 60)] as const),
	);
	const sourceGroups =
		hasTabsList && groups.length === 0
			? [{name: record?.groupName ?? record?.listName, tabs: record?.tabs}]
			: groups;
	const sessions = sourceGroups.filter(isObject).map((entry) => {
		const createdAt = toTimestamp(entry.createdAt ?? entry.timestamp);
		const links = collector.links(
			asArray(entry.tabs).map((tab) =>
				isObject(tab)
					? collector.link(tab.url ?? tab.href, tab.title ?? tab.name, {
							notes: text(tab.notes),
							createdAt: toTimestamp(tab.savedAt ?? tab.timestamp),
							pinned: tab.pinned === true,
						})
					: collector.skip(),
			),
		);
		const folderName = folders.get(text(entry.folderId));
		return group(entry.name ?? entry.title, links, {
			folder:
				folderName && text(entry.folderId) !== 'unfiled'
					? folderName
					: undefined,
			description: text(entry.description),
			notes: text(entry.notes),
			createdAt,
		});
	});

	const columns = asArray(record?.bookmarkColumns).filter(isObject);
	const byColumn = new Map<string, ImportGroup>(
		columns.map((column) => [
			text(column.id),
			group(
				column.isDefault === true || column.id === 'bookmark-default'
					? column.name || 'Bookmarks'
					: column.name,
				[],
				{createdAt: toTimestamp(column.createdAt)},
			),
		]),
	);
	const loose = group('', []);
	for (const entry of asArray(record?.bookmarks)) {
		if (!isObject(entry)) {
			collector.invalid += 1;
			continue;
		}

		const link = collector.link(
			entry.url ?? entry.href,
			entry.title ?? entry.name,
			{createdAt: toTimestamp(entry.createdAt)},
		);
		if (link) {
			(byColumn.get(text(entry.columnId)) ?? loose).links.push(link);
		}
	}

	const bookmarks = [...byColumn.values(), loose].filter(
		(entry) => entry.links.length,
	);
	const hasSessionData = sessions.some((entry) => entry.links.length);
	const hasBookmarkData = bookmarks.length > 0;
	const out = result(
		'backup',
		hasBookmarkData && !hasSessionData
			? 'Bookmarks backup (JSON)'
			: hasSessionData && !hasBookmarkData
				? 'Sessions backup (JSON)'
				: 'Backup (JSON)',
		'verified',
		[],
		collector,
	);
	out.sessions = sessionSized(
		hasSessionData
			? sessions
			: bookmarks.map((entry) => ({...entry, name: entry.name || 'Bookmarks'})),
	);
	out.bookmarks = hasBookmarkData
		? bookmarks
		: sessions.filter((entry) => entry.links.length);
	out.native = {
		data,
		sessions: hasSessionData,
		bookmarks: hasBookmarkData || columns.length > 0,
	};
	return out;
}

// Session Buddy: v4 "nxs.json.v2" (collections → folders → links, epoch ms) and v3 "nxs.json.v1"
// (sessions → windows → tabs, ISO dates). Aliases of either shape are accepted.
function parseSessionBuddy(
	data: unknown,
	collector: Collector,
): ParsedImport | null {
	if (!isObject(data)) {
		return null;
	}

	const format = text(data.format);
	const collections = asArray(
		data.collections ?? (format.startsWith('nxs') ? data.sessions : undefined),
	);
	const v3 = asArray(data.sessions);
	const looksV4 = collections.some(
		(entry) =>
			isObject(entry) &&
			(Array.isArray(entry.folders) || Array.isArray(entry.windows)),
	);
	const looksV3 = v3.some(
		(entry) => isObject(entry) && Array.isArray(entry.windows),
	);
	if (!format.startsWith('nxs.json') && !looksV4 && !looksV3) {
		return null;
	}

	const source = looksV4 ? collections : v3;
	const groups = source.filter(isObject).map((entry, index) => {
		const windows = asArray(entry.folders ?? entry.windows);
		const links = collector.links(
			windows
				.flatMap((window) =>
					isObject(window) ? asArray(window.links ?? window.tabs) : [],
				)
				.map((tab) =>
					isObject(tab)
						? collector.link(tab.url, tab.title ?? tab.titleOriginal)
						: collector.skip(),
				),
		);
		const fallback =
			entry.type === 'current'
				? 'Session Buddy: open tabs'
				: entry.type === 'previous'
					? 'Session Buddy: previous session'
					: `Session Buddy ${index + 1}`;
		return group(text(entry.title ?? entry.name) || fallback, links, {
			createdAt: toTimestamp(entry.created ?? entry.generated ?? entry.updated),
		});
	});
	return result(
		'session-buddy',
		'Session Buddy export',
		'verified',
		groups,
		collector,
	);
}

/**
Tab Session Manager stores lazily loaded tabs as an extension page that carries the real URL in `url=`.
*/
function unwrapTsmUrl(value: unknown): {url: unknown; title?: string} {
	const raw = text(value);
	if (
		!/^(?:moz|chrome|ms-browser)-extension:\/\/[^/]+\/replaced\/(?:index|replaced)\.html/i.test(
			raw,
		)
	) {
		return {url: raw};
	}

	try {
		const params = new URL(raw).searchParams;
		let url = params.get('url') ?? '';
		if (url.startsWith('about:reader?')) {
			url =
				new URLSearchParams(url.slice('about:reader?'.length)).get('url') ??
				url;
		}

		return {url, title: params.get('title') ?? undefined};
	} catch {
		return {url: raw};
	}
}

// Tab Session Manager: an array of sessions; `windows` maps windowId → tabId → tabs.Tab.
function parseTabSessionManager(
	data: unknown,
	collector: Collector,
): ParsedImport | null {
	const sessions = Array.isArray(data)
		? data
		: isObject(data) && Array.isArray(data.sessions)
			? data.sessions
			: [];
	const looks = sessions.some(
		(entry) =>
			isObject(entry) &&
			isObject(entry.windows) &&
			('tabsNumber' in entry ||
				'sessionStartTime' in entry ||
				'windowsNumber' in entry ||
				'tag' in entry),
	);
	if (!looks) {
		return null;
	}

	const groups = sessions.filter(isObject).map((entry, index) => {
		const windows = isObject(entry.windows) ? Object.values(entry.windows) : [];
		const tabs = windows.flatMap((window) =>
			isObject(window)
				? Object.values(window)
						.filter(isObject)
						.toSorted((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0))
				: [],
		);
		const links = collector.links(
			tabs.map((tab) => {
				const real = unwrapTsmUrl(tab.url);
				return collector.link(real.url, tab.title || real.title);
			}),
		);
		const tags = Array.isArray(entry.tag)
			? entry.tag
					.map((tag) => text(tag))
					.filter(
						(tag) =>
							tag && tag !== 'auto' && tag !== 'winClose' && tag !== 'regular',
					)
					.join(', ')
			: '';
		return group(
			text(entry.name) || `Tab Session Manager ${index + 1}`,
			links,
			{
				createdAt: toTimestamp(entry.date),
				description: tags ? `Tags: ${tags}` : '',
			},
		);
	});
	return result(
		'tab-session-manager',
		'Tab Session Manager export',
		'verified',
		groups,
		collector,
	);
}

// Toby: `{ version, lists: [{ title, cards: [{ title, url, customTitle, customDescription }] }] }`;
// newer exports wrap lists in `groups` (spaces). Any object with a `cards` array is read as a list.
function parseToby(data: unknown, collector: Collector): ParsedImport | null {
	const lists: Array<{list: Json; space: string}> = [];
	const visit = (value: unknown, space: string, depth: number) => {
		if (depth > 4) {
			return;
		}

		for (const entry of asArray(value)) {
			if (!isObject(entry)) {
				continue;
			}

			if (Array.isArray(entry.cards)) {
				lists.push({list: entry, space});
			} else if (Array.isArray(entry.lists)) {
				visit(
					entry.lists,
					cleanTitle(entry.name ?? entry.title, 60),
					depth + 1,
				);
			}
		}
	};

	if (Array.isArray(data)) {
		visit(data, '', 0);
	} else if (isObject(data)) {
		visit(data.lists, '', 0);
		visit(data.groups, '', 0);
		visit(data.spaces, '', 0);
	}

	if (lists.length === 0) {
		return null;
	}

	const confidence: FormatConfidence =
		isObject(data) && Array.isArray(data.lists) ? 'verified' : 'best-effort';
	const groups = lists.map(({list, space}, index) => {
		const links = collector.links(
			asArray(list.cards).map((card) =>
				isObject(card)
					? collector.link(card.url, text(card.customTitle) || card.title, {
							notes: text(card.customDescription),
						})
					: collector.skip(),
			),
		);
		const name = text(list.title ?? list.name) || `Toby list ${index + 1}`;
		return group(space ? `${space} / ${name}` : name, links);
	});
	return result('toby', 'Toby export', confidence, groups, collector);
}

// A bare JSON array of links (`[{ url, title }]` or `["https://…"]`).
function parseJsonLinks(
	data: unknown,
	collector: Collector,
): ParsedImport | null {
	if (
		!Array.isArray(data) ||
		data.length === 0 ||
		data.some(
			(entry) =>
				!(
					typeof entry === 'string' ||
					(isObject(entry) && ('url' in entry || 'href' in entry))
				),
		)
	) {
		return null;
	}

	const links = collector.links(
		data.map((entry) =>
			typeof entry === 'string'
				? collector.link(entry)
				: isObject(entry)
					? collector.link(entry.url ?? entry.href, entry.title ?? entry.name, {
							notes: text(entry.notes),
						})
					: null,
		),
	);
	return result(
		'json-links',
		'JSON list of links',
		'verified',
		[group('', links)],
		collector,
	);
}

function parseJson(data: unknown): ParsedImport {
	for (const parser of [
		parseSessionBuddy,
		parseTabSessionManager,
		parseToby,
		parseNative,
		parseJsonLinks,
	]) {
		const collector = new Collector();
		const parsed = parser(data, collector);
		if (parsed) {
			return parsed;
		}
	}

	throw new ImportFormatError(
		'This JSON file isn’t a format we recognize. Supported: backups from this extension, Session Buddy, Tab Session Manager, and Toby.',
	);
}

// ---------------------------------------------------------------- HTML (Netscape bookmark file)

const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	'#39': "'",
};
export function decodeEntities(value: string): string {
	return value.replaceAll(
		/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi,
		(match, entity: string) => {
			const lower = entity.toLowerCase();
			if (lower.startsWith('#x') || lower.startsWith('#')) {
				const code = lower.startsWith('#x')
					? Number.parseInt(lower.slice(2), 16)
					: Number.parseInt(lower.slice(1), 10);
				return Number.isFinite(code) &&
					code > 0 &&
					code <= 0x10_ff_ff &&
					!(code >= 0xd8_00 && code <= 0xdf_ff)
					? String.fromCodePoint(code)
					: '';
			}

			return NAMED_ENTITIES[lower] ?? match;
		},
	);
}

function attributes(source: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const match of source.matchAll(
		/([:a-z_][\w\-.:]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
	)) {
		attrs[match[1].toLowerCase()] = decodeEntities(
			match[2] ?? match[3] ?? match[4] ?? '',
		);
	}

	return attrs;
}

/**
 Reads a Netscape bookmark file (what every browser exports) or any HTML page with links, as text.
 `<H3>` folders nest through `<DL>` lists; `<DD>` after a link is its description. Scripts, styles and
 comments are dropped before tokenizing, and nothing is ever handed to an HTML parser.
 */
function parseHtml(source: string): ParsedImport {
	const collector = new Collector();
	const html = source
		.replaceAll(/<!--[\s\S]*?-->/g, ' ')
		.replaceAll(
			/<(script|style|template|noscript|iframe|object)\b[\s\S]*?<\/\1\s*>/gi,
			' ',
		);
	const isNetscape = /<!doctype\s+netscape-bookmark-file/i.test(html);
	const groups = new Map<string, ImportGroup>();
	const path: string[] = [];
	let pendingFolder: {name: string; createdAt?: number} | null = null;
	let capture: {
		kind: 'a' | 'h3' | 'dd';
		text: string;
		attrs: Record<string, string>;
	} | null = null;
	let lastLink: ImportLink | null = null;
	const groupFor = (names: string[]) => {
		const key = names.filter(Boolean).join(' / ');
		let entry = groups.get(key);
		if (!entry) {
			entry = group(key, []);
			groups.set(key, entry);
		}

		return entry;
	};

	const finish = () => {
		if (!capture) {
			return;
		}

		const content = cleanTitle(decodeEntities(capture.text));
		if (capture.kind === 'h3') {
			pendingFolder = {
				name: content || 'Untitled folder',
				createdAt: toTimestamp(capture.attrs.add_date),
			};
		} else if (capture.kind === 'a') {
			const link = collector.link(capture.attrs.href, content, {
				createdAt: toTimestamp(capture.attrs.add_date),
			});
			lastLink = link;
			if (link) {
				const entry = groupFor(path);
				if (
					path.length > 0 &&
					!entry.createdAt &&
					pendingCreated.get(path.join(' / '))
				) {
					entry.createdAt = pendingCreated.get(path.join(' / '));
				}

				entry.links.push(link);
			}
		} else if (capture.kind === 'dd' && lastLink && content) {
			lastLink.notes = cleanNotes(decodeEntities(capture.text));
		}

		capture = null;
	};

	const pendingCreated = new Map<string, number | undefined>();
	for (const match of html.matchAll(
		/<(\/?)([a-z][0-9a-z]*)([^>]*)>|([^<]+)/gi,
	)) {
		const [, closing, rawTag, rest, content] = match;
		if (content !== undefined) {
			if (capture) {
				capture.text += content;
			}

			continue;
		}

		const tag = rawTag.toLowerCase();
		if (capture?.kind === 'dd' && !closing && tag !== 'br') {
			finish();
		}

		if (!closing && tag === 'a') {
			finish();
			capture = {kind: 'a', text: '', attrs: attributes(rest)};
			continue;
		}

		if (closing && tag === 'a') {
			if (capture?.kind === 'a') {
				finish();
			}

			continue;
		}

		if (!closing && tag === 'h3') {
			finish();
			capture = {kind: 'h3', text: '', attrs: attributes(rest)};
			continue;
		}

		if (closing && tag === 'h3') {
			if (capture?.kind === 'h3') {
				finish();
			}

			continue;
		}

		if (!closing && tag === 'dd') {
			finish();
			capture = {kind: 'dd', text: '', attrs: {}};
			continue;
		}

		if (!closing && tag === 'dl') {
			finish();
			// Finish() may have set the pending folder, which control-flow narrowing cannot see.
			const folder = pendingFolder as {name: string; createdAt?: number} | null;
			if (folder) {
				path.push(folder.name);
				pendingCreated.set(path.join(' / '), folder.createdAt);
				pendingFolder = null;
			} else {
				path.push('');
			}

			continue;
		}

		if (closing && tag === 'dl') {
			finish();
			path.pop();
			continue;
		}

		if (
			!closing &&
			['dt', 'p', 'li', 'div'].includes(tag) &&
			capture?.kind !== 'a' &&
			capture?.kind !== 'h3'
		) {
			finish();
		}
	}

	finish();
	// Netscape files wrap everything in one unnamed top-level <DL>; its path segment is "" and is dropped.
	const merged = new Map<string, ImportGroup>();
	for (const entry of groups.values()) {
		const name = entry.name.split(' / ').filter(Boolean).join(' / ');
		const target = merged.get(name);
		if (target) {
			target.links.push(...entry.links);
		} else {
			merged.set(name, {...entry, name});
		}
	}

	const list = [...merged.values()];
	if (list.every((entry) => entry.links.length === 0) && !collector.invalid) {
		throw new ImportFormatError('This HTML file has no links.');
	}

	return result(
		'netscape-html',
		isNetscape ? 'Browser bookmark file (HTML)' : 'Web page with links (HTML)',
		isNetscape ? 'verified' : 'best-effort',
		list.map((entry) => ({...entry, name: entry.name})),
		collector,
	);
}

// ---------------------------------------------------------------- Text formats

/**
RFC 4180 rows: quoted fields may contain the delimiter, quotes ("") and line breaks.
*/
export function parseCsvRows(source: string, delimiter: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let index = 0; index < source.length; index += 1) {
		const char = source[index];
		if (quoted) {
			if (char === '"') {
				if (source[index + 1] === '"') {
					field += '"';
					index += 1;
				} else {
					quoted = false;
				}
			} else {
				field += char;
			}
		} else if (char === '"' && field === '') {
			quoted = true;
		} else if (char === delimiter) {
			row.push(field);
			field = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && source[index + 1] === '\n') {
				index += 1;
			}

			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += char;
		}
	}

	if (field || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

const CSV_COLUMNS = {
	url: ['url', 'link', 'href', 'address', 'web address', 'uri'],
	title: ['title', 'name', 'page title', 'bookmark'],
	group: [
		'session',
		'column',
		'group',
		'list',
		'collection',
		'category',
		'window',
	],
	folder: ['folder', 'path', 'tags'],
	notes: ['notes', 'note', 'description', 'comment', 'comments'],
	created: [
		'created',
		'date',
		'created date',
		'date added',
		'added',
		'add date',
		'created at',
		'createdat',
		'savedat',
		'saved at',
		'timestamp',
	],
} as const;

function csvHeader(cells: string[]) {
	const names = cells.map((cell) =>
		cell.trim().toLowerCase().replaceAll(/[-_]+/g, ' '),
	);
	const find = (options: readonly string[]) =>
		names.findIndex((name) => options.includes(name));
	return {
		url: find(CSV_COLUMNS.url),
		title: find(CSV_COLUMNS.title),
		group: find(CSV_COLUMNS.group),
		folder: find(CSV_COLUMNS.folder),
		notes: find(CSV_COLUMNS.notes),
		created: find(CSV_COLUMNS.created),
	};
}

// Exports guard spreadsheet formulas with a leading apostrophe; it is removed again here.
const unguard = (value: string) =>
	/^'[\t\r+\-=@]/.test(value) ? value.slice(1) : value;

function detectDelimiter(firstLine: string) {
	const counts = [',', ';', '\t'].map(
		(delimiter) => [delimiter, firstLine.split(delimiter).length - 1] as const,
	);
	return counts.toSorted((a, b) => b[1] - a[1])[0];
}

function parseCsv(source: string): ParsedImport | null {
	const firstLine = source.split(/\r?\n/, 1)[0];
	const [delimiter, count] = detectDelimiter(firstLine);
	if (!count) {
		return null;
	}

	const rows = parseCsvRows(source, delimiter);
	const header = csvHeader(rows[0] ?? []);
	if (header.url < 0) {
		return null;
	}

	const collector = new Collector();
	const groups = new Map<string, ImportGroup>();
	// With both a session/column and a folder column, the folder is the session's folder; otherwise
	// the folder (or path/tags) column names the group.
	const groupIndex = header.group >= 0 ? header.group : header.folder;
	const folderIndex = header.group >= 0 ? header.folder : -1;
	for (const cells of rows.slice(1)) {
		const cell = (index: number) =>
			index >= 0 ? unguard(cells[index] ?? '').trim() : '';
		const link = collector.link(cell(header.url), cell(header.title), {
			notes: cell(header.notes),
			createdAt: toTimestamp(cell(header.created)),
		});
		if (!link) {
			continue;
		}

		const name = cleanTitle(cell(groupIndex), MAX_GROUP_NAME);
		const folder = cell(folderIndex);
		const key = JSON.stringify([name, folder]);
		let entry = groups.get(key);
		if (!entry) {
			entry = group(name, [], {folder});
			groups.set(key, entry);
		}

		if (
			link.createdAt &&
			(!entry.createdAt || link.createdAt < entry.createdAt)
		) {
			entry.createdAt = link.createdAt;
		}

		entry.links.push(link);
	}

	return result(
		'csv',
		'Spreadsheet (CSV)',
		'verified',
		[...groups.values()],
		collector,
	);
}

// OneTab "Export URLs": `url | title` per line, groups separated by blank lines, no header.
const ONETAB_LINE = /^([a-z][+\-.0-9a-z]*:\S+)(?: \| ?(.*))?$/i;
function parseOneTab(lines: string[]): ParsedImport {
	const collector = new Collector();
	const groups: ImportGroup[] = [];
	let current: ImportLink[] = [];
	const close = () => {
		if (current.length > 0) {
			groups.push(group(`OneTab group ${groups.length + 1}`, current));
		}

		current = [];
	};

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			close();
			continue;
		}

		const match = ONETAB_LINE.exec(trimmed);
		if (!match) {
			collector.invalid += 1;
			continue;
		}

		const link = collector.link(match[1], match[2] ?? '');
		if (link) {
			current.push(link);
		}
	}

	close();
	if (groups.length === 1) {
		groups[0].name = 'OneTab';
	}

	return result('onetab', 'OneTab export', 'verified', groups, collector);
}

// A Markdown list of links, grouped by headings (the Markdown export of this extension reads back).
// `[title](url)` or `[title](<url>)`; the angle-bracket form allows parentheses inside the URL.
const MARKDOWN_LINK =
	/^\s*(?:[*+\-]|\d+[).])\s+\[((?:\\.|[^\\\]])*)\]\(\s*(?:<([^\s>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)(.*)$/;
function parseMarkdown(lines: string[]): ParsedImport {
	const collector = new Collector();
	const groups: ImportGroup[] = [];
	let current = group('', []);
	groups.push(current);
	for (const line of lines) {
		const heading = /^\s*#{2,6}\s+(.+?)\s*#*\s*$/.exec(line);
		if (heading) {
			current = group(heading[1].replaceAll(/\\(.)/g, '$1'), []);
			groups.push(current);
			continue;
		}

		const match = MARKDOWN_LINK.exec(line);
		if (!match) {
			if (/^\s*[*+\-]\s+\S/.test(line) && !/^\s{2,}/.test(line)) {
				collector.invalid += 1;
			}

			continue;
		}

		const notes = match[4].replace(/^\s*[-–—]\s*/, '').trim();
		const link = collector.link(
			match[2] ?? match[3],
			match[1].replaceAll(/\\(.)/g, '$1'),
			{notes},
		);
		if (link) {
			current.links.push(link);
		}
	}

	return result('markdown', 'Markdown list', 'verified', groups, collector);
}

// One link per line. The first http(s) URL on a line is the link; the rest of the line, if any, its title.
function parseUrlList(lines: string[]): ParsedImport {
	const collector = new Collector();
	const links: ImportLink[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		const match = /https?:\/\/[^\s"'<>|]+/i.exec(trimmed);
		if (!match) {
			collector.invalid += 1;
			continue;
		}

		const url = match[0].replace(/[),.;]+$/, '');
		const title = (
			trimmed.slice(0, match.index) +
			' ' +
			trimmed.slice(match.index + match[0].length)
		).replaceAll(/^[\s,\-:;|–—]+|[\s,\-:;|–—]+$/g, '');
		const link = collector.link(url, title);
		if (link) {
			links.push(link);
		}
	}

	return result(
		'url-list',
		'Plain URL list',
		'verified',
		[group('', links)],
		collector,
	);
}

// ---------------------------------------------------------------- Entry point

/**
 Detects the format of an import file and parses it. Throws ImportFormatError with a readable
 message when the file is empty, too large, or not a supported format.
 */
export function parseImportFile(source: string, filename = ''): ParsedImport {
	if (source.length > MAX_IMPORT_BYTES) {
		throw new ImportFormatError('This file is larger than 45 MB.');
	}

	const content = source.replace(/^\uFEFF/, '');
	const trimmed = content.trim();
	if (!trimmed) {
		throw new ImportFormatError('This file is empty.');
	}

	const extension = filename.toLowerCase().split('.').pop() ?? '';
	if (/^[[{]/.test(trimmed)) {
		let data: unknown;
		try {
			data = JSON.parse(trimmed);
		} catch {
			if (extension === 'json') {
				throw new ImportFormatError('This file isn’t valid JSON.');
			}

			data = undefined;
		}

		if (data !== undefined) {
			return withEmptyCheck(parseJson(data));
		}
	}

	if (
		/^<|<!doctype|<a\s[^>]*href\s*=/i.test(trimmed.slice(0, 4096)) ||
		extension === 'html' ||
		extension === 'htm'
	) {
		return withEmptyCheck(parseHtml(content));
	}

	const lines = content.split(/\r\n?|\n/);
	if (
		extension === 'csv' ||
		extension === 'tsv' ||
		/^\s*"?[ \-a-z_]+"?\s*[\t,;]/i.test(lines[0] ?? '')
	) {
		const csv = parseCsv(content);
		if (csv) {
			return withEmptyCheck(csv);
		}

		if (extension === 'csv' || extension === 'tsv') {
			throw new ImportFormatError(
				'This CSV file needs a header row with a “url” column.',
			);
		}
	}

	const nonEmpty = lines.filter((line) => line.trim());
	if (
		nonEmpty.some((line) => MARKDOWN_LINK.test(line)) &&
		nonEmpty.filter((line) => MARKDOWN_LINK.test(line)).length >=
			nonEmpty.filter((line) => /https?:\/\//i.test(line)).length / 2
	) {
		return withEmptyCheck(parseMarkdown(lines));
	}

	const oneTabLines = nonEmpty.filter(
		(line) => line.includes(' | ') && ONETAB_LINE.test(line.trim()),
	).length;
	return withEmptyCheck(
		oneTabLines && oneTabLines >= nonEmpty.length / 2
			? parseOneTab(lines)
			: parseUrlList(lines),
	);
}

function withEmptyCheck(parsed: ParsedImport): ParsedImport {
	const links =
		parsed.bookmarks.reduce((sum, entry) => sum + entry.links.length, 0) +
		parsed.sessions.reduce((sum, entry) => sum + entry.links.length, 0);
	if (!links) {
		throw new ImportFormatError(
			parsed.invalid
				? `No web links found in this ${parsed.label}. ${parsed.invalid} ${parsed.invalid === 1 ? 'entry was' : 'entries were'} skipped (only http and https links can be imported).`
				: `This ${parsed.label} has no links.`,
		);
	}

	if (parsed.native && !parsed.native.sessions && parsed.native.bookmarks) {
		parsed.warnings.push('This backup holds bookmarks only.');
	}

	if (parsed.native && parsed.native.sessions && !parsed.native.bookmarks) {
		parsed.warnings.push('This backup holds sessions only.');
	}

	return parsed;
}

/**
Reads browser bookmarks (chrome.bookmarks.getTree output) as folders, the same way the service worker imports them.
*/
export type BookmarkTreeNode = {
	id?: string;
	title?: string;
	url?: string;
	children?: BookmarkTreeNode[];
	dateAdded?: number;
};
export function parseBookmarkTree(roots: BookmarkTreeNode[]): ParsedImport {
	const collector = new Collector();
	const groups = new Map<string, ImportGroup>();
	let processed = 0;
	const visit = (node: BookmarkTreeNode, path: string[]) => {
		if (!node || processed >= 10_000) {
			return;
		}

		processed += 1;
		if (typeof node.url === 'string') {
			const link = collector.link(node.url, node.title, {
				createdAt: toTimestamp(node.dateAdded),
			});
			if (!link) {
				return;
			}

			const key = path.join(' / ');
			let entry = groups.get(key);
			if (!entry) {
				entry = group(key, []);
				groups.set(key, entry);
			}

			entry.links.push(link);
			return;
		}

		const next =
			node.id === '0' || !node.title
				? path
				: [...path, cleanTitle(node.title, 60) || 'Bookmarks'];
		for (const child of node.children ?? []) {
			visit(child, next);
		}
	};

	for (const root of roots) {
		visit(root, []);
	}

	return result(
		'netscape-html',
		'This browser’s bookmarks',
		'verified',
		[...groups.values()],
		collector,
	);
}

// ---------------------------------------------------------------- Preview and payloads

export type ImportPreview = {
	/**
	Sessions, or bookmark folders that become columns.
	*/
	groups: number;
	/**
	Tabs or bookmarks.
	*/
	links: number;
	/**
	Links already saved, or repeated within the file.
	*/
	duplicates: number;
	/**
	Skipped while reading (non-web or malformed).
	*/
	invalid: number;
	/**
	Pinned tabs the importer leaves out because Settings excludes pinned tabs (never for a TabLodge export).
	*/
	pinnedSkipped: number;
	sample: Array<{title: string; url: string; group: string}>;
};

export type PreviewOptions = {
	existingUrls: Iterable<string>;
	includePinned?: boolean;
	/**
	Bookmark imports into a single column count one group.
	*/
	singleColumn?: boolean;
	sampleSize?: number;
};

export function previewImport(
	parsed: ParsedImport,
	kind: ImportKind,
	{
		existingUrls,
		includePinned = false,
		singleColumn = false,
		sampleSize = 40,
	}: PreviewOptions,
): ImportPreview {
	const groups = kind === 'sessions' ? parsed.sessions : parsed.bookmarks;
	const existing = new Set(existingUrls);
	const seen = new Set<string>();
	let duplicates = 0;
	let links = 0;
	let pinnedSkipped = 0;
	// A TabLodge export keeps its pinned tabs; the setting only filters other formats.
	const keepPinned = includePinned || Boolean(parsed.native?.sessions);
	const sample: ImportPreview['sample'] = [];
	for (const entry of groups) {
		for (const link of entry.links) {
			if (kind === 'sessions' && link.pinned && !keepPinned) {
				pinnedSkipped += 1;
				continue;
			}

			links += 1;
			if (existing.has(link.url) || seen.has(link.url)) {
				duplicates += 1;
			}

			seen.add(link.url);
			if (sample.length < sampleSize) {
				sample.push({
					title: link.title || link.url,
					url: link.url,
					group: entry.name,
				});
			}
		}
	}

	const named = groups.filter(
		(entry) => entry.links.length > 0 && (kind === 'sessions' || entry.name),
	).length;
	return {
		groups: kind === 'bookmarks' && singleColumn ? 1 : named,
		links,
		duplicates,
		invalid: parsed.invalid,
		pinnedSkipped,
		sample,
	};
}

/**
The message payload for IMPORT_SESSIONS: the native backup when it has sessions, else converted groups.
*/
export function sessionImportPayload(
	parsed: ParsedImport,
	fallbackName = 'Imported tabs',
): unknown {
	if (parsed.native?.sessions) {
		return parsed.native.data;
	}

	const folders = new Map<string, string>();
	const groups = parsed.sessions.map((entry) => {
		let folderId: string | undefined;
		if (entry.folder) {
			folderId =
				folders.get(entry.folder) ?? `import-folder-${folders.size + 1}`;
			folders.set(entry.folder, folderId);
		}

		return {
			name: entry.name || fallbackName,
			...(folderId && {folderId}),
			...(entry.description && {description: entry.description}),
			...(entry.notes && {notes: entry.notes}),
			...(entry.createdAt && {createdAt: entry.createdAt}),
			tabs: entry.links.map((link) => ({
				url: link.url,
				title: link.title,
				...(link.notes && {notes: link.notes}),
				...(link.createdAt && {savedAt: link.createdAt}),
			})),
		};
	});
	return {
		format: SESSIONS_FORMAT_ID,
		version: BACKUP_VERSION,
		folders: [...folders].map(([name, id]) => ({id, name})),
		groups,
	};
}

/**
The message payload for IMPORT_BOOKMARKS_FILE: the native backup when it has bookmarks, else folders as columns.
*/
export function bookmarkImportPayload(parsed: ParsedImport): unknown {
	if (parsed.native?.bookmarks) {
		return parsed.native.data;
	}

	const bookmarkColumns: Array<{id: string; name: string}> = [];
	const bookmarks: Array<{
		url: string;
		title: string;
		columnId?: string;
		createdAt?: number;
	}> = [];
	for (const entry of parsed.bookmarks) {
		let columnId: string | undefined;
		if (entry.name) {
			columnId = `import-column-${bookmarkColumns.length + 1}`;
			bookmarkColumns.push({id: columnId, name: entry.name.slice(0, 60)});
		}

		for (const link of entry.links) {
			bookmarks.push({
				url: link.url,
				title: link.title,
				...(columnId && {columnId}),
				...(link.createdAt && {createdAt: link.createdAt}),
			});
		}
	}

	return {
		format: BOOKMARKS_FORMAT_ID,
		version: BACKUP_VERSION,
		bookmarkColumns,
		bookmarks,
	};
}
