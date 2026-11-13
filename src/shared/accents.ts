// The accent color. It is "default" (TabLodge's own indigo, which the stylesheet defines), a preset
// id, "system" (the operating system's accent, read from the CSS AccentColor keyword and kept current),
// or a custom "#rrggbb". Every accent except the default is applied as inline CSS variables on
// <html>. extension/service-worker.ts mirrors the ids and the hex rule (the worker cannot import).
import {
	ACCENT_MIRROR_KEY,
	DARK_PAGE,
	DEFAULT_ACCENT,
	DEFAULT_ACCENT_HEX,
	hexToRgb,
	isAccent,
	legibleOn,
	LIGHT_PAGE,
	foregroundOn,
	presetColor,
	SYSTEM_ACCENT,
	type Rgb,
} from './accent-colors';

export {
	ACCENT_MIRROR_KEY,
	ACCENTS,
	columnColorShades,
	DEFAULT_ACCENT,
	DEFAULT_ACCENT_HEX,
	foregroundOn,
	hexToRgb,
	isAccent,
	isColumnColor,
	isCustomAccent,
	rgbToHex,
	SYSTEM_ACCENT,
	type Rgb,
} from './accent-colors';

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

	return accent === SYSTEM_ACCENT ? systemAccentColor() : presetColor(accent);
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

// A private window's own accent, mirrored into its (separate) localStorage by the theme provider.
// "same" means the regular accent applies; a missing value means the user never chose, so the default applies.
export const PRIVATE_ACCENT_SAME = 'same';
export const PRIVATE_ACCENT_DEFAULT = 'teal';
export const PRIVATE_ACCENT_MIRROR = 'tablodge.privateAccent';

// Maps a stored private accent to the accent to show: undefined means "use the regular accent".
export function resolvePrivateAccent(value: unknown): string | undefined {
	if (value === PRIVATE_ACCENT_SAME) {
		return undefined;
	}

	return isAccent(value) ? value : PRIVATE_ACCENT_DEFAULT;
}

export function readPrivateAccent(): string | undefined {
	try {
		return resolvePrivateAccent(localStorage.getItem(PRIVATE_ACCENT_MIRROR));
	} catch {
		return PRIVATE_ACCENT_DEFAULT;
	}
}

// The accent this page shows: a private window's own accent when set, otherwise the saved one.
export function readEffectiveAccent(): string {
	return (
		(chrome.extension?.inIncognitoContext ? readPrivateAccent() : undefined) ??
		readSavedAccent()
	);
}
