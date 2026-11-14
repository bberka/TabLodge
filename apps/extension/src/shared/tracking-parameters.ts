const TRACKING_PARAMETER_NAMES = new Set([
	'_ga',
	'_gl',
	'_hsenc',
	'_hsmi',
	'__hsfp',
	'__hssc',
	'__hstc',
	'dclid',
	'epik',
	'fb_action_ids',
	'fb_action_types',
	'fb_ref',
	'fb_source',
	'fbclid',
	'gad_source',
	'gclsrc',
	'gclid',
	'gbraid',
	'hsctatracking',
	'igsh',
	'igshid',
	'li_fat_id',
	'mc_cid',
	'mc_eid',
	'mkt_tok',
	'msclkid',
	'rb_clickid',
	's_cid',
	'srsltid',
	'ttclid',
	'twclid',
	'vero_conv',
	'vero_id',
	'wbraid',
	'yclid',
]);

/**
Parameters that are only trackers on certain sites. `s` and `t` are generic names, so they are removed on X status links and nowhere else.
*/
const SITE_TRACKING_RULES: ReadonlyArray<{
	hosts: readonly string[];
	path?: RegExp;
	names: ReadonlySet<string>;
}> = [
	{
		hosts: ['x.com', 'twitter.com'],
		path: /\/status(?:es)?\/\d/,
		names: new Set(['s', 't']),
	},
	{
		hosts: ['x.com', 'twitter.com'],
		names: new Set(['ref_src', 'ref_url', 'cxt']),
	},
	{
		hosts: ['youtube.com', 'youtu.be', 'open.spotify.com'],
		names: new Set(['si']),
	},
];

function isTrackingParameter(name: string, url: URL) {
	const normalized = name.toLowerCase();
	return (
		normalized.startsWith('utm_') ||
		TRACKING_PARAMETER_NAMES.has(normalized) ||
		SITE_TRACKING_RULES.some(
			(rule) =>
				rule.names.has(normalized) &&
				rule.hosts.some(
					(host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
				) &&
				(!rule.path || rule.path.test(url.pathname)),
		)
	);
}

/**
Removes common tracking parameters from an HTTP or HTTPS URL, leaving other query values and the fragment intact.
*/
export function stripTrackingParameters(rawUrl: string): string {
	try {
		const url = new URL(rawUrl);
		if (!['http:', 'https:'].includes(url.protocol)) {
			return rawUrl;
		}

		const query = url.search.slice(1).split('&');
		const kept = query.filter((part) => {
			const separator = part.indexOf('=');
			const key = separator === -1 ? part : part.slice(0, separator);
			let name = key;
			try {
				name = decodeURIComponent(key.replaceAll('+', ' '));
			} catch {
				// Keep malformed keys unless their raw form is a known tracker.
			}

			return !isTrackingParameter(name, url);
		});
		if (kept.length === query.length) {
			return rawUrl;
		}

		url.search = kept.length > 0 ? `?${kept.join('&')}` : '';
		return url.href;
	} catch {
		return rawUrl;
	}
}
