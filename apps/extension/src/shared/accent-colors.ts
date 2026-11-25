export const ACCENTS = [
	{id: 'red', label: 'Red', hex: '#dc2626'},
	{id: 'orange', label: 'Orange', hex: '#c2410c'},
	{id: 'amber', label: 'Amber', hex: '#d97706'},
	{id: 'green', label: 'Green', hex: '#15803d'},
	{id: 'teal', label: 'Teal', hex: '#0f766e'},
	{id: 'cyan', label: 'Cyan', hex: '#0891b2'},
	{id: 'blue', label: 'Blue', hex: '#2563eb'},
	{id: 'violet', label: 'Violet', hex: '#7c3aed'},
	{id: 'pink', label: 'Pink', hex: '#db2777'},
	{id: 'rose', label: 'Rose', hex: '#be123c'},
	{id: 'slate', label: 'Slate', hex: '#475569'},
] as const;

export const DEFAULT_ACCENT = 'default';
export const DEFAULT_ACCENT_HEX = '#6254d7';
export const SYSTEM_ACCENT = 'system';
export const ACCENT_MIRROR_KEY = 'tablodge.uiAccent';

export type Rgb = [number, number, number];

const PRESET_IDS = new Set<unknown>(ACCENTS.map(({id}) => id));
const HEX_COLOR = /^#[\da-f]{6}$/;
export const isCustomAccent = (value: unknown): value is string =>
	typeof value === 'string' && HEX_COLOR.test(value);
export const isAccent = (value: unknown): value is string =>
	value === DEFAULT_ACCENT ||
	value === SYSTEM_ACCENT ||
	PRESET_IDS.has(value) ||
	isCustomAccent(value);

export const LIGHT_PAGE: Rgb = [250, 250, 250];
export const DARK_PAGE: Rgb = [9, 9, 11];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const INK: Rgb = [24, 24, 27];

const luminance = (color: Rgb) => {
	const [r, g, b] = color.map((channel) => {
		const value = channel / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: Rgb, b: Rgb) => {
	const [high, low] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
	return (high + 0.05) / (low + 0.05);
};

const mix = (from: Rgb, to: Rgb, amount: number): Rgb => [
	Math.round(from[0] + (to[0] - from[0]) * amount),
	Math.round(from[1] + (to[1] - from[1]) * amount),
	Math.round(from[2] + (to[2] - from[2]) * amount),
];

export function legibleOn(color: Rgb, page: Rgb): Rgb {
	const target = luminance(page) > 0.5 ? BLACK : WHITE;
	let result = color;
	for (let step = 1; step <= 10 && contrast(result, page) < 4.5; step++) {
		result = mix(color, target, step / 10);
	}

	return result;
}

export const foregroundOn = (color: Rgb) =>
	contrast(color, WHITE) >= contrast(color, INK) ? WHITE : INK;

export const hexToRgb = (hex: string): Rgb => [
	Number.parseInt(hex.slice(1, 3), 16),
	Number.parseInt(hex.slice(3, 5), 16),
	Number.parseInt(hex.slice(5, 7), 16),
];

export const rgbToHex = ([r, g, b]: Rgb) =>
	`#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

export function presetColor(accent: string): Rgb | undefined {
	const preset = ACCENTS.find(({id}) => id === accent);
	if (preset) {
		return hexToRgb(preset.hex);
	}

	return isCustomAccent(accent) ? hexToRgb(accent) : undefined;
}

export const isColumnColor = (value: unknown): value is string =>
	isCustomAccent(value) || ACCENTS.some(({id}) => id === value);

export function columnColorShades(
	value: string | undefined,
): {light: Rgb; dark: Rgb} | undefined {
	if (!isColumnColor(value)) {
		return undefined;
	}

	const color = presetColor(value);
	return color
		? {light: legibleOn(color, LIGHT_PAGE), dark: legibleOn(color, DARK_PAGE)}
		: undefined;
}
