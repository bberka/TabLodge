export type TileRoute = 'save' | 'search';

export function parseTileRoute(
	url: string | null | undefined,
): TileRoute | undefined {
	const match = /^tablodge:\/\/\/?([a-z]+)\/?(?:[#?].*)?$/i.exec(
		url?.trim() ?? '',
	);
	const route = match?.[1]?.toLowerCase();
	return route === 'save' || route === 'search' ? route : undefined;
}

export function parseColumnRoute(
	url: string | null | undefined,
): string | undefined {
	const match = /^tablodge:\/\/column\/([^#/?]+)\/?(?:[#?].*)?$/i.exec(
		url?.trim() ?? '',
	);
	if (!match?.[1]) {
		return undefined;
	}

	try {
		return decodeURIComponent(match[1]);
	} catch {
		return undefined;
	}
}

export function parseImportRoute(
	url: string | null | undefined,
): string | undefined {
	const match = /^tablodge:\/\/import\/?\?(?:[^#]*&)?url=([^#&]*)/i.exec(
		url?.trim() ?? '',
	);
	if (!match) {
		return undefined;
	}

	try {
		const page = decodeURIComponent(match[1].replaceAll('+', ' '));
		return /^https?:\/\/\S+$/i.test(page) ? page : undefined;
	} catch {
		return undefined;
	}
}
