/*
Settings that belong to this phone only and never sync: how the app looks. Loaded once at startup; screens read
them with `usePreferences`.
*/
import {Appearance, Platform} from 'react-native';
import {useSyncExternalStore} from 'react';
import {isAccent} from '../../../extension/src/shared/accent-colors';
import {cleanDeviceName} from '../../../extension/src/shared/device';
import {readJson, writeJson} from '../platform/storage';

const LOOKS = ['auto', 'material', 'ios'] as const;
export type Look = (typeof LOOKS)[number];
const isLook = (value: unknown): value is Look => LOOKS.includes(value as Look);

/**
The look to draw: the one chosen, or for Automatic the phone's own: iOS on an iPhone, and Material on Android.
*/
export const resolveLook = (look: Look): 'material' | 'ios' => {
	if (look !== 'auto') {
		return look;
	}

	return Platform.OS === 'ios' ? 'ios' : 'material';
};

export type Theme = 'system' | 'light' | 'dark';

const THEMES = new Set<unknown>(['system', 'light', 'dark']);
const isTheme = (value: unknown): value is Theme => THEMES.has(value);

/**
Makes the whole app, and the system dialogs it opens, follow the chosen theme; `system` hands the choice back to the phone.
*/
function applyTheme(theme: Theme) {
	// `unspecified` hands the choice back to the phone.
	Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);
}

/**
What a swipe on a bookmark does.
*/
export type RowAction = 'none' | 'open' | 'edit' | 'move' | 'delete';
export const ROW_ACTIONS: readonly RowAction[] = [
	'none',
	'open',
	'edit',
	'move',
	'delete',
];

/**
What a swipe on a session card does.
*/
export type SessionAction =
	'none' | 'open' | 'rename' | 'move' | 'archive' | 'share' | 'delete';
export const SESSION_ACTIONS: readonly SessionAction[] = [
	'none',
	'open',
	'rename',
	'move',
	'share',
	'archive',
	'delete',
];

export const PRIVATE_LOCK_MODES = [
	'manual',
	'leave',
	'screen',
	'timeout',
] as const;
export const PRIVATE_LOCK_MINUTES = [1, 5, 15, 30, 60] as const;

type Preferences = {
	/**
	Which platform's design the app imitates. Defaults to the phone's own.
	*/
	look: Look;
	/**
	A rounded bar that floats above the content, instead of one fixed to the bottom edge.
	*/
	floatingBar: boolean;
	/**
	With the floating bar: `full` spans the screen with labels, `compact` is a small pill of icons, `scroll` is full
	until the list is scrolled down, and `icons` keeps the bar's size but hides the labels.
	*/
	barSize: BarSize;
	/**
	The column the last link was saved to, offered first next time.
	*/
	lastColumnId: string;
	/**
	What tapping a bookmark does.
	*/
	tapAction: 'open' | 'edit';
	/**
	What swiping a bookmark to the right, and to the left, does.
	*/
	swipeRight: RowAction;
	swipeLeft: RowAction;
	/**
	What swiping a session card to the right, and to the left, does. Sync with the rest of the app's look.
	*/
	sessionSwipeRight: SessionAction;
	sessionSwipeLeft: SessionAction;
	/**
	What tapping a session card does: show its tabs, or open them all.
	*/
	sessionTap: 'expand' | 'open';
	/**
	The button at the foot of an open session card. Open all by default.
	*/
	sessionMain: SessionAction;
	/**
	Remove tracking parameters (utm_source and the like) from a link when it is saved.
	*/
	cleanOnSave: boolean;
	/**
	Share the settings above, except this one, through sync, so phones that use one library look and behave alike.
	On by default, like the extension's portable settings. This choice itself stays on this phone.
	*/
	syncSettings: boolean;
	/**
	Keep the private library in step with the server. Off, it stays on this phone only. This choice stays on this phone.
	*/
	syncPrivate: boolean;
	/**
	Ask before the private library syncs: each time it opens (the app starts with it open, or it is unlocked, or the private
	view is opened), a dialog asks whether to sync it now. Only matters while syncing the private library is on and a
	server is connected. This choice stays on this phone.
	*/
	askToSyncPrivate: boolean;
	/**
	Whether each site's own icon replaces its letter tile: `server` (the default) asks the connected sync server, which
	fetches it, so the site never sees this phone and nothing is shown without a server; `direct` also asks the site
	itself when there is no server; `off` shows letter tiles. Stays on this phone.
	*/
	siteIcons: SiteIcons;
	/**
	Look the page up while saving a link, to show its icon and fill in its title. Through the sync server when one is
	connected, otherwise from the site itself. On by default, and stays on this phone.
	*/
	savePreview: boolean;
	/**
	The accent color: `default` (TabLodge's, the default), `system` (the phone's own), a preset id, or `#rrggbb`. Syncs with
	the rest of the app's look.
	*/
	accent: string;
	/**
	Light, dark, or the phone's own setting (the default). Syncs with the rest of the app's look.
	*/
	theme: Theme;
	/**
	Show the button that opens the private library on Bookmarks and Sessions, while a server is connected. On by default,
	though it tells anyone holding the phone that a private library exists. Stays on this phone.
	*/
	showPrivateButton: boolean;
	/**
	When the private library locks by itself: `manual` only by hand, `leave` when the app goes behind another one,
	`screen` (the default) when the screen turns off, `timeout` after a while without use. Only a library with a PIN or
	password locks.
	This stays on this phone.
	*/
	privateLockMode: 'manual' | 'leave' | 'screen' | 'timeout';
	/**
	How many minutes without use `timeout` waits.
	*/
	privateLockMinutes: number;
	/**
	Where a link opens: the default browser, an in-app tab, or the browser in `openApp`. Stays on this phone.
	*/
	openWith: OpenWith;
	/**
	The package name of the browser for `openWith` `app`.
	*/
	openApp: string;
	/**
	The same for links from the private library, or `same` to follow the setting above. Chrome ignores a request for a
	private tab from another app, so a private browser is chosen here as an app instead.
	*/
	privateOpenWith: OpenWith | 'same';
	privateOpenApp: string;
	/**
	Session cards without the tab icon strip and the saved-on line, and with tighter tab rows. Syncs with the rest of the
	app's look.
	*/
	compactSessions: boolean;
	/**
	Show which device saved a session on its card. Syncs with the rest of the app's look.
	*/
	showSavedOn: boolean;
	/**
	The name this phone puts on the sessions it saves. Empty means the phone's own make and model. Stays on this phone.
	*/
	deviceName: string;
};

