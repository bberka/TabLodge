import type {CSSProperties} from 'react';
import {columnColorShades} from '../shared/accents';

export const COLUMN_COLOR_TEXT =
	'text-[rgb(var(--column-light))] dark:text-[rgb(var(--column-dark))]';
export const COLUMN_COLOR_BAR =
	'shadow-[inset_0_2px_0_rgb(var(--column-light))] dark:shadow-[inset_0_2px_0_rgb(var(--column-dark))]';
export const COLUMN_COLOR_SOFT =
	'bg-[rgb(var(--column-light)/0.12)] dark:bg-[rgb(var(--column-dark)/0.16)]';
export const COLUMN_COLOR_ACTIVE_TEXT =
	'text-[color-mix(in_srgb,rgb(var(--column-light))_75%,black)] dark:text-[color-mix(in_srgb,rgb(var(--column-dark))_70%,white)]';
export const COLUMN_COLOR_EDGE =
	'shadow-[inset_3px_0_0_rgb(var(--column-light))] dark:shadow-[inset_3px_0_0_rgb(var(--column-dark))]';

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
