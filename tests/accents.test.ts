import assert from 'node:assert/strict';
import {afterEach, test, vi} from 'vite-plus/test';
import {
	ACCENTS,
	applyAccent,
	isAccent,
	isCustomAccent,
	rgbToHex,
	watchSystemAccent,
} from '../src/shared/accents';

// A minimal stand-in for the page: the root's inline variables and the color AccentColor resolves to.
function fakePage(initial?: string) {
	const properties = new Map<string, string>();
	const listeners = new Map<string, () => void>();
	const page = {
		accentColor: initial,
		hidden: false,
		properties,
		fire: (type: string) => listeners.get(type)?.(),
	};
	vi.stubGlobal('document', {
		get hidden() {
			return page.hidden;
		},
		addEventListener: (type: string, listener: () => void) =>
			listeners.set(type, listener),
		removeEventListener: (type: string) => listeners.delete(type),
		documentElement: {
			style: {
				setProperty: (name: string, value: string) =>
					properties.set(name, value),
				removeProperty: (name: string) => properties.delete(name),
			},
			append() {},
		},
		createElement: () => ({style: {}, remove() {}}),
	});
	vi.stubGlobal('getComputedStyle', () => ({color: page.accentColor ?? ''}));
	vi.stubGlobal('CSS', {supports: () => page.accentColor !== undefined});
	vi.stubGlobal('addEventListener', (type: string, listener: () => void) =>
		listeners.set(type, listener),
	);
	vi.stubGlobal('removeEventListener', (type: string) =>
		listeners.delete(type),
	);
	return page;
}

const channels = (value: string | undefined) =>
	(value ?? '').split(' ').map(Number);

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test('accents are preset ids, system, or lowercase #rrggbb', () => {
	assert.equal(isAccent('system'), true);
	assert.equal(isAccent('browser'), false);
	assert.equal(isAccent('teal'), true);
	assert.equal(isAccent('#12ab9f'), true);
	assert.equal(isAccent('#12AB9F'), false);
	assert.equal(isAccent('#123'), false);
	assert.equal(isAccent('purple'), false);
	assert.equal(isAccent('<script>'), false);
	assert.equal(isCustomAccent('teal'), false);
	assert.equal(rgbToHex([18, 171, 159]), '#12ab9f');
	assert.ok(ACCENTS.every(({hex}) => isCustomAccent(hex)));
});

test('a preset applies its color as variables', () => {
	const page = fakePage();
	applyAccent('blue');
	assert.deepEqual(
		channels(page.properties.get('--brand-primary-light')),
		[37, 99, 235],
	);
	assert.deepEqual(
		channels(page.properties.get('--brand-primary-foreground-light')),
		[255, 255, 255],
	);
});

test('the default accent sets no variables, so the stylesheet shows', () => {
	const page = fakePage();
	applyAccent('red');
	assert.ok(page.properties.size > 0);
	applyAccent('default');
	assert.equal(page.properties.size, 0);
	assert.equal(isAccent('default'), true);
});

test('the system accent uses the resolved AccentColor', () => {
	const page = fakePage('rgb(200, 30, 60)');
	applyAccent('system');
	assert.deepEqual(
		channels(page.properties.get('--brand-primary-light')),
		[200, 30, 60],
	);
	// Too dark for the dark page, so that variable is lightened.
	const dark = channels(page.properties.get('--brand-primary-dark'));
	assert.ok(dark[0] > 200);
	assert.ok(dark[1] > 30);
});

test('the system accent falls back to the stylesheet when there is none or only the placeholder blue', () => {
	const page = fakePage();
	applyAccent('green');
	assert.ok(page.properties.size > 0);
	applyAccent('system');
	assert.equal(page.properties.size, 0);
	// Chromium reports this blue when the platform has no accent to give.
	page.accentColor = 'rgb(0, 117, 255)';
	applyAccent('green');
	applyAccent('system');
	assert.equal(page.properties.size, 0);
});

test('a custom accent is made legible and gets a readable foreground', () => {
	const page = fakePage();
	applyAccent('#ffff00');
	// Pure yellow is unreadable on the light page, so it is darkened there but kept on the dark page.
	const light = channels(page.properties.get('--brand-primary-light'));
	assert.ok(light[0] < 255);
	assert.ok(light[2] < 255);
	assert.deepEqual(
		channels(page.properties.get('--brand-primary-dark')),
		[255, 255, 0],
	);
	assert.deepEqual(
		channels(page.properties.get('--brand-primary-foreground-dark')),
		[24, 24, 27],
	);
});

test('watching the system accent reports changes on the timer and on focus, but not repeats', () => {
	vi.useFakeTimers();
	const page = fakePage('rgb(10, 90, 200)');
	const seen: Array<number[] | undefined> = [];
	const stop = watchSystemAccent((color) => {
		seen.push(color);
	});
	assert.deepEqual(seen, [[10, 90, 200]]);
	vi.advanceTimersByTime(4000);
	assert.equal(seen.length, 1);
	page.accentColor = 'rgb(200, 30, 60)';
	vi.advanceTimersByTime(2000);
	assert.deepEqual(seen.at(-1), [200, 30, 60]);
	page.accentColor = 'rgb(10, 20, 30)';
	page.hidden = true;
	vi.advanceTimersByTime(4000);
	assert.equal(seen.length, 2);
	page.hidden = false;
	page.fire('focus');
	assert.deepEqual(seen.at(-1), [10, 20, 30]);
	stop();
	page.accentColor = 'rgb(1, 2, 3)';
	vi.advanceTimersByTime(4000);
	assert.equal(seen.length, 3);
});
