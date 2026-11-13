/*
Site icons and link previews, fetched on behalf of a device that asks. The sync server is the one place that can
read a page without handing the page's owner the phone's or the browser's address, and without any third party
learning which links are saved. The token holder is the only caller, but the server still refuses to be pointed at
its own network.
*/

const FETCH_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 256 * 1024;
export const MAX_ICON_BYTES = 128 * 1024;
export const MAX_IMAGE_BYTES = 512 * 1024;
const IMAGE_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'image/x-icon',
	'image/vnd.microsoft.icon',
]);
const USER_AGENT = 'Mozilla/5.0 (compatible; TabLodge link preview)';

export type Preview = {
	title?: string;
	description?: string;
	/**
	The page's share image as a `data:` URL, when it is small enough.
	*/
	image?: string;
};

export type PreviewDeps = {
	fetch?: typeof fetch;
	/**
	Every address a host name points at. The Docker server passes DNS; the Cloudflare runtime cannot reach private
	networks at all, so it passes nothing.
	*/
	resolve?: (host: string) => Promise<string[]>;
};

/**
True for an address that is not on the public internet: loopback, private, link local (cloud metadata), shared
address space, and their IPv6 counterparts.
*/
export function isPrivateAddress(address: string): boolean {
	const text = address.toLowerCase().replaceAll(/^\[|\]$/g, '');
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
	const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(mapped?.[1] ?? text);
	if (v4) {
		const [a = 0, b = 0] = v4.slice(1).map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 192 && b === 0) ||
			a >= 224
		);
	}

	if (text.includes(':')) {
		return (
			text === '::' ||
			text === '::1' ||
			/^f[cd]/.test(text) ||
			/^fe[89ab]/.test(text)
		);
	}

	return false;
}

function isIpLiteral(host: string) {
	return /^\[.*\]$/.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

/**
The URL when it is a plain web address this server may fetch, otherwise undefined.
*/
export async function allowedUrl(
	text: string,
	deps: PreviewDeps = {},
): Promise<URL | undefined> {
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return undefined;
	}

	if (!(url.protocol === 'https:' || url.protocol === 'http:')) {
		return undefined;
	}

	if (url.username || url.password) {
		return undefined;
	}

	const host = url.hostname.toLowerCase();
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		!(host.includes('.') || host.includes(':'))
	) {
		return undefined;
	}

	if (isIpLiteral(host)) {
		return isPrivateAddress(host) ? undefined : url;
	}

	if (deps.resolve) {
		try {
			const addresses = await deps.resolve(host);
			if (
				addresses.length === 0 ||
				addresses.some((address) => isPrivateAddress(address))
			) {
				return undefined;
			}
		} catch {
			return undefined;
		}
	}

	return url;
}

/**
Fetches with a time limit, following a few redirects and checking every hop against the same rules.
*/
async function guardedFetch(
	start: URL,
	deps: PreviewDeps,
	accept: string,
): Promise<{response: Response; url: URL} | undefined> {
	const send = deps.fetch ?? fetch;
	let url = start;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		let response: Response;
		try {
			response = await send(url, {
				redirect: 'manual',
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				headers: new Headers({accept, 'user-agent': USER_AGENT}),
			});
		} catch {
			return undefined;
		}

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			await response.body?.cancel();
			if (!location) {
				return undefined;
			}

			const next = await allowedUrl(new URL(location, url).href, deps);
			if (!next) {
				return undefined;
			}

			url = next;
			continue;
		}

		return response.ok ? {response, url} : undefined;
	}

	return undefined;
}

async function readLimited(
	response: Response,
	max: number,
): Promise<Uint8Array | undefined> {
	const reader = response.body?.getReader();
	if (!reader) {
		return undefined;
	}

	const parts: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const {done, value} = await reader.read();
		if (done) {
			break;
		}

		total += value.length;
		if (total > max) {
			await reader.cancel();
			return undefined;
		}

		parts.push(value);
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}

	return bytes;
}

/**
Reads up to the first part of a page, enough to reach its head, and no more.
*/
async function readHtml(response: Response): Promise<string | undefined> {
	const reader = response.body?.getReader();
	if (!reader) {
		return undefined;
	}

	const decoder = new TextDecoder();
	let text = '';
	let total = 0;
	while (total < MAX_HTML_BYTES) {
		const {done, value} = await reader.read();
		if (done) {
			break;
		}

		total += value.length;
		text += decoder.decode(value, {stream: true});
		if (/<\/head>/i.test(text)) {
			break;
		}
	}

	await reader.cancel().catch(() => undefined);
	return text;
}

