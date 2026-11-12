import {useColorScheme} from 'react-native';

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

const dark: typeof light = {
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

export const useColors = (): Colors =>
	useColorScheme() === 'dark' ? dark : light;

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
