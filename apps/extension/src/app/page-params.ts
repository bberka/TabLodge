// Query parameters the dashboard (newtab.html) accepts from the service worker's menus. Pure helpers so
// they can be tested without a page.

/**
`?q=` from the "Search … in TabLodge" selection menu: a trimmed, single-line search query (capped).
*/
export function initialSearchQuery(search: string): string {
	const value = new URLSearchParams(search).get('q') ?? '';
	return value
		.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
		.replaceAll(/\s+/g, ' ')
		.trim()
		.slice(0, 200);
}

/**
`bookmarkColumn=new` (the "New column…" menu item) asks the add-bookmark dialog to create a column.
*/
export const newColumnRequested = (value: string | null | undefined) =>
	value === 'new';

/**
`?window=` on palette.html: the id of the browser window the shortcut was pressed in; undefined when missing or not a whole number.
*/
export function paletteWindowId(search: string): number | undefined {
	const value = new URLSearchParams(search).get('window');
	const id = value && /^\d{1,10}$/.test(value) ? Number(value) : undefined;
	return id !== undefined && Number.isSafeInteger(id) ? id : undefined;
}

/**
`?overlay=1` on palette.html: the palette is shown in a frame over a web page, not in a window of its own.
*/
export function paletteOverlay(search: string): boolean {
	return new URLSearchParams(search).get('overlay') === '1';
}

/**
The current address without the given query parameters, for history.replaceState.
*/
export function stripSearchParams(
	location: Pick<Location, 'pathname' | 'search' | 'hash'>,
	names: string[],
): string {
	const params = new URLSearchParams(location.search);
	for (const name of names) {
		params.delete(name);
	}

	const query = params.toString();
	return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
}

/**
The current address with one query parameter set (or removed when `value` is null), for history.replaceState.
*/
export function withSearchParam(
	location: Pick<Location, 'pathname' | 'search' | 'hash'>,
	name: string,
	value: string | null,
): string {
	const params = new URLSearchParams(location.search);
	if (value) {
		params.set(name, value);
	} else {
		params.delete(name);
	}

	const query = params.toString();
	return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
}
