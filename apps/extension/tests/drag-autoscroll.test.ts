import assert from 'node:assert/strict';
import {test} from 'vite-plus/test';
import {
	ACCELERATION,
	EDGE_ZONE_PX,
	MAX_FRAME_MS,
	MAX_SPEED,
	MIN_SPEED,
	REDUCED_MOTION_FACTOR,
	createAutoscroller,
	edgeVelocity,
	watchDragAutoscroll,
	type AutoscrollEnv,
	type Axis,
	type Direction,
	type ScrollTarget,
} from '../src/app/drag-autoscroll';

// A pane 0..1000 tall and wide, big enough that the zone is the full EDGE_ZONE_PX.
const SIZE = 1000;

test('edgeVelocity is zero in the middle and outside both strips', () => {
	assert.equal(edgeVelocity(500, 0, SIZE), 0);
	assert.equal(edgeVelocity(EDGE_ZONE_PX, 0, SIZE), 0);
	assert.equal(edgeVelocity(SIZE - EDGE_ZONE_PX, 0, SIZE), 0);
});

test('edgeVelocity scrolls toward the edge the pointer is near', () => {
	assert.ok(edgeVelocity(10, 0, SIZE) < 0);
	assert.ok(edgeVelocity(SIZE - 10, 0, SIZE) > 0);
});

test('edgeVelocity speeds up toward the edge and tops out at the maximum', () => {
	const outer = Math.abs(edgeVelocity(EDGE_ZONE_PX - 1, 0, SIZE));
	const middle = Math.abs(edgeVelocity(EDGE_ZONE_PX / 2, 0, SIZE));
	const inner = Math.abs(edgeVelocity(1, 0, SIZE));
	assert.ok(outer >= MIN_SPEED);
	assert.ok(outer < middle);
	assert.ok(middle < inner);
	assert.equal(edgeVelocity(0, 0, SIZE), -MAX_SPEED);
	// Past the edge (a pointer dragged out of the window) is the same top speed.
	assert.equal(edgeVelocity(-40, 0, SIZE), -MAX_SPEED);
	assert.equal(edgeVelocity(SIZE + 40, 0, SIZE), MAX_SPEED);
});

test('edgeVelocity follows the acceleration curve', () => {
	const depth = 0.5;
	const expected = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * depth ** ACCELERATION;
	assert.equal(edgeVelocity(EDGE_ZONE_PX * (1 - depth), 0, SIZE), -expected);
});

test('edgeVelocity shrinks the strip on a small pane and ignores an empty one', () => {
	// A 100px pane gets a 30px strip, so its middle never scrolls.
	assert.equal(edgeVelocity(50, 0, 100), 0);
	assert.ok(edgeVelocity(10, 0, 100) < 0);
	assert.equal(edgeVelocity(5, 10, 10), 0);
	assert.equal(edgeVelocity(5, 20, 10), 0);
});

test('edgeVelocity still scrolls, more slowly, for reduced motion', () => {
	const normal = edgeVelocity(0, 0, SIZE);
	const reduced = edgeVelocity(0, 0, SIZE, true);
	assert.equal(reduced, normal * REDUCED_MOTION_FACTOR);
	assert.ok(reduced < 0);
});

type FakePane = ScrollTarget & {
	position: Record<Axis, number>;
	limit: Record<Axis, number>;
	moves: number;
};

function fakePane(
	bounds: ScrollTarget['bounds'],
	limit: Record<Axis, number>,
	start: Record<Axis, number> = {x: 0, y: 0},
): FakePane {
	const pane: FakePane = {
		bounds,
		position: {...start},
		limit,
		moves: 0,
		canScroll(axis: Axis, direction: Direction) {
			return direction < 0
				? pane.position[axis] > 0
				: pane.position[axis] < pane.limit[axis];
		},
		scrollBy(axis: Axis, pixels: number) {
			pane.moves++;
			pane.position[axis] = Math.min(
				Math.max(pane.position[axis] + pixels, 0),
				pane.limit[axis],
			);
		},
	};
	return pane;
}

