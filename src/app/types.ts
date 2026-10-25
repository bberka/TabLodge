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

export type Settings = {
	closeOnSave: boolean;
	includePinnedTabs: boolean;
	openDashboardAfterSave: boolean;
	openDashboardOnStartup: boolean;
	startupBehavior: 'dashboard' | 'last-session';
	newTabEnabled: boolean;
	actionMode: ActionMode;
	sessionsEnabled: boolean;
	bookmarksEnabled: boolean;
	sidePanelEnabled: boolean;
	excludedOrigins: string[];
	saveDuplicateHandling: 'allow' | 'reject';
	saveDuplicateTitle: TitlePolicy;
	restoreDuplicateHandling: 'skip' | 'open';
	restoreTarget: RestoreTarget;
	restoreMode: RestoreMode;
	/**
	Legacy mirror of `restoreMode === "remove"`, kept for older readers of the stored state.
	*/
	removeAfterRestore?: boolean;
	singleTabBehavior: 'stay' | 'switch';
	unloadRestoredTabs: boolean;
	restoreSplitTabs: RestoreSplitTabs;
	saveSplitTabs: SaveSplitTabs;
	sessionSort: SessionSort;
	/**
	Session cards start expanded on the TabLodge page; each can still be collapsed during the visit.
	*/
	expandSessionsByDefault: boolean;
	/**
	Dashboard bookmark board: columns in the same row grow to the tallest one's height (default on).
	*/
	stretchBookmarkColumns: boolean;
	copyFormat: CopyFormat;
	dashboardBehavior: 'switch' | 'move';
	urlDisplayMode: 'full' | 'none';
	groupTitleAction: 'edit' | 'restore';
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
	restoreTarget: RestoreTarget | null;
	createdAt: number;
	updatedAt: number;
	sourceWindowName: string;
	sourceWindowId: number | null;
	tabs: SavedTab[];
};

export type Folder = {
	id: string;
	name: string;
	createdAt: number;
	isDefault: boolean;
};

export type BookmarkColumn = {
	id: string;
	name: string;
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
> & {restoreTarget?: RestoreTarget | 'default' | null};
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
	CREATE_FOLDER: {name: string};
	UPDATE_FOLDER: {folderId: string; name: string};
	DELETE_FOLDER: {folderId: string};
	MOVE_GROUP: {groupId: string; folderId: string};
	DELETE_TAB: {groupId: string; tabId: string};
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
	CREATE_BOOKMARK_COLUMN: {name: string};
	UPDATE_BOOKMARK_COLUMN: {columnId: string; name: string};
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
	REMOVE_EXCLUDED_ORIGIN: {origin: string};
	UPDATE_SETTINGS: {settings: Partial<Settings>};
	RESET_SETTINGS: {};
	/**
	Erases stored data (not settings or excluded sites): sessions + folders, bookmarks + columns, or both.
	*/
	ERASE_DATA: {scope: EraseScope};
	OPEN_DEFAULT_NEW_TAB: {};
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
	CREATE_FOLDER: {folder: Folder};
	UPDATE_FOLDER: {folder: Folder};
	DELETE_FOLDER: {};
	MOVE_GROUP: {};
	DELETE_TAB: {};
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
	REMOVE_EXCLUDED_ORIGIN: {settings: Settings};
	UPDATE_SETTINGS: {settings: Settings};
	RESET_SETTINGS: {settings: Settings};
	/**
	Counts of sessions and bookmarks removed.
	*/
	ERASE_DATA: {sessions: number; bookmarks: number};
	OPEN_DEFAULT_NEW_TAB: {};
	OPEN_DASHBOARD: {};
};

export type ActionSuccess<K extends TabLodgeMessageType = TabLodgeMessageType> =
	{ok: true} & TabLodgeResponses[K];
export type ActionResult<K extends TabLodgeMessageType = TabLodgeMessageType> =
	ActionSuccess<K> | ActionFailure;
