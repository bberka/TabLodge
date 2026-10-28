import {escapeHtml} from './escape-html';
import {webUrl} from './web-url';

export const SESSION_DRAG_TYPE = 'application/x-tablodge-session';
export const COLUMN_DRAG_TYPE = 'application/x-tablodge-column';
export const BOOKMARK_DRAG_TYPE = 'application/x-tablodge-bookmark';
const LINK_DRAG_TYPES = new Set([
	'text/x-moz-url',
	'application/x-moz-url',
	'text/uri-list',
	'text/html',
	'text/plain',
]);
const MAX_SESSION_DROP_LINKS = 500;

export type DragPayloadKind = 'column' | 'bookmark' | 'session' | 'link';
/**
A link that can be dragged, copied, or bookmarked (saved tabs satisfy this).
*/
export type LinkLike = {
	url: string;
	title?: string | null;
};
export type SessionDragData = {
	id: string;
	name: string;
	links: Array<{url: string; title: string}>;
};
/**
The parts of a drag event the document guard reads (a DragEvent satisfies this).
*/
export type DropGuardEvent = {
	defaultPrevented: boolean;
	dataTransfer?: {types?: Iterable<string> | ArrayLike<string> | null} | null;
	target?: EventTarget | {closest?: (selectors: string) => unknown} | null;
};
type ClosestTarget = {closest?: (selectors: string) => unknown};

/**
Reads `value[key]` when `value` is an object, as optional chaining on untyped JSON would.
*/
const field = (value: unknown, key: string): unknown =>
	value !== null && typeof value === 'object'
		? (value as Record<string, unknown>)[key]
		: undefined;

// What a drag carries, judged from its types alone: drag data is unreadable until the drop.
export function dragPayloadKind(
	types: Iterable<string> | ArrayLike<string> | null | undefined,
): DragPayloadKind | null {
	const list = Array.from(types || []);
	if (list.includes(COLUMN_DRAG_TYPE)) {
		return 'column';
	}

	if (list.includes(BOOKMARK_DRAG_TYPE)) {
		return 'bookmark';
	}

	if (list.includes(SESSION_DRAG_TYPE)) {
		return 'session';
	}

	return list.some((type) => LINK_DRAG_TYPES.has(type)) ? 'link' : null;
}

// Document-level guard only; it never saves anything. Valid drop targets (bookmark columns, Unfiled)
// call preventDefault first. Any other link drag gets the "no drop" cursor and a stray drop is
// swallowed so the page does not navigate to the dragged link. Text fields keep native drops.
export function shouldBlockDocumentDrop(
	event: DropGuardEvent | null | undefined,
) {
	if (
		!event ||
		event.defaultPrevented ||
		!dragPayloadKind(event.dataTransfer?.types)
	) {
		return false;
	}

	return !(event.target as ClosestTarget | null | undefined)?.closest?.(
		"input, textarea, [contenteditable]:not([contenteditable='false'])",
	);
}

// Reads the session payload placed by applyLinkDrag. Returns null for anything malformed.
export function parseSessionDragData(raw: unknown): SessionDragData | null {
	let data: unknown;
	try {
		data = JSON.parse(String(raw || ''));
	} catch {
		return null;
	}

	const rawLinks = field(data, 'links');
	const links = (Array.isArray(rawLinks) ? (rawLinks as unknown[]) : [])
		.slice(0, MAX_SESSION_DROP_LINKS)
		.flatMap((link) => {
			const url = webUrl(field(link, 'url'));
			return url
				? [
						{
							url,
							title: String(field(link, 'title') || '')
								.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
								.trim()
								.slice(0, 500),
						},
					]
				: [];
		});
	if (links.length === 0) {
		return null;
	}

	const id = field(data, 'id');
	return {
		id: typeof id === 'string' ? id : '',
		name:
			String(field(data, 'name') || '')
				.trim()
				.slice(0, 120) || 'Saved session',
		links,
	};
}

/**
The one link a dragged or pasted `DataTransfer` carries, or null when it holds no web address. The title is empty
when the source gave none.
*/
export function parseDraggedLink(
	dataTransfer: DataTransfer | null,
): {url: string; title: string} | null {
	if (!dataTransfer) {
		return null;
	}

	let raw = '';
	let title = '';
	const mozUrl =
		dataTransfer.getData('text/x-moz-url') ||
		dataTransfer.getData('application/x-moz-url');
	if (mozUrl) {
		const [url, ...titleParts] = mozUrl.split(/\r?\n/);
		raw = url;
		title = titleParts.join(' ').trim();
	}

	raw ||=
		dataTransfer
			.getData('text/uri-list')
			.split(/\r?\n/)
			.find((line) => line.trim() && !line.trimStart().startsWith('#')) || '';
	if (!raw) {
		const html = dataTransfer.getData('text/html');
		if (html) {
			const anchor = new DOMParser()
				.parseFromString(html, 'text/html')
				.querySelector('a[href]');
			raw = anchor?.getAttribute('href') || '';
			title ||= anchor?.textContent?.trim() || '';
		}
	}

	raw ||= dataTransfer.getData('text/plain').trim();
	const url = webUrl(raw);
	if (!url) {
		return null;
	}

	return {
		url,
		title: title
			.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
			.trim()
			.slice(0, 500),
	};
}

