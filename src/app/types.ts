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
export type RestoreMode = 'keep' | 'remove';
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
export type SessionNameStyle =
	'title' | 'datetime' | 'date-title' | 'custom' | 'ask';
/**
The styles that build a name by themselves: what `ask` falls back to when the name is left empty or no page can ask.
*/
export type SessionNameFallback = Exclude<SessionNameStyle, 'ask'>;
/**
For selection saves while the active tab is in a split view: keep both halves, or only the focused one.
*/
export type SaveSplitTabs = 'both' | 'focused';

export type BookmarkQuickAction =
	'open-current' | 'open-new' | 'copy' | 'edit' | 'delete';

/**
What clicking a link does: nothing, open in the current tab, or open in a new tab.
*/
export type LinkClickAction = 'none' | 'current' | 'new';
/**
What clicking a bookmark does: a link action, or open the bookmark's action menu instead.
*/
export type BookmarkClickAction = LinkClickAction | 'menu';

export type AutoBackupSchedule = 'off' | 'daily' | 'weekly';
export type DashboardWidth = 'default' | 'wider' | 'full' | 'narrower';

export type BrowserBookmarkAction = 'off' | 'ask' | 'add';

export type Settings = {
	closeOnSave: boolean;
	emptyWindowAfterSave: 'new-tab' | 'close-extra';
	includePinnedTabs: boolean;
	ignoreTabGroups: boolean;
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
	Session cards start expanded on the TabLodge page (default off: collapsed); each can still be toggled during the visit.
	*/
	expandSessionsByDefault: boolean;
	/**
	Dashboard bookmark board: columns in the same row grow to the tallest one's height (default on).
	*/
	stretchBookmarkColumns: boolean;
	/**
	Pasting a link (Ctrl/Cmd+V outside a text field) on the TabLodge page opens the add-bookmark dialog prefilled with it (default on).
	*/
	pasteLinkToBookmark: boolean;
	/**
	Remove leading notification counters such as "(1) " from page titles when saving tabs and bookmarks (default on).
	*/
	cleanTitles: boolean;
	/**
	What clicking a bookmark does (default: open in this tab).
	*/
	bookmarkClickAction: BookmarkClickAction;
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
	Show the Save this window shortcut in the dashboard header (default on).
	*/
	showSaveWindowButton: boolean;
	/**
	Show the Trash bin shortcut in the dashboard header (default on).
	*/
	showTrashBinButton: boolean;
	/**
	Dashboard width and bookmark-grid layout (default: default).
	*/
	dashboardWidth: DashboardWidth;
	/**
	Keep one pinned TabLodge tab per window open; links from it open in new tabs.
	*/
	keepLodgePinned: boolean;
	/**
	What to do when you bookmark the page you are on with the browser's own bookmark feature (default off).
	*/
	browserBookmarkAction: BrowserBookmarkAction;
	/**
	Column that receives such bookmarks when added automatically; falls back to the first column if it is gone.
	*/
	browserBookmarkColumn: string;
	/**
	Kept for stored settings and backups; no longer shown, since Share covers copying session links.
	*/
	copyFormat: CopyFormat;
	dashboardBehavior: 'switch' | 'move';
	/**
	Remove common tracking parameters when opening saved links or restoring sessions and snapshots; saved URLs are unchanged (default off).
	*/
	removeTrackingParameters: boolean;
	/**
	Shown addresses drop https://, http:// and www. (default on); display only.
	*/
	simplifyUrls: boolean;
	/**
	An amber open lock next to http addresses (default on); display only.
	*/
	markInsecureLinks: boolean;
	/**
	Also mark localhost and home-network http addresses (default off).
	*/
	markLocalLinks: boolean;
	urlDisplayMode: 'domain' | 'full' | 'url-only' | 'none';
	groupTitleAction: 'toggle' | 'edit' | 'restore';
	// ---- Right-click menus ----
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
	// ---- Recovery & backups (all local; nothing leaves the browser) ----
	/**
	Keep rolling snapshots of the open windows so a crash can be undone (default on).
	*/
	snapshotsEnabled: boolean;
	/**
	How often a snapshot is added to the history: 5, 15 (default) or 30 minutes.
	*/
	snapshotIntervalMinutes: number;
	/**
	How many history snapshots are kept: 10, 25 (default) or 50.
	*/
	snapshotKeep: number;
	/**
	Automatic local backups of sessions, bookmarks and settings (default off).
	*/
	autoBackup: AutoBackupSchedule;
	/**
	How many automatic backups are kept: 7 (default) or 30.
	*/
	autoBackupKeep: number;
	/**
	Also write each automatic backup to Downloads/TabLodge (needs the optional "downloads" permission; default off).
	*/
	autoBackupToDownloads: boolean;
	/**
	Days deleted items stay in the trash: 7, 30 (default) or 90.
	*/
	trashRetentionDays: number;
	/**
	How a new session is named: the first tab's title, the date and time, the date and first tab (default), `sessionNameTemplate`, or `ask` (a dialog asks each time; `sessionNameFallback` names it when left empty).
	*/
	sessionNameStyle: SessionNameStyle;
	/**
	Template for the `custom` style, with {date} {time} {weekday} {title} {domain} {count} {window} (default "{date} · {title}").
	*/
	sessionNameTemplate: string;
	/**
	The style used when `sessionNameStyle` is `ask` and the name is left empty (default "date-title").
	*/
	sessionNameFallback: SessionNameFallback;
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
	notes: string;
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

// ---- Crash snapshots ----
export type SnapshotTab = {
	url: string;
	title: string;
	pinned?: boolean;
	active?: boolean;
	/**
	Index into the window's `groups`.
	*/
	group?: number;
	split?: SplitInfo;
};
export type SnapshotGroup = {
	title: string;
	color: TabGroupColor;
	collapsed: boolean;
};
export type SnapshotWindow = {
	focused: boolean;
	state: string;
	groups: SnapshotGroup[];
	tabs: SnapshotTab[];
};
export type SnapshotReason =
	'interval' | 'startup' | 'crash' | 'exit' | 'manual';
export type Snapshot = {
	id: string;
	at: number;
	reason: SnapshotReason;
	/**
	Hash of the windows, used to skip a snapshot identical to the previous one.
	*/
	sig: string;
	/**
	Length of the serialized windows, used to cap the history's total size.
	*/
	size: number;
	windows: SnapshotWindow[];
};
export type SnapshotWindowSummary = {
	tabs: number;
	pinned: number;
	groups: number;
	focused: boolean;
	/**
	Titles of the first few tabs.
	*/
	titles: string[];
};
export type SnapshotSummary = {
	id: string;
	at: number;
	reason: SnapshotReason;
	tabs: number;
	windows: SnapshotWindowSummary[];
};
export type RecoveryInfo = {
	snapshotId: string;
	at: number;
	windows: number;
	tabs: number;
};

// ---- Backups ----
export type BackupKind = 'auto' | 'manual' | 'safety';
export type BackupSummary = {
	id: string;
	at: number;
	kind: BackupKind;
	/**
	Why a safety backup was taken, such as "Before erasing data".
	*/
	reason: string;
	sessions: number;
	tabs: number;
	bookmarks: number;
	bytes: number;
};

// ---- Trash ----
export type TrashKind = 'session' | 'tabs' | 'bookmark' | 'column' | 'folder';
export type TrashSummary = {
	id: string;
	kind: TrashKind;
	deletedAt: number;
	label: string;
	/**
	Where it came from, such as the session or column name.
	*/
	origin: string;
	/**
	Links in the item (tabs or bookmarks), 0 when not applicable.
	*/
	count: number;
};
export type StorageUsage = {
	snapshots: number;
	backups: number;
	trash: number;
	state: number;
};

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
	Pick<Session, 'name' | 'description' | 'folderId'>
>;
export type TabFields = Partial<Pick<SavedTab, 'title' | 'notes' | 'url'>>;
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
	PREVIEW_SESSION_NAME: {
		style?: SessionNameStyle;
		fallback?: SessionNameFallback;
		template?: string;
		/**
		Preview for the tabs a save with this scope (or these tab ids) would capture, instead of the whole window.
		*/
		scope?: SaveScope;
		tabIds?: number[];
	};
	SAVE_CURRENT_TAB_TO_GROUP: {};
	RESTORE_TAB: {groupId: string; tabId: string} & RestoreOptions;
	RESTORE_GROUP: {groupId: string; forceRemove?: boolean} & RestoreOptions;
	DELETE_GROUP: {groupId: string};
	UPDATE_GROUP: {groupId: string; fields: SessionFields};
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
		/**
		Undo of a move that emptied its source: the trash entry holding that session. `toGroupId` is the
		deleted source session; the link comes back with it.
		*/
		restoreTrashId?: string;
	};
	/**
	Moves every link of `sourceGroupId` into `targetGroupId` (links already there are skipped) and removes the source.
	*/
	MERGE_GROUPS: {sourceGroupId: string; targetGroupId: string};
	UPDATE_TAB: {groupId: string; tabId: string; fields: TabFields};
	ADD_BOOKMARK: {bookmark: BookmarkFields};
	ADD_BOOKMARKS: {
		bookmarks: LinkEntry[];
		columnId?: string | null;
		targetBookmarkId?: string | null;
		position?: InsertPosition;
		/**
		Asks for an `undoId` in the response, which removes the added bookmarks again.
		*/
		undoable?: boolean;
	};
	UPDATE_BOOKMARK: {bookmarkId: string; fields: BookmarkFields};
	DELETE_BOOKMARK: {bookmarkId: string};
	CREATE_BOOKMARK_COLUMN: {name: string; icon?: string};
	/**
	`icon` omitted keeps the current icon; an empty string resets it to the default.
	*/
	UPDATE_BOOKMARK_COLUMN: {columnId: string; name: string; icon?: string};
	/**
	Moves the column's bookmarks to `targetColumnId` (a remaining column or the Unfiled id), or deletes them when `discardBookmarks` is true.
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
	GET_SNAPSHOTS: {};
	/**
	Reopens a snapshot (every window, or just `windowIndex`) in new windows.
	*/
	RESTORE_SNAPSHOT: {id: string; windowIndex?: number};
	SAVE_SNAPSHOT_AS_SESSION: {id: string; windowIndex?: number};
	DELETE_SNAPSHOT: {id: string};
	CLEAR_SNAPSHOTS: {};
	/**
	Hides the "restore your last session" banner (the snapshot stays in the history).
	*/
	DISMISS_RECOVERY: {};
	GET_BACKUPS: {};
	BACKUP_NOW: {};
	/**
	Replaces sessions and bookmarks with a backup's (settings are kept); a safety backup of the current data comes first.
	*/
	RESTORE_BACKUP: {id: string};
	DELETE_BACKUP: {id: string};
	/**
	The backup as JSON text in the regular export format, for downloading.
	*/
	GET_BACKUP_DATA: {id: string};
	/**
	The stored values a full-backup ZIP is made of (state, page preferences, snapshot history, trash).
	*/
	GET_FULL_BACKUP: {};
	/**
	Replaces everything with the contents of a full-backup ZIP, read on the page. The worker validates and normalizes it; a safety backup comes first.
	*/
	RESTORE_FULL_BACKUP: {
		format: string;
		version: number;
		state: unknown;
		preferences?: unknown;
		snapshots?: unknown;
		trash?: unknown;
	};
	GET_TRASH: {};
	RESTORE_TRASH: {id: string};
	DELETE_TRASH: {id: string};
	EMPTY_TRASH: {};
	/**
	Puts back what an action with an `undoId` changed, if that was under two minutes ago and nothing else has changed that data since.
	*/
	UNDO: {id: string};
	GET_STORAGE_USAGE: {};
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
	splits: number;
	splitsSeparated: number;
	/**
	The saved tabs a restore removed, now in the trash (for Undo).
	*/
	trashId?: string;
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
`undoId`: set when the action can be undone with `UNDO` for a short while.
*/
type Undoable = {undoId?: string};

