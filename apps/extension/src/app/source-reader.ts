// What the site adapters share. An adapter looks at a click on the site's page, before the site handles it, and
// says whether it was the user saving something there and, if so, which link. It only reads the DOM.

/**
`discussion` is the item's own page on a site whose items link elsewhere; it goes in the bookmark's note.
*/
export type SourceLink = {url: string; title: string; discussion?: string};

/**
`save`: the user saved this link on the site. `unreadable`: the user saved something, but the page did not have
what the adapter needs to tell which link, so nothing is saved. Undefined: the click was not a save.
*/
export type SourceRead =
	{kind: 'save'; link: SourceLink} | {kind: 'unreadable'} | undefined;

export type SourceReader = (event: Event) => SourceRead;

/**
A save of the link when the page gave both its address and its title, else `unreadable`.
*/
export const savedOrUnreadable = (
	url: string | null | undefined,
	title: string,
): SourceRead =>
	url && title ? {kind: 'save', link: {url, title}} : {kind: 'unreadable'};

/**
A menu or dialog the site opens away from the item it belongs to is matched to the item clicked last, but only
this soon after; an older click is too unsure to save.
*/
const CONTEXT_TTL_MS = 60_000;

/**
The elements an event passed through, innermost first, including inside open shadow roots.
*/
export function eventElements(event: Event): Element[] {
	return event
		.composedPath()
		.filter(
			(target): target is Element =>
				typeof (target as Partial<Element>).matches === 'function',
		);
}

export const squash = (text: string | null | undefined) =>
	(text ?? '').replaceAll(/\s+/g, ' ').trim();

/**
The text a control shows or announces: its aria-label, else its visible text.
*/
export function controlLabel(element: Element) {
	return squash(element.getAttribute('aria-label') ?? element.textContent);
}

/**
Remembers the item the user last clicked in, for menus and dialogs that open outside it.
*/
export function rememberLast<T>(now: () => number) {
	let last: {value: T; at: number} | undefined;
	return {
		set(value: T) {
			last = {value, at: now()};
		},
		get(): T | undefined {
			return last && now() - last.at <= CONTEXT_TTL_MS ? last.value : undefined;
		},
	};
}

const EXCERPT_LENGTH = 100;

/**
The start of a post's text as a title: up to a word boundary near 100 characters, with an ellipsis when cut.
*/
export function excerpt(text: string | null | undefined) {
	const whole = squash(text);
	if (whole.length <= EXCERPT_LENGTH) {
		return whole;
	}

	const cut = whole.slice(0, EXCERPT_LENGTH);
	const space = cut.lastIndexOf(' ');
	return `${(space > EXCERPT_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
