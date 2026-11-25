export const CHIP_EDGE_GAP = 16;

export function chipScrollX(
	chip: {x: number; width: number},
	rowWidth: number,
): number {
	if (rowWidth <= 0 || chip.x + chip.width <= rowWidth) {
		return 0;
	}

	const gap = Math.max(0, Math.min(CHIP_EDGE_GAP, rowWidth - chip.width));
	return Math.max(0, chip.x - gap);
}
