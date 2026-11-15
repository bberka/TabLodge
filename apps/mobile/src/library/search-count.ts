/*
How a search says how many results it found, as one short phrase that is shown and spoken.
*/

/**
Milliseconds a search count waits for typing to stop before it shows and is announced, so it does not speak on every
keystroke.
*/
export const SEARCH_COUNT_DELAY = 600;

/**
"No results", "1 result", or "12 results".
*/
export function resultCount(count: number): string {
	if (count <= 0) {
		return 'No results';
	}

	return count === 1 ? '1 result' : `${count} results`;
}

/**
The line above the results from the other places. It names the count, so the same words are shown and announced.
*/
export function elsewhereIntro(
	placeName: string,
	localCount: number,
	found: number,
): string {
	if (found === 0) {
		return localCount > 0
			? 'Nothing found elsewhere.'
			: `Nothing in ${placeName} matches, and nothing else does either.`;
	}

	return localCount === 0
		? `Nothing in ${placeName} matches. ${resultCount(found)} found elsewhere:`
		: `${resultCount(found).replace(/ /, ' more ')} found elsewhere:`;
}