/**
Success payload of each message (merged with `{ ok: true }`). Fields marked optional are only sometimes reported.
*/
export type TabLodgeResponses = {
	GET_STATE: Store;
	SAVE_TABS: SaveResult;
	/**
	`asks` is true when the style is `ask`; `name` is then the name used when the answer is left empty.
	*/
	PREVIEW_SESSION_NAME: {name: string; asks: boolean};
	SAVE_CURRENT_TAB_TO_GROUP: {count: number; skipped: number; groupId: string};
	RESTORE_TAB: RestoreResult;
	RESTORE_GROUP: RestoreResult;
	/**
	`trashId`: the deleted session in the trash, for Undo.
	*/
	DELETE_GROUP: {trashId?: string};
	UPDATE_GROUP: {group: Session};
	SET_GROUP_ORDER: {};
	CREATE_FOLDER: {folder: Folder};
	UPDATE_FOLDER: {folder: Folder};
	DELETE_FOLDER: {moved: number} & Undoable;
	DELETE_TAB: {trashId?: string};
	MOVE_TAB: {
		/**
		Set when the move emptied the source session: it is in the trash under this id.
		*/
		trashId?: string;
	};
	UPDATE_TAB: {shared: number};
	MERGE_GROUPS: {added: number; skipped: number} & Undoable;
	ADD_BOOKMARK: {bookmark: Bookmark};
	ADD_BOOKMARKS: {count: number; bookmarks: Bookmark[]} & Undoable;
	UPDATE_BOOKMARK: {bookmark: Bookmark};
	DELETE_BOOKMARK: {trashId?: string};
	CREATE_BOOKMARK_COLUMN: {column: BookmarkColumn};
	UPDATE_BOOKMARK_COLUMN: {column: BookmarkColumn};
	/**
	`deleted`: bookmarks removed together with the column (only when `discardBookmarks` was set).
	*/
	DELETE_BOOKMARK_COLUMN: {
		moved: number;
		unfiled: number;
		deleted: number;
		trashId?: string;
	};
	REORDER_BOOKMARK_COLUMN: {};
	REORDER_BOOKMARK: {};
	IMPORT_GROUPS: ImportResult & Undoable;
	IMPORT_SESSIONS: ImportResult & Undoable;
	IMPORT_BOOKMARKS_FILE: ImportResult & Undoable;
	IMPORT_BROWSER_BOOKMARKS: BrowserBookmarkImportResult & Undoable;
	ADD_EXCLUDED_ORIGIN: {origin: string; settings: Settings};
	ADD_EXCLUDED_ORIGINS: {
		added: number;
		/**
		Valid new sites left out because the list is full.
		*/
		notAdded: number;
		settings: Settings;
	};
	REMOVE_EXCLUDED_ORIGIN: {settings: Settings};
	UPDATE_SETTINGS: {settings: Settings};
	RESET_SETTINGS: {settings: Settings} & Undoable;
	/**
	Counts of sessions and bookmarks removed.
	*/
	ERASE_DATA: {sessions: number; bookmarks: number} & Undoable;
	HANDOFF_NEW_TAB: {handedOff: boolean};
	GET_SNAPSHOTS: {
		enabled: boolean;
		snapshots: SnapshotSummary[];
		live: SnapshotSummary | null;
		recovery: RecoveryInfo | null;
	};
	/**
	`tabIds`: the tabs it opened, so a page can close them again.
	*/
	RESTORE_SNAPSHOT: {
		windows: number;
		count: number;
		failed: number;
		tabIds: number[];
	};
	SAVE_SNAPSHOT_AS_SESSION: {groups: number; count: number};
	DELETE_SNAPSHOT: Undoable;
	CLEAR_SNAPSHOTS: {count: number} & Undoable;
	DISMISS_RECOVERY: {};
	GET_BACKUPS: {
		auto: BackupSummary[];
		safety: BackupSummary[];
		/**
		Set when the last Downloads copy failed (permission missing or too large).
		*/
		downloadError: string;
	};
	BACKUP_NOW: {backup: BackupSummary};
	RESTORE_BACKUP: {sessions: number; bookmarks: number} & Undoable;
	DELETE_BACKUP: Undoable;
	GET_BACKUP_DATA: {filename: string; json: string};
	GET_FULL_BACKUP: {
		state: unknown;
		preferences: unknown;
		snapshots: unknown;
		trash: unknown;
	};
	RESTORE_FULL_BACKUP: {
		sessions: number;
		bookmarks: number;
		snapshots: number;
		trash: number;
	} & Undoable;
	GET_TRASH: {items: TrashSummary[]};
	/**
	`placed`: where it went, such as the session name or "Unfiled".
	*/
	RESTORE_TRASH: {placed: string};
	DELETE_TRASH: Undoable;
	EMPTY_TRASH: {count: number} & Undoable;
	UNDO: {label: string};
	GET_STORAGE_USAGE: {usage: StorageUsage};
};

export type ActionSuccess<K extends TabLodgeMessageType = TabLodgeMessageType> =
	{ok: true} & TabLodgeResponses[K];
export type ActionResult<K extends TabLodgeMessageType = TabLodgeMessageType> =
	ActionSuccess<K> | ActionFailure;
