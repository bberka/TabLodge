/*
Hybrid logical clock for sync stamps. A stamp's `h` is the wall time in milliseconds and a counter, both fixed
width base 36, so plain string order is causal order. Two writes with the same `h` are ordered by device id.
Wall time never goes backwards on a device, and a stamp received from another device moves the clock past it,
so a device whose system clock is behind still writes stamps that win over what it has seen.
*/

const WALL_WIDTH = 11;
const COUNTER_WIDTH = 5;
const MAX_WALL = 36 ** WALL_WIDTH - 1;
const MAX_COUNTER = 36 ** COUNTER_WIDTH - 1;
const STAMP_PATTERN = /^[\da-z]{16}$/;

/**
A stamp from a clock more than this far ahead of the receiver is refused, so one device with a wrong clock
cannot win every later edit.
*/
export const MAX_CLOCK_DRIFT_MS = 24 * 60 * 60 * 1000;

export type Clock = {wall: number; counter: number};
export type Stamp = {h: string; d: string};

export class ClockDriftError extends Error {
	constructor(readonly stamp: string) {
		super('Sync stamp is too far in the future');
		this.name = 'ClockDriftError';
	}
}

export const startClock = (): Clock => ({wall: 0, counter: 0});

function formatStamp({wall, counter}: Clock): string {
	return (
		wall.toString(36).padStart(WALL_WIDTH, '0') +
		counter.toString(36).padStart(COUNTER_WIDTH, '0')
	);
}

export function parseStamp(h: string): Clock | undefined {
	if (!STAMP_PATTERN.test(h)) {
		return undefined;
	}

	return {
		wall: Number.parseInt(h.slice(0, WALL_WIDTH), 36),
		counter: Number.parseInt(h.slice(WALL_WIDTH), 36),
	};
}

/**
The clock after a local write at `now`, and the stamp that write carries.
*/
export function tick(clock: Clock, now: number): {clock: Clock; h: string} {
	const wall = Math.max(clock.wall, Math.floor(now));
	const next = {wall, counter: wall === clock.wall ? clock.counter + 1 : 0};
	if (next.wall > MAX_WALL || next.counter > MAX_COUNTER) {
		throw new RangeError('Sync clock overflow');
	}

	return {clock: next, h: formatStamp(next)};
}

/**
The clock after seeing a stamp written elsewhere, so the next `tick` comes after it. Throws `ClockDriftError` for a stamp too far ahead of `now`
and a `TypeError` for one that is not a stamp.
*/
export function observe(clock: Clock, h: string, now: number): Clock {
	const remote = parseStamp(h);
	if (!remote) {
		throw new TypeError('Not a sync stamp');
	}

	if (remote.wall > now + MAX_CLOCK_DRIFT_MS) {
		throw new ClockDriftError(h);
	}

	return formatStamp(remote) > formatStamp(clock) ? remote : clock;
}

/**
Negative when `a` was written before `b`. Equal stamps from the same device are the same write.
*/
export function compareStamps(a: Stamp, b: Stamp): number {
	if (a.h !== b.h) {
		return a.h < b.h ? -1 : 1;
	}

	if (a.d !== b.d) {
		return a.d < b.d ? -1 : 1;
	}

	return 0;
}
