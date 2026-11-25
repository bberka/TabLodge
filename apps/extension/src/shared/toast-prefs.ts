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

export function toastPlace(position: ToastPosition, fallback: Place): Place {
	return position === 'default' ? fallback : position;
}

export type ToastEdges = {
	top?: string;
	bottom?: string;
	left?: string;
	right?: string;
	transform?: string;
	align: 'flex-start' | 'center' | 'flex-end';
	reverse: boolean;
};

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

export function toastMs(base: number, duration: ToastDuration) {
	if (duration === 'dismiss') {
		return undefined;
	}

	return duration === 'longer' ? base * 2 : base;
}
