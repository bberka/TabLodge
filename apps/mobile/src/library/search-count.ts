export const SEARCH_COUNT_DELAY = 600;

export function resultCount(count: number): string {
	if (count <= 0) {
		return 'No results';
	}

	return count === 1 ? '1 result' : `${count} results`;
}

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
