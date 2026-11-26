export type SettingScope = 'all' | 'platform' | 'device';
type Scoped<Scope extends SettingScope = SettingScope> = readonly [
	Scope,
	string,
];

const BOTH = 'Both apps read it, and it means the same in each.';
const TABS = 'Acts on browser windows and tabs, which the phone does not have.';
const START =
	'How the browser starts, opens new tabs, and uses the toolbar button.';
const BOARD =
	"The extension's dashboard: the phone lays out its screens with its own preferences.";
const MENU = "The browser's right-click menu.";
const KEPT = 'Snapshots and backups the extension keeps in the browser.';
const LOOK = 'Appearance, which each app draws its own way.';
const PHONE_LOOK = 'Appearance of the Android app, which phones share.';
const GESTURES = "Taps and swipes on the phone's screens.";
const SECURITY =
	"The protection of this device's private library: a change made on another device must not weaken it.";
const APPS = 'The browsers installed on this phone.';
const HINT = 'A per-screen hint, dismissed on this device.';

export const LIBRARY_SETTINGS = {
	closeOnSave: [
		'platform',
		'Closes the browser tabs a save used; the phone has no browser tabs.',
	],
	emptyWindowAfterSave: ['platform', TABS],
	includePinnedTabs: ['platform', TABS],
	ignoreTabGroups: ['platform', TABS],
	openDashboardAfterSave: ['platform', TABS],
	openDashboardOnStartup: ['platform', START],
	startupBehavior: ['platform', START],
	newTabEnabled: ['platform', START],
	newTabFallback: ['platform', START],
	newTabFallbackUrl: ['platform', START],
	autoFocusSearchOnNewTab: ['platform', START],
	actionMode: ['platform', START],
	excludedOrigins: ['all', BOTH],
	saveDuplicateHandling: ['platform', TABS],
	saveDuplicateTitle: ['platform', TABS],
	restoreDuplicateHandling: ['platform', TABS],
	restoreTarget: ['platform', TABS],
	restoreWindowBounds: ['platform', TABS],
	restoreMode: ['platform', TABS],
	unloadRestoredTabs: ['platform', TABS],
	unloadRestoredTabsThreshold: ['platform', TABS],
	restoreSplitTabs: ['platform', TABS],
	saveSplitTabs: ['platform', TABS],
	paletteLocation: ['platform', BOARD],
	sessionSort: ['all', BOTH],
	expandSessionsByDefault: ['all', BOTH],
	showSessionFaviconPreviews: ['all', BOTH],
	sessionQuickActions: ['platform', BOARD],
	stretchBookmarkColumns: ['platform', BOARD],
	bookmarkColumnWidth: ['platform', BOARD],
	bookmarkColumnsPerRow: ['platform', BOARD],
	bookmarkSort: ['all', BOTH],
	bookmarkDensity: ['all', BOTH],
	limitBookmarksPerColumn: [
		'platform',
		'Caps the height of a column on the board; the phone shows one column at a time and scrolls it.',
	],
	bookmarkColumnPageSize: [
		'platform',
		'How many bookmarks fit in a board column before it scrolls; the phone has no board.',
	],
	pasteLinkToBookmark: [
		'platform',
		'Pasting on the board with a keyboard; the phone saves links from the share sheet and its Add button.',
	],
	toastPosition: [
		'platform',
		"Where the extension's messages appear; the phone has its own Message position.",
	],
	toastDuration: ['all', BOTH],
	cleanTitles: ['all', BOTH],
	bookmarkClickAction: ['platform', TABS],
	sessionLinkClickAction: ['platform', TABS],
	bookmarkQuickActions: ['platform', BOARD],
	sessionsOnTop: ['platform', BOARD],
	showSaveWindowButton: ['platform', BOARD],
	linkPreviews: [
		'platform',
		'The hover card on the dashboard. The phone has no hover preview; its save screen lookup is `savePreview`, which also fills in the title of a bare shared address.',
	],
	siteIcons: ['all', BOTH],
	showTrashBinButton: ['platform', BOARD],
	dashboardWidth: ['platform', BOARD],
	bookmarkBoardView: ['platform', BOARD],
	sessionFolderView: ['platform', BOARD],
	showAllBookmarks: ['all', BOTH],
	keepLodgePinned: ['platform', TABS],
	browserBookmarkAction: ['platform', "The browser's own bookmarks."],
	browserBookmarkColumn: ['platform', "The browser's own bookmarks."],
	dashboardBehavior: ['platform', TABS],
	removeTrackingParameters: ['all', BOTH],
	simplifyUrls: ['all', BOTH],
	markInsecureLinks: ['all', BOTH],
	markLocalLinks: ['all', BOTH],
	urlDisplayMode: ['all', BOTH],
	groupTitleAction: ['platform', BOARD],
	contextMenusEnabled: ['platform', MENU],
	contextMenuLinksEnabled: ['platform', MENU],
	contextMenuPageEnabled: ['platform', MENU],
	contextMenuSelectionEnabled: ['platform', MENU],
	contextMenuActionEnabled: ['platform', MENU],
	snapshotsEnabled: ['platform', TABS],
	snapshotIntervalMinutes: ['platform', TABS],
	snapshotKeep: ['platform', TABS],
	autoBackup: ['platform', KEPT],
	autoBackupKeep: ['platform', KEPT],
	autoBackupToDownloads: [
		'device',
		'Needs the optional downloads permission, which only a click in that browser can grant.',
	],
	trashRetentionDays: ['all', BOTH],
	autoArchiveDays: ['all', BOTH],
	sessionNameStyle: ['all', BOTH],
	sessionNameTemplate: ['all', BOTH],
	sessionNameFallback: ['all', BOTH],
	defaultShareMode: ['all', BOTH],
	sourceCatchUp: [
		'platform',
		'Watches the saved pages of sites the extension reads; the phone cannot read site pages.',
	],
	mobileApp: [
		'platform',
		"The Android app's own preferences, which only phones read (`ANDROID_PREFERENCES`).",
	],
} as const satisfies Record<string, Scoped>;

