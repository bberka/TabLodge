export type MoveDirection = 'earlier' | 'later';

/**
The id next to `id` in the given direction, or null at either end (or when `id` is not in the list).
Keyboard users reorder with "Move up" and "Move down" menu items, which are one step in this list.
*/
export function neighborId(
	ids: readonly string[],
	id: string,
	direction: MoveDirection,
): string | null {
	const at = ids.indexOf(id);
	return at === -1
		? null
		: (ids[direction === 'earlier' ? at - 1 : at + 1] ?? null);
}

/**
Moving a node in the DOM drops focus to the page body, so after a reorder redraws the list this puts
focus back on the element that was moved (found by `selector` once React has committed).
*/
export function focusAfterMove(selector: string) {
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			document.querySelector<HTMLElement>(selector)?.focus();
		});
	});
}
