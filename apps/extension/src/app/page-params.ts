export function initialSearchQuery(search: string): string {
	const value = new URLSearchParams(search).get('q') ?? '';
	return value
		.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
		.replaceAll(/\s+/g, ' ')
		.trim()
		.slice(0, 200);
}

export const newColumnRequested = (value: string | null | undefined) =>
	value === 'new';

export function paletteWindowId(search: string): number | undefined {
	return requestId(search, 'window');
}

export function paletteTabId(search: string): number | undefined {
	return requestId(search, 'tab');
}

function requestId(search: string, name: string): number | undefined {
	const value = new URLSearchParams(search).get(name);
	const id = value && /^\d{1,10}$/.test(value) ? Number(value) : undefined;
	return id !== undefined && Number.isSafeInteger(id) ? id : undefined;
}

export function paletteOverlay(search: string): boolean {
	return new URLSearchParams(search).get('overlay') === '1';
}

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
