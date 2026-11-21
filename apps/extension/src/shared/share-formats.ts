// Pure builders for the Share dialog: an HTML page, Markdown, plain links and rich text.
import {escapeHtml} from './escape-html';
import {
	SHARED_PAGE_DATA_FORMAT,
	SHARED_PAGE_DATA_VERSION,
	sharedPageDataBlock,
	type SharedPageKind,
} from './shared-page-data';
import {siteName} from './web-url';

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
				`# ${group.name}\n\n${group.tabs.map((tab) => `- [${label(tab).replaceAll(/[[\\\]]/g, String.raw`\$&`)}](${tab.url.replaceAll('(', '%28').replaceAll(')', '%29')})`).join('\n')}`,
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

const WEBSITE = 'https://tablodge.bbay.dev';
const ANDROID_PACKAGE = 'com.bberka.tablodge';
const TILE_HUES = 8;

export type SharePageOptions = {
	kind?: SharedPageKind;
	sharedAt?: number;
	url?: string;
	formatDate?: (value: number) => string;
};

function tileClass(host: string) {
	let hash = 0;
	for (const char of host) {
		hash = (hash * 31 + char.codePointAt(0)!) % 9973;
	}

	return `t${hash % TILE_HUES}`;
}

function linkRow(link: ShareLink) {
	const site = siteName(link.url);
	const letter = (
		/[\da-z]/i.exec(site)?.[0] ??
		[...site][0] ??
		'?'
	).toUpperCase();
	const notes = [
		site,
		...(link.pinned ? ['Pinned'] : []),
		...(link.nativeGroup?.title ? [link.nativeGroup.title] : []),
	];
	return `<li><span class="tile ${tileClass(site)}" aria-hidden="true">${escapeHtml(letter)}</span><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label(link))}</a><small>${escapeHtml(notes.join(' · '))}</small></li>`;
}

function addPanel(url: string) {
	const intent = `intent://import?url=${encodeURIComponent(url)}#Intent;scheme=tablodge;package=${ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(`${WEBSITE}/#android`)};end`;
	return `<section id="add" class="add" aria-labelledby="add-h"><h2 id="add-h">Add these links to TabLodge</h2><ul><li><b>Android app:</b> <a class="button" href="${escapeHtml(intent)}">Open in the TabLodge app</a></li><li><b>Browser extension:</b> click TabLodge in your browser’s toolbar, then <b>Add this shared page</b>.</li><li>Or paste this address into TabLodge › Import › From a link:<code>${escapeHtml(url)}</code></li></ul><p>Don’t have TabLodge? <a href="${WEBSITE}/" target="_blank" rel="noopener noreferrer">Get TabLodge</a>, free for Chrome, Firefox and Android.</p><a class="close" href="#top">Close</a></section>`;
}

const PAGE_STYLE =
	'*{box-sizing:border-box}:root{color-scheme:light dark;--bg:#f6f7fb;--card:#fff;--text:#1f2433;--muted:#5c6375;--line:#e2e5ee;--accent:#4f46c8;--on-accent:#fff;--soft:#eceafd;--l:92%;--d:30%}@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1a1d25;--text:#e8eaf0;--muted:#a6acba;--line:#2d313d;--accent:#aba5ff;--on-accent:#15132e;--soft:#24223d;--l:24%;--d:86%}}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}a{color:var(--accent)}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}.page{width:min(820px,100% - 32px);margin:0 auto;padding:32px 0 24px}h1{margin:0;font-size:clamp(24px,6vw,32px);line-height:1.2;overflow-wrap:anywhere}.meta{margin:6px 0 16px;color:var(--muted)}.button{display:inline-block;padding:9px 16px;border-radius:999px;background:var(--accent);color:var(--on-accent);font-weight:600;text-decoration:none}.add{display:none;margin:16px 0;padding:16px 20px;border:1px solid var(--line);border-radius:14px;background:var(--card)}.add:target{display:block}.add h2{margin:0 0 8px;font-size:17px}.add ul{margin:0;padding-left:20px}.add li{margin:8px 0}.add code{display:block;margin-top:4px;padding:6px 8px;border-radius:6px;background:var(--soft);font-size:13px;overflow-wrap:anywhere;user-select:all}.add p{margin:12px 0 0;color:var(--muted)}.close{display:inline-block;margin-top:8px}nav{margin:24px 0 8px}nav h2{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}nav ol{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}nav a{display:inline-flex;gap:6px;padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);text-decoration:none;color:var(--text)}nav a span{color:var(--muted)}section.group{margin:16px 0;border:1px solid var(--line);border-radius:14px;background:var(--card);scroll-margin-top:12px}.group>header{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--line)}.group h2{margin:0;font-size:18px;overflow-wrap:anywhere}.group header span,.saved{color:var(--muted);font-size:13px}.saved,.notes{margin:12px 18px 0}.notes{white-space:pre-wrap;overflow-wrap:anywhere}.group ul{margin:0;padding:4px 0;list-style:none}.group li{display:grid;grid-template-columns:32px minmax(0,1fr);column-gap:12px;align-items:center;padding:8px 18px}.group li+li{border-top:1px solid var(--line)}.tile{grid-row:span 2;display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:hsl(var(--h) 55% var(--l));color:hsl(var(--h) 45% var(--d));font-weight:700;font-size:14px}.t0{--h:250}.t1{--h:200}.t2{--h:160}.t3{--h:120}.t4{--h:35}.t5{--h:10}.t6{--h:330}.t7{--h:290}.group li a{font-weight:600;line-height:24px;text-decoration:none;overflow-wrap:anywhere}.group li a:hover{text-decoration:underline}.group small{color:var(--muted);font-size:13px;overflow-wrap:anywhere}.top{display:block;padding:8px 18px 12px;font-size:13px}footer{margin:24px 0 0;color:var(--muted);font-size:13px;text-align:center}';

