// Shared TabLodge data model and message protocol, used by the service worker
// (extension/service-worker.ts) and the extension pages in src/app.
// Only types live here so the classic service-worker bundle stays import-free.

export type ActionMode =
	| 'popup'
	| 'current-group'
	| 'current-window'
	| 'full-window'
	| 'all-windows'
	| 'current-tab'
	| 'current-tab-to-group';
export type RestoreTarget =
	'current-window' | 'new-window-unless-only-tab' | 'always-new-window';
export type RestoreMode = 'keep' | 'remove' | 'archive';
export type SessionLayout = 'list' | 'grid';
export type SessionSort = 'newest' | 'oldest' | 'name' | 'tabs' | 'custom';
export type CopyFormat =
	'rich' | 'title-url' | 'url-title' | 'url' | 'markdown';
export type TabGroupColor = `${chrome.tabGroups.Color}`;
export type DuplicateMode = 'skip' | 'allow';
export type TitlePolicy = 'existing' | 'latest';
export type InsertPosition = 'before' | 'after';
/**
Whether a restore recreates a saved split view ("split") or opens its two tabs side by side as normal tabs.
*/
export type RestoreSplitTabs = 'split' | 'separate';
/**
For selection saves while the active tab is in a split view: keep both halves, or only the focused one.
*/
export type SaveSplitTabs = 'both' | 'focused';

/**
What clicking a link does: nothing, open in the current tab, or open in a new tab.
*/
export type BookmarkQuickAction =
	'open-current' | 'open-new' | 'copy' | 'edit' | 'delete';

export type LinkClickAction = 'none' | 'current' | 'new';

export type Settings = {
	closeOnSave: boolean;
	includePinnedTabs: boolean;
	openDashboardAfterSave: boolean;
	openDashboardOnStartup: boolean;
	startupBehavior: 'dashboard' | 'last-session';
	newTabEnabled: boolean;
	/**
	What new tabs show while "Use TabLodge for new tabs" is off: the browser's own page, a blank page, or a custom http(s) page.
	*/
	newTabFallback: 'browser' | 'blank' | 'custom';
	newTabFallbackUrl: string;
	/**
	The new-tab page opens with an always-visible search box that has focus (default off).
	*/
	autoFocusSearchOnNewTab: boolean;
	actionMode: ActionMode;
	sessionsEnabled: boolean;
	bookmarksEnabled: boolean;
	/**
	What the toolbar icon opens: the quick popup or the browser side panel.
	*/
	toolbarOpens: 'popup' | 'sidepanel';
	/**
	Excluded sites as bare host names; an entry covers the host and all its subdomains (older versions stored origins).
	*/
	excludedOrigins: string[];
	saveDuplicateHandling: 'allow' | 'reject';
	saveDuplicateTitle: TitlePolicy;
	restoreDuplicateHandling: 'skip' | 'open';
	restoreTarget: RestoreTarget;
	restoreMode: RestoreMode;
	singleTabBehavior: 'stay' | 'switch';
	unloadRestoredTabs: boolean;
	/**
	Background restored tabs are unloaded only when a restore opened more tabs than this (1 to 500, default 5).
	*/
	unloadRestoredTabsThreshold: number;
	restoreSplitTabs: RestoreSplitTabs;
	saveSplitTabs: SaveSplitTabs;
	sessionSort: SessionSort;
	/**
	Session cards in one column (list, default) or two columns on wide pages (grid).
	*/
	sessionLayout: SessionLayout;
	/**
	Session cards start expanded on the TabLodge page (default off: collapsed); each can still be toggled during the visit.
	*/
	expandSessionsByDefault: boolean;
	/**
	Dashboard bookmark board: columns in the same row grow to the tallest one's height (default on).
	*/
	stretchBookmarkColumns: boolean;
	/**
	What clicking a bookmark does (default: open in this tab).
	*/
	bookmarkClickAction: LinkClickAction;
	/**
	What clicking a saved session link does (default: open in a new tab).
	*/
	sessionLinkClickAction: LinkClickAction;
	/**
	Show one configurable quick-action button next to the bookmark menu button.
	*/
	showBookmarkQuickActions: boolean;
	/**
	What the quick-action button on a bookmark does (default: open in a new tab).
	*/
	bookmarkQuickAction: BookmarkQuickAction;
	/**
	Show the sessions section above the bookmark board (only when both are enabled).
	*/
	sessionsOnTop: boolean;
	/**
	Keep one pinned TabLodge tab per window open; links from it open in new tabs.
	*/
	keepLodgePinned: boolean;
	copyFormat: CopyFormat;
	dashboardBehavior: 'switch' | 'move';
	urlDisplayMode: 'domain' | 'full' | 'none';
	groupTitleAction: 'toggle' | 'edit' | 'restore';
	// ---- Right-click menus (context-menu agent) ----
	/**
	Master switch: when off, no right-click menu items are created at all.
	*/
	contextMenusEnabled: boolean;
	/**
	Per-context groups (default on), shown only while the master switch is on.
	*/
	contextMenuLinksEnabled: boolean;
	contextMenuPageEnabled: boolean;
	contextMenuSelectionEnabled: boolean;
	/**
	The toolbar icon's own right-click menu (Chrome's "action" context).
	*/
	contextMenuActionEnabled: boolean;
	// ---- end right-click menus ----
};

