// Scrolls the view while something is dragged near its edge, shared by every drag source.
//
// A native HTML5 drag scrolls on its own only in a thin strip at the edge, at a fixed speed, and not at
// every edge of a nested pane. So the page watches `dragover` itself and drives a requestAnimationFrame
// loop that scrolls the pane under the pointer, with a wider strip that speeds up toward the edge.
//
// The wheel is deliberately left alone. Browsers either swallow it for the whole drag, so no listener
// could see it, or scroll natively during the drag, and a listener that cancels the event would stop
// that. The edge scroll is what keeps the page reachable in the first case.

/**
Width of the strip along each edge of a scroll pane where dragging starts scrolling it.
*/
export const EDGE_ZONE_PX = 72;
/**
Small panes shrink the strip so it never takes more than this share of the pane.
*/
export const EDGE_ZONE_MAX_FRACTION = 0.3;
/**
Speed in pixels per second at the inner border of the strip.
*/
export const MIN_SPEED = 120;
/**
Speed in pixels per second at the very edge, or past it. Chromium adds its own scroll in the last
few pixels of the window, so this stays below what a lone loop would use.
*/
export const MAX_SPEED = 1000;
/**
How fast the speed grows toward the edge: 1 is linear, 2 starts gently and accelerates.
*/
export const ACCELERATION = 2;
/**
Share of the normal speed used when the user prefers reduced motion. The view still scrolls.
*/
export const REDUCED_MOTION_FACTOR = 0.35;
/**
Longest time one frame may advance, so a stalled tab does not jump the page when it wakes.
*/
export const MAX_FRAME_MS = 50;
/**
Time assumed for the first frame, before there is a previous one to measure from.
*/
export const FIRST_FRAME_MS = 16;

export type Axis = 'x' | 'y';
export type Direction = -1 | 1;
export type Box = {left: number; top: number; right: number; bottom: number};

/**
One scroll pane: its visible box on screen, whether it can move further one way, and how to move it.
*/
export type ScrollTarget = {
	bounds: Box;
	canScroll: (axis: Axis, direction: Direction) => boolean;
	scrollBy: (axis: Axis, pixels: number) => void;
};

/**
Everything the controller needs from the page, so tests can supply a fake one.
*/
export type AutoscrollEnv = {
	/**
	The scroll panes under a point, innermost first, ending with the window.
	*/
	targetsAt: (x: number, y: number) => ScrollTarget[];
	requestFrame: (callback: (time: number) => void) => number;
	cancelFrame: (id: number) => void;
	reducedMotion: () => boolean;
	/**
	Whether a point lies at or beyond the edge of the window.
	*/
	atWindowEdge: (x: number, y: number) => boolean;
};

export type Autoscroller = {
	/**
	Moves the pointer and starts the scroll loop if it is not running.
	*/
	update: (x: number, y: number) => void;
	/**
	Ends the scroll loop. Safe to call when nothing is running.
	*/
	stop: () => void;
};

/**
Signed speed in pixels per second for a pointer at `position` in a pane spanning `start` to `end`.
Negative scrolls toward the start, positive toward the end, zero outside both strips.
*/
export function edgeVelocity(
	position: number,
	start: number,
	end: number,
	reducedMotion = false,
) {
	const size = end - start;
	if (!(size > 0)) {
		return 0;
	}

	const zone = Math.min(EDGE_ZONE_PX, size * EDGE_ZONE_MAX_FRACTION);
	const toStart = (start + zone - position) / zone;
	const toEnd = (position - (end - zone)) / zone;
	const depth = Math.min(Math.max(toStart, toEnd), 1);
	if (!(depth > 0)) {
		return 0;
	}

	const speed =
		(MIN_SPEED + (MAX_SPEED - MIN_SPEED) * depth ** ACCELERATION) *
		(reducedMotion ? REDUCED_MOTION_FACTOR : 1);
	return toStart > toEnd ? -speed : speed;
}