/**
Every link a drop carries: all links of a dragged session, otherwise the single dragged link.
*/
export function parseDroppedLinks(
	dataTransfer: DataTransfer,
): Array<{url: string; title: string}> {
	if (dragPayloadKind(dataTransfer.types) === 'session') {
		return (
			parseSessionDragData(dataTransfer.getData(SESSION_DRAG_TYPE))?.links ?? []
		);
	}

	const link = parseDraggedLink(dataTransfer);
	return link ? [link] : [];
}

export function activateSessionTitle<E, R>(
	action: string | undefined,
	handlers: {
		restore: (event?: E) => R;
		edit: (event?: E) => R;
		toggle: (event?: E) => R;
	},
	event?: E,
): R {
	if (action === 'restore') {
		return handlers.restore(event);
	}

	return action === 'edit' ? handlers.edit(event) : handlers.toggle(event);
}

/**
What writeClipboard puts on the clipboard. `html` is set only for rich text, so callers can write text/html
alongside text/plain.
*/
export type ClipboardContent = {
	text: string;
	html: string | null;
};

/**
The clipboard methods writeClipboard uses (navigator.clipboard satisfies this).
*/
export type ClipboardLike = {
	write?(items: unknown[]): Promise<unknown>;
	writeText(text: string): Promise<unknown>;
};
type ClipboardItemConstructor = new (items: Record<string, Blob>) => unknown;

export async function writeClipboard(
	{text, html}: ClipboardContent,
	clipboard: ClipboardLike = globalThis.navigator?.clipboard,
	ClipboardItemType:
		ClipboardItemConstructor | undefined = globalThis.ClipboardItem,
) {
	if (html && typeof clipboard?.write === 'function' && ClipboardItemType) {
		await clipboard.write([
			new ClipboardItemType({
				'text/html': new Blob([html], {type: 'text/html'}),
				'text/plain': new Blob([text], {type: 'text/plain'}),
			}),
		]);
		return 'rich';
	}

	await clipboard.writeText(text);
	return html ? 'plain' : 'text';
}

// Data placed on a drag so saved tabs or whole sessions can be dropped into documents,
// editors, and chat boxes. A single tab drops as a link; a session (any drag with a name) drops as
// a titled list and also carries SESSION_DRAG_TYPE so TabLodge's own columns can add every link.
export function buildLinkDragData(
	tabs: readonly LinkLike[] | null | undefined,
	name = '',
	sessionId = '',
): Record<string, string> | null {
	const source: readonly LinkLike[] = Array.isArray(tabs) ? tabs : [];
	const items = source.filter((tab) => tab?.url);
	if (items.length === 0) {
		return null;
	}

	const label = (tab: LinkLike) => String(tab.title || tab.url);
	if (items.length === 1 && !name) {
		return {
			'text/uri-list': items[0].url,
			'text/plain': items[0].url,
			'text/html': `<a href="${escapeHtml(items[0].url)}">${escapeHtml(label(items[0]))}</a>`,
		};
	}

	const heading = name ? `${name}\n` : '';
	return {
		...(name && {
			[SESSION_DRAG_TYPE]: JSON.stringify({
				id: String(sessionId || ''),
				name: String(name),
				links: items.map((tab) => ({
					title: String(tab.title || ''),
					url: tab.url,
				})),
			}),
		}),
		'text/uri-list': items.map((tab) => tab.url).join('\r\n'),
		'text/plain': `${heading}${items.map((tab) => `${label(tab)}\n${tab.url}`).join('\n\n')}`,
		'text/html': `${name ? `<h3>${escapeHtml(name)}</h3>` : ''}<ul>${items.map((tab) => `<li><a href="${escapeHtml(tab.url)}">${escapeHtml(label(tab))}</a></li>`).join('')}</ul>`,
	};
}

/**
The DataTransfer members applyLinkDrag writes (a DataTransfer satisfies this).
*/
export type LinkDragTarget = {
	setData(format: string, data: string): void;
	effectAllowed?: DataTransfer['effectAllowed'];
};

export function applyLinkDrag(
	dataTransfer: LinkDragTarget | null | undefined,
	tabs: readonly LinkLike[] | null | undefined,
	name = '',
	sessionId = '',
) {
	const data = buildLinkDragData(tabs, name, sessionId);
	if (!data || !dataTransfer) {
		return false;
	}

	for (const [type, value] of Object.entries(data)) {
		dataTransfer.setData(type, value);
	}

	dataTransfer.effectAllowed = 'copyLink';
	return true;
}
