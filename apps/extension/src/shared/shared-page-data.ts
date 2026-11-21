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

const BLOCK = new RegExp(
	String.raw`<script\b[^>]*\bid=["']?${SHARED_PAGE_DATA_ID}\b[^>]*>([\s\S]*?)</script\s*>`,
	'i',
);

export function readSharedPageData(html: string): unknown {
	const match = BLOCK.exec(html);
	if (!match) {
		return undefined;
	}

	try {
		return JSON.parse(match[1]) as unknown;
	} catch {
		return undefined;
	}
}
