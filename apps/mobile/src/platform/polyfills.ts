/* eslint-disable no-extend-native, unicorn/no-array-sort, unicorn/no-array-reverse -- these are the missing methods, built on the copy made here */
// eslint-disable-next-line import-x/no-unassigned-import -- the package installs the URL class for its side effect
import 'react-native-url-polyfill/auto';

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

if (!('withResolvers' in Promise)) {
	Object.defineProperty(Promise, 'withResolvers', {
		value() {
			let resolve!: (value: unknown) => void;
			let reject!: (reason?: unknown) => void;
			// eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- this is the missing method itself
			const promise = new Promise((resolveIt, rejectIt) => {
				resolve = resolveIt;
				reject = rejectIt;
			});
			return {promise, resolve, reject};
		},
		writable: true,
		configurable: true,
	});
}