function fakeEnv(panes: ScrollTarget[], reduced = false) {
	const frames = new Map<number, (time: number) => void>();
	let nextId = 1;
	let time = 0;
	const env: AutoscrollEnv = {
		targetsAt: () => panes,
		requestFrame(callback) {
			const id = nextId++;
			frames.set(id, callback);
			return id;
		},
		cancelFrame(id) {
			frames.delete(id);
		},
		reducedMotion: () => reduced,
		atWindowEdge: (x, y) => x <= 0 || y <= 0 || x >= SIZE - 1 || y >= SIZE - 1,
	};
	return {
		env,
		get pending() {
			return frames.size;
		},
		/**
		Runs the queued frames, `ms` apart.
		*/
		run(count: number, ms = 16) {
			for (let i = 0; i < count; i++) {
				const queued = [...frames];
				frames.clear();
				time += ms;
				for (const [, callback] of queued) {
					callback(time);
				}
			}
		},
	};
}

const wholeWindow = {left: 0, top: 0, right: SIZE, bottom: SIZE};

test('the controller scrolls while the pointer sits in the strip and stops when told', () => {
	const page = fakePane(wholeWindow, {x: 0, y: 5000});
	const frames = fakeEnv([page]);
	const scroller = createAutoscroller(frames.env);

	scroller.update(500, SIZE - 5);
	assert.equal(frames.pending, 1);
	frames.run(30);
	const afterRun = page.position.y;
	assert.ok(afterRun > 0, 'scrolled down');
	frames.run(10);
	assert.ok(page.position.y > afterRun, 'keeps scrolling over time');

	scroller.stop();
	assert.equal(frames.pending, 0, 'no frame stays queued');
	const stopped = page.position.y;
	frames.run(10);
	assert.equal(page.position.y, stopped);
});

test('the controller scrolls up near the top edge', () => {
	const page = fakePane(wholeWindow, {x: 0, y: 5000}, {x: 0, y: 2000});
	const frames = fakeEnv([page]);
	const scroller = createAutoscroller(frames.env);
	scroller.update(500, 3);
	frames.run(20);
	assert.ok(page.position.y < 2000);
});

test('the controller does not scroll while the pointer is away from the edges', () => {
	const page = fakePane(wholeWindow, {x: 0, y: 5000});
	const frames = fakeEnv([page]);
	const scroller = createAutoscroller(frames.env);
	scroller.update(500, 500);
	frames.run(20);
	assert.equal(page.moves, 0);
	// Moving into the strip starts it; moving out stops it without a stop call.
	scroller.update(500, SIZE - 2);
	frames.run(5);
	const moved = page.position.y;
	assert.ok(moved > 0);
	scroller.update(500, 500);
	frames.run(5);
	assert.equal(page.position.y, moved);
	scroller.stop();
});

test('the controller scrolls the horizontal axis independently', () => {
	const page = fakePane(wholeWindow, {x: 3000, y: 0});
	const frames = fakeEnv([page]);
	const scroller = createAutoscroller(frames.env);
	scroller.update(SIZE - 2, 500);
	frames.run(20);
	assert.ok(page.position.x > 0);
	assert.equal(page.position.y, 0);
	scroller.stop();
});

test('speed grows as the pointer moves closer to the edge', () => {
	const far = fakePane(wholeWindow, {x: 0, y: 1e6});
	const near = fakePane(wholeWindow, {x: 0, y: 1e6});
	const farFrames = fakeEnv([far]);
	const nearFrames = fakeEnv([near]);
	const slow = createAutoscroller(farFrames.env);
	const fast = createAutoscroller(nearFrames.env);
	slow.update(500, SIZE - EDGE_ZONE_PX + 5);
	fast.update(500, SIZE - 2);
	farFrames.run(30);
	nearFrames.run(30);
	assert.ok(near.position.y > far.position.y * 3);
	slow.stop();
	fast.stop();
});

