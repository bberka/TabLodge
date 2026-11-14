/*
React Native's own `URL` is a short imitation made of regular expressions. It cuts a hash route such as
`#inbox/abc` at the slash, rejects an upper case scheme, and does not normalize a host, which broke the link cleaning
that the extension and the app share. The standard implementation replaces it.

Hermes, the JavaScript engine in React Native, does not have the ES2023 copying array methods yet. The code shared
with the extension (`apps/extension/src/shared/`) uses `toSorted`, so a sync round failed on the phone until it existed. `Promise.withResolvers`
is missing too. Each is added only when it is missing.
*/
/* eslint-disable no-extend-native, unicorn/no-array-sort, unicorn/no-array-reverse -- these are the missing methods, built on the copy made here */
// eslint-disable-next-line import-x/no-unassigned-import
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
