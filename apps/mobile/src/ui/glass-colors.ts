export type Rgb = [number, number, number];

export const hexRgb = (hex: string): Rgb => [
	Number.parseInt(hex.slice(1, 3), 16),
	Number.parseInt(hex.slice(3, 5), 16),
	Number.parseInt(hex.slice(5, 7), 16),
];

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

export function contrast(a: Rgb, b: Rgb): number {
	const [first, second] = [luminance(a), luminance(b)];
	const [high, low] = [Math.max(first, second), Math.min(first, second)];
	return (high + 0.05) / (low + 0.05);
}

export const BLUR_INTENSITY = 40;
export const BLUR_VEIL = {
	light: {color: [249, 249, 249] as Rgb, alpha: 0.78 * (BLUR_INTENSITY / 100)},
	dark: {color: [25, 25, 25] as Rgb, alpha: 0.69 * (BLUR_INTENSITY / 100)},
};

export const GLASS = {
	bar: 0.55,
	button: 0.55,
	search: 0.7,
	primary: 0.88,
	unblurred: 0.92,
} as const;

export type GlassKind = keyof typeof GLASS;

export function glassOver(
	fill: Rgb,
	kind: GlassKind,
	back: Rgb,
	dark: boolean,
): Rgb {
	const veil = BLUR_VEIL[dark ? 'dark' : 'light'];
	return over(fill, GLASS[kind], over(veil.color, veil.alpha, back));
}

export function glassFill(
	color: string,
	kind: GlassKind,
	blurred: boolean,
): string {
	const [r, g, b] = hexRgb(color);
	const alpha = blurred ? GLASS[kind] : Math.max(GLASS[kind], GLASS.unblurred);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
