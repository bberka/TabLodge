// The accent color. It is "default" (TabLodge's own indigo, which the stylesheet defines), a preset
// id, "system" (the operating system's accent, read from the CSS AccentColor keyword and kept current),
// or a custom "#rrggbb". Every accent except the default is applied as inline CSS variables on
// <html>. extension/service-worker.ts mirrors the ids and the hex rule (the worker cannot import).
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
// The stylesheet's color, shown for the default accent.
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

const LIGHT_PAGE: Rgb = [250, 250, 250];
const DARK_PAGE: Rgb = [9, 9, 11];
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

// Moves a color toward black or white until it stands out from the page (accent text and rings).
function legibleOn(color: Rgb, page: Rgb): Rgb {
	const target = luminance(page) > 0.5 ? BLACK : WHITE;
	let result = color;
	for (let step = 1; step <= 10 && contrast(result, page) < 4.5; step++) {
		result = mix(color, target, step / 10);
	}

	return result;
}

// Text on a filled accent: white or near-black, whichever reads better.
export const foregroundOn = (color: Rgb) =>
	contrast(color, WHITE) >= contrast(color, INK) ? WHITE : INK;

export const hexToRgb = (hex: string): Rgb => [
	Number.parseInt(hex.slice(1, 3), 16),
	Number.parseInt(hex.slice(3, 5), 16),
	Number.parseInt(hex.slice(5, 7), 16),
];

export const rgbToHex = ([r, g, b]: Rgb) =>
	`#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;

// What Chromium reports for AccentColor when the platform has no accent color to give (Linux without
// a GTK accent, for one). It is not a real choice, so it counts as no accent.
const NO_SYSTEM_ACCENT = '0,117,255';

// The system accent color, or undefined where the browser or platform has none.
export function systemAccentColor(): Rgb | undefined {
	if (!globalThis.CSS?.supports('color', 'AccentColor')) {
		return undefined;
	}

	const probe = document.createElement('span');
	probe.style.color = 'AccentColor';
	document.documentElement.append(probe);
	const resolved = getComputedStyle(probe).color;
	probe.remove();
	const channels = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(resolved);
	if (!channels) {
		return undefined;
	}

	const color: Rgb = [
		Number(channels[1]),
		Number(channels[2]),
		Number(channels[3]),
	];
	return color.join(',') === NO_SYSTEM_ACCENT ? undefined : color;
}

// The color an accent stands for, or undefined for "system" where there is none.
export function accentColor(accent: string): Rgb | undefined {
	if (accent === DEFAULT_ACCENT) {
		return hexToRgb(DEFAULT_ACCENT_HEX);
	}

	if (accent === SYSTEM_ACCENT) {
		return systemAccentColor();
	}

	const preset = ACCENTS.find(({id}) => id === accent);
	if (preset) {
		return hexToRgb(preset.hex);
	}

	return isCustomAccent(accent) ? hexToRgb(accent) : undefined;
}

const VARIABLES = [
	'--brand-primary-light',
	'--brand-primary-dark',
	'--brand-primary-foreground-light',
	'--brand-primary-foreground-dark',
] as const;

// Sets the accent variables on <html>. Called before first paint by theme-boot.ts and again by the
// theme provider. For the default accent, or a platform that has no system accent, the variables are
// removed and the stylesheet's indigo shows.
export function applyAccent(accent: string) {
	const {style} = document.documentElement;
	const color = accent === DEFAULT_ACCENT ? undefined : accentColor(accent);
	if (!color) {
		for (const name of VARIABLES) {
			style.removeProperty(name);
		}

		return;
	}

	const light = legibleOn(color, LIGHT_PAGE);
	const dark = legibleOn(color, DARK_PAGE);
	const values = [light, dark, foregroundOn(light), foregroundOn(dark)];
	for (const [index, name] of VARIABLES.entries()) {
		style.setProperty(name, values[index].join(' '));
	}
}

const WATCH_INTERVAL_MS = 2000;

// Calls onChange with the system accent now and whenever it changes. The browser fires no event
// for this, so it is rechecked when the page regains focus or visibility, when the color scheme or
// contrast mode changes, and every couple of seconds while the page is visible (the new tab page can
// stay in view while the system accent is changed beside it).
export function watchSystemAccent(
	onChange: (color: Rgb | undefined) => void,
): () => void {
	let last = systemAccentColor();
	onChange(last);
	const refresh = () => {
		if (document.hidden) {
			return;
		}

		const next = systemAccentColor();
		if (next?.join(',') === last?.join(',')) {
			return;
		}

		last = next;
		onChange(next);
	};

	const timer = setInterval(refresh, WATCH_INTERVAL_MS);
	const queries = ['(prefers-color-scheme: dark)', '(forced-colors: active)']
		.map((query) => globalThis.matchMedia?.(query))
		.filter((query) => query !== undefined);
	globalThis.addEventListener('focus', refresh);
	document.addEventListener('visibilitychange', refresh);
	for (const query of queries) {
		query.addEventListener('change', refresh);
	}

	return () => {
		clearInterval(timer);
		globalThis.removeEventListener('focus', refresh);
		document.removeEventListener('visibilitychange', refresh);
		for (const query of queries) {
			query.removeEventListener('change', refresh);
		}
	};
}

export function readSavedAccent(): string {
	try {
		const saved = localStorage.getItem(ACCENT_MIRROR_KEY);
		return isAccent(saved) ? saved : DEFAULT_ACCENT;
	} catch {
		return DEFAULT_ACCENT;
	}
}
