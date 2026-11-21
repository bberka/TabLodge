// Pure, so the rule is tested without the app.

/**
The Up button appears once a list is scrolled a screen's height down, and goes again below this share of a screen from
the top, so it does not flicker around the line and close to the top is enough to hide it.
*/
const HIDE_BELOW = 0.35;

/**
Whether the Up button shows at scroll offset `y` on a screen `screenHeight` tall, given whether it showed before.
*/
export function upButtonShows(
	y: number,
	screenHeight: number,
	showing: boolean,
): boolean {
	return y >= screenHeight ? true : showing && y > screenHeight * HIDE_BELOW;
}
