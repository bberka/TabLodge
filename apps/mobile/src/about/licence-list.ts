/*
The search and text layout of the Open source licences sheet.
*/
import type {LicenceEntry} from './licence-data';

/**
The packages whose name or licence contains every word of the query.
*/
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

/**
Licence files are wrapped at about 80 columns, which breaks every line twice on a phone. This joins the lines of each
paragraph, keeps the blank lines between paragraphs, and starts each list item on its own line.
*/
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
