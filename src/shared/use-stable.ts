import {useRef, useState} from 'react';

/**
Returns an object with the same functions as `latest` that never changes identity and always calls the newest ones.
*/
export function useStableCallbacks<
	T extends Record<string, (...args: never[]) => unknown>,
>(latest: T): T {
	const ref = useRef(latest);
	ref.current = latest;
	const [stable] = useState(
		() =>
			Object.fromEntries(
				Object.keys(latest).map((key) => [
					key,
					(...args: unknown[]) =>
						(ref.current[key] as (...a: unknown[]) => unknown)(...args),
				]),
			) as unknown as T,
	);
	return stable;
}
