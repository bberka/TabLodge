/*
Settings that belong to this phone only and never sync: how the app looks. Loaded once at startup; screens read
them with `usePreferences`.
*/
import {Appearance, Platform} from 'react-native';
import {useSyncExternalStore} from 'react';
import {isAccent} from '../../extension/src/shared/accent-colors';
import {cleanDeviceName} from '../../extension/src/shared/device';
import {readJson, writeJson} from './storage';

const LOOKS = ['auto', 'material', 'oneui', 'ios'] as const;
export type Look = (typeof LOOKS)[number];
const isLook = (value: unknown): value is Look => LOOKS.includes(value as Look);

/**
Whether this is a Samsung phone, which has its own One UI look.
*/
const samsung = (): boolean =>
	Platform.OS === 'android' &&
	(
		Platform.constants as {Manufacturer?: string}
	).Manufacturer?.toLowerCase() === 'samsung';

/**
The look to draw: the one chosen, or for Automatic the phone's own: iOS on an iPhone, One UI on a Samsung phone, and
Material on any other Android phone.
*/
export const resolveLook = (look: Look): 'material' | 'oneui' | 'ios' => {
	if (look !== 'auto') {
		return look;
	}

	if (Platform.OS === 'ios') {
		return 'ios';
	}

	return samsung() ? 'oneui' : 'material';
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
	| 'none'
	| 'open'
	| 'color'
	| 'rename'
	| 'move'
	| 'archive'
	| 'share'
	| 'delete';
export const SESSION_ACTIONS: readonly SessionAction[] = [
	'none',
	'open',
	'rename',
	'color',
	'move',
	'share',
	'archive',
	'delete',
];

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
	With the floating bar: `full` spans the screen with labels, `compact` is a small pill of icons, and `scroll` is full
	until the list is scrolled down.
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
	Remove tracking parameters (utm_source and the like) from a link when it is saved.
	*/
	cleanOnSave: boolean;
	/**
	Share the settings above, except this one, through sync, so phones that use one library look and behave alike.
	On by default, like the extension's portable settings. This choice itself stays on this phone.
	*/
	syncSettings: boolean;
	/**
	Show each site's own icon instead of a letter tile. Icons come from the sync server when one is connected,
	otherwise straight from the site. Off by default, because either way the site or the server is asked for each
	address that is shown. Stays on this phone.
	*/
	siteIcons: boolean;
	/**
	Look the page up while saving a link, to show its icon and fill in its title. Through the sync server when one is
	connected, otherwise from the site itself. On by default, and stays on this phone.
	*/
	savePreview: boolean;
	/**
	The accent color: `system` (the phone's own, the default), `default` (TabLodge's), a preset id, or `#rrggbb`. Syncs with
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
	cleanOnSave: true,
	syncSettings: true,
	siteIcons: false,
	savePreview: true,
	accent: 'system',
	theme: 'system',
	showPrivateButton: true,
	openWith: 'system',
	openApp: '',
	privateOpenWith: 'same',
	privateOpenApp: '',
	compactSessions: false,
	showSavedOn: true,
	deviceName: '',
};

const OPEN_WITH = ['system', 'inapp', 'app'] as const;
export type OpenWith = (typeof OPEN_WITH)[number];
const isOpenWith = (value: unknown): value is OpenWith =>
	OPEN_WITH.includes(value as OpenWith);

const BAR_SIZES = ['full', 'scroll', 'compact'] as const;
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

export async function loadPreferences(): Promise<void> {
	const saved = await readJson(KEY);
	if (typeof saved !== 'object' || saved === null) {
		return;
	}

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
		cleanOnSave,
		syncSettings,
		siteIcons,
		savePreview,
		deviceName,
		accent,
		theme,
		showPrivateButton,
		openWith,
		openApp,
		privateOpenWith,
		privateOpenApp,
		compactSessions,
		showSavedOn,
	} = saved as Partial<Preferences>;
	current = {
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
		cleanOnSave:
			typeof cleanOnSave === 'boolean' ? cleanOnSave : defaults.cleanOnSave,
		syncSettings:
			typeof syncSettings === 'boolean' ? syncSettings : defaults.syncSettings,
		siteIcons: siteIcons === true,
		savePreview:
			typeof savePreview === 'boolean' ? savePreview : defaults.savePreview,
		accent: isAccent(accent) ? accent : defaults.accent,
		theme: isTheme(theme) ? theme : defaults.theme,
		showPrivateButton:
			typeof showPrivateButton === 'boolean'
				? showPrivateButton
				: defaults.showPrivateButton,
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
	'cleanOnSave',
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
