// Pure helpers for the excluded-websites list. An entry is a bare host name that covers the host and all of its
// subdomains. The service worker keeps its own copy of the normalizer and the matcher (it is a classic script
// without imports); tests/excluded-sites.test.ts runs both against the same table.

/**
An entry as a lower-case host name, or null when it is not a usable web host. Accepts "google.com", "*.google.com",
"https://google.com:8080/path" and old stored origins; a leading "www." is dropped.
*/
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

/**
True when `host` is an entry or one of its subdomains ("mail.google.com" for "google.com", not "notgoogle.com").
*/
export function hostIsExcluded(
	host: string,
	entries: readonly string[],
): boolean {
	return entries.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export type ExcludedLines = {
	/**
	New, distinct hosts to add, in input order.
	*/
	valid: string[];
	/**
	Hosts that are already excluded (or repeated in the input), once each.
	*/
	duplicates: string[];
	/**
	Non-empty lines that are not a usable website, as typed.
	*/
	invalid: string[];
};

/**
Sorts the lines of the bulk box: new hosts, ones already excluded, and lines to ignore. Blank lines are skipped.
*/
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
		} else if (seen.has(host)) {
			// Repeated within the input: counted once as new, not again.
		} else {
			result.valid.push(host);
		}

		if (host) {
			seen.add(host);
		}
	}

	return result;
}

/**
One-line message for the single-site field: why the text cannot be used, or '' when it can.
*/
export function excludedHostError(value: string): string {
	const text = value.trim();
	if (!text || normalizeExcludedHost(text)) {
		return '';
	}

	return /^[a-z][\d+\-.a-z]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)
		? 'Use an http:// or https:// address.'
		: 'Enter a website such as example.com.';
}
