/*
The settings that stay on one device, each with its reason, for the extension and the Android app. This is the only
list: every other setting syncs while Settings › Sync › Sync settings is on. The extension syncs every key of
`DEFAULT_SETTINGS` that is not listed here (`library-records.ts`), and the phone every preference in its schema that
is not listed here (`preference-schema.ts`), so a new setting syncs unless someone adds it here with a reason.

docs/PRIVACY.md repeats the list under "What stays on each device", and tests/local-settings.test.ts fails when a key
is local without being listed, or listed here and missing from that page.

No imports: the Android app and the tests read this file too.
*/

/**
Extension settings in the library (`Settings`) that stay in each browser.
*/
export const EXTENSION_LOCAL_SETTINGS = {
	autoBackupToDownloads:
		'Needs the optional downloads permission, which only a click in that browser can grant.',
} as const;

/**
Extension settings kept outside the library under their own storage keys. None of them syncs.
*/
export const EXTENSION_DEVICE_STORAGE = {
	uiTheme: 'Theme and appearance: each device keeps its own.',
	uiAccent: 'Theme and appearance: each device keeps its own.',
	'tablodge.uiTheme':
		'A copy of `uiTheme` that pages apply before they render.',
	'tablodge.uiAccent':
		'A copy of `uiAccent` that pages apply before they render.',
	'tablodge.privateAccent':
		'Theme and appearance of private windows, which each device keeps.',
	'tablodge.device':
		'The device name, which says which device saved a session.',
	'tablodge.sync.config':
		'The sync server address and token, which connect this device.',
	'tablodge.sync.settings':
		'The Sync settings switch itself, which decides what this device takes.',
	'tablodge.private.config':
		'Private storage mode, its setup, its new tab redirect, and the private window accent: they follow the private library of this browser.',
	'tablodge.private.lock':
		"The private library's password lock and how long it waits before it locks, which protect the private library of this browser.",
	'tablodge.sources':
		'Only the part that says whether each site runs here: it follows the site access this browser granted. The choices themselves sync.',
	'tablodge.sourceCatchUp':
		'The pages answered Not now, a dismissal on this device.',
	'tablodge.sync.dismissed':
		'A dismissed banner about missing server features, a dismissal on this device.',
	'tablodge.focusHintDismissed': 'A per-screen hint, dismissed on this device.',
	'tablodge.sessionFolderHintDismissed':
		'A per-screen hint, dismissed on this device.',
} as const;

/**
Android app preferences that stay on the phone. The rest of its preferences sync between phones.
*/
export const ANDROID_LOCAL_PREFERENCES = {
	look: 'Theme and appearance: each device keeps its own.',
	theme: 'Theme and appearance: each device keeps its own.',
	accent: 'Theme and appearance: each device keeps its own.',
	floatingBar: 'Theme and appearance: each device keeps its own.',
	barSize: 'Theme and appearance: each device keeps its own.',
	barLabels: 'Theme and appearance: each device keeps its own.',
	glassEffect: 'Theme and appearance, and what this phone can draw smoothly.',
	deviceName: 'The device name, which says which device saved a session.',
	syncSettings:
		'The Sync settings switch itself, which decides what this phone takes.',
	syncPrivate: "Whether this phone's private library syncs.",
	backgroundSync: "Background sync, which uses this phone's battery.",
	showPrivateButton: 'Whether this phone shows that it has a private library.',
	privateLockMode: "When this phone's private library locks.",
	privateLockMinutes: "When this phone's private library locks.",
	openWith: 'The browsers installed on this phone.',
	openApp: 'The browsers installed on this phone.',
	privateOpenWith: 'The browsers installed on this phone.',
	privateOpenApp: 'The browsers installed on this phone.',
	lastColumnId:
		'The column this phone saved to last, which it remembers rather than a choice.',
} as const;
