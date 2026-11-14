import {useEffect, useRef} from 'react';

const handlers: Array<() => void> = [];

/**
Runs the most recent back action, if a screen has one waiting. True when one ran, so the app knows Back was used.
*/
export function runBackAction(): boolean {
	const latest = handlers.at(-1);
	latest?.();
	return latest !== undefined;
}

/**
While `active`, Android's Back button runs `action` instead of leaving the screen or the app, such as ending a
selection. The newest active screen gets Back first.
*/
export function useBackAction(active: boolean, action: () => void): void {
	const latestRef = useRef(action);
	latestRef.current = action;
	useEffect(() => {
		if (!active) {
			return;
		}

		const handler = () => {
			latestRef.current();
		};

		handlers.push(handler);
		return () => {
			const index = handlers.indexOf(handler);
			if (index !== -1) {
				handlers.splice(index, 1);
			}
		};
	}, [active]);
}
