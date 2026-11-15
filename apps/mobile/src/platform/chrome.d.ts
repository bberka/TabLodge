// The shared model names Chrome's tab group colors in a type. The phone never calls the Chrome API, so only
// that one type is declared.
declare namespace chrome.tabGroups {
	type Color =
		| 'grey'
		| 'blue'
		| 'red'
		| 'yellow'
		| 'green'
		| 'pink'
		| 'purple'
		| 'cyan'
		| 'orange';
}

// The shared normalizer asks `globalThis.chrome?.runtime?.getURL` whether it runs in Firefox. The phone has no
// `chrome`, so that is always false.
declare namespace chrome {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	const runtime: {getURL?: (path: string) => string} | undefined;
}
