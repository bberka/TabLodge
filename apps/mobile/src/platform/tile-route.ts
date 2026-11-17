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
