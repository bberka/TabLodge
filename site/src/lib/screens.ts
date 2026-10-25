import {getImage} from 'astro:assets';
import type {ImageMetadata} from 'astro';

export type ScreenName = 'dashboard' | 'palette' | 'settings' | 'sidepanel';
export type Theme = 'dark' | 'light';

const files = import.meta.glob<{default: ImageMetadata}>('../assets/*.webp', {
	eager: true,
});

export const DEFAULT_WIDTHS = [640, 1080, 1600, 2400];

export async function screenshotSet(
	name: ScreenName,
	theme: Theme,
	widths = DEFAULT_WIDTHS,
) {
	const meta = files[`../assets/${name}-${theme}.webp`]?.default;
	if (!meta) {
		throw new Error(`Missing screenshot ${name}-${theme}`);
	}

	const usable = widths.filter((w) => w <= meta.width);
	const sets = await Promise.all(
		usable.map(async (w) => {
			const img = await getImage({src: meta, width: w, format: 'webp', quality: 80});
			return `${img.src} ${w}w`;
		}),
	);
	const fallback = await getImage({
		src: meta,
		width: usable.at(-1) ?? meta.width,
		format: 'webp',
		quality: 80,
	});
	return {srcset: sets.join(', '), src: fallback.src, width: meta.width, height: meta.height};
}
