export const SHARED_PAGE_DATA_ID = 'tablodge-shared-page';
export const SHARED_PAGE_DATA_FORMAT = 'tablodge-shared-page';
export const SHARED_PAGE_DATA_VERSION = 1;

export type SharedPageKind = 'bookmarks' | 'sessions';

export type SharedPageData = {
	format: typeof SHARED_PAGE_DATA_FORMAT;
	version: typeof SHARED_PAGE_DATA_VERSION;
	kind: SharedPageKind;
	title: string;
	sharedAt?: number;
	groups: Array<{
		name: string;
		description?: string;
		createdAt?: number;
		links: Array<{title: string; url: string; pinned?: boolean}>;
	}>;
};

export function sharedPageDataBlock(data: SharedPageData): string {
	const json = JSON.stringify(data).replaceAll('<', String.raw`\u003C`);
	return `<script type="application/json" id="${SHARED_PAGE_DATA_ID}">${json}</script>`;
}

const DATA_ID_ATTRIBUTES = [
	`id="${SHARED_PAGE_DATA_ID}"`,
	`id='${SHARED_PAGE_DATA_ID}'`,
	`id=${SHARED_PAGE_DATA_ID}>`,
	`id=${SHARED_PAGE_DATA_ID} `,
];

function dataBlockText(html: string): string | undefined {
	const lower = html.replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase());
	let at = lower.indexOf('<script');
	while (at !== -1) {
		const tagEnd = lower.indexOf('>', at);
		if (tagEnd === -1) {
			return undefined;
		}

		const close = lower.indexOf('</script', tagEnd);
		if (close === -1) {
			return undefined;
		}

		const tag = `${lower.slice(at, tagEnd)}>`;
		if (DATA_ID_ATTRIBUTES.some((attribute) => tag.includes(attribute))) {
			return html.slice(tagEnd + 1, close);
		}

		at = lower.indexOf('<script', close);
	}

	return undefined;
}

export function readSharedPageData(html: string): unknown {
	const text = dataBlockText(html);
	if (text === undefined) {
		return undefined;
	}

	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}
