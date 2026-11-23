import {useCallback, useRef} from 'react';

export function useStableCallback<Args extends unknown[], Result>(
	callback: (...args: Args) => Result,
): (...args: Args) => Result {
	const latestRef = useRef(callback);
	latestRef.current = callback;
	return useCallback((...args: Args) => latestRef.current(...args), []);
}
