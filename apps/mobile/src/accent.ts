import {
	DEFAULT_ACCENT,
	foregroundOn,
	hexToRgb,
	legibleOn,
	presetColor,
	rgbToHex,
	SYSTEM_ACCENT,
	type Rgb,
} from '../../extension/src/shared/accent-colors';

/**
TabLodge's own accent in the light theme, shown for the default choice.
*/
export const APP_ACCENT = '#5043c4';

export type AccentColors = {
	accent: string;
	accentSoft: string;
	onAccent: string;
};

const mix = (from: Rgb, to: Rgb, amount: number): Rgb => [
	Math.round(from[0] + (to[0] - from[0]) * amount),
	Math.round(from[1] + (to[1] - from[1]) * amount),
	Math.round(from[2] + (to[2] - from[2]) * amount),
];

/**
The accent colors for a choice, made to read on this theme's page: the accent itself (moved toward black or white
until text in it is legible), a pale fill of it for chips and tiles, and the text color for a filled button. Undefined
when the choice leaves the look's own accent in place: the default, and the system color where the phone has none (and
for the iOS look, whose system accent is its blue).
*/
export function resolveAccent(
	choice: string,
	scheme: 'light' | 'dark',
	ios: boolean,
	page: string,
	surface: string,
	system?: {light: string; dark: string},
): AccentColors | undefined {
	if (choice === DEFAULT_ACCENT) {
		return undefined;
	}

	let base: Rgb | undefined;
	if (choice === SYSTEM_ACCENT) {
		const hex = ios ? undefined : system?.[scheme];
		base = hex ? hexToRgb(hex) : undefined;
	} else {
		base = presetColor(choice);
	}

	if (!base) {
		return undefined;
	}

	const accent = legibleOn(base, hexToRgb(page));
	return {
		accent: rgbToHex(accent),
		accentSoft: rgbToHex(
			mix(hexToRgb(surface), accent, scheme === 'dark' ? 0.22 : 0.14),
		),
		onAccent: rgbToHex(foregroundOn(accent)),
	};
}
