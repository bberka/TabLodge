import {useMemo} from 'react';
import {useColorScheme} from 'react-native';
import {systemAccent} from '../../modules/open-links';
import {resolveLook, usePreferences} from '../settings/preferences';
import {resolveAccent} from './accent';

const light = {
	background: '#faf9f7',
	surface: '#ffffff',
	pressed: '#efedf5',
	text: '#1c1b22',
	muted: '#5f5d6b',
	border: '#dcd9e3',
	accent: '#5043c4',
	accentSoft: '#e8e5fb',
	onAccent: '#ffffff',
	danger: '#b3261e',
	ok: '#1f7a45',
	warn: '#8a5a00',
	info: '#1d5fbf',
	teal: '#0b7a75',
};

const darkMaterial: typeof light = {
	background: '#16151b',
	surface: '#1f1e26',
	pressed: '#2b2a35',
	text: '#f1f0f5',
	muted: '#a9a6b6',
	border: '#383643',
	accent: '#a99fff',
	accentSoft: '#2f2b52',
	onAccent: '#16151b',
	danger: '#e5484d',
	ok: '#7fd9a0',
	warn: '#f0c36d',
	info: '#7db4ff',
	teal: '#5fd3c8',
};

export type Colors = typeof light;

// The iOS look uses the system colors: grouped gray background, white cards, and the system blue.
const iosLight: Colors = {
	background: '#f2f2f7',
	surface: '#ffffff',
	pressed: '#e5e5ea',
	text: '#000000',
	muted: '#6c6c70',
	border: '#c6c6c8',
	accent: '#007aff',
	accentSoft: '#e5f0ff',
	onAccent: '#ffffff',
	danger: '#ff3b30',
	ok: '#248a3d',
	warn: '#b25000',
	info: '#0a60c8',
	teal: '#0a7d73',
};

const iosDark: Colors = {
	background: '#000000',
	surface: '#1c1c1e',
	pressed: '#2c2c2e',
	text: '#ffffff',
	muted: '#98989f',
	border: '#38383a',
	accent: '#0a84ff',
	accentSoft: '#0a2a4d',
	onAccent: '#ffffff',
	danger: '#ff453a',
	ok: '#32d74b',
	warn: '#ff9f0a',
	info: '#64a8ff',
	teal: '#40d0c4',
};

// The phone's accent is read once, when the app starts.
const system = systemAccent();

function palette(look: ReturnType<typeof resolveLook>, dark: boolean): Colors {
	switch (look) {
		case 'ios': {
			return dark ? iosDark : iosLight;
		}

		default: {
			return dark ? darkMaterial : light;
		}
	}
}

export const useColors = (): Colors => {
	const dark = useColorScheme() === 'dark';
	const {look: choice, accent} = usePreferences();
	const look = resolveLook(choice);
	return useMemo(() => {
		const base = palette(look, dark);
		const chosen = resolveAccent(
			accent,
			dark ? 'dark' : 'light',
			look === 'ios',
			base.background,
			base.surface,
			system,
		);
		return chosen ? {...base, ...chosen} : base;
	}, [look, accent, dark]);
};

/**
Shape and size choices that differ between the two looks.
*/
type Shape = {
	ios: boolean;
	buttonRadius: number;
	buttonHeight: number;
	fieldRadius: number;
	cardRadius: number;
	sheetRadius: number;
	chipRadius: number;
	titleSize: number;
	/**
	The gap around a floating tab bar, at its sides and below it.
	*/
	barGap: number;
};

const materialShape: Shape = {
	ios: false,
	buttonRadius: 24,
	buttonHeight: 48,
	fieldRadius: 12,
	cardRadius: 16,
	sheetRadius: 28,
	chipRadius: 20,
	titleSize: 28,
	barGap: 12,
};

const iosShape: Shape = {
	ios: true,
	buttonRadius: 12,
	buttonHeight: 50,
	fieldRadius: 10,
	cardRadius: 12,
	sheetRadius: 14,
	chipRadius: 9,
	titleSize: 34,
	barGap: 12,
};

const SHAPES = {material: materialShape, ios: iosShape};

export const useShape = (): Shape => SHAPES[resolveLook(usePreferences().look)];

// Android asks for touch targets of at least 48dp.
export const TARGET = 48;

const AVATAR_HUES = [262, 200, 150, 30, 340, 90, 220, 10];

/**
A steady color for a site, from its host name, so the same site always gets the same avatar.
*/
export function avatarColor(host: string, scheme: 'light' | 'dark'): string {
	let hash = 0;
	for (const char of host) {
		hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 997;
	}

	const hue = AVATAR_HUES[hash % AVATAR_HUES.length];
	return scheme === 'dark' ? `hsl(${hue} 45% 38%)` : `hsl(${hue} 55% 42%)`;
}

/**
A see-through version of a color, for the fill behind a tinted icon or chip. Takes `#rrggbb` or `hsl(h s% l%)`.
*/
export function soften(color: string): string {
	return color.startsWith('#')
		? `${color}26`
		: color.replace(/^hsl\((\d+) (\d+)% (\d+)%\)$/, 'hsla($1, $2%, $3%, 0.18)');
}

/**
White or near black text, whichever reads better on a solid `color` (`#rrggbb` or `hsl(h s% l%)`).
*/
export function readableOn(color: string): string {
	const hsl = /^hsl\(\d+ \d+% (\d+)%\)$/.exec(color);
	const bright = hsl
		? Number(hsl[1]) > 60
		: color.startsWith('#') && luminance(color) > 0.4;
	return bright ? '#1b1b1f' : '#ffffff';
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((at) => {
		const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
		return channel <= 0.03928
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const BAR_HEIGHT = 64;
