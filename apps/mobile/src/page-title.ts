// How much of a page is read when looking for its title, the same cut the server makes.
const READ_LIMIT = 262_144;
const MAX_TEXT = 300;

const NAMED: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

function decode(text: string): string {
	return text.replaceAll(
		/&(#x[\da-f]+|#\d+|[a-z]+);/gi,
		(whole, entity: string) => {
			if (entity.startsWith('#')) {
				const code =
					entity[1] === 'x' || entity[1] === 'X'
						? Number.parseInt(entity.slice(2), 16)
						: Number.parseInt(entity.slice(1), 10);
				return Number.isSafeInteger(code) && code > 0 && code < 0x11_00_00
					? String.fromCodePoint(code)
					: whole;
			}

			return NAMED[entity.toLowerCase()] ?? whole;
		},
	);
}

const clean = (text: string): string | undefined => {
	const flat = decode(text).replaceAll(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
	return flat === '' ? undefined : flat;
};

/**
The content of a `<meta>` tag with this `property` or `name`, whichever order its attributes are in.
*/
function metaContent(html: string, key: string): string | undefined {
	for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
		const named = new RegExp(
			String.raw`(?:property|name)\s*=\s*["']${key}["']`,
			'i',
		).test(tag);
		if (!named) {
			continue;
		}

		const content = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
		const found = clean(content?.[1] ?? content?.[2] ?? '');
		if (found) {
			return found;
		}
	}

	return undefined;
}

/**
The title and description a page gives itself: the share title when it has one, otherwise the `<title>`. Only the start
of the page is read.
*/
export function readPage(html: string): {title?: string; description?: string} {
	const head = html.slice(0, READ_LIMIT);
	const tag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head);
	return {
		title: metaContent(head, 'og:title') ?? clean(tag?.[1] ?? ''),
		description:
			metaContent(head, 'og:description') ?? metaContent(head, 'description'),
	};
}