test('reduced motion scrolls the same way, just slower', () => {
	const normalPane = fakePane(wholeWindow, {x: 0, y: 1e6});
	const calmPane = fakePane(wholeWindow, {x: 0, y: 1e6});
	const normalFrames = fakeEnv([normalPane]);
	const calmFrames = fakeEnv([calmPane], true);
	const normal = createAutoscroller(normalFrames.env);
	const calm = createAutoscroller(calmFrames.env);
	normal.update(500, SIZE - 2);
	calm.update(500, SIZE - 2);
	normalFrames.run(30);
	calmFrames.run(30);
	assert.ok(calmPane.position.y > 0);
	assert.ok(calmPane.position.y < normalPane.position.y / 2);
	normal.stop();
	calm.stop();
});

test('a long frame is capped so the page does not jump', () => {
	const page = fakePane(wholeWindow, {x: 0, y: 1e6});
	const frames = fakeEnv([page]);
	const scroller = createAutoscroller(frames.env);
	scroller.update(500, SIZE - 2);
	frames.run(1);
	const first = page.position.y;
	frames.run(1, 5000);
	assert.ok(page.position.y - first <= (MAX_SPEED * MAX_FRAME_MS) / 1000 + 1);
	scroller.stop();
});

test('the innermost pane scrolls first and the window takes over at its end', () => {
	// An inner pane sitting on the bottom edge of the window, and the window behind it.
	const inner = fakePane(
		{left: 0, top: 400, right: SIZE, bottom: SIZE},
		{x: 0, y: 200},
	);
	const outer = fakePane(wholeWindow, {x: 0, y: 5000});
	const frames = fakeEnv([inner, outer]);
	const scroller = createAutoscroller(frames.env);
	scroller.update(500, SIZE - 2);
	frames.run(60);
	assert.equal(inner.position.y, 200, 'the inner pane scrolled to its end');
	assert.ok(outer.position.y > 0, 'then the window scrolled');
	const handedOver = outer.moves;
	assert.ok(handedOver > 0);
	scroller.stop();
});

test('a pane whose far edge lies at the window edge does not pull against the window', () => {
	// The pane ends at y=14, so a pointer at y=12 is in its bottom strip and in the window's top strip.
	const inner = fakePane(
		{left: 0, top: -600, right: SIZE, bottom: 14},
		{x: 0, y: 900},
		{x: 0, y: 100},
	);
	const outer = fakePane(wholeWindow, {x: 0, y: 5000}, {x: 0, y: 2000});
	const frames = fakeEnv([inner, outer]);
	const scroller = createAutoscroller(frames.env);
	scroller.update(500, 12);
	frames.run(30);
	assert.equal(inner.position.y, 100, 'the pane stayed put');
	assert.ok(outer.position.y < 2000, 'the window scrolled up');
	scroller.stop();
});

test('a pane scrolls from its own strip while the window stays still', () => {
	const inner = fakePane(
		{left: 100, top: 300, right: 600, bottom: 700},
		{x: 0, y: 900},
	);
	const outer = fakePane(wholeWindow, {x: 0, y: 5000});
	const frames = fakeEnv([inner, outer]);
	const scroller = createAutoscroller(frames.env);
	scroller.update(300, 695);
	frames.run(30);
	assert.ok(inner.position.y > 0);
	assert.equal(outer.moves, 0);
	scroller.stop();
});

test('a pane that cannot move that way is skipped without error', () => {
	const stuck = fakePane(wholeWindow, {x: 0, y: 0});
	const frames = fakeEnv([stuck]);
	const scroller = createAutoscroller(frames.env);
	scroller.update(500, SIZE - 2);
	frames.run(10);
	assert.equal(stuck.moves, 0);
	scroller.stop();
});

