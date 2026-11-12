import {useColorScheme} from 'react-native';
import {usePreferences} from './preferences';

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
	danger: '#f2b8b5',
	ok: '#7fd9a0',
	warn: '#f0c36d',
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
};

export const useColors = (): Colors => {
	const dark = useColorScheme() === 'dark';
	const {look} = usePreferences();
	if (look === 'ios') {
		return dark ? iosDark : iosLight;
	}

	return dark ? darkMaterial : light;
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
};

export const useShape = (): Shape =>
	usePreferences().look === 'ios' ? iosShape : materialShape;

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

export const BAR_HEIGHT = 64;
export const BAR_MARGIN = 12;
