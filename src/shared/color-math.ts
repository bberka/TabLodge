import {hexToRgb, rgbToHex, type Rgb} from './accent-colors';

/**
Hue (0 to 360), saturation and lightness (0 to 1) to a `#rrggbb` color, so a picker can offer sliders and store the
same text a typed or preset color is stored as.
*/
export function hslToHex(hue: number, saturation: number, lightness: number) {
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const section = (((hue % 360) + 360) % 360) / 60;
	const second = chroma * (1 - Math.abs((section % 2) - 1));
	const [r, g, b] = [
		[chroma, second, 0],
		[second, chroma, 0],
		[0, chroma, second],
		[0, second, chroma],
		[second, 0, chroma],
		[chroma, 0, second],
	][Math.min(5, Math.floor(section))] as Rgb;
	const shift = lightness - chroma / 2;
	return rgbToHex(
		[r, g, b].map((part) => Math.round((part + shift) * 255)) as Rgb,
	);
}

/**
A `#rrggbb` color as hue (0 to 360), saturation and lightness (0 to 1).
*/
export function hexToHsl(hex: string): [number, number, number] {
	const [r, g, b] = hexToRgb(hex).map((part) => part / 255) as Rgb;
	const high = Math.max(r, g, b);
	const low = Math.min(r, g, b);
	const lightness = (high + low) / 2;
	const delta = high - low;
	if (delta === 0) {
		return [0, 0, lightness];
	}

	const saturation = delta / (1 - Math.abs(2 * lightness - 1));
	let hue: number;
	if (high === r) {
		hue = ((g - b) / delta) % 6;
	} else if (high === g) {
		hue = (b - r) / delta + 2;
	} else {
		hue = (r - g) / delta + 4;
	}

	return [(hue * 60 + 360) % 360, saturation, lightness];
}
