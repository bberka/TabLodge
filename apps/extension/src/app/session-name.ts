export const SESSION_NAME_MAX = 120;

export function typedSessionName(raw: string): string | undefined {
	const name = raw.trim().slice(0, SESSION_NAME_MAX);
	return name || undefined;
}

export function numberedSessionNames(base: string, count: number): string[] {
	if (count <= 1) {
		return [base.slice(0, SESSION_NAME_MAX)];
	}

	const stem = base.slice(0, 100);
	return Array.from(
		{length: count},
		(_, index) => `${stem} (${index + 1}/${count})`,
	);
}

export const baseSessionName = (name: string) =>
	name.replace(/ \(\d+\/\d+\)$/, '');

export function promptGroupIds(search: string): string[] {
	return [...new Set(new URLSearchParams(search).getAll('groupId'))].filter(
		Boolean,
	);
}
