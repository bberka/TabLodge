import type {DeviceKind} from './device';
import {fold} from './fuzzy';
import {normalizeTag, shownTags} from './bookmark-tags';
import {LINK_KINDS, type LinkKind, linkKind} from './link-kind';
import type {Bookmark, Session} from './types';

export type SearchPlace = 'sessions' | 'bookmarks' | 'tabs' | 'open';

export type SearchQuery = {
	text: string;
	phrases: string[];
	exclude: string[];
	sites: string[];
	places: SearchPlace[];
	kinds: LinkKind[];
	tags: string[];
	columns: string[];
	folders: string[];
	devices: string[];
	after?: number;
	before?: number;
};

export type SearchFacets = {
	places: readonly SearchPlace[];
	urls: ReadonlyArray<string | undefined>;
	tags?: readonly string[];
	column?: string;
	folder?: string;
	date?: number;
	device?: {name?: string; kind?: DeviceKind};
};

export const SEARCH_TIPS: ReadonlyArray<{
	example: string;
	meaning: string;
	browserOnly?: boolean;
}> = [
	{example: '"exact phrase"', meaning: 'Words in this order'},
	{example: '-word', meaning: 'Leave out a word'},
	{example: 'site:github.com', meaning: 'Links on a site'},
	{example: 'in:sessions', meaning: 'Only sessions'},
	{example: 'in:bookmarks', meaning: 'Only bookmarks'},
	{example: 'in:tabs', meaning: 'Only saved tabs'},
	{example: 'in:open', meaning: 'Only open tabs', browserOnly: true},
	{example: 'kind:image', meaning: 'Only links to images'},
	{example: 'kind:pdf', meaning: 'Only links to PDFs'},
	{example: 'kind:video', meaning: 'Only links to videos'},
	{example: 'kind:repo', meaning: 'Only code repositories'},
	{example: 'tag:movie', meaning: 'Bookmarks with a tag'},
	{example: 'col:Work', meaning: 'Bookmarks in a column'},
	{example: 'folder:Work', meaning: 'Sessions in a folder'},
	{example: 'from:phone', meaning: 'Saved on a phone'},
	{example: 'from:computer', meaning: 'Saved on a computer'},
	{example: 'from:"Work laptop"', meaning: 'Saved on a device by name'},
	{example: 'after:2026-01-01', meaning: 'Saved on or after a day'},
	{example: 'before:2026-06-01', meaning: 'Saved before a day'},
];

const PLACES = new Set<string>(['sessions', 'bookmarks', 'tabs', 'open']);
const KINDS = new Set<string>([...LINK_KINDS, 'page']);
const QUOTES = new Set(['"', '“', '”', '„']);

type Token =
	| {kind: 'raw'; value: string}
	| {kind: 'quoted'; prefix: string; body: string}
	| {kind: 'word'; value: string};

function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let current = '';
	let prefix: string | undefined;
	const flush = () => {
		if (current !== '') {
			tokens.push({kind: 'raw', value: current});
		}

		current = '';
	};

	for (const char of input) {
		if (QUOTES.has(char)) {
			if (prefix === undefined) {
				if (current.endsWith(':') || current === '-') {
					prefix = current;
					current = '';
				} else {
					flush();
					prefix = '';
				}
			} else {
				tokens.push({kind: 'quoted', prefix, body: current});
				prefix = undefined;
				current = '';
			}
		} else if (prefix === undefined && /\s/.test(char)) {
			flush();
		} else {
			current += char;
		}
	}

	if (prefix === undefined) {
		flush();
	} else {
		for (const value of `${prefix}${current}`.split(/\s+/)) {
			if (value !== '') {
				tokens.push({kind: 'word', value});
			}
		}
	}

	return tokens;
}

function dayStart(value: string): number | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) {
		return undefined;
	}

	const [year, month, day] = match.slice(1).map(Number);
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year &&
		date.getMonth() === month - 1 &&
		date.getDate() === day
		? date.getTime()
		: undefined;
}

