import {
	DEFAULT_ACCENT,
	foregroundOn,
	hexToRgb,
	legibleOn,
	presetColor,
	rgbToHex,
	SYSTEM_ACCENT,
	type Rgb,
} from '../../../extension/src/shared/accent-colors';

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
