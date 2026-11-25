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

export function showsInsecureMark(
	url: string,
	settings: {markInsecureLinks?: boolean; markLocalLinks?: boolean},
): boolean {
	return (
		settings.markInsecureLinks !== false &&
		isInsecureLink(url, {markLocal: settings.markLocalLinks === true})
	);
}