function siteHost(value: string): string | undefined {
	const host = value
		.toLowerCase()
		.replace(/^[a-z][\d+\-.a-z]*:\/\//, '')
		.replace(/^www\./, '')
		.split(/[#/?]/, 1)[0];
	return /^[^\s@]+$/.test(host) && /[\p{Letter}\p{Number}]/u.test(host)
		? host
		: undefined;
}

export function parseSearchQuery(input: string): SearchQuery {
	const query: SearchQuery = {
		text: input,
		phrases: [],
		exclude: [],
		sites: [],
		places: [],
		kinds: [],
		tags: [],
		columns: [],
		folders: [],
		devices: [],
	};
	const words: string[] = [];
	let changed = false;
	for (const token of tokenize(input)) {
		changed ||= token.kind !== 'raw';
		if (token.kind === 'word') {
			words.push(token.value);
			continue;
		}

		if (token.kind === 'quoted') {
			const body = fold(token.body).trim();
			if (body === '') {
				continue;
			}

			if (token.prefix === '') {
				query.phrases.push(body);
			} else if (token.prefix === '-') {
				query.exclude.push(body);
			} else if (!operator(query, token.prefix.slice(0, -1), token.body)) {
				words.push(...token.body.split(/\s+/));
			}

			continue;
		}

		const {value} = token;
		const colon = value.indexOf(':');
		if (value.startsWith('-') && fold(value.slice(1)).trim() !== '') {
			query.exclude.push(fold(value.slice(1)).trim());
		} else if (
			colon <= 0 ||
			!operator(query, value.slice(0, colon), value.slice(colon + 1))
		) {
			words.push(value);
			continue;
		}

		changed = true;
	}

	if (changed) {
		query.text = words.join(' ');
	}

	return query;
}

function operator(query: SearchQuery, name: string, raw: string): boolean {
	const value = raw.trim();
	if (value === '') {
		return false;
	}

	const key = name.toLowerCase();
	switch (key) {
		case 'site': {
			const host = siteHost(value);
			if (host) {
				query.sites.push(host);
			}

			return host !== undefined;
		}

		case 'kind': {
			const kind = value.toLowerCase();
			if (KINDS.has(kind)) {
				query.kinds.push(kind as LinkKind);
			}

			return KINDS.has(kind);
		}

		case 'tag': {
			const tag = normalizeTag(value);
			if (tag) {
				query.tags.push(tag);
			}

			return tag !== undefined;
		}

		case 'in': {
			const place = value.toLowerCase();
			if (PLACES.has(place)) {
				query.places.push(place as SearchPlace);
			}

			return PLACES.has(place);
		}

		case 'col':
		case 'folder':
		case 'from': {
			const list = {
				col: query.columns,
				folder: query.folders,
				from: query.devices,
			};
			list[key].push(fold(value));
			return true;
		}

		case 'after':
		case 'before': {
			const day = dayStart(value);
			if (day !== undefined) {
				query[key] = day;
			}

			return day !== undefined;
		}

		default: {
			return false;
		}
	}
}

export const hasOperators = (query: SearchQuery) =>
	query.phrases.length > 0 ||
	query.exclude.length > 0 ||
	query.sites.length > 0 ||
	query.places.length > 0 ||
	query.kinds.length > 0 ||
	query.tags.length > 0 ||
	query.columns.length > 0 ||
	query.folders.length > 0 ||
	query.devices.length > 0 ||
	query.after !== undefined ||
	query.before !== undefined;

const hostOf = (url: string | undefined) => {
	const match = /^[a-z][\d+\-.a-z]*:\/\/(?:[^#/?@]*@)?([^#/:?]+)/i.exec(
		url ?? '',
	);
	return match?.[1].toLowerCase().replace(/^www\./, '');
};

function savedOn(value: string, device: SearchFacets['device']): boolean {
	return value === 'phone' || value === 'computer'
		? device?.kind === (value === 'phone' ? 'mobile' : 'desktop')
		: device?.name !== undefined && fold(device.name).includes(value);
}

export function passesOperators(
	query: SearchQuery,
	texts: ReadonlyArray<string | undefined>,
	facets: SearchFacets,
): boolean {
	if (
		(query.places.length > 0 &&
			facets.places.every((place) => !query.places.includes(place))) ||
		(query.columns.length > 0 &&
			query.columns.every(
				(name) => !fold(facets.column ?? '\0').includes(name),
			)) ||
		(query.folders.length > 0 &&
			query.folders.every(
				(name) => !fold(facets.folder ?? '\0').includes(name),
			)) ||
		query.tags.some((tag) => !facets.tags?.includes(tag)) ||
		(query.devices.length > 0 &&
			query.devices.every((value) => !savedOn(value, facets.device))) ||
		((query.after !== undefined || query.before !== undefined) &&
			(facets.date === undefined ||
				facets.date < (query.after ?? -Infinity) ||
				facets.date >= (query.before ?? Infinity))) ||
		(query.kinds.length > 0 &&
			facets.urls.every(
				(url) => url === undefined || !query.kinds.includes(linkKind(url)),
			))
	) {
		return false;
	}

	if (query.sites.length > 0) {
		const hosts = facets.urls.map((url) => hostOf(url));
		const onSite = query.sites.some((site) =>
			hosts.some((host) => host === site || host?.endsWith(`.${site}`)),
		);
		if (!onSite) {
			return false;
		}
	}

	if (query.phrases.length === 0 && query.exclude.length === 0) {
		return true;
	}

	const haystack = fold([...texts, ...facets.urls].join('\n'));
	return (
		query.phrases.every((phrase) => haystack.includes(phrase)) &&
		query.exclude.every((word) => !haystack.includes(word))
	);
}

export const sessionFacets = (
	session: Session,
	folder: string | undefined,
): SearchFacets => ({
	places: ['sessions', 'tabs'],
	urls: session.tabs.map((tab) => tab.url),
	folder,
	date: session.createdAt,
	device: {name: session.deviceName, kind: session.deviceKind},
});

export const bookmarkFacets = (
	bookmark: Bookmark,
	column: string | undefined,
): SearchFacets => ({
	places: ['bookmarks'],
	urls: [bookmark.url],
	tags: shownTags(bookmark),
	column,
	date: bookmark.createdAt,
	device: {name: bookmark.deviceName, kind: bookmark.deviceKind},
});

export function highlightWords(input: string): string {
	const query = parseSearchQuery(input);
	return [query.text, ...query.phrases].join(' ');
}

export function literalQuery(text: string, max = 200): string {
	const plain = text
		.replaceAll(/["“”„]/g, ' ')
		.replaceAll(/\s+/g, ' ')
		.trim()
		.slice(0, max)
		.trim();
	return hasOperators(parseSearchQuery(plain))
		? `"${plain.slice(0, max - 2).trim()}"`
		: plain;
}

export const tagOperator = (tag: string) =>
	/\s/.test(tag) ? `tag:"${tag}"` : `tag:${tag}`;

export function toggleTagFilter(input: string, tag: string): string {
	if (!parseSearchQuery(input).tags.includes(tag)) {
		return [input.trim(), tagOperator(tag)].filter(Boolean).join(' ');
	}

	return input
		.replaceAll(
			/(?:^|\s)(tag:(?:["“„][^"“”„]*["“”]|[^\s"“”„]+))|["“„][^"“”„]*["“”]?/gi,
			(match, filter?: string) =>
				filter && parseSearchQuery(filter).tags.includes(tag) ? '' : match,
		)
		.replaceAll(/\s+/g, ' ')
		.trim();
}