const KEY = 'tablodge.prefs';

const defaults: Preferences = {
	look: 'auto',
	floatingBar: true,
	barSize: 'scroll',
	lastColumnId: '',
	tapAction: 'open',
	swipeRight: 'delete',
	swipeLeft: 'edit',
	sessionSwipeRight: 'archive',
	sessionSwipeLeft: 'delete',
	sessionTap: 'expand',
	sessionMain: 'open',
	cleanOnSave: true,
	syncSettings: true,
	syncPrivate: true,
	askToSyncPrivate: true,
	siteIcons: 'server',
	savePreview: true,
	accent: 'default',
	theme: 'system',
	showPrivateButton: true,
	privateLockMode: 'screen',
	privateLockMinutes: 5,
	openWith: 'system',
	openApp: '',
	privateOpenWith: 'same',
	privateOpenApp: '',
	compactSessions: false,
	showSavedOn: true,
	deviceName: '',
};

const SITE_ICONS = ['off', 'server', 'direct'] as const;
export type SiteIcons = (typeof SITE_ICONS)[number];

/**
An earlier version kept this as a switch: on asked the server or the site, off showed none. On keeps its meaning;
off, the default, becomes the server-only choice.
*/
const siteIconsChoice = (value: unknown): SiteIcons => {
	if (value === true) {
		return 'direct';
	}

	return SITE_ICONS.includes(value as SiteIcons)
		? (value as SiteIcons)
		: defaults.siteIcons;
};

const OPEN_WITH = ['system', 'inapp', 'app'] as const;
export type OpenWith = (typeof OPEN_WITH)[number];
const isOpenWith = (value: unknown): value is OpenWith =>
	OPEN_WITH.includes(value as OpenWith);

const BAR_SIZES = ['full', 'scroll', 'compact', 'icons'] as const;
export type BarSize = (typeof BAR_SIZES)[number];
const isBarSize = (value: unknown): value is BarSize =>
	BAR_SIZES.includes(value as BarSize);

const rowAction = (value: unknown, fallback: RowAction): RowAction =>
	ROW_ACTIONS.find((action) => action === value) ?? fallback;

const sessionAction = (
	value: unknown,
	fallback: SessionAction,
): SessionAction =>
	SESSION_ACTIONS.find((action) => action === value) ?? fallback;

let current = defaults;
const listeners = new Set<() => void>();