export const EXTENSION_STORAGE = {
	uiTheme: ['platform', LOOK],
	uiAccent: ['platform', LOOK],
	privateAccent: [
		'platform',
		'The accent of private windows, stored in `tablodge.private.config`. It syncs under this id; the rest of that key does not.',
	],
	'tablodge.uiTheme': [
		'platform',
		'A copy of `uiTheme` that pages apply before they render.',
	],
	'tablodge.uiAccent': [
		'platform',
		'A copy of `uiAccent` that pages apply before they render.',
	],
	'tablodge.privateAccent': [
		'platform',
		'A copy of `privateAccent` that private windows apply before they render.',
	],
	'tablodge.device': [
		'device',
		'The device name, which says which device saved a session.',
	],
	'tablodge.sync.config': [
		'device',
		'The sync server address and token, which connect this device.',
	],
	'tablodge.sync.settings': [
		'device',
		'The Sync settings switch itself, which decides what this device takes.',
	],
	'tablodge.private.config': [
		'device',
		'Private storage mode, its setup, and its new tab redirect: they follow the private library of this browser. Its accent syncs as `privateAccent`.',
	],
	'tablodge.private.lock': ['device', SECURITY],
	'tablodge.sources': [
		'device',
		'Only the part that says whether each site runs here: it follows the site access this browser granted. The choices themselves sync.',
	],
	'tablodge.sourceCatchUp': [
		'device',
		'The pages answered Not now, a dismissal on this device.',
	],
	'tablodge.sync.dismissed': [
		'device',
		'A dismissed banner about missing server features, a dismissal on this device.',
	],
	'tablodge.focusHintDismissed': ['device', HINT],
	'tablodge.sessionFolderHintDismissed': ['device', HINT],
} as const satisfies Record<string, Scoped>;

export const ANDROID_PREFERENCES = {
	look: ['platform', PHONE_LOOK],
	floatingBar: ['platform', PHONE_LOOK],
	barSize: ['platform', PHONE_LOOK],
	barLabels: ['platform', PHONE_LOOK],
	glassEffect: [
		'device',
		'Whether this phone frosts its floating bar and buttons, which depends on its graphics: a slow phone turns it off for itself.',
	],
	messagePosition: ['platform', PHONE_LOOK],
	theme: ['platform', PHONE_LOOK],
	accent: ['platform', PHONE_LOOK],
	compactSessions: ['platform', PHONE_LOOK],
	showSavedOn: ['platform', PHONE_LOOK],
	tapAction: ['platform', GESTURES],
	swipeRight: ['platform', GESTURES],
	swipeLeft: ['platform', GESTURES],
	sessionSwipeRight: ['platform', GESTURES],
	sessionSwipeLeft: ['platform', GESTURES],
	linkSwipeRight: ['platform', GESTURES],
	linkSwipeLeft: ['platform', GESTURES],
	bookmarkView: ['platform', PHONE_LOOK],
	sessionView: ['platform', PHONE_LOOK],
	sessionTap: ['platform', GESTURES],
	sessionMain: ['platform', GESTURES],
	savePreview: [
		'platform',
		"A phone only lookup of the page on the save screen, which also fills in the title of a bare shared address; the extension's tab already has its title. Not the extension's hover card, `linkPreviews`.",
	],
	backgroundSync: [
		'platform',
		'Syncing with the app closed, which means the same on every phone.',
	],
	lastColumnId: [
		'device',
		'The column this phone saved to last, which it remembers rather than a choice.',
	],
	deviceName: [
		'device',
		'The device name, which says which device saved a session.',
	],
	syncSettings: [
		'device',
		'The Sync settings switch itself, which decides what this phone takes.',
	],
	syncPrivate: [
		'device',
		"Whether this phone's private library goes to the server, which is this phone's own choice about its private data.",
	],
	showPrivateButton: [
		'device',
		'Whether this phone shows that it has a private library, which is its own privacy choice.',
	],
	privateLockMode: ['device', SECURITY],
	privateLockMinutes: ['device', SECURITY],
	openWith: ['device', APPS],
	openApp: ['device', APPS],
	privateOpenWith: ['device', APPS],
	privateOpenApp: ['device', APPS],
} as const satisfies Record<string, Scoped<'platform' | 'device'>>;

export const keysScoped = <Key extends string>(
	registry: Readonly<Record<Key, Scoped>>,
	scope: SettingScope,
): Key[] =>
	(Object.keys(registry) as Key[]).filter((key) => registry[key][0] === scope);
