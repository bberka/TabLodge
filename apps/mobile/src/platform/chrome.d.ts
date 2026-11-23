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

declare namespace chrome {
	// eslint-disable-next-line @typescript-eslint/naming-convention -- chrome.runtime is the browser's own lower case name
	const runtime: {getURL?: (path: string) => string} | undefined;
}