/**
Reads stored or backed up preferences. A value that is missing or not valid falls back to its default.
*/
function parsePreferences(saved: Partial<Preferences>): Preferences {
	const {
		look,
		floatingBar,
		barSize,
		lastColumnId,
		tapAction,
		swipeRight,
		swipeLeft,
		sessionSwipeRight,
		sessionSwipeLeft,
		sessionTap,
		sessionMain,
		cleanOnSave,
		syncSettings,
		syncPrivate,
		askToSyncPrivate,
		siteIcons,
		savePreview,
		deviceName,
		accent,
		theme,
		showPrivateButton,
		privateLockMode,
		privateLockMinutes,
		openWith,
		openApp,
		privateOpenWith,
		privateOpenApp,
		compactSessions,
		showSavedOn,
	} = saved;
	return {
		look: isLook(look) ? look : defaults.look,
		floatingBar:
			typeof floatingBar === 'boolean' ? floatingBar : defaults.floatingBar,
		barSize: isBarSize(barSize) ? barSize : defaults.barSize,
		lastColumnId: typeof lastColumnId === 'string' ? lastColumnId : '',
		tapAction: tapAction === 'edit' ? 'edit' : 'open',
		swipeRight: rowAction(swipeRight, defaults.swipeRight),
		swipeLeft: rowAction(swipeLeft, defaults.swipeLeft),
		sessionSwipeRight: sessionAction(
			sessionSwipeRight,
			defaults.sessionSwipeRight,
		),
		sessionSwipeLeft: sessionAction(
			sessionSwipeLeft,
			defaults.sessionSwipeLeft,
		),
		sessionTap: sessionTap === 'open' ? 'open' : 'expand',
		sessionMain: sessionAction(sessionMain, defaults.sessionMain),
		cleanOnSave:
			typeof cleanOnSave === 'boolean' ? cleanOnSave : defaults.cleanOnSave,
		syncSettings:
			typeof syncSettings === 'boolean' ? syncSettings : defaults.syncSettings,
		syncPrivate:
			typeof syncPrivate === 'boolean' ? syncPrivate : defaults.syncPrivate,
		askToSyncPrivate:
			typeof askToSyncPrivate === 'boolean'
				? askToSyncPrivate
				: defaults.askToSyncPrivate,
		siteIcons: siteIconsChoice(siteIcons),
		savePreview:
			typeof savePreview === 'boolean' ? savePreview : defaults.savePreview,
		accent: isAccent(accent) ? accent : defaults.accent,
		theme: isTheme(theme) ? theme : defaults.theme,
		showPrivateButton:
			typeof showPrivateButton === 'boolean'
				? showPrivateButton
				: defaults.showPrivateButton,
		privateLockMode: PRIVATE_LOCK_MODES.includes(privateLockMode as never)
			? privateLockMode!
			: defaults.privateLockMode,
		privateLockMinutes: PRIVATE_LOCK_MINUTES.includes(
			privateLockMinutes as never,
		)
			? privateLockMinutes!
			: defaults.privateLockMinutes,
		openWith: isOpenWith(openWith) ? openWith : defaults.openWith,
		openApp: typeof openApp === 'string' ? openApp : '',
		privateOpenWith:
			privateOpenWith === 'same' || isOpenWith(privateOpenWith)
				? privateOpenWith
				: defaults.privateOpenWith,
		privateOpenApp: typeof privateOpenApp === 'string' ? privateOpenApp : '',
		compactSessions: compactSessions === true,
		showSavedOn: showSavedOn !== false,
		deviceName: cleanDeviceName(deviceName),
	};
}

export async function loadPreferences(): Promise<void> {
	const saved = await readJson(KEY);
	if (typeof saved !== 'object' || saved === null) {
		return;
	}

	current = parsePreferences(saved);
	applyTheme(current.theme);
	for (const listener of listeners) {
		listener();
	}
}

let onLocalChange: ((change: Partial<Preferences>) => void) | undefined;

/**
Registers what runs after the user changes a preference, so settings sync can send it without this module knowing.
*/
export function watchLocalChanges(
	callback: (change: Partial<Preferences>) => void,
): void {
	onLocalChange = callback;
}

/**
Changes preferences. `fromSync` marks values that came from another phone, which are not sent back.
*/
export function setPreferences(
	change: Partial<Preferences>,
	fromSync = false,
): void {
	current = {...current, ...change};
	if (change.theme) {
		applyTheme(change.theme);
	}

	for (const listener of listeners) {
		listener();
	}

	void writeJson(KEY, current);
	if (!fromSync) {
		onLocalChange?.(change);
	}
}

