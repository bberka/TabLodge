import {canonicalJson, isCount, isRecord} from './library-values';

export type ListPatch = {
	length: number;
	head: number;
	tail: number;
	middle: unknown[];
};

const same = (a: unknown, b: unknown) =>
	a === b || canonicalJson(a) === canonicalJson(b);

export function diffList(
	old: readonly unknown[],
	current: readonly unknown[],
): ListPatch {
	const shortest = Math.min(old.length, current.length);
	let head = 0;
	while (head < shortest && same(old[head], current[head])) {
		head += 1;
	}

	let tail = 0;
	while (
		tail < shortest - head &&
		same(old[old.length - 1 - tail], current[current.length - 1 - tail])
	) {
		tail += 1;
	}

	return {
		length: current.length,
		head,
		tail,
		middle: old.slice(head, old.length - tail),
	};
}

export function parsePatch(value: unknown): ListPatch | undefined {
	return isRecord(value) &&
		isCount(value.length) &&
		isCount(value.head) &&
		isCount(value.tail) &&
		Array.isArray(value.middle)
		? {
				length: value.length,
				head: value.head,
				tail: value.tail,
				middle: value.middle,
			}
		: undefined;
}

export function applyPatch(
	current: readonly unknown[],
	patch: ListPatch,
): unknown[] | undefined {
	if (
		current.length !== patch.length ||
		patch.head + patch.tail > current.length
	) {
		return undefined;
	}

	return [
		...current.slice(0, patch.head),
		...patch.middle,
		...current.slice(current.length - patch.tail),
	];
}