export function shareHtmlPage(
	title: string,
	groups: readonly ShareGroup[],
	appName: string,
	{
		kind = 'bookmarks',
		sharedAt,
		url,
		formatDate = (value) =>
			new Date(value).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
			}),
	}: SharePageOptions = {},
): string {
	const several = groups.length > 1;
	const groupNoun = kind === 'sessions' ? 'session' : 'column';
	const {links} = shareCounts(groups);
	const sections = groups
		.map((group, index) => {
			const id = `g${index + 1}`;
			const repeatedTitle = !several && group.name === title;
			const count = `${group.tabs.length} ${group.tabs.length === 1 ? 'link' : 'links'}`;
			const saved = group.createdAt
				? `<p class="saved">Saved ${escapeHtml(formatDate(group.createdAt))}</p>`
				: '';
			const header = repeatedTitle
				? ''
				: `<header><h2 id="${id}-h">${escapeHtml(group.name)}</h2><span>${count}</span></header>`;
			return `<section class="group" id="${id}"${repeatedTitle ? ` aria-label="${escapeHtml(group.name)}"` : ` aria-labelledby="${id}-h"`}>${header}${saved}${group.description ? `<p class="notes">${escapeHtml(group.description)}</p>` : ''}<ul>${group.tabs.map((tab) => linkRow(tab)).join('')}</ul>${several ? '<a class="top" href="#top">Back to top</a>' : ''}</section>`;
		})
		.join('');
	const meta = [
		`Links shared from ${escapeHtml(appName)}${sharedAt ? ` on ${escapeHtml(formatDate(sharedAt))}` : ''}`,
		...(several ? [`${groups.length} ${groupNoun}s`] : []),
		`${links} ${links === 1 ? 'link' : 'links'}`,
	].join(' · ');
	const nav = several
		? `<nav aria-labelledby="nav-h"><h2 id="nav-h">${kind === 'sessions' ? 'Sessions' : 'Columns'}</h2><ol>${groups.map((group, index) => `<li><a href="#g${index + 1}">${escapeHtml(group.name)} <span>${group.tabs.length}</span></a></li>`).join('')}</ol></nav>`
		: '';
	const data = sharedPageDataBlock({
		format: SHARED_PAGE_DATA_FORMAT,
		version: SHARED_PAGE_DATA_VERSION,
		kind,
		title,
		...(sharedAt && {sharedAt}),
		groups: groups.map((group) => ({
			name: group.name,
			...(group.description && {description: group.description}),
			...(group.createdAt && {createdAt: group.createdAt}),
			links: group.tabs.map((tab) => ({
				title: tab.title ?? '',
				url: tab.url,
				...(tab.pinned && {pinned: true}),
			})),
		})),
	});
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style><body><div class="page"><header id="top"><h1>${escapeHtml(title)}</h1><p class="meta">${meta}</p>${url ? `<a class="button" href="#add">Add to ${escapeHtml(appName)}</a>` : ''}</header>${url ? addPanel(url) : ''}${nav}<main>${sections}</main><footer>Made with <a href="${WEBSITE}/" target="_blank" rel="noopener noreferrer">${escapeHtml(appName)}</a></footer></div>${data}</body></html>`;
}
