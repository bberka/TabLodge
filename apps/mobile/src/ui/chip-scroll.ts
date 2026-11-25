export const CHIP_EDGE_GAP = 16;

export function chipScrollX(
	chip: {x: number; width: number},
	rowWidth: number,
): number {
	if (rowWidth <= 0) {
		return 0;
	}

	return chip.x + chip.width <= rowWidth
		? 0
		: Math.max(0, chip.x - CHIP_EDGE_GAP);
}