test('onScroll runs after frames that moved something and not otherwise', () => {
	const page = fakePane(wholeWindow, {x: 0, y: 5000});
	const frames = fakeEnv([page]);
	let calls = 0;
	const scroller = createAutoscroller(frames.env, () => {
		calls++;
	});
	scroller.update(500, 500);
	frames.run(5);
	assert.equal(calls, 0);
	scroller.update(500, SIZE - 2);
	frames.run(5);
	assert.ok(calls > 0);
	scroller.stop();
});

test('stop is safe to call when nothing is running', () => {
	const frames = fakeEnv([fakePane(wholeWindow, {x: 0, y: 10})]);
	const scroller = createAutoscroller(frames.env);
	scroller.stop();
	scroller.stop();
	assert.equal(frames.pending, 0);
});

type FakeEvent = Event & {
	clientX?: number;
	clientY?: number;
	relatedTarget?: unknown;
};

function fire(
	source: EventTarget,
	type: string,
	fields: Partial<FakeEvent> = {},
) {
	const event = Object.assign(new Event(type, {cancelable: true}), fields);
	source.dispatchEvent(event);
	return event;
}

function watched() {
	const page = fakePane(wholeWindow, {x: 0, y: 5000});
	const frames = fakeEnv([page]);
	const source = new EventTarget();
	const stopWatching = watchDragAutoscroll(source, frames.env);
	return {page, frames, source, stopWatching};
}

test('a watched dragover near the edge starts scrolling and a drop ends it', () => {
	const {page, frames, source, stopWatching} = watched();
	fire(source, 'dragover', {clientX: 500, clientY: SIZE - 4});
	frames.run(20);
	assert.ok(page.position.y > 0);
	fire(source, 'drop');
	assert.equal(frames.pending, 0);
	const stopped = page.position.y;
	frames.run(5);
	assert.equal(page.position.y, stopped);
	stopWatching();
});

test('the end of a drag, such as Escape, stops the scroll', () => {
	const {page, frames, source, stopWatching} = watched();
	fire(source, 'dragover', {clientX: 500, clientY: 3});
	frames.run(5);
	fire(source, 'dragend');
	assert.equal(frames.pending, 0);
	const stopped = page.position.y;
	frames.run(5);
	assert.equal(page.position.y, stopped);
	stopWatching();
});

test('ordinary input after a drag that never reported its end stops the scroll', () => {
	for (const type of ['pointermove', 'pointerdown', 'keydown']) {
		const {frames, source, stopWatching} = watched();
		fire(source, 'dragover', {clientX: 500, clientY: SIZE - 4});
		fire(source, type);
		assert.equal(frames.pending, 0, type);
		stopWatching();
	}
});

test('leaving the window stops the scroll but moving between elements does not', () => {
	const {frames, source, stopWatching} = watched();
	fire(source, 'dragover', {clientX: 500, clientY: SIZE - 4});
	// An element change inside the page: a related element, or a point away from the edges.
	fire(source, 'dragleave', {clientX: 500, clientY: 500, relatedTarget: null});
	fire(source, 'dragleave', {
		clientX: 500,
		clientY: SIZE - 4,
		relatedTarget: {},
	});
	assert.equal(frames.pending, 1);
	fire(source, 'dragleave', {clientX: 500, clientY: SIZE, relatedTarget: null});
	assert.equal(frames.pending, 0);
	stopWatching();
});

test('tearing the watcher down cancels the frame and removes every listener', () => {
	const {page, frames, source, stopWatching} = watched();
	fire(source, 'dragover', {clientX: 500, clientY: SIZE - 4});
	stopWatching();
	assert.equal(frames.pending, 0);
	fire(source, 'dragover', {clientX: 500, clientY: SIZE - 4});
	assert.equal(frames.pending, 0);
	frames.run(5);
	assert.equal(page.position.y, 0);
});

test('the wheel is never cancelled, so a browser that scrolls during a drag keeps doing so', () => {
	const {source, stopWatching} = watched();
	fire(source, 'dragover', {clientX: 500, clientY: 500});
	assert.equal(fire(source, 'wheel').defaultPrevented, false);
	stopWatching();
});