function attributes(tag: string): Record<string, string> {
	const found: Record<string, string> = {};
	for (const match of tag.matchAll(
		/([\w\-:]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
	)) {
		found[(match[1] ?? '').toLowerCase()] = decodeEntities(
			match[2] ?? match[3] ?? match[4] ?? '',
		);
	}

	return found;
}

function decodeEntities(text: string) {
	return text
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&apos;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>');
}

export type PageMeta = {
	title?: string;
	description?: string;
	image?: string;
	icon?: string;
};

/**
What a page's head says about itself: its Open Graph or Twitter card, then the plain title and description, and the
icon it links. Addresses are made absolute against the page.
*/
export function readPageMeta(html: string, base: URL): PageMeta {
	const head = html.split(/<\/head>/i, 1)[0] ?? html;
	const meta = new Map<string, string>();
	const icons: Array<{rank: number; href: string}> = [];
	for (const [tag] of head.matchAll(/<(?:meta|link)\b[^>]*>/gi)) {
		const attrs = attributes(tag);
		if (tag.toLowerCase().startsWith('<meta')) {
			const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
			if (key && attrs.content && !meta.has(key)) {
				meta.set(key, attrs.content);
			}
		} else if (attrs.href) {
			const rel = new Set((attrs.rel ?? '').toLowerCase().split(/\s+/));
			if (rel.has('icon')) {
				icons.push({rank: 1, href: attrs.href});
			} else if (rel.has('apple-touch-icon')) {
				icons.push({rank: 2, href: attrs.href});
			}
		}
	}

	const absolute = (value: string | undefined) => {
		if (!value) {
			return undefined;
		}

		try {
			const url = new URL(value, base);
			return url.protocol === 'https:' || url.protocol === 'http:'
				? url.href
				: undefined;
		} catch {
			return undefined;
		}
	};

	const title =
		meta.get('og:title') ??
		meta.get('twitter:title') ??
		(/<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1]
			? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(head)![1].trim())
			: undefined);
	return {
		title: title?.slice(0, 200) || undefined,
		description:
			(
				meta.get('og:description') ??
				meta.get('twitter:description') ??
				meta.get('description')
			)?.slice(0, 400) || undefined,
		image: absolute(meta.get('og:image') ?? meta.get('twitter:image')),
		icon: absolute(icons.toSorted((a, b) => a.rank - b.rank)[0]?.href),
	};
}

async function imageBytes(
	url: URL,
	max: number,
	deps: PreviewDeps,
): Promise<{bytes: Uint8Array; type: string} | undefined> {
	const found = await guardedFetch(url, deps, 'image/*');
	if (!found) {
		return undefined;
	}

	const type = (found.response.headers.get('content-type') ?? '')
		.split(';', 1)[0]
		.trim()
		.toLowerCase();
	const declared = Number(found.response.headers.get('content-length') ?? 0);
	if (!IMAGE_TYPES.has(type) || declared > max) {
		await found.response.body?.cancel();
		return undefined;
	}

	const bytes = await readLimited(found.response, max);
	return bytes && bytes.length > 0 ? {bytes, type} : undefined;
}

function dataUrl(image: {bytes: Uint8Array; type: string}) {
	let binary = '';
	for (let index = 0; index < image.bytes.length; index += 0x80_00) {
		binary += String.fromCodePoint(
			...image.bytes.subarray(index, index + 0x80_00),
		);
	}

	// eslint-disable-next-line no-restricted-globals -- btoa exists in Node and Workers; Buffer does not in Workers.
	return `data:${image.type};base64,${btoa(binary)}`;
}

/**
The title, description, and share image of a page.
*/
export async function fetchPreview(
	text: string,
	deps: PreviewDeps = {},
): Promise<Preview | undefined> {
	const start = await allowedUrl(text, deps);
	if (!start) {
		return undefined;
	}

	const found = await guardedFetch(start, deps, 'text/html');
	if (!found) {
		return undefined;
	}

	const type = found.response.headers.get('content-type') ?? '';
	if (!/html|xml/i.test(type)) {
		await found.response.body?.cancel();
		return undefined;
	}

	const html = await readHtml(found.response);
	if (html === undefined) {
		return undefined;
	}

	const meta = readPageMeta(html, found.url);
	const imageUrl = meta.image ? await allowedUrl(meta.image, deps) : undefined;
	const image = imageUrl
		? await imageBytes(imageUrl, MAX_IMAGE_BYTES, deps)
		: undefined;
	return {
		title: meta.title,
		description: meta.description,
		image: image ? dataUrl(image) : undefined,
	};
}

/**
The icon of a site: the one its home page links, or /favicon.ico.
*/
export async function fetchIcon(
	host: string,
	deps: PreviewDeps = {},
): Promise<{bytes: Uint8Array; type: string} | undefined> {
	const home = await allowedUrl(`https://${host}/`, deps);
	if (!home) {
		return undefined;
	}

	const candidates: URL[] = [];
	const page = await guardedFetch(home, deps, 'text/html');
	if (page && /html/i.test(page.response.headers.get('content-type') ?? '')) {
		const html = await readHtml(page.response);
		const linked = html ? readPageMeta(html, page.url).icon : undefined;
		const url = linked ? await allowedUrl(linked, deps) : undefined;
		if (url) {
			candidates.push(url);
		}
	} else {
		await page?.response.body?.cancel();
	}

	candidates.push(new URL('/favicon.ico', home));
	for (const url of candidates) {
		const image = await imageBytes(url, MAX_ICON_BYTES, deps);
		if (image) {
			return image;
		}
	}

	return undefined;
}
