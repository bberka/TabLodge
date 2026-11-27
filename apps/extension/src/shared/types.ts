import type {StateChange} from './state-changes';
import type {SyncStatus} from './sync/client';
import type {SharedPageMode} from './sync/shared-pages';
import type {SharedPage} from './sync/shared-pages-client';
import type {ImageEntry, SavedImage, SavedThumb} from './image-store';
import type {PageCopy} from './page-copy';
import type {LinkKind} from './link-kind';
import type {ToastDuration, ToastPosition} from './toast-prefs';
import type {SendTarget} from './send-to-private';

export type ActionMode =
	| 'popup'
	| 'sidepanel'
	| 'current-group'
	| 'current-window'
	| 'full-window'
	| 'all-windows'
	| 'current-tab'
	| 'current-tab-to-group';
export type PrivateStorageMode = 'shared' | 'saved' | 'temporary';
export type SiteIconSource = 'server' | 'browser';
export type LinkPreviewData = {
	title?: string;
	description?: string;
	image?: string;
};

export type PrivateConfig = {
	mode: PrivateStorageMode;
	configured: boolean;
	redirectNewTabs: boolean;
	accent: string;
};
export type PrivateServerInfo = {connected: boolean; hasKey: boolean};
export type PrivateLockInfo = {
	available: boolean;
	manageHere: boolean;
	needsLock: boolean;
	enabled: boolean;
	state: 'none' | 'encrypting' | 'encrypted' | 'decrypting' | 'damaged';
	locked: boolean;
	idleMinutes: number;
	expiresAt: number | null;
};
export type RestoreTarget =
	'current-window' | 'new-window-unless-only-tab' | 'always-new-window';
export type RestoreMode = 'keep' | 'remove';
export type SessionSort =
	'newest' | 'oldest' | 'opened' | 'name' | 'tabs' | 'custom';
export type BookmarkSort = 'manual' | 'newest' | 'oldest' | 'title' | 'site';
export type NewBookmarkPosition = 'bottom' | 'top';
export type TabGroupColor = `${chrome.tabGroups.Color}`;
export type DuplicateMode = 'skip' | 'allow';
export type TitlePolicy = 'existing' | 'latest';
export type InsertPosition = 'before' | 'after';
export type RestoreSplitTabs = 'split' | 'separate';
export type SessionNameStyle =
	'title' | 'datetime' | 'date-title' | 'custom' | 'ask';
export type SessionNameFallback = Exclude<SessionNameStyle, 'ask'>;
export type SaveSplitTabs = 'both' | 'focused';
export type PaletteLocation = 'window' | 'page';

export type BookmarkQuickAction =
	| 'open-current'
	| 'open-new'
	| 'open-private'
	| 'copy'
	| 'edit'
	| 'delete'
	| 'move'
	| 'move-up'
	| 'move-down';
export type SessionQuickAction =
	| 'archive'
	| 'delete'
	| 'share'
	| 'edit'
	| 'move-up'
	| 'move-down'
	| 'switch-to';

export type LinkClickAction = 'none' | 'current' | 'new';
export type BookmarkClickAction = LinkClickAction | 'menu';

