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

export function whenMounted(
	selector: string,
	onSettled: (element: HTMLElement | null) => void,
) {
	let framesLeft = 30;
	const look = () => {
		const element = document.querySelector<HTMLElement>(selector);
		framesLeft -= 1;
		if (element || framesLeft === 0) {
			onSettled(element);
			return;
		}

		frame = requestAnimationFrame(look);
	};

	let frame = requestAnimationFrame(() => {
		frame = requestAnimationFrame(look);
	});
	return () => {
		cancelAnimationFrame(frame);
	};
}