function velocityOn(
	target: ScrollTarget,
	axis: Axis,
	x: number,
	y: number,
	reducedMotion: boolean,
) {
	const {bounds} = target;
	return axis === 'y'
		? edgeVelocity(y, bounds.top, bounds.bottom, reducedMotion)
		: edgeVelocity(x, bounds.left, bounds.right, reducedMotion);
}

function pick(
	targets: ScrollTarget[],
	axis: Axis,
	x: number,
	y: number,
	reducedMotion: boolean,
) {
	// A pointer held at the window's edge means "scroll the window". A pane whose own strip pulls the
	// other way (its far edge happens to lie there) must not take the pointer from it.
	const outermost = targets.at(-1);
	const windowVelocity = outermost
		? velocityOn(outermost, axis, x, y, reducedMotion)
		: 0;
	const windowWins =
		outermost !== undefined &&
		windowVelocity !== 0 &&
		outermost.canScroll(axis, windowVelocity < 0 ? -1 : 1);
	for (const target of targets) {
		const velocity = velocityOn(target, axis, x, y, reducedMotion);
		if (
			velocity !== 0 &&
			(!windowWins || Math.sign(velocity) === Math.sign(windowVelocity)) &&
			target.canScroll(axis, velocity < 0 ? -1 : 1)
		) {
			return {target, velocity};
		}
	}

	return null;
}

/**
Scrolls panes toward the pointer while it is held near their edges. The innermost pane wins, and an
outer one takes over when the inner one cannot move further that way. `onScroll` runs after each
frame that moved something, so the caller can work out the drop position again.
*/
export function createAutoscroller(
	env: AutoscrollEnv,
	onScroll?: () => void,
): Autoscroller {
	let pointer: {x: number; y: number} | null = null;
	let frame: number | null = null;
	let lastTime: number | null = null;
	const carry = {x: 0, y: 0};

	function advance(axis: Axis, pixels: number) {
		const wanted = carry[axis] + pixels;
		const whole = Math.trunc(wanted);
		carry[axis] = wanted - whole;
		return whole;
	}

	function tick(time: number) {
		frame = null;
		if (!pointer) {
			return;
		}

		const elapsed =
			lastTime === null
				? FIRST_FRAME_MS
				: Math.min(Math.max(time - lastTime, 0), MAX_FRAME_MS);
		lastTime = time;
		const targets = env.targetsAt(pointer.x, pointer.y);
		const reduced = env.reducedMotion();
		let moved = false;
		for (const axis of ['x', 'y'] as const) {
			const choice = pick(targets, axis, pointer.x, pointer.y, reduced);
			if (!choice) {
				carry[axis] = 0;
				continue;
			}

			const whole = advance(axis, (choice.velocity * elapsed) / 1000);
			if (whole === 0) {
				continue;
			}

			choice.target.scrollBy(axis, whole);
			moved = true;
		}

		if (moved) {
			onScroll?.();
		}

		// The loop keeps running until stopped: a list that loads more rows can become scrollable again.
		if (pointer && frame === null) {
			frame = env.requestFrame(tick);
		}
	}

	return {
		update(x, y) {
			pointer = {x, y};
			if (frame !== null) {
				return;
			}

			lastTime = null;
			frame = env.requestFrame(tick);
		},
		stop() {
			pointer = null;
			lastTime = null;
			carry.x = 0;
			carry.y = 0;
			if (frame === null) {
				return;
			}

			env.cancelFrame(frame);
			frame = null;
		},
	};
}

function scrollsOn(overflow: string) {
	return ['auto', 'scroll', 'overlay'].includes(overflow);
}

function canMove(element: Element, axis: Axis, direction: Direction) {
	const position = axis === 'y' ? element.scrollTop : element.scrollLeft;
	const visible = axis === 'y' ? element.clientHeight : element.clientWidth;
	const total = axis === 'y' ? element.scrollHeight : element.scrollWidth;
	return direction < 0 ? position > 0 : position + visible < total - 1;
}

function moveBy(
	scroller: {scrollBy: (options: ScrollToOptions) => void},
	axis: Axis,
	pixels: number,
) {
	// An explicit instant step: a page with `scroll-behavior: smooth` must not animate each frame.
	scroller.scrollBy(
		axis === 'y'
			? {top: pixels, behavior: 'instant'}
			: {left: pixels, behavior: 'instant'},
	);
}

