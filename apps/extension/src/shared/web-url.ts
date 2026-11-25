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

export function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

export function siteName(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./i, '');
	} catch {
		return url;
	}
}
