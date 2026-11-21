// Where a toast appears and how long it stays, from two settings. Shared by the pages' toast (common.tsx), the
// Sources toast on site pages (source-toast.ts), the quote toast the worker injects, and the Android snackbar. No
// browser APIs: quote-toast.ts is serialized into a page, so it takes the finished values rather than importing this.

export const TOAST_POSITIONS = [
	'default',
	'top-left',
	'top',
	'top-right',
	'bottom-left',
	'bottom',
	'bottom-right',
] as const;
export type ToastPosition = (typeof TOAST_POSITIONS)[number];

export const TOAST_DURATIONS = ['default', 'longer', 'dismiss'] as const;
export type ToastDuration = (typeof TOAST_DURATIONS)[number];

type Place = Exclude<ToastPosition, 'default'>;

/**
The place a surface uses for `Default`: bottom center on TabLodge's pages and for the quote toast, bottom right on
the site pages the Sources toast shows in.
*/
export function toastPlace(position: ToastPosition, fallback: Place): Place {
	return position === 'default' ? fallback : position;
}

export type ToastEdges = {
	top?: string;
	bottom?: string;
	left?: string;
	right?: string;
	/**
	Set for the centered places, which sit at left 50% and shift back by half their width.
	*/
	transform?: string;
	/**
	Where the toasts of a stack line up across the edge: start, center, or end.
	*/
	align: 'flex-start' | 'center' | 'flex-end';
	/**
	A column stacks the newest nearest the edge: at the top it reads upward from the bottom, so it is reversed.
	*/
	reverse: boolean;
};

/**
The fixed-position edges of a toast or a stack of them at `place`, `inset` pixels from the window.
*/
export function toastEdges(place: Place, inset: number): ToastEdges {
	const px = `${inset}px`;
	const [vertical, horizontal] = place.includes('-')
		? (place.split('-') as ['top' | 'bottom', 'left' | 'right'])
		: ([place, 'center'] as ['top' | 'bottom', 'center']);
	const edges: ToastEdges = {
		[vertical]: px,
		align: 'center',
		reverse: vertical === 'top',
	};
	if (horizontal === 'center') {
		edges.left = '50%';
		edges.transform = 'translateX(-50%)';
		return edges;
	}

	edges[horizontal] = px;
	edges.align = horizontal === 'left' ? 'flex-start' : 'flex-end';
	return edges;
}

/**
How long a toast stays: `base` milliseconds, twice as long for Longer, and undefined (never closes by itself) for
Until dismissed.
*/
export function toastMs(base: number, duration: ToastDuration) {
	if (duration === 'dismiss') {
		return undefined;
	}

	return duration === 'longer' ? base * 2 : base;
}
