export type SourceLink = {url: string; title: string; discussion?: string};

export type SourceRead =
	{kind: 'save'; link: SourceLink} | {kind: 'unreadable'} | undefined;

export type SourceReader = (event: Event) => SourceRead;

export const savedOrUnreadable = (
	url: string | null | undefined,
	title: string,
): SourceRead =>
	url && title ? {kind: 'save', link: {url, title}} : {kind: 'unreadable'};

const CONTEXT_TTL_MS = 60_000;

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

export function controlLabel(element: Element) {
	return squash(element.getAttribute('aria-label') ?? element.textContent);
}

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

export function excerpt(text: string | null | undefined) {
	const whole = squash(text);
	if (whole.length <= EXCERPT_LENGTH) {
		return whole;
	}

	const cut = whole.slice(0, EXCERPT_LENGTH);
	const space = cut.lastIndexOf(' ');
	return `${(space > EXCERPT_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
