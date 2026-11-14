import type {BookmarkColumnWidth, BookmarkDensity} from '../shared/types';

const MIN_WIDTH_REM: Record<BookmarkColumnWidth, number> = {
	narrow: 14,
	default: 18,
	wide: 24,
	'extra-wide': 32,
};

/**
Space between board columns in rem, matching the grid gap class for each density.
*/
const BOOKMARK_GAP_REM: Record<BookmarkDensity, number> = {
	comfortable: 1,
	compact: 0.5,
};

/**
The Board grid's column template for the width and columns-per-row settings, or undefined when both are
at their defaults and the Dashboard width grid applies. Columns per row is a cap: a narrow container still
fits fewer columns than the cap, so none shrink below the minimum width.
*/
export function bookmarkGridTemplate(
	width: BookmarkColumnWidth,
	perRow: number,
	density: BookmarkDensity,
): string | undefined {
	if (width === 'default' && perRow < 1) {
		return undefined;
	}

	const min = `${MIN_WIDTH_REM[width]}rem`;
	if (perRow < 1) {
		return `repeat(auto-fit, minmax(min(100%, ${min}), 1fr))`;
	}

	const gaps = BOOKMARK_GAP_REM[density] * (perRow - 1);
	return `repeat(auto-fit, minmax(min(100%, max(${min}, calc((100% - ${gaps}rem) / ${perRow}))), 1fr))`;
}
