import {useCallback, useRef} from 'react';

/**
A function that keeps its identity across renders but always runs the latest `callback`, so a memoized row can take
it as a prop without going stale or redrawing every time the screen does.
*/
export function useStableCallback<Args extends unknown[], Result>(
	callback: (...args: Args) => Result,
): (...args: Args) => Result {
	const latestRef = useRef(callback);
	latestRef.current = callback;
	return useCallback((...args: Args) => latestRef.current(...args), []);
}
