import {useColorScheme} from 'react-native';

const light = {
	background: '#faf9f7',
	surface: '#ffffff',
	text: '#1c1b22',
	muted: '#5f5d6b',
	border: '#dcd9e3',
	accent: '#5043c4',
	onAccent: '#ffffff',
	danger: '#b3261e',
};

const dark: typeof light = {
	background: '#16151b',
	surface: '#1f1e26',
	text: '#f1f0f5',
	muted: '#a9a6b6',
	border: '#383643',
	accent: '#a99fff',
	onAccent: '#16151b',
	danger: '#f2b8b5',
};

export type Colors = typeof light;

export const useColors = (): Colors =>
	useColorScheme() === 'dark' ? dark : light;

// Android asks for touch targets of at least 48dp.
export const TARGET = 48;
