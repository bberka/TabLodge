// Helpers for web addresses shared by the pages and the import parsers. The service worker is a classic script
// without imports, so it keeps its own copy of `webUrl` (`normalizeUrl`).

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
The host of an address, with its port; the address itself when it cannot be parsed.
*/
export function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/**
The host name without a leading "www." (what a person calls the site); the address itself when it cannot be parsed.
*/
export function siteName(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./i, '');
	} catch {
		return url;
	}
}
