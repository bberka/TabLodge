import {useRef, useState} from 'react';

export function useUnchanged<T>(
	value: T,
	isSame: (held: T, next: T) => boolean,
): T {
	const ref = useRef(value);
	if (!isSame(ref.current, value)) {
		ref.current = value;
	}

	return ref.current;
}

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