export type NativeGroup = {
	key: string;
	title: string;
	color: TabGroupColor;
	collapsed: boolean;
};

/**
 Membership in a browser Split View (two tabs shown side by side in one tab-strip slot).
 `id` is a pair key that is stable within its session (not the browser's volatile splitViewId);
 `position` 0 is the left tab and 1 the right one. Both tabs of a pair are stored next to each other.
 */
export type SplitInfo = {
	id: string;
	position: 0 | 1;
};

export type SavedTab = {
	id: string;
	title: string;
	url: string;
	faviconUrl: string;
	notes: string;
	archived: boolean;
	pinned: boolean;
	nativeGroup: NativeGroup | null;
	savedAt: number;
	originalIndex: number;
	/**
	Present only when both tabs of a split view were saved together.
	*/
	split?: SplitInfo;
};

/**
A saved session ("group" in the stored schema).
*/
export type Session = {
	id: string;
	name: string;
	folderId: string;
	description: string;
	notes: string;
	archived: boolean;
	archivedAt: number | null;
	locked: boolean;
	createdAt: number;
	updatedAt: number;
	sourceWindowName: string;
	sourceWindowId: number | null;
	tabs: SavedTab[];
};

export type Folder = {
	id: string;
	name: string;
	/**
	Icon id from the icon registry; missing means the default folder icon.
	*/
	icon?: string;
	createdAt: number;
	isDefault: boolean;
};

export type BookmarkColumn = {
	id: string;
	name: string;
	/**
	Icon id from the icon registry; missing means the default column icon.
	*/
	icon?: string;
	createdAt: number;
	isDefault: boolean;
};

export type Bookmark = {
	id: string;
	title: string;
	url: string;
	columnId: string;
	createdAt: number;
	updatedAt: number;
};

export type Store = {
	schemaVersion: number;
	groups: Session[];
	folders: Folder[];
	bookmarkColumns: BookmarkColumn[];
	bookmarks: Bookmark[];
	settings: Settings;
	updatedAt: number;
};

export type TabLodgeState = Store & {ok: true};

export type RestoreFailure = {
	title: string;
	url: string;
	error: string;
};

export type ImportOptions = {
	duplicateMode?: DuplicateMode;
	titlePolicy?: TitlePolicy;
	/**
	Bookmark imports only: put every bookmark into this existing column (or "bookmark-unfiled") instead of creating columns from the file's folders.
	*/
	targetColumnId?: string | null;
};

export type RestoreOptions = {
	restoreMode?: RestoreMode;
	restoreTarget?: RestoreTarget;
	activate?: boolean;
};

export type SessionFields = Partial<
	Pick<
		Session,
		'name' | 'description' | 'notes' | 'archived' | 'locked' | 'folderId'
	>
>;
export type TabFields = Partial<Pick<SavedTab, 'title' | 'notes' | 'archived'>>;
export type BookmarkFields = Partial<
	Pick<Bookmark, 'title' | 'url' | 'columnId'>
>;
export type LinkEntry = {
	url: string;
	title?: string;
};
export type EraseScope = 'sessions' | 'bookmarks' | 'all';
/**
Which tabs SAVE_TABS captures; the "-tab" scopes are relative to the sender (or active) tab.
*/
export type SaveScope =
	| 'window'
	| 'selected'
	| 'selected-or-window'
	| 'current-group'
	| 'tab-group'
	| 'all-windows'
	| 'current-tab'
	| 'this-tab'
	| 'except-this-tab'
	| 'left-of-tab'
	| 'right-of-tab';

