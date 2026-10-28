/**
The address as shown in lists and summaries. With `simplify`, a leading `https://` or `http://` and then `www.` are
dropped, and so is the slash of a bare `/` path (`https://www.icloud.com/mail` becomes `icloud.com/mail`,
`https://github.com/` becomes `github.com`). Insecure http links are flagged by their marker instead. Display only:
stored, copied, opened, and exported addresses are never changed.
*/
export function displayUrl(url: string, simplify = true): string {
	if (!simplify || !/^https?:\/\//i.test(url)) {
		return url;
	}

	const text = url
		.replace(/^https?:\/\//i, '')
		.replace(/^www\./i, '')
		.replace(/^([^#/?]*)\/(?=$|[#?])/, '$1');
	return text || url;
}

const PRIVATE_IPV4 =
	/^(?:127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|0\.0\.0\.0)$/;

/**
True for hosts on this device or a home/office network: `localhost`, `*.localhost`, `*.local`, 127.0.0.0/8, 0.0.0.0, `[::1]`, 10.0.0.0/8, 192.168.0.0/16, and 172.16.0.0/12.
*/
function isLocalHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/, '');
	return (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host === '[::1]' ||
		PRIVATE_IPV4.test(host)
	);
}

/**
True for an `http://` link that deserves the "not secure" marker. Local addresses are trusted and skipped unless `markLocal` is set. Display only.
*/
export function isInsecureLink(
	url: string,
	{markLocal = false}: {markLocal?: boolean} = {},
): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	return (
		parsed.protocol === 'http:' && (markLocal || !isLocalHost(parsed.hostname))
	);
}

/**
Whether a link shows the marker under the user's settings.
*/
export function showsInsecureMark(
	url: string,
	settings: {markInsecureLinks?: boolean; markLocalLinks?: boolean},
): boolean {
	return (
		settings.markInsecureLinks !== false &&
		isInsecureLink(url, {markLocal: settings.markLocalLinks === true})
	);
}
