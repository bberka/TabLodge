const HIDE_BELOW = 0.35;

export function upButtonShows(
	y: number,
	screenHeight: number,
	showing: boolean,
): boolean {
	return y >= screenHeight ? true : showing && y > screenHeight * HIDE_BELOW;
}
