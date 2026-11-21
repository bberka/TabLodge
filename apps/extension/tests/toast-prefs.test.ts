import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	TOAST_POSITIONS,
	toastEdges,
	toastMs,
	toastPlace,
} from '../src/shared/toast-prefs';
import {
	DEFAULT_SETTINGS,
	normalizeSettings,
} from '../src/shared/library-normalize';

test('Default keeps the place each surface has today', () => {
	assert.equal(toastPlace('default', 'bottom'), 'bottom');
	assert.equal(toastPlace('default', 'bottom-right'), 'bottom-right');
	assert.equal(toastPlace('top-left', 'bottom-right'), 'top-left');
	assert.deepEqual(toastEdges('bottom-right', 16), {
		bottom: '16px',
		right: '16px',
		align: 'flex-end',
		reverse: false,
	});
});

test('every place has edges, and a top stack lists the newest nearest the top', () => {
	for (const position of TOAST_POSITIONS) {
		if (position === 'default') {
			continue;
		}

		const edges = toastEdges(position, 20);
		assert.equal(edges.reverse, position.startsWith('top'), position);
		assert.equal(
			(edges.top === undefined) !== (edges.bottom === undefined),
			true,
			position,
		);
	}

	assert.deepEqual(toastEdges('top', 24), {
		top: '24px',
		left: '50%',
		transform: 'translateX(-50%)',
		align: 'center',
		reverse: true,
	});
	assert.equal(toastEdges('top-left', 8).left, '8px');
	assert.equal(toastEdges('top-left', 8).align, 'flex-start');
});

test('Messages stay doubles the time, or never closes', () => {
	assert.equal(toastMs(4000, 'default'), 4000);
	assert.equal(toastMs(4000, 'longer'), 8000);
	assert.equal(toastMs(4000, 'dismiss'), undefined);
});

test('stored toast settings fall back to Default', () => {
	assert.equal(DEFAULT_SETTINGS.toastPosition, 'default');
	assert.equal(DEFAULT_SETTINGS.toastDuration, 'default');
	const settings = normalizeSettings({toastPosition: 'left', toastDuration: 5});
	assert.equal(settings.toastPosition, 'default');
	assert.equal(settings.toastDuration, 'default');
	assert.equal(
		normalizeSettings({toastPosition: 'top-right', toastDuration: 'dismiss'})
			.toastPosition,
		'top-right',
	);
});
