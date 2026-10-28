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

function isTrackingParameter(name: string) {
	const normalized = name.toLowerCase();
	return (
		normalized.startsWith('utm_') || TRACKING_PARAMETER_NAMES.has(normalized)
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

			return !isTrackingParameter(name);
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
