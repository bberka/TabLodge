/*
Hermes, the JavaScript engine in React Native, does not have the ES2023 copying array methods yet. The code shared
with the extension (`src/shared/`) uses `toSorted`, so a sync round failed on the phone until it existed. Each method
is added only when it is missing.
*/
/* eslint-disable no-extend-native, unicorn/no-array-sort, unicorn/no-array-reverse -- these are the missing methods, built on the copy made here */
if (!('toSorted' in Array.prototype)) {
	Object.defineProperty(Array.prototype, 'toSorted', {
		value(this: unknown[], compare?: (a: unknown, b: unknown) => number) {
			return [...this].sort(compare);
		},
		writable: true,
		configurable: true,
	});
}

if (!('toReversed' in Array.prototype)) {
	Object.defineProperty(Array.prototype, 'toReversed', {
		value(this: unknown[]) {
			return [...this].reverse();
		},
		writable: true,
		configurable: true,
	});
}
