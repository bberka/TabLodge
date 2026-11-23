import type {LicenceEntry} from './licence-data';

export function searchLicences(
	packages: readonly LicenceEntry[],
	query: string,
): readonly LicenceEntry[] {
	const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return packages;
	}

	return packages.filter((entry) => {
		const text = `${entry.name} ${entry.licence}`.toLocaleLowerCase();
		return words.every((word) => text.includes(word));
	});
}

const LIST_ITEM = /^(?:[*\-•]|\d+\.|\([\da-z]+\))\s/i;

function joinLines(paragraph: string): string {
	let joined = '';
	for (const raw of paragraph.split('\n')) {
		const line = raw.trim();
		if (line) {
			joined +=
				joined === '' ? line : `${LIST_ITEM.test(line) ? '\n' : ' '}${line}`;
		}
	}

	return joined;
}

export const reflow = (text: string): string =>
	text
		.replaceAll('\r\n', '\n')
		.split(/\n\s*\n/)
		.map((paragraph) => joinLines(paragraph))
		.filter(Boolean)
		.join('\n\n');
