// Pure helpers for the "Ask each time" session name: the dialog's empty-means-default rule and the prompt window's
// handling of several sessions saved at once. Kept apart from the React pieces so they can be tested alone.

/**
Longest session name the worker keeps.
*/
export const SESSION_NAME_MAX = 120;

/**
The name to send with SAVE_TABS from what was typed: trimmed, or `undefined` when left empty so the worker uses
the setting's fallback name.
*/
export function typedSessionName(raw: string): string | undefined {
	const name = raw.trim().slice(0, SESSION_NAME_MAX);
	return name || undefined;
}

/**
Names for the sessions one save created, from one typed base name: a single session keeps it as typed, several
become "Name (1/3)", "Name (2/3)", ... in save order.
*/
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

/**
A session name without the trailing " (1/3)" numbering added to sessions that were saved together.
*/
export const baseSessionName = (name: string) =>
	name.replace(/ \(\d+\/\d+\)$/, '');

/**
The session ids in the name prompt window's address (`?groupId=a&groupId=b`).
*/
export function promptGroupIds(search: string): string[] {
	return [...new Set(new URLSearchParams(search).getAll('groupId'))].filter(
		Boolean,
	);
}