export type AutoBackupSchedule = 'off' | 'daily' | 'weekly';
export type DashboardWidth = 'default' | 'wider' | 'full' | 'narrower';
export type BookmarkBoardView = 'board' | 'focus';
export type SessionFolderView = 'auto' | 'list' | 'chips';
export type BookmarkColumnWidth = 'narrow' | 'default' | 'wide' | 'extra-wide';
export type BookmarkDensity = 'comfortable' | 'compact';

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
	newTabFallback: 'browser' | 'blank' | 'custom';
	newTabFallbackUrl: string;
	autoFocusSearchOnNewTab: boolean;
	actionMode: ActionMode;
	excludedOrigins: string[];
	saveDuplicateHandling: 'allow' | 'reject';
	saveDuplicateTitle: TitlePolicy;
	restoreDuplicateHandling: 'skip' | 'open';
	restoreTarget: RestoreTarget;
	restoreWindowBounds: boolean;
	restoreMode: RestoreMode;
	unloadRestoredTabs: boolean;
	unloadRestoredTabsThreshold: number;
	restoreSplitTabs: RestoreSplitTabs;
	saveSplitTabs: SaveSplitTabs;
	paletteLocation: PaletteLocation;
	sessionSort: SessionSort;
	bookmarkSort: BookmarkSort;
	newBookmarkPosition: NewBookmarkPosition;
	expandSessionsByDefault: boolean;
	showSessionFaviconPreviews: boolean;
	sessionQuickActions: SessionQuickAction[];
	stretchBookmarkColumns: boolean;
	bookmarkColumnWidth: BookmarkColumnWidth;
	bookmarkColumnsPerRow: number;
	bookmarkDensity: BookmarkDensity;
	limitBookmarksPerColumn: boolean;
	bookmarkColumnPageSize: number;
	pasteLinkToBookmark: boolean;
	cleanTitles: boolean;
	bookmarkClickAction: BookmarkClickAction;
	sessionLinkClickAction: LinkClickAction;
	bookmarkQuickActions: BookmarkQuickAction[];
	sessionsOnTop: boolean;
	toastPosition: ToastPosition;
	toastDuration: ToastDuration;
	showSaveWindowButton: boolean;
	linkPreviews: boolean;
	siteIcons: SiteIconSource;
	showTrashBinButton: boolean;
	dashboardWidth: DashboardWidth;
	bookmarkBoardView: BookmarkBoardView;
	sessionFolderView: SessionFolderView;
	showAllBookmarks: boolean;
	keepLodgePinned: boolean;
	browserBookmarkAction: BrowserBookmarkAction;
	browserBookmarkColumn: string;
	dashboardBehavior: 'switch' | 'move';
	removeTrackingParameters: boolean;
	simplifyUrls: boolean;
	markInsecureLinks: boolean;
	markLocalLinks: boolean;
	urlDisplayMode: 'domain' | 'full' | 'url-only' | 'none';
	groupTitleAction: 'toggle' | 'edit' | 'restore';
	contextMenusEnabled: boolean;
	contextMenuLinksEnabled: boolean;
	contextMenuPageEnabled: boolean;
	contextMenuSelectionEnabled: boolean;
	contextMenuActionEnabled: boolean;
	snapshotsEnabled: boolean;
	snapshotIntervalMinutes: number;
	snapshotKeep: number;
	autoBackup: AutoBackupSchedule;
	autoBackupKeep: number;
	autoBackupToDownloads: boolean;
	trashRetentionDays: number;
	autoArchiveDays: number;
	sessionNameStyle: SessionNameStyle;
	sessionNameTemplate: string;
	sessionNameFallback: SessionNameFallback;
	defaultShareMode: SharedPageMode;
	sourceCatchUp: SourceCatchUpMode;
	mobileApp: Record<string, string | number | boolean>;
	heldSettings: Record<string, unknown>;
};

export type NativeGroup = {
	key: string;
	title: string;
	color: TabGroupColor;
	collapsed: boolean;
};

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
	split?: SplitInfo;
};

export type Session = {
	id: string;
	name: string;
	folderId: string;
	description: string;
	createdAt: number;
	updatedAt: number;
	lastOpenedAt?: number;
	sourceWindowName: string;
	sourceWindowId: number | null;
	deviceName?: string;
	deviceKind?: 'desktop' | 'mobile';
	color?: string;
	windowBounds?: WindowBounds;
	tabs: SavedTab[];
};

export type WindowBounds = {
	left: number;
	top: number;
	width: number;
	height: number;
};

export type Folder = {
	id: string;
	name: string;
	icon?: string;
	color?: string;
	colorSessions?: true;
	createdAt: number;
	isDefault: boolean;
};

export type BookmarkColumn = {
	id: string;
	name: string;
	icon?: string;
	color?: string;
	domains?: string[];
	createdAt: number;
	isDefault: boolean;
};

