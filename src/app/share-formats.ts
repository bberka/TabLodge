// Pure builders for the Share dialog: an HTML page, Markdown, plain links and rich text.
import {escapeHtml} from './escape-html';

export type ShareLink = {
	title?: string;
	url: string;
	pinned?: boolean;
	nativeGroup?: {title?: string} | null;
};
export type ShareGroup = {
	name: string;
	description?: string;
	createdAt?: number;
	tabs: readonly ShareLink[];
};
export type ShareMethod = 'html' | 'markdown' | 'links' | 'rich';

const SHARE_PREVIEW_GROUP_LIMIT = 3;
const SHARE_PREVIEW_LINK_LIMIT = 3;

const label = (link: ShareLink) => String(link.title || link.url);

export type SharePreviewGroup = Omit<ShareGroup, 'tabs'> & {
	tabs: readonly ShareLink[];
	moreLinks: number;
};
type SharePreviewBase = {
	groups: SharePreviewGroup[];
	moreGroups: number;
	omittedLinks: number;
};
export type SharePreview = SharePreviewBase &
	({format: 'html'} | {format: 'markdown' | 'links' | 'rich'; text: string});

export function sharePreview(
	groups: readonly ShareGroup[],
	method: ShareMethod,
): SharePreview {
	const shownGroups = groups.slice(0, SHARE_PREVIEW_GROUP_LIMIT);
	const previewGroups = shownGroups.map((group) => ({
		...group,
		tabs: group.tabs.slice(0, SHARE_PREVIEW_LINK_LIMIT),
		moreLinks: Math.max(0, group.tabs.length - SHARE_PREVIEW_LINK_LIMIT),
	}));
	const sampleGroups: ShareGroup[] = previewGroups.map(
		({name, description, createdAt, tabs}) => ({
			name,
			...(description !== undefined && {description}),
			...(createdAt !== undefined && {createdAt}),
			tabs,
		}),
	);
	const base: SharePreviewBase = {
		groups: previewGroups,
		moreGroups: Math.max(0, groups.length - shownGroups.length),
		omittedLinks:
			groups.reduce((count, group) => count + group.tabs.length, 0) -
			previewGroups.reduce((count, group) => count + group.tabs.length, 0),
	};

	switch (method) {
		case 'html': {
			return {...base, format: method};
		}

		case 'markdown': {
			return {...base, format: method, text: shareMarkdown(sampleGroups)};
		}

		case 'links': {
			return {...base, format: method, text: shareLinks(sampleGroups)};
		}

		case 'rich': {
			return {...base, format: method, text: shareRich(sampleGroups).text};
		}
	}
}

export function shareCounts(groups: readonly ShareGroup[]) {
	return {
		groups: groups.length,
		links: groups.reduce((sum, group) => sum + group.tabs.length, 0),
	};
}

export function shareMarkdown(groups: readonly ShareGroup[]): string {
	return groups
		.map(
			(group) =>
				`# ${group.name}\n\n${group.tabs.map((tab) => `- [${label(tab).replaceAll(/[[\\\]]/g, String.raw`\$&`)}](${tab.url})`).join('\n')}`,
		)
		.join('\n\n');
}

export function shareLinks(groups: readonly ShareGroup[]): string {
	return groups.flatMap((group) => group.tabs.map((tab) => tab.url)).join('\n');
}

export function shareRich(groups: readonly ShareGroup[]): {
	text: string;
	html: string;
} {
	return {
		text: groups
			.map(
				(group) =>
					`${group.name}\n${group.tabs.map((tab) => `${label(tab)}\n${tab.url}`).join('\n\n')}`,
			)
			.join('\n'.repeat(3)),
		html: groups
			.map(
				(group) =>
					`<h3>${escapeHtml(group.name)}</h3><ul>${group.tabs.map((tab) => `<li><a href="${escapeHtml(tab.url)}">${escapeHtml(label(tab))}</a></li>`).join('')}</ul>`,
			)
			.join(''),
	};
}

export function shareHtmlPage(
	title: string,
	groups: readonly ShareGroup[],
	appName: string,
	formatDate: (value: number) => string = (value) =>
		new Date(value).toLocaleDateString(),
): string {
	const parts = groups
		.map(
			(group) =>
				`<article><header><div><h2>${escapeHtml(group.name)}</h2>${group.createdAt ? `<p>Saved ${escapeHtml(formatDate(group.createdAt))}</p>` : ''}</div><span>${group.tabs.length} ${group.tabs.length === 1 ? 'link' : 'links'}</span></header>${group.description ? `<p class="notes">${escapeHtml(group.description)}</p>` : ''}<ol>${group.tabs.map((tab) => `<li><a href="${escapeHtml(tab.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label(tab))}</a><small>${escapeHtml(tab.url)}${tab.pinned ? ' · Pinned' : ''}${tab.nativeGroup?.title ? ` · ${escapeHtml(tab.nativeGroup.title)}` : ''}</small></li>`).join('')}</ol></article>`,
		)
		.join('');
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f6fa;color:#222737;font:14px/1.55 system-ui,sans-serif}main{width:min(780px,calc(100% - 32px));margin:40px auto}h1{font-size:30px;letter-spacing:-1px}article{margin:14px 0;border:1px solid #e0e3ed;border-radius:15px;background:#fff;overflow:hidden}header{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid #e0e3ed}h2{margin:0;font-size:18px}header p,header span,small{color:#686f84;font-size:12px}p,ol{margin:16px 20px}p,h1,h2{overflow-wrap:anywhere}header>div{min-width:0}ol{padding-left:22px}li{padding:10px 0;border-top:1px solid #eee}a{display:block;color:#5c54c3;font-weight:650;overflow-wrap:anywhere}small{display:block;margin-top:4px;overflow-wrap:anywhere}.notes{white-space:pre-wrap}</style><main><h1>${escapeHtml(title)}</h1><p>Shared from ${escapeHtml(appName)} · ${shareCounts(groups).links} links</p>${parts}</main></html>`;
}