/**
Every message the TabLodge pages send to the service worker, keyed by `type`.
*/
export type TabLodgeMessages = {
	GET_STATE: {};
	SAVE_TABS: {
		scope?: SaveScope;
		folderId?: string;
		tabIds?: number[];
		groupName?: string;
		includePinned?: boolean;
	};
	SAVE_CURRENT_TAB_TO_GROUP: {};
	RESTORE_TAB: {groupId: string; tabId: string} & RestoreOptions;
	RESTORE_GROUP: {groupId: string; forceRemove?: boolean} & RestoreOptions;
	DELETE_GROUP: {groupId: string};
	UPDATE_GROUP: {groupId: string; fields: SessionFields};
	REORDER_GROUP: {groupId: string; direction: 'up' | 'down'; folderId?: string};
	/**
	Sets the custom session order: `order` lists the visible session ids in their new order and they take
	the slots those sessions held in the stored order (others stay put). Switches the sort to "custom".
	*/
	SET_GROUP_ORDER: {order: string[]};
	CREATE_FOLDER: {name: string; icon?: string};
	/**
	`icon` omitted keeps the current icon; an empty string resets it to the default.
	*/
	UPDATE_FOLDER: {folderId: string; name: string; icon?: string};
	DELETE_FOLDER: {folderId: string};
	MOVE_GROUP: {groupId: string; folderId: string};
	DELETE_TAB: {groupId: string; tabId: string};
	/**
	Moves (or, with `copy`, duplicates) a saved link into another session, or reorders it inside the same
	session. It lands next to `targetTabId` (`position` defaults to after) or at the end. Split info of the
	moved link and its partner is dropped.
	*/
	MOVE_TAB: {
		fromGroupId: string;
		tabId: string;
		toGroupId: string;
		targetTabId?: string | null;
		position?: InsertPosition;
		copy?: boolean;
	};
	UPDATE_TAB: {groupId: string; tabId: string; fields: TabFields};
	ADD_BOOKMARK: {bookmark: BookmarkFields};
	ADD_BOOKMARKS: {
		bookmarks: LinkEntry[];
		columnId?: string | null;
		targetBookmarkId?: string | null;
		position?: InsertPosition;
	};
	UPDATE_BOOKMARK: {bookmarkId: string; fields: BookmarkFields};
	DELETE_BOOKMARK: {bookmarkId: string};
	CREATE_BOOKMARK_COLUMN: {name: string; icon?: string};
	/**
	`icon` omitted keeps the current icon; an empty string resets it to the default.
	*/
	UPDATE_BOOKMARK_COLUMN: {columnId: string; name: string; icon?: string};
	/**
	Moves the column's bookmarks to `targetColumnId` (or the first remaining column), or deletes them when `discardBookmarks` is true.
	*/
	DELETE_BOOKMARK_COLUMN: {
		columnId: string;
		targetColumnId?: string | null;
		discardBookmarks?: boolean;
	};
	REORDER_BOOKMARK_COLUMN: {
		columnId: string;
		targetColumnId: string;
		position?: InsertPosition;
	};
	REORDER_BOOKMARK: {
		bookmarkId: string;
		targetColumnId: string;
		targetBookmarkId?: string | null;
		position?: InsertPosition;
	};
	IMPORT_GROUPS: {data: unknown; importOptions?: ImportOptions};
	IMPORT_SESSIONS: {data: unknown; importOptions?: ImportOptions};
	IMPORT_BOOKMARKS_FILE: {data: unknown; importOptions?: ImportOptions};
	IMPORT_BROWSER_BOOKMARKS: {
		duplicateMode?: DuplicateMode;
		titlePolicy?: TitlePolicy;
		targetColumnId?: string | null;
	};
	ADD_EXCLUDED_ORIGIN: {origin: string};
	ADD_EXCLUDED_ORIGINS: {origins: string[]};
	REMOVE_EXCLUDED_ORIGIN: {origin: string};
	UPDATE_SETTINGS: {settings: Partial<Settings>};
	RESET_SETTINGS: {};
	/**
	Erases stored data (not settings or excluded sites): sessions + folders, bookmarks + columns, or both.
	*/
	ERASE_DATA: {scope: EraseScope};
	HANDOFF_NEW_TAB: {brave?: boolean};
	OPEN_DASHBOARD: {};
};

