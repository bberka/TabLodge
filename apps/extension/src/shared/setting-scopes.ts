/*
The sync scope of every setting in the extension and the Android app, each with its reason. One of three:

- `all`: syncs to every browser and phone, because both apps read it and it means the same in each.
- `platform`: syncs to every device of one kind, all browsers or all phones, because the other app has no use for it.
- `device`: never syncs, not even to a second device of the same kind. Only for what cannot mean anything on another
  device: its name, its connection, a permission only it can grant, its installed apps, its private library,
  dismissals and remembered state.

On the wire `all` and `platform` travel alike. Library settings reach every device, and only the app that reads one
acts on it: the phone reads exactly the library settings scoped `all` (tests/setting-scopes.test.ts checks its
source). The phone's own preferences travel in the library's `mobileApp` setting, which only phones read, and the
extension's theme and accents as `setting` records the phone holds without reading. A setting scoped `device` stays
out of every record. Every one still syncs only while Settings › Sync › Sync settings is on.

A new setting needs an entry here, or the extension and the app do not compile; the default is `all` or, when the other
app has no use for it, `platform`. A narrower scope needs a reason that names what binds it to the device.
docs/PRIVACY.md lists every `device` entry under "What stays on each device", which the test checks.

No imports: the Android app and the tests read this file too.
*/

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
const NAMES = 'Names for sessions saved from browser windows.';
const DUPLICATE =
	'The phone has its own preference for this (#429); until the two are one, each app keeps its own.';
const LOOK = 'Appearance, which each app draws its own way.';
const PHONE_LOOK = 'Appearance of the Android app, which phones share.';
const GESTURES = "Taps and swipes on the phone's screens.";
const SECURITY =
	"The protection of this device's private library: a change made on another device must not weaken it.";
const APPS = 'The browsers installed on this phone.';
const HINT = 'A per-screen hint, dismissed on this device.';

/**
Extension settings in the library (`Settings`), except `heldSettings`, which only carries a newer version's settings.
*/
export const LIBRARY_SETTINGS = {
	closeOnSave: ['platform', TABS],
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
	bookmarkSort: [
		'platform',
		'The phone shows the stored order until it has a sort of its own (#440).',
	],
	bookmarkDensity: ['all', BOTH],
	limitBookmarksPerColumn: ['platform', BOARD],
	bookmarkColumnPageSize: ['platform', BOARD],
	pasteLinkToBookmark: ['platform', BOARD],
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
	linkPreviews: ['platform', DUPLICATE],
	siteIcons: ['platform', DUPLICATE],
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
	autoArchiveDays: [
		'platform',
		'The extension archives idle sessions; the phone has no such option yet.',
	],
	sessionNameStyle: ['platform', NAMES],
	sessionNameTemplate: ['platform', NAMES],
	sessionNameFallback: ['platform', NAMES],
	mobileApp: [
		'platform',
		"The Android app's own preferences, which only phones read (`ANDROID_PREFERENCES`).",
	],
} as const satisfies Record<string, Scoped>;

/**
Extension settings kept outside the library under their own storage keys, and the ids the platform ones sync under.
*/
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

/**
Android app preferences. They never reach a browser, so none is `all`: a setting both apps share belongs in the
library's settings instead.
*/
export const ANDROID_PREFERENCES = {
	look: ['platform', PHONE_LOOK],
	floatingBar: ['platform', PHONE_LOOK],
	barSize: ['platform', PHONE_LOOK],
	barLabels: ['platform', PHONE_LOOK],
	glassEffect: ['platform', PHONE_LOOK],
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
	cleanOnSave: [
		'platform',
		'Strips tracking parameters when the phone saves a link. The shared `removeTrackingParameters` strips them when a link opens.',
	],
	siteIcons: ['platform', DUPLICATE],
	savePreview: ['platform', DUPLICATE],
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

/**
The keys of `registry` with the scope `scope`.
*/
export const keysScoped = <Key extends string>(
	registry: Readonly<Record<Key, Scoped>>,
	scope: SettingScope,
): Key[] =>
	(Object.keys(registry) as Key[]).filter((key) => registry[key][0] === scope);
