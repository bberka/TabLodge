import assert from 'node:assert/strict';
import {describe, test} from 'vite-plus/test';
import {
	contrast,
	glassFill,
	glassOver,
	hexRgb,
	over,
} from '../src/ui/glass-colors';

const THEMES = {
	light: {
		background: '#f2f2f7',
		surface: '#ffffff',
		text: '#000000',
		muted: '#6c6c70',
		accent: '#007aff',
		onAccent: '#ffffff',
	},
	dark: {
		background: '#000000',
		surface: '#1c1c1e',
		text: '#ffffff',
		muted: '#98989f',
		accent: '#0a84ff',
		onAccent: '#ffffff',
	},
};

const backdrops = (theme: (typeof THEMES)['light']) => {
	const page = hexRgb(theme.background);
	const ink = hexRgb(theme.text);
	return [page, hexRgb(theme.surface), over(ink, 0.15, page)];
};

describe('the glass colors', () => {
	for (const [name, theme] of Object.entries(THEMES)) {
		const dark = name === 'dark';
		const surface = hexRgb(theme.surface);
		describe(`in the ${name} theme`, () => {
			test('tab labels and the search text read at 4.5:1 on the glass', () => {
				for (const back of backdrops(theme)) {
					for (const kind of ['bar', 'search'] as const) {
						const glass = glassOver(surface, kind, back, dark);
						assert.ok(contrast(hexRgb(theme.muted), glass) >= 4.5, kind);
						assert.ok(contrast(hexRgb(theme.text), glass) >= 4.5, kind);
					}
				}
			});

			test('icons read at 3:1 even over dense text', () => {
				const dense = over(hexRgb(theme.text), 0.4, hexRgb(theme.background));
				for (const back of [...backdrops(theme), dense]) {
					const glass = glassOver(surface, 'button', back, dark);
					assert.ok(contrast(hexRgb(theme.text), glass) >= 3);
					const bar = glassOver(surface, 'bar', back, dark);
					assert.ok(contrast(hexRgb(theme.muted), bar) >= 3);
				}
			});

			test('the icon on the accent button reads at 3:1', () => {
				const dense = over(hexRgb(theme.text), 0.4, hexRgb(theme.background));
				for (const back of [...backdrops(theme), dense]) {
					const glass = glassOver(hexRgb(theme.accent), 'primary', back, dark);
					assert.ok(contrast(hexRgb(theme.onAccent), glass) >= 3);
				}
			});
		});
	}

	test('without a blur the glass covers more', () => {
		assert.equal(
			glassFill('#ffffff', 'bar', true),
			'rgba(255, 255, 255, 0.55)',
		);
		assert.equal(
			glassFill('#ffffff', 'bar', false),
			'rgba(255, 255, 255, 0.92)',
		);
	});
});
