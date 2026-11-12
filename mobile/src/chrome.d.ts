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
