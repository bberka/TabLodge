/*
The right-click menu tree: which entries exist for the current settings, columns, and sessions, and the ids the
service worker answers clicks with. Pure, so the whole tree can be checked without a browser; the worker creates
the entries and handles the clicks.
*/
import {
	arrayOf,
	archivedFolderIds,
	cleanText,
	positiveOr,
	type Raw,
} from './library-normalize';
import {isRecord} from './library-values';
import type {BookmarkColumn, SaveScope, Settings} from './types';

// One parent item per context, named after the extension, keeps the browser menu short. The toolbar
// icon's menu is already the extension's own, so its items are top level (Chrome shows at most
// ACTION_MENU_TOP_LEVEL_LIMIT = 6). Tab-strip menus are not available to extensions.
// Menu ids keep the "tablodge-" prefix (see the note at STORAGE_KEY); column items append the column id.
export type MenuItemProperties = chrome.contextMenus.CreateProperties;

export const MENU = {
	linkRoot: 'tablodge-link-root',
	linkBookmark: 'tablodge-link-bookmark',
	linkBookmarkNew: 'tablodge-link-bookmark-new',
	linkSend: 'tablodge-link-send',
	linkSave: 'tablodge-link-save',
	pageRoot: 'tablodge-page-root',
	pageBookmark: 'tablodge-page-bookmark',
	pageBookmarkNew: 'tablodge-page-bookmark-new',
	pageSend: 'tablodge-page-send',
	pageSendNew: 'tablodge-page-send-new',
	selectionRoot: 'tablodge-selection-root',
	selectionSearch: 'tablodge-selection-search',
	actionOpen: 'tablodge-action-open',
	actionSaveWindow: 'tablodge-action-save-window',
	actionExclude: 'tablodge-action-exclude',
	actionSidePanel: 'tablodge-action-side-panel',
	actionHelp: 'tablodge-action-help',
	actionSettings: 'tablodge-action-settings',
} as const;

/**
"Send this tab to session" items are `${PAGE_SEND_PREFIX}${sessionId}`.
*/
export const PAGE_SEND_PREFIX = 'tablodge-page-send:';
/**
"Save link to session" items are `${LINK_SEND_PREFIX}${sessionId}`.
*/
export const LINK_SEND_PREFIX = 'tablodge-link-send:';

/**
Column items are `${prefix}${columnId}`; the Unfiled pseudo-column uses BOOKMARK_UNFILED_ID.
*/
export const LINK_COLUMN_PREFIX = 'tablodge-link-bookmark:';

export const PAGE_COLUMN_PREFIX = 'tablodge-page-bookmark:';

/**
How many sessions the "Send this tab to session" and "Save link to session" submenus list, most recently changed first.
*/
export const MENU_SESSION_LIMIT = 10;

/**
The page menu's save actions, reusing the SAVE_TABS scopes.
*/
export const PAGE_SAVE_ITEMS: ReadonlyArray<
	readonly [id: string, title: string, scope: SaveScope]
> = [
	['tablodge-page-save-tab', 'Save this tab', 'this-tab'],
	['tablodge-page-save-window', 'Save this window', 'window'],
	['tablodge-page-save-selected', 'Save selected tabs', 'selected'],
	['tablodge-page-save-left', 'Save tabs to the left', 'left-of-tab'],
	['tablodge-page-save-right', 'Save tabs to the right', 'right-of-tab'],
	[
		'tablodge-page-save-except-tab',
		'Save all tabs except this one',
		'except-this-tab',
	],
	['tablodge-page-save-group', 'Save this tab group', 'tab-group'],
	[
		'tablodge-page-save-all-windows',
		'Save tabs from all windows',
		'all-windows',
	],
];

/**
The "Saved links" entry of "Save link to session" collects links in this session (matched by name, case-insensitively).
*/
export const SAVED_LINKS_SESSION = 'Saved links';

export const WEB_URL_PATTERNS = ['http://*/*', 'https://*/*'];

/**
Everything the menu tree depends on: the switches, the enabled systems, and the column names and order.
*/
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
		settings.contextMenuPageEnabled || settings.contextMenuLinksEnabled
			? sessions.map((session) => [session.id, session.name])
			: [],
	]);
}

export type MenuSession = {id: string; name: string};

/**
The sessions the page menu offers: the most recently changed ones, leaving out the Archived folder.
Takes stored data, so every entry is checked.
*/
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

/**
 The full menu tree for these settings and columns, in creation order (parents first).
 `excludeState` sets the toolbar menu's "Exclude this site" checkbox for the active tab.
 */
export function contextMenuPlan(
	settings: Settings,
	columns: BookmarkColumn[],
	sessions: MenuSession[],
	env: {appName: string; hasSidePanel: boolean},
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

		// Unfiled is not offered: it only holds bookmarks left over from a deleted column.
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

		items.push({
			id: MENU.linkSend,
			title: 'Save link to session',
			parentId: MENU.linkRoot,
			...link,
		});
		// The Saved links entry below stands in for that session, so it is not listed twice.
		const savedLinksName = SAVED_LINKS_SESSION.toLocaleLowerCase();
		for (const session of sessions) {
			if (session.name.toLocaleLowerCase() !== savedLinksName) {
				items.push({
					id: `${LINK_SEND_PREFIX}${session.id}`,
					title: session.name,
					parentId: MENU.linkSend,
					...link,
				});
			}
		}

		if (items.some((item) => item.parentId === MENU.linkSend)) {
			items.push({
				id: `${MENU.linkSend}-separator`,
				type: 'separator',
				parentId: MENU.linkSend,
				...link,
			});
		}

		items.push({
			id: MENU.linkSave,
			title: SAVED_LINKS_SESSION,
			parentId: MENU.linkSend,
			...link,
		});
	}

	if (settings.contextMenuPageEnabled) {
		const page = {
			contexts: ['page', 'frame'],
			documentUrlPatterns: WEB_URL_PATTERNS,
		} satisfies Partial<MenuItemProperties>;
		items.push(
			{id: MENU.pageRoot, title: env.appName, ...page},
			{
				id: MENU.pageBookmark,
				title: 'Bookmark this page to',
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
				id: 'tablodge-page-separator',
				type: 'separator',
				parentId: MENU.pageRoot,
				...page,
			},
		);

		// The tab-group item stays enabled: Chrome has no contextMenus.onShown to toggle it per tab, and a
		// click outside a tab group just logs "The active tab is not in a tab group." Browsers with onShown refine it.
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
			// Chrome substitutes %s with the selected text (shortened for long selections).
			{
				id: MENU.selectionSearch,
				title: 'Search saved tabs & bookmarks for “%s”',
				parentId: MENU.selectionRoot,
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

	return items;
}
