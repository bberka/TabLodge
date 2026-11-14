import type {CSSProperties} from 'react';
import {columnColorShades} from '../shared/accents';

/**
Classes that paint an element in its column's color: the shade that reads on the light page, or the one for the dark page.
They need the variables from `columnColorVars` on the element or a parent. Without a color, use the neutral class instead.
*/
export const COLUMN_COLOR_TEXT =
	'text-[rgb(var(--column-light))] dark:text-[rgb(var(--column-dark))]';
export const COLUMN_COLOR_BAR =
	'shadow-[inset_0_2px_0_rgb(var(--column-light))] dark:shadow-[inset_0_2px_0_rgb(var(--column-dark))]';
/**
A soft wash of the column's color, for the background of its active item.
*/
export const COLUMN_COLOR_SOFT =
	'bg-[rgb(var(--column-light)/0.12)] dark:bg-[rgb(var(--column-dark)/0.16)]';
/**
The column's color as text on its own wash: pushed toward black in the light theme and toward white in the dark one, so
the label stays readable on the tint.
*/
export const COLUMN_COLOR_ACTIVE_TEXT =
	'text-[color-mix(in_srgb,rgb(var(--column-light))_75%,black)] dark:text-[color-mix(in_srgb,rgb(var(--column-dark))_70%,white)]';
export const COLUMN_COLOR_EDGE =
	'shadow-[inset_3px_0_0_rgb(var(--column-light))] dark:shadow-[inset_3px_0_0_rgb(var(--column-dark))]';

/**
The two CSS variables a column's color sets, or nothing for a column without one (or a value that is not a color).
*/
export function columnColorVars(
	color: string | undefined,
): CSSProperties | undefined {
	const shades = columnColorShades(color);
	return shades
		? ({
				'--column-light': shades.light.join(' '),
				'--column-dark': shades.dark.join(' '),
			} as CSSProperties)
		: undefined;
}
