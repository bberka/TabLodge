import {
	arrayOf,
	archivedFolderIds,
	cleanText,
	positiveOr,
	type Raw,
} from './library-normalize';
import {isRecord} from './library-values';
import type {BookmarkColumn, SaveScope, Settings} from './types';

export type MenuItemProperties = chrome.contextMenus.CreateProperties;

export const MENU = {
	linkRoot: 'tablodge-link-root',
	linkBookmark: 'tablodge-link-bookmark',
	linkBookmarkNew: 'tablodge-link-bookmark-new',
	imageRoot: 'tablodge-image-root',
	imageBookmark: 'tablodge-image-bookmark',
	imageBookmarkNew: 'tablodge-image-bookmark-new',
	mediaRoot: 'tablodge-media-root',
	mediaBookmark: 'tablodge-media-bookmark',
	mediaBookmarkNew: 'tablodge-media-bookmark-new',
	pageRoot: 'tablodge-page-root',
	pageBookmark: 'tablodge-page-bookmark',
	pageBookmarkNew: 'tablodge-page-bookmark-new',
	pageSend: 'tablodge-page-send',
	pageSendNew: 'tablodge-page-send-new',
	pageKeepCopy: 'tablodge-page-keep-copy',
	selectionRoot: 'tablodge-selection-root',
	selectionSearch: 'tablodge-selection-search',
	selectionQuote: 'tablodge-selection-quote',
	actionOpen: 'tablodge-action-open',
	actionSaveWindow: 'tablodge-action-save-window',
	actionExclude: 'tablodge-action-exclude',
	actionSidePanel: 'tablodge-action-side-panel',
	actionHelp: 'tablodge-action-help',
	actionSettings: 'tablodge-action-settings',
} as const;

export const PAGE_BOOKMARK_TITLE = {
	page: 'Bookmark this page to',
	tab: 'Bookmark this tab to',
} as const;

export const PAGE_SEND_PREFIX = 'tablodge-page-send:';

export const LINK_COLUMN_PREFIX = 'tablodge-link-bookmark:';

export const PAGE_COLUMN_PREFIX = 'tablodge-page-bookmark:';

export const IMAGE_COLUMN_PREFIX = 'tablodge-image-bookmark:';

export const MEDIA_COLUMN_PREFIX = 'tablodge-media-bookmark:';

export const MENU_SESSION_LIMIT = 10;

export const PAGE_SAVE_ITEMS: ReadonlyArray<
	readonly [id: string, title: string, scope: SaveScope]
> = [
	['tablodge-page-save-selected', 'Save selected tabs', 'selected'],
	['tablodge-page-save-window', 'Save this window', 'window'],
	[
		'tablodge-page-save-all-windows',
		'Save tabs from all windows',
		'all-windows',
	],
];

export const WEB_URL_PATTERNS = ['http://*/*', 'https://*/*'];

export const CHROMIUM_TAB_MENU_VERSION = 150;

export function hasTabMenu(browser: {
	listsTabContext: boolean;
	isFirefox: boolean;
	userAgent: string;
}): boolean {
	if (!browser.listsTabContext) {
		return false;
	}

	return (
		browser.isFirefox ||
		Number(/Chrome\/(\d+)/.exec(browser.userAgent)?.[1]) >=
			CHROMIUM_TAB_MENU_VERSION
	);
}

export function contextMenuSignature(
	settings: Settings,
	columns: BookmarkColumn[],
	sessions: MenuSession[],
) {
	return JSON.stringify([
		settings.contextMenusEnabled,
		settings.contextMenuLinksEnabled,
		settings.contextMenuPageEnabled,
		settings.contextMenuSelectionEnabled,
		settings.contextMenuActionEnabled,
		columns.map((column) => [column.id, column.name]),
		settings.contextMenuPageEnabled
			? sessions.map((session) => [session.id, session.name])
			: [],
	]);
}

export type MenuSession = {id: string; name: string};

export function menuSessions(
	rawGroups: unknown,
	rawFolders: unknown,
): MenuSession[] {
	const archived = archivedFolderIds(rawFolders);
	return arrayOf(rawGroups)
		.filter(
			(group): group is Raw & {id: string} =>
				isRecord(group) &&
				typeof group.id === 'string' &&
				group.id !== '' &&
				!archived.has(cleanText(group.folderId, '', 100)),
		)
		.toSorted(
			(a, b) =>
				positiveOr(b.updatedAt, positiveOr(b.createdAt, 0)) -
				positiveOr(a.updatedAt, positiveOr(a.createdAt, 0)),
		)
		.slice(0, MENU_SESSION_LIMIT)
		.map((group) => ({
			id: group.id,
			name: cleanText(group.name, 'Untitled session', 60),
		}));
}

