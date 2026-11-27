export function normalizeExcludedHost(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const text = value.trim().replace(/^([a-z][\d+\-.a-z]*:\/\/)?\*\./i, '$1');
	if (!text || text.length > 2048) {
		return null;
	}

	try {
		const url = new URL(
			/^[a-z][\d+\-.a-z]*:\/\//i.test(text) ? text : `https://${text}`,
		);
		if (!['http:', 'https:'].includes(url.protocol)) {
			return null;
		}

		let host = url.hostname.toLowerCase().replace(/\.$/, '');
		if (host.startsWith('www.') && host.includes('.', 4)) {
			host = host.slice(4);
		}

		return !host.includes('.') && host !== 'localhost' && !host.startsWith('[')
			? null
			: host;
	} catch {
		return null;
	}
}

export function hostIsExcluded(
	host: string,
	entries: readonly string[],
): boolean {
	return entries.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export type ExcludedLines = {
	valid: string[];
	duplicates: string[];
	invalid: string[];
};

export function parseExcludedLines(
	text: string,
	existing: readonly string[],
): ExcludedLines {
	const result: ExcludedLines = {valid: [], duplicates: [], invalid: []};
	const known = new Set(existing);
	const seen = new Set<string>();
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}

		const host = normalizeExcludedHost(trimmed);
		if (!host) {
			result.invalid.push(trimmed);
		} else if (known.has(host)) {
			if (!seen.has(host)) {
				result.duplicates.push(host);
			}
			// eslint-disable-next-line no-empty -- a line repeated in the input is counted once, as new, so this branch adds nothing
		} else if (seen.has(host)) {
		} else {
			result.valid.push(host);
		}

		if (host) {
			seen.add(host);
		}
	}

	return result;
}

export function excludedHostError(value: string): string {
	const text = value.trim();
	if (!text || normalizeExcludedHost(text)) {
		return '';
	}

	return /^[a-z][\d+\-.a-z]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)
		? 'Use an http:// or https:// address.'
		: 'Enter a website such as example.com.';
}