export type TabLodgeMessageType = keyof TabLodgeMessages;
export type TabLodgeMessage = {
	[K in TabLodgeMessageType]: {type: K} & TabLodgeMessages[K];
}[TabLodgeMessageType];

export type ActionFailure = {
	ok: false;
	error: string;
};

export type SaveResult = {
	count: number;
	groups: number;
	skipped: number;
	groupId: string | null;
};
/**
 `removed` is true when restoring removed the session's last tab and with it the session.
 `splits`: split views recreated. `splitsSeparated`: saved pairs that opened as adjacent normal tabs because
 the browser refused to split them (a soft note, never a failure; an unsupported browser does not count).
 */
export type RestoreResult = {
	count: number;
	skipped: number;
	failed: number;
	failures: RestoreFailure[];
	removed: boolean;
	archived: boolean;
	splits: number;
	splitsSeparated: number;
};
/**
`groups`/`count`: sessions/tabs imported; `bookmarks`/`columns`: bookmarks/columns added.
*/
export type ImportResult = {
	groups: number;
	count: number;
	bookmarks: number;
	columns: number;
	columnsReordered: boolean;
	skipped: number;
	updatedTitles: number;
};
export type BrowserBookmarkImportResult = {
	columnsAdded: number;
	bookmarksAdded: number;
	bookmarksSkipped: number;
	bookmarksUpdated: number;
};

/**
Success payload of each message (merged with `{ ok: true }`). Fields marked optional are only sometimes reported.
*/
export type TabLodgeResponses = {
	GET_STATE: Store;
	SAVE_TABS: SaveResult;
	SAVE_CURRENT_TAB_TO_GROUP: {count: number; skipped: number; groupId: string};
	RESTORE_TAB: RestoreResult;
	RESTORE_GROUP: RestoreResult;
	DELETE_GROUP: {};
	UPDATE_GROUP: {group: Session};
	REORDER_GROUP: {};
	SET_GROUP_ORDER: {};
	CREATE_FOLDER: {folder: Folder};
	UPDATE_FOLDER: {folder: Folder};
	DELETE_FOLDER: {};
	MOVE_GROUP: {};
	DELETE_TAB: {};
	MOVE_TAB: {};
	UPDATE_TAB: {shared: number};
	ADD_BOOKMARK: {bookmark: Bookmark};
	ADD_BOOKMARKS: {count: number; bookmarks: Bookmark[]};
	UPDATE_BOOKMARK: {bookmark: Bookmark};
	DELETE_BOOKMARK: {};
	CREATE_BOOKMARK_COLUMN: {column: BookmarkColumn};
	UPDATE_BOOKMARK_COLUMN: {column: BookmarkColumn};
	/**
	`deleted`: bookmarks removed together with the column (only when `discardBookmarks` was set).
	*/
	DELETE_BOOKMARK_COLUMN: {moved: number; unfiled: number; deleted: number};
	REORDER_BOOKMARK_COLUMN: {};
	REORDER_BOOKMARK: {};
	IMPORT_GROUPS: ImportResult;
	IMPORT_SESSIONS: ImportResult;
	IMPORT_BOOKMARKS_FILE: ImportResult;
	IMPORT_BROWSER_BOOKMARKS: BrowserBookmarkImportResult;
	ADD_EXCLUDED_ORIGIN: {origin: string; settings: Settings};
	ADD_EXCLUDED_ORIGINS: {added: number; settings: Settings};
	REMOVE_EXCLUDED_ORIGIN: {settings: Settings};
	UPDATE_SETTINGS: {settings: Settings};
	RESET_SETTINGS: {settings: Settings};
	/**
	Counts of sessions and bookmarks removed.
	*/
	ERASE_DATA: {sessions: number; bookmarks: number};
	HANDOFF_NEW_TAB: {handedOff: boolean};
	OPEN_DASHBOARD: {};
};

export type ActionSuccess<K extends TabLodgeMessageType = TabLodgeMessageType> =
	{ok: true} & TabLodgeResponses[K];
export type ActionResult<K extends TabLodgeMessageType = TabLodgeMessageType> =
	ActionSuccess<K> | ActionFailure;