export function contextMenuPlan(
	settings: Settings,
	columns: BookmarkColumn[],
	sessions: MenuSession[],
	env: {
		appName: string;
		hasSidePanel: boolean;
		hasTabContext: boolean;
		hasAmpersandAccessKeys: boolean;
	},
	excludeState: {checked: boolean; enabled: boolean} = {
		checked: false,
		enabled: true,
	},
): MenuItemProperties[] {
	if (!settings.contextMenusEnabled) {
		return [];
	}

	const items: MenuItemProperties[] = [];
	const columnSubmenu = (
		parentId: string,
		prefix: string,
		newId: string,
		contexts: MenuItemProperties['contexts'],
		extra: {targetUrlPatterns?: string[]; documentUrlPatterns?: string[]},
	) => {
		for (const column of columns) {
			items.push({
				id: `${prefix}${column.id}`,
				title: column.name,
				parentId,
				contexts,
				...extra,
			});
		}

		if (columns.length > 0) {
			items.push({
				id: `${parentId}-separator`,
				type: 'separator',
				parentId,
				contexts,
				...extra,
			});
		}

		items.push({
			id: newId,
			title: 'New column',
			parentId,
			contexts,
			...extra,
		});
	};

	if (settings.contextMenuLinksEnabled) {
		const link = {
			contexts: ['link'],
			targetUrlPatterns: WEB_URL_PATTERNS,
		} satisfies Partial<MenuItemProperties>;
		items.push(
			{id: MENU.linkRoot, title: env.appName, ...link},
			{
				id: MENU.linkBookmark,
				title: 'Bookmark link to',
				parentId: MENU.linkRoot,
				...link,
			},
		);
		columnSubmenu(
			MENU.linkBookmark,
			LINK_COLUMN_PREFIX,
			MENU.linkBookmarkNew,
			link.contexts,
			{targetUrlPatterns: WEB_URL_PATTERNS},
		);

		const image = {
			contexts: ['image'],
			targetUrlPatterns: WEB_URL_PATTERNS,
		} satisfies Partial<MenuItemProperties>;
		items.push(
			{id: MENU.imageRoot, title: env.appName, ...image},
			{
				id: MENU.imageBookmark,
				title: 'Bookmark image to',
				parentId: MENU.imageRoot,
				...image,
			},
		);
		columnSubmenu(
			MENU.imageBookmark,
			IMAGE_COLUMN_PREFIX,
			MENU.imageBookmarkNew,
			image.contexts,
			{targetUrlPatterns: WEB_URL_PATTERNS},
		);

		const media = {
			contexts: ['video', 'audio'],
			documentUrlPatterns: WEB_URL_PATTERNS,
		} satisfies Partial<MenuItemProperties>;
		items.push(
			{id: MENU.mediaRoot, title: env.appName, ...media},
			{
				id: MENU.mediaBookmark,
				title: 'Bookmark video to',
				parentId: MENU.mediaRoot,
				...media,
			},
		);
		columnSubmenu(
			MENU.mediaBookmark,
			MEDIA_COLUMN_PREFIX,
			MENU.mediaBookmarkNew,
			media.contexts,
			{documentUrlPatterns: WEB_URL_PATTERNS},
		);
	}

	if (settings.contextMenuPageEnabled) {
		const page = {
			contexts: env.hasTabContext
				? ['page', 'frame', 'tab']
				: ['page', 'frame'],
			documentUrlPatterns: WEB_URL_PATTERNS,
		} satisfies Partial<MenuItemProperties>;
		items.push(
			{id: MENU.pageRoot, title: env.appName, ...page},
			{
				id: MENU.pageBookmark,
				title: PAGE_BOOKMARK_TITLE.page,
				parentId: MENU.pageRoot,
				...page,
			},
		);
		columnSubmenu(
			MENU.pageBookmark,
			PAGE_COLUMN_PREFIX,
			MENU.pageBookmarkNew,
			page.contexts,
			{documentUrlPatterns: WEB_URL_PATTERNS},
		);

		items.push({
			id: MENU.pageSend,
			title: 'Send this tab to session',
			parentId: MENU.pageRoot,
			...page,
		});
		for (const session of sessions) {
			items.push({
				id: `${PAGE_SEND_PREFIX}${session.id}`,
				title: session.name,
				parentId: MENU.pageSend,
				...page,
			});
		}

		if (sessions.length > 0) {
			items.push({
				id: `${MENU.pageSend}-separator`,
				type: 'separator',
				parentId: MENU.pageSend,
				...page,
			});
		}

		items.push(
			{
				id: MENU.pageSendNew,
				title: 'New session',
				parentId: MENU.pageSend,
				...page,
			},
			{
				id: MENU.pageKeepCopy,
				title: 'Keep a copy',
				parentId: MENU.pageRoot,
				...page,
			},
			{
				id: 'tablodge-page-separator',
				type: 'separator',
				parentId: MENU.pageRoot,
				...page,
			},
		);

		for (const [id, title] of PAGE_SAVE_ITEMS) {
			items.push({id, title, parentId: MENU.pageRoot, ...page});
		}
	}

	if (settings.contextMenuSelectionEnabled) {
		const selection = {
			contexts: ['selection'],
		} satisfies Partial<MenuItemProperties>;
		items.push(
			{id: MENU.selectionRoot, title: env.appName, ...selection},
			{
				id: MENU.selectionSearch,
				title: 'Search saved tabs & bookmarks for “%s”',
				parentId: MENU.selectionRoot,
				...selection,
			},
			{
				id: MENU.selectionQuote,
				title: 'Save quote',
				parentId: MENU.selectionRoot,
				documentUrlPatterns: WEB_URL_PATTERNS,
				...selection,
			},
		);
	}

	if (settings.contextMenuActionEnabled) {
		const action = {contexts: ['action']} satisfies Partial<MenuItemProperties>;
		items.push({id: MENU.actionOpen, title: 'Open dashboard', ...action});
		if (env.hasSidePanel) {
			items.push({
				id: MENU.actionSidePanel,
				title: 'Open side panel',
				...action,
			});
		}

		items.push(
			{
				id: MENU.actionSaveWindow,
				title: 'Save this window',
				...action,
			},
			{
				id: MENU.actionExclude,
				title: 'Exclude this site from saves',
				type: 'checkbox',
				checked: excludeState.checked,
				enabled: excludeState.enabled,
				...action,
			},
			{id: MENU.actionHelp, title: 'Help', ...action},
			{id: MENU.actionSettings, title: 'Settings', ...action},
		);
	}

	return env.hasAmpersandAccessKeys
		? items.map((item) =>
				item.title ? {...item, title: item.title.replaceAll('&', '&&')} : item,
			)
		: items;
}
