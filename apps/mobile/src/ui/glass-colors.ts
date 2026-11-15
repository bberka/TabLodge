/*
The colors of the iOS look's glass: pure functions, so the contrast of what is drawn on top can be checked in a test.
*/
export type Rgb = [number, number, number];

export const hexRgb = (hex: string): Rgb => [
	Number.parseInt(hex.slice(1, 3), 16),
	Number.parseInt(hex.slice(3, 5), 16),
	Number.parseInt(hex.slice(5, 7), 16),
];

/**
`color` at `alpha` over `under`, as an opaque color.
*/
export const over = (color: Rgb, alpha: number, under: Rgb): Rgb => [
	Math.round(color[0] * alpha + under[0] * (1 - alpha)),
	Math.round(color[1] * alpha + under[1] * (1 - alpha)),
	Math.round(color[2] * alpha + under[2] * (1 - alpha)),
];

const channel = (value: number) => {
	const unit = value / 255;
	return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: Rgb) =>
	0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/**
The WCAG contrast ratio between two opaque colors, from 1 to 21.
*/
export function contrast(a: Rgb, b: Rgb): number {
	const [first, second] = [luminance(a), luminance(b)];
	const [high, low] = [Math.max(first, second), Math.min(first, second)];
	return (high + 0.05) / (low + 0.05);
}

/**
The native blur's own tint, drawn over the blurred content before the fill: a pale or a dark veil, at this share of
full strength (`intensity` / 100) and this alpha.
*/
export const BLUR_INTENSITY = 40;
export const BLUR_VEIL = {
	light: {color: [249, 249, 249] as Rgb, alpha: 0.78 * (BLUR_INTENSITY / 100)},
	dark: {color: [25, 25, 25] as Rgb, alpha: 0.69 * (BLUR_INTENSITY / 100)},
};

/**
How much of the surface color covers the blurred content behind a piece of glass. The search bar holds typed text, so it
is the most covered; the accent button is nearly solid so its icon keeps its contrast.
*/
export const GLASS = {
	bar: 0.55,
	button: 0.55,
	search: 0.7,
	primary: 0.88,
	// With no blur to hide what is behind (an older Android), the glass is nearly opaque.
	unblurred: 0.92,
} as const;

export type GlassKind = keyof typeof GLASS;

/**
What a piece of glass looks like over `back`: the blur's veil, then the fill, as one opaque color.
*/
export function glassOver(
	fill: Rgb,
	kind: GlassKind,
	back: Rgb,
	dark: boolean,
): Rgb {
	const veil = BLUR_VEIL[dark ? 'dark' : 'light'];
	return over(fill, GLASS[kind], over(veil.color, veil.alpha, back));
}

/**
The `rgba()` fill of a piece of glass: the surface color at the kind's cover.
*/
export function glassFill(
	color: string,
	kind: GlassKind,
	blurred: boolean,
): string {
	const [r, g, b] = hexRgb(color);
	const alpha = blurred ? GLASS[kind] : Math.max(GLASS[kind], GLASS.unblurred);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