/**
Puts every preference back to its default. This phone's name, the column last saved to, and whether settings sync stay.
*/
export function resetPreferences(): void {
	setPreferences({
		...defaults,
		deviceName: current.deviceName,
		lastColumnId: current.lastColumnId,
		syncSettings: current.syncSettings,
		syncPrivate: current.syncPrivate,
		askToSyncPrivate: current.askToSyncPrivate,
	});
}

/**
Every preference worth keeping in a backup: all but this phone's name and the column last saved to.
*/
export function backupPreferences(): Omit<
	Preferences,
	'deviceName' | 'lastColumnId'
> {
	const {deviceName: _name, lastColumnId: _column, ...rest} = current;
	return rest;
}

/**
Puts the preferences of a backup back, as one change. This phone's name and last column stay.
*/
export function restorePreferences(value: unknown): void {
	if (typeof value !== 'object' || value === null) {
		return;
	}

	const {
		deviceName: _name,
		lastColumnId: _column,
		...rest
	} = parsePreferences(value);
	setPreferences(rest);
}

export const getPreferences = (): Preferences => current;

export const usePreferences = (): Preferences =>
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => current,
	);

const SYNCED_KEYS = [
	'look',
	'floatingBar',
	'barSize',
	'tapAction',
	'swipeRight',
	'swipeLeft',
	'sessionSwipeRight',
	'sessionSwipeLeft',
	'sessionTap',
	'sessionMain',
	'cleanOnSave',
	'savePreview',
	'siteIcons',
	'accent',
	'theme',
	'compactSessions',
	'showSavedOn',
] as const;

/**
The preferences that sync, as the plain values the extension keeps for the phones.
*/
export function syncedPreferences(
	prefs: Preferences,
): Record<string, string | boolean> {
	return Object.fromEntries(SYNCED_KEYS.map((key) => [key, prefs[key]]));
}

/**
Reads synced preferences from another phone. Anything that is not a valid value is left out, so one bad entry never
changes the rest.
*/
export function readSyncedPreferences(value: unknown): Partial<Preferences> {
	if (typeof value !== 'object' || value === null) {
		return {};
	}

	const raw = value as Record<string, unknown>;
	const found: Partial<Preferences> = {};
	if (isLook(raw.look)) {
		found.look = raw.look;
	}

	if (typeof raw.floatingBar === 'boolean') {
		found.floatingBar = raw.floatingBar;
	}

	if (isBarSize(raw.barSize)) {
		found.barSize = raw.barSize;
	}

	if (raw.tapAction === 'open' || raw.tapAction === 'edit') {
		found.tapAction = raw.tapAction;
	}

	const right = ROW_ACTIONS.find((action) => action === raw.swipeRight);
	if (right) {
		found.swipeRight = right;
	}

	const left = ROW_ACTIONS.find((action) => action === raw.swipeLeft);
	if (left) {
		found.swipeLeft = left;
	}

	const sessionRight = SESSION_ACTIONS.find(
		(action) => action === raw.sessionSwipeRight,
	);
	if (sessionRight) {
		found.sessionSwipeRight = sessionRight;
	}

	const sessionLeft = SESSION_ACTIONS.find(
		(action) => action === raw.sessionSwipeLeft,
	);
	if (sessionLeft) {
		found.sessionSwipeLeft = sessionLeft;
	}

	if (raw.sessionTap === 'expand' || raw.sessionTap === 'open') {
		found.sessionTap = raw.sessionTap;
	}

	const main = SESSION_ACTIONS.find((action) => action === raw.sessionMain);
	if (main && main !== 'none') {
		found.sessionMain = main;
	}

	if (typeof raw.savePreview === 'boolean') {
		found.savePreview = raw.savePreview;
	}

	if (['off', 'server', 'direct'].includes(String(raw.siteIcons))) {
		found.siteIcons = raw.siteIcons as Preferences['siteIcons'];
	}

	if (typeof raw.compactSessions === 'boolean') {
		found.compactSessions = raw.compactSessions;
	}

	if (typeof raw.showSavedOn === 'boolean') {
		found.showSavedOn = raw.showSavedOn;
	}

	if (isTheme(raw.theme)) {
		found.theme = raw.theme;
	}

	if (isAccent(raw.accent)) {
		found.accent = raw.accent;
	}

	if (typeof raw.cleanOnSave === 'boolean') {
		found.cleanOnSave = raw.cleanOnSave;
	}

	return found;
}