export type Bookmark = {
	id: string;
	title: string;
	url: string;
	columnId: string;
	notes?: string;
	deviceName?: string;
	deviceKind?: 'desktop' | 'mobile';
	tags?: string[];
	hiddenKinds?: Array<Exclude<LinkKind, 'page'>>;
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

export type RevisionedStore = Store & {revision?: string};

export type TabLodgeState = RevisionedStore & {ok: true};

export type SnapshotTab = {
	url: string;
	title: string;
	pinned?: boolean;
	active?: boolean;
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
	sig: string;
	size: number;
	windows: SnapshotWindow[];
};
export type SnapshotWindowSummary = {
	tabs: number;
	pinned: number;
	groups: number;
	focused: boolean;
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

export type BackupKind = 'auto' | 'manual' | 'safety';
export type BackupSummary = {
	id: string;
	at: number;
	kind: BackupKind;
	reason: string;
	sessions: number;
	tabs: number;
	bookmarks: number;
	bytes: number;
};

export type TrashKind = 'session' | 'tabs' | 'bookmark' | 'column' | 'folder';
export type TrashSummary = {
	id: string;
	kind: TrashKind;
	deletedAt: number;
	label: string;
	origin: string;
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
	targetColumnId?: string | null;
};

export type RestoreOptions = {
	restoreMode?: RestoreMode;
	restoreTarget?: RestoreTarget;
	activate?: boolean;
};

export type SessionFields = Partial<
	Pick<Session, 'name' | 'description' | 'folderId' | 'color'>
>;
export type TabFields = Partial<Pick<SavedTab, 'title' | 'notes' | 'url'>>;
export type BookmarkFields = Partial<
	Pick<
		Bookmark,
		'title' | 'url' | 'columnId' | 'notes' | 'tags' | 'hiddenKinds'
	>
>;
export type LinkEntry = {
	url: string;
	title?: string;
};
export type EraseScope = 'sessions' | 'bookmarks' | 'all';
export type SessionWindowMode = 'replace' | 'append';
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

export type TabLodgeMessages = {
	GET_PRIVATE_CONFIG: {};
	GET_LINK_PREVIEW: {url: string};
	GET_SERVER_ICONS: {};
	GET_SERVER_ICON: {url: string};
	SET_PRIVATE_CONFIG: {mode: PrivateStorageMode};
	SET_PRIVATE_NEW_TAB_REDIRECT: {enabled: boolean};
	SET_PRIVATE_ACCENT: {accent: string};
	GET_PRIVATE_LOCK: {};
	UNLOCK_PRIVATE: {credential: string};
	LOCK_PRIVATE: {};
	TOUCH_PRIVATE_LOCK: {};
	ENABLE_PRIVATE_LOCK: {
		credential: string;
		idleMinutes?: number;
		sync?: boolean;
	};
	CHANGE_PRIVATE_LOCK_CREDENTIAL: {
		current: string;
		credential: string;
	};
	REMOVE_PRIVATE_LOCK: {credential: string};
	RESET_PRIVATE_LIBRARY: {};
	GET_PRIVATE_SERVER: {};
	JOIN_PRIVATE_SERVER: {credential: string};
	SET_PRIVATE_LOCK_IDLE: {minutes: number};
	GET_STATE: {};
	GET_STATE_CHANGES: {since: string};
	GET_BOOKMARK_PROMPT: {url: string};
	GET_SETTINGS_DEFAULTS: {};
	SAVE_TABS: {
		scope?: SaveScope;
		folderId?: string;
		tabIds?: number[];
		groupName?: string;
		includePinned?: boolean;
		allowDuplicates?: boolean;
	};
	PREVIEW_SESSION_NAME: {
		style?: SessionNameStyle;
		fallback?: SessionNameFallback;
		template?: string;
		scope?: SaveScope;
		tabIds?: number[];
		links?: LinkEntry[];
	};
	SAVE_CURRENT_TAB_TO_GROUP: {};
	RESTORE_GROUP: {groupId: string; forceRemove?: boolean} & RestoreOptions;
	SWITCH_WORKSPACE: {groupId: string};
	DELETE_GROUP: {groupId: string};
	ARCHIVE_GROUP: {groupId: string};
	UPDATE_GROUP: {groupId: string; fields: SessionFields};
	SET_GROUP_ORDER: {order: string[]};
	CREATE_FOLDER: {
		name: string;
		icon?: string;
		color?: string;
		colorSessions?: boolean;
	};
	UPDATE_FOLDER: {
		folderId: string;
		name: string;
		icon?: string;
		color?: string;
		colorSessions?: boolean;
	};
	DELETE_FOLDER: {folderId: string};
	DELETE_TAB: {groupId: string; tabId: string};
	MOVE_TAB: {
		fromGroupId: string;
		tabId: string;
		toGroupId: string;
		targetTabId?: string | null;
		position?: InsertPosition;
		copy?: boolean;
		restoreTrashId?: string;
	};
	MERGE_GROUPS: {sourceGroupId: string; targetGroupId: string};
	ADD_LINKS_TO_SESSION: {
		groupId: string;
		links: LinkEntry[];
		targetTabId?: string | null;
		position?: InsertPosition;
	};
	CREATE_SESSION_FROM_LINKS: {links: LinkEntry[]; name?: string};
	UPDATE_GROUP_FROM_WINDOW: {groupId: string; mode: SessionWindowMode};
	SPLIT_GROUP: {groupId: string; tabIds: string[]; name?: string};
	UPDATE_TAB: {groupId: string; tabId: string; fields: TabFields};
	ADD_BOOKMARK: {bookmark: BookmarkFields};
	SAVE_QUOTE: {url: string; quote: string; title?: string};
	ADD_BOOKMARKS: {
		bookmarks: LinkEntry[];
		columnId?: string | null;
		targetBookmarkId?: string | null;
		position?: InsertPosition;
		undoable?: boolean;
	};
	UPDATE_BOOKMARK: {bookmarkId: string; fields: BookmarkFields};
	DELETE_BOOKMARK: {bookmarkId: string};
	REMOVE_DUPLICATE_BOOKMARKS: {bookmarkIds: string[]};
	CREATE_BOOKMARK_COLUMN: {
		name: string;
		icon?: string;
		color?: string;
		domains?: string[];
	};
	UPDATE_BOOKMARK_COLUMN: {
		columnId: string;
		name: string;
		icon?: string;
		color?: string;
		domains?: string[];
	};
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
		bookmarkIds?: string[];
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
	ERASE_DATA: {scope: EraseScope};
	HANDOFF_NEW_TAB: {brave?: boolean};
	GET_SNAPSHOTS: {};
	RESTORE_SNAPSHOT: {id: string; windowIndex?: number};
	SAVE_SNAPSHOT_AS_SESSION: {id: string; windowIndex?: number};
	DELETE_SNAPSHOT: {id: string};
	CLEAR_SNAPSHOTS: {};
	DISMISS_RECOVERY: {};
	GET_BACKUPS: {};
	BACKUP_NOW: {};
	RESTORE_BACKUP: {id: string};
	DELETE_BACKUP: {id: string};
	GET_BACKUP_DATA: {id: string};
	GET_FULL_BACKUP: {};
	RESTORE_FULL_BACKUP: {
		format: string;
		version: number;
		state: unknown;
		preferences?: unknown;
		snapshots?: unknown;
		trash?: unknown;
		copies?: unknown;
	};
	KEEP_PAGE_COPY: {tabId: number};
	GET_PAGE_COPIES: {};
	GET_PAGE_COPY: {url: string};
	DELETE_PAGE_COPY: {url: string};
	ADD_PAGE_COPIES: {copies: unknown};
	GET_SAVED_IMAGES: {};
	GET_IMAGE_THUMBS: {urls: string[]};
	GET_SAVED_IMAGE: {url: string};
	DELETE_SAVED_IMAGE: {url: string};
	ADD_SAVED_IMAGES: {images: unknown};
	GET_TRASH: {};
	RESTORE_TRASH: {id: string};
	DELETE_TRASH: {id: string};
	EMPTY_TRASH: {};
	UNDO: {id: string};
	DROP_UNDO: {id: string};
	SEND_TO_PRIVATE: {targets: SendTarget[]};
	SEND_TO_PRIVATE_STATE: {};
	GET_STORAGE_USAGE: {};
	SYNC_STATUS: {};
	SYNC_CONNECT: {url: string; token: string};
	SYNC_DISCONNECT: {};
	SYNC_NOW: {};
	PRIVATE_SYNC_STATUS: {};
	PRIVATE_SYNC_ENABLE: {credential?: string; serverCredential?: string};
	PRIVATE_SYNC_DISABLE: {};
	PRIVATE_SYNC_NOW: {};
	OPEN_PRIVATE_SYNC: {};
	GET_SHARED_PAGES: {list?: boolean};
	UPLOAD_SHARED_PAGE: {
		title: string;
		html: string;
		id?: string;
		linkBase?: string;
		source?: string;
		mode?: SharedPageMode;
		password?: string;
	};
	DELETE_SHARED_PAGE: {id: string};
	GET_SITE_SOURCES: {};
	SET_SITE_SOURCE: {source: string; enabled: boolean};
	SET_SITE_SOURCE_COLUMN: {source: string; columnId: string | null};
	SET_SITE_SOURCE_KEEP_OFF: {source: string; keepOffSite: boolean};
	SITE_SOURCES_POINTED: {sources: string[]};
	SITE_SOURCE_MODE: {source: string};
	SITE_SOURCE_SAVE: {
		source: string;
		url: string;
		title?: string;
		discussion?: string;
	};
	SITE_SOURCE_UNREADABLE: {source: string};
	SITE_SOURCE_PENDING: {source: string};
	TOAST_PREFS: {};
	SITE_SOURCE_CATCH_UP: {source: string; links: unknown[]};
	SITE_SOURCE_CATCH_UP_ADD: {
		source: string;
		links: unknown[];
		automatic?: boolean;
	};
	SITE_SOURCE_CATCH_UP_DISMISS: {source: string; links: unknown[]};
	SITE_SOURCE_UNDO: {id: string};
	QUOTE_UNDO: {id: string};
	SHOW_TRASH_UNDO: {tabId: number; message: string; trashId: string};
	TRASH_UNDO: {id: string};
};

export type TabLodgeMessageType = keyof TabLodgeMessages;
export type TabLodgeMessage = {
	[K in TabLodgeMessageType]: {type: K} & TabLodgeMessages[K];
}[TabLodgeMessageType];

export type ActionFailure = {
	ok: false;
	error: string;
	locked?: true;
	duplicate?: true;
	field?: 'url' | 'token' | 'credential' | 'serverCredential';
};

export type SharedPagesServer = 'none' | 'old' | 'offline' | 'ready';

export type PrivateSyncInfo = {
	availability:
		'ready' | 'no-server' | 'shared' | 'temporary' | 'setup' | 'locked';
	server: string | null;
	lock: boolean;
	encrypted: boolean;
	status: SyncStatus;
};

export type SaveResult = {
	count: number;
	groups: number;
	skipped: number;
	rejectedTabIds: number[];
	groupId: string | null;
};
export type RestoreResult = {
	count: number;
	skipped: number;
	failed: number;
	failures: RestoreFailure[];
	removed: boolean;
	splits: number;
	splitsSeparated: number;
	trashId?: string;
};
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

type Undoable = {undoId?: string};

export type SendToPrivateState = 'hidden' | 'needs-private-window' | 'ready';

export type SiteSourceNotice = 'revoked' | 'unreadable';
export type SiteSourceStatus = {
	id: string;
	enabled: boolean;
	wanted: boolean;
	notice?: SiteSourceNotice;
	pointed?: true;
	columnId?: string;
	keepOffSite?: true;
};
export type SiteSourceOutcome = 'saved' | 'exists' | 'trashed' | 'off';
export type SourceCatchUpMode = 'add' | 'ask';

export type TabLodgeResponses = {
	GET_PRIVATE_CONFIG: PrivateConfig;
	GET_LINK_PREVIEW: {preview: LinkPreviewData | null};
	GET_SERVER_ICONS: {on: boolean};
	GET_SERVER_ICON: {icon: string | null};
	SET_PRIVATE_CONFIG: PrivateConfig;
	SET_PRIVATE_NEW_TAB_REDIRECT: PrivateConfig;
	SET_PRIVATE_ACCENT: PrivateConfig;
	GET_PRIVATE_LOCK: PrivateLockInfo;
	UNLOCK_PRIVATE: PrivateLockInfo;
	LOCK_PRIVATE: PrivateLockInfo;
	TOUCH_PRIVATE_LOCK: PrivateLockInfo;
	ENABLE_PRIVATE_LOCK: PrivateLockInfo;
	CHANGE_PRIVATE_LOCK_CREDENTIAL: PrivateLockInfo;
	REMOVE_PRIVATE_LOCK: PrivateLockInfo;
	RESET_PRIVATE_LIBRARY: PrivateLockInfo;
	GET_PRIVATE_SERVER: {privateServer: PrivateServerInfo};
	JOIN_PRIVATE_SERVER: PrivateLockInfo;
	SET_PRIVATE_LOCK_IDLE: PrivateLockInfo;
	GET_STATE: RevisionedStore;
	GET_STATE_CHANGES: {changes?: StateChange[]};
	GET_BOOKMARK_PROMPT: {
		bookmarkColumns: BookmarkColumn[];
		defaultColumnId?: string;
		existingColumnId?: string;
		settings: Settings;
	};
	GET_SETTINGS_DEFAULTS: {settings: Settings};
	SAVE_TABS: SaveResult;
	PREVIEW_SESSION_NAME: {name: string; asks: boolean};
	SAVE_CURRENT_TAB_TO_GROUP: {count: number; skipped: number; groupId: string};
	RESTORE_GROUP: RestoreResult;
	SWITCH_WORKSPACE: RestoreResult & {
		saved: number;
		savedGroupId: string | null;
		closed: number;
	};
	DELETE_GROUP: {trashId?: string};
	ARCHIVE_GROUP: {group: Session} & Undoable;
	UPDATE_GROUP: {group: Session} & Undoable;
	SET_GROUP_ORDER: Undoable;
	CREATE_FOLDER: {folder: Folder} & Undoable;
	UPDATE_FOLDER: {folder: Folder} & Undoable;
	DELETE_FOLDER: {moved: number} & Undoable;
	DELETE_TAB: {trashId?: string};
	MOVE_TAB: {
		trashId?: string;
	} & Undoable;
	ADD_LINKS_TO_SESSION: {added: number; skipped: number} & Undoable;
	CREATE_SESSION_FROM_LINKS: {
		groupId: string;
		count: number;
		skipped: number;
	} & Undoable;
	UPDATE_GROUP_FROM_WINDOW: {
		count: number;
		added: number;
		removed: number;
		skipped: number;
	} & Undoable;
	SPLIT_GROUP: {groupId: string; count: number} & Undoable;
	UPDATE_TAB: {shared: number} & Undoable;
	MERGE_GROUPS: {added: number; skipped: number} & Undoable;
	ADD_BOOKMARK: {bookmark: Bookmark} & Undoable;
	SAVE_QUOTE: {placed: string} & Undoable;
	ADD_BOOKMARKS: {
		count: number;
		skipped: number;
		bookmarks: Bookmark[];
	} & Undoable;
	UPDATE_BOOKMARK: {bookmark: Bookmark} & Undoable;
	DELETE_BOOKMARK: {trashId?: string};
	REMOVE_DUPLICATE_BOOKMARKS: {removed: number; trashIds: string[]};
	CREATE_BOOKMARK_COLUMN: {column: BookmarkColumn} & Undoable;
	UPDATE_BOOKMARK_COLUMN: {column: BookmarkColumn} & Undoable;
	DELETE_BOOKMARK_COLUMN: {
		moved: number;
		unfiled: number;
		deleted: number;
		trashId?: string;
	};
	REORDER_BOOKMARK_COLUMN: Undoable;
	REORDER_BOOKMARK: Undoable;
	IMPORT_GROUPS: ImportResult & Undoable;
	IMPORT_SESSIONS: ImportResult & Undoable;
	IMPORT_BOOKMARKS_FILE: ImportResult & Undoable;
	IMPORT_BROWSER_BOOKMARKS: BrowserBookmarkImportResult & Undoable;
	ADD_EXCLUDED_ORIGIN: {origin: string; settings: Settings};
	ADD_EXCLUDED_ORIGINS: {
		added: number;
		notAdded: number;
		settings: Settings;
	};
	REMOVE_EXCLUDED_ORIGIN: {settings: Settings};
	UPDATE_SETTINGS: {settings: Settings};
	RESET_SETTINGS: {settings: Settings} & Undoable;
	ERASE_DATA: {sessions: number; bookmarks: number} & Undoable;
	HANDOFF_NEW_TAB: {handedOff: boolean};
	GET_SNAPSHOTS: {
		enabled: boolean;
		snapshots: SnapshotSummary[];
		live: SnapshotSummary | null;
		recovery: RecoveryInfo | null;
	};
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
		copies: PageCopy[];
	};
	RESTORE_FULL_BACKUP: {
		sessions: number;
		bookmarks: number;
		snapshots: number;
		trash: number;
		copies: number;
	} & Undoable;
	KEEP_PAGE_COPY: {url: string; title: string; bookmarked: boolean};
	GET_PAGE_COPIES: {urls: string[]; size: number; budget: number};
	GET_PAGE_COPY: {copy: PageCopy | null};
	DELETE_PAGE_COPY: Undoable;
	ADD_PAGE_COPIES: {copies: number};
	GET_SAVED_IMAGES: {items: ImageEntry[]; size: number; budget: number};
	GET_IMAGE_THUMBS: {thumbs: SavedThumb[]};
	GET_SAVED_IMAGE: {image: SavedImage | null; thumb: SavedThumb | null};
	DELETE_SAVED_IMAGE: {};
	ADD_SAVED_IMAGES: {images: number};
	GET_TRASH: {
		items: TrashSummary[];
		urls: {sessions: string[]; bookmarks: string[]};
	};
	RESTORE_TRASH: {placed: string};
	DELETE_TRASH: Undoable;
	EMPTY_TRASH: {count: number} & Undoable;
	UNDO: {label: string};
	DROP_UNDO: {};
	SEND_TO_PRIVATE: {count: number; keptColumn?: string} & Undoable;
	SEND_TO_PRIVATE_STATE: {state: SendToPrivateState};
	GET_STORAGE_USAGE: {usage: StorageUsage};
	SYNC_STATUS: {status: SyncStatus};
	SYNC_CONNECT: {status: SyncStatus};
	SYNC_DISCONNECT: {status: SyncStatus};
	SYNC_NOW: {status: SyncStatus};
	PRIVATE_SYNC_STATUS: {privateSync: PrivateSyncInfo};
	PRIVATE_SYNC_ENABLE: {privateSync: PrivateSyncInfo};
	PRIVATE_SYNC_DISABLE: {privateSync: PrivateSyncInfo};
	PRIVATE_SYNC_NOW: {privateSync: PrivateSyncInfo};
	OPEN_PRIVATE_SYNC: {};
	GET_SHARED_PAGES: {
		server: SharedPagesServer;
		pages: SharedPage[];
		linkBase: string | null;
		supportsLivePassword: boolean;
		defaultShareMode: SharedPageMode;
	};
	UPLOAD_SHARED_PAGE: {page: SharedPage};
	DELETE_SHARED_PAGE: {};
	GET_SITE_SOURCES: {sources: SiteSourceStatus[]};
	SET_SITE_SOURCE: {sources: SiteSourceStatus[]};
	SET_SITE_SOURCE_COLUMN: {sources: SiteSourceStatus[]};
	SET_SITE_SOURCE_KEEP_OFF: {sources: SiteSourceStatus[]};
	SITE_SOURCES_POINTED: {};
	SITE_SOURCE_MODE: {keepOffSite: boolean};
	SITE_SOURCE_SAVE: {outcome: SiteSourceOutcome; column?: string} & Undoable;
	SITE_SOURCE_UNREADABLE: {reported: boolean};
	SITE_SOURCE_PENDING: {
		saved?: {outcome: SiteSourceOutcome; column?: string} & Undoable;
	};
	TOAST_PREFS: {position: ToastPosition; duration: ToastDuration};
	SITE_SOURCE_CATCH_UP: {
		missing: number;
		ask: boolean;
		mode?: SourceCatchUpMode;
	};
	SITE_SOURCE_CATCH_UP_ADD: {added: number; column?: string} & Undoable;
	SITE_SOURCE_CATCH_UP_DISMISS: {};
	SITE_SOURCE_UNDO: {label: string};
	QUOTE_UNDO: {label: string};
	SHOW_TRASH_UNDO: {};
	TRASH_UNDO: {message: string};
};

export type ActionSuccess<K extends TabLodgeMessageType = TabLodgeMessageType> =
	{ok: true} & TabLodgeResponses[K];
export type ActionResult<K extends TabLodgeMessageType = TabLodgeMessageType> =
	ActionSuccess<K> | ActionFailure;
