export type MoveDirection = 'earlier' | 'later';

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

export function focusAfterMove(selector: string) {
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			document.querySelector<HTMLElement>(selector)?.focus();
		});
	});
}
