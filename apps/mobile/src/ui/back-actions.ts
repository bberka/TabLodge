import {useEffect, useRef} from 'react';

const handlers: Array<() => void> = [];

export function runBackAction(): boolean {
	const latest = handlers.at(-1);
	latest?.();
	return latest !== undefined;
}

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
