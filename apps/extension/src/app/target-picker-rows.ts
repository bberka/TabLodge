export type PickerTarget = {
	id: string;
	name: string;
	icon?: string;
	color?: string;
};

export type IndexedPickerTarget = {
	target: PickerTarget;
	search: string;
};

export type PickerRow =
	| {type: 'target'; target: PickerTarget; current: boolean}
	| {type: 'create'; name: string};

export const isCurrentPickerRow = (row: PickerRow | undefined) =>
	row?.type === 'target' && row.current;

export function indexPickerTargets(
	targets: readonly PickerTarget[],
): IndexedPickerTarget[] {
	return targets.map((target) => ({
		target,
		search: target.name.toLowerCase(),
	}));
}

export function filterPickerRows(
	indexed: readonly IndexedPickerTarget[],
	query: string,
	currentId: string | undefined,
	canCreate: boolean,
): PickerRow[] {
	const trimmed = query.trim();
	const needle = trimmed.toLowerCase();
	const matches: PickerRow[] = [];
	for (const entry of indexed) {
		if (!needle || entry.search.includes(needle)) {
			matches.push({
				type: 'target',
				target: entry.target,
				current: entry.target.id === currentId,
			});
		}
	}

	return matches.length === 0 && canCreate && needle
		? [{type: 'create', name: trimmed}]
		: matches;
}

export function stepPickerRow(
	rows: readonly PickerRow[],
	active: number,
	direction: 1 | -1,
): number | null {
	let next = active + direction;
	while (isCurrentPickerRow(rows[next])) {
		next += direction;
	}

	return next >= 0 && next < rows.length ? next : null;
}
