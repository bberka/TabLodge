/**
What a Quick Settings tile asks the app to open.
*/
export type TileRoute = 'save' | 'search';

/**
Reads the address a tile opens the app with, `tablodge://save` or `tablodge://search`. Any other address, including
one with a different scheme, is not a tile's and gives undefined.
*/
export function parseTileRoute(
	url: string | null | undefined,
): TileRoute | undefined {
	const match = /^tablodge:\/\/\/?([a-z]+)\/?(?:[#?].*)?$/i.exec(
		url?.trim() ?? '',
	);
	const route = match?.[1]?.toLowerCase();
	return route === 'save' || route === 'search' ? route : undefined;
}

/**
Reads the address the Bookmarks widget's header opens, `tablodge://column/<id>` with the id URI-encoded, and gives the
column id. Any other address gives undefined.
*/
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

/**
Reads the address a shared page's Open in the TabLodge app button opens, `tablodge://import?url=<page>`, and gives
the page's web address. Any other address, or one without a web `url`, gives undefined.
*/
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