function viewportBox(): Box {
	const root = document.documentElement;
	return {left: 0, top: 0, right: root.clientWidth, bottom: root.clientHeight};
}

function elementTarget(
	element: Element,
	scrollsX: boolean,
	scrollsY: boolean,
): ScrollTarget {
	const {left, top, right, bottom} = element.getBoundingClientRect();
	return {
		// The pane's own edges: one that lies past the window cannot take the pointer from the window.
		bounds: {left, top, right, bottom},
		canScroll: (axis, direction) =>
			(axis === 'y' ? scrollsY : scrollsX) && canMove(element, axis, direction),
		scrollBy: (axis, pixels) => moveBy(element, axis, pixels),
	};
}

/**
The real page: scroll panes found from the element under the pointer, then the window.
*/
export function pageEnv(): AutoscrollEnv {
	return {
		targetsAt(x, y) {
			const view = viewportBox();
			const targets: ScrollTarget[] = [];
			let node = document.elementFromPoint(x, y);
			while (
				node &&
				node !== document.body &&
				node !== document.documentElement
			) {
				const style = getComputedStyle(node);
				const scrollsX = scrollsOn(style.overflowX);
				const scrollsY = scrollsOn(style.overflowY);
				if (scrollsX || scrollsY) {
					targets.push(elementTarget(node, scrollsX, scrollsY));
				}

				node = node.parentElement;
			}

			const root = document.scrollingElement ?? document.documentElement;
			targets.push({
				bounds: view,
				canScroll: (axis, direction) => canMove(root, axis, direction),
				scrollBy: (axis, pixels) => moveBy(globalThis, axis, pixels),
			});
			return targets;
		},
		requestFrame: (callback) => requestAnimationFrame(callback),
		cancelFrame(id) {
			cancelAnimationFrame(id);
		},
		reducedMotion: () =>
			globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches,
		atWindowEdge(x, y) {
			const view = viewportBox();
			return x <= 0 || y <= 0 || x >= view.right - 1 || y >= view.bottom - 1;
		},
	};
}

/**
An autoscroller for a drag the page runs itself (the pointer based column drag).
*/
export function createPageAutoscroller(onScroll?: () => void) {
	return createAutoscroller(pageEnv(), onScroll);
}

type DragSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/**
Autoscrolls for every native drag that crosses the page: saved tabs, sessions, bookmarks, columns, and
links dragged in from elsewhere. Call it once per page and run the returned function on teardown.

It starts on the first `dragover` and ends on a drop, the end of the drag (which also covers Escape),
the pointer leaving the window, or any ordinary input, which cannot arrive during a native drag and so
means the drag is already over.
*/
export function watchDragAutoscroll(
	source: DragSource = document,
	env: AutoscrollEnv = pageEnv(),
) {
	const scroller = createAutoscroller(env);
	const stop = () => {
		scroller.stop();
	};

	const onOver = (event: Event) => {
		const {clientX, clientY} = event as DragEvent;
		scroller.update(clientX, clientY);
	};

	const onLeave = (event: Event) => {
		const {clientX, clientY, relatedTarget} = event as DragEvent;
		// Moving between elements also fires dragleave; only leaving the window ends the scroll.
		if (!relatedTarget && env.atWindowEdge(clientX, clientY)) {
			stop();
		}
	};

	const ending = ['dragend', 'drop', 'pointermove', 'pointerdown', 'keydown'];
	// The same options object for add and remove: some runtimes ignore a bare `true` when removing.
	const capture = {capture: true};
	source.addEventListener('dragover', onOver, capture);
	source.addEventListener('dragleave', onLeave, capture);
	for (const type of ending) {
		source.addEventListener(type, stop, capture);
	}

	return () => {
		stop();
		source.removeEventListener('dragover', onOver, capture);
		source.removeEventListener('dragleave', onLeave, capture);
		for (const type of ending) {
			source.removeEventListener(type, stop, capture);
		}
	};
}
