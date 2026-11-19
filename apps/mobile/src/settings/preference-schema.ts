/*
What the phone's preferences are: each one's type, default, validation, and whether it travels with the library. This
file holds no storage and no React Native, so every rule here runs under Node. `preferences.ts` keeps the current values
and saves them.

A preference is either `synced`, shared with the other phones through the library's `mobileApp` setting, or `device`,
which stays on this phone. Adding one means one entry in `FIELDS`; the types and every reader follow from it.
*/
import {isAccent} from '../../../extension/src/shared/accent-colors';
import {cleanDeviceName} from '../../../extension/src/shared/device';

const LOOKS = ['auto', 'material', 'ios'] as const;
export type Look = (typeof LOOKS)[number];
const LIST_VIEWS = ['chips', 'list'] as const;
export type ListView = (typeof LIST_VIEWS)[number];

export type Theme = 'system' | 'light' | 'dark';

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

/**
What a swipe on one link inside an open session card does.
*/
export type LinkAction = 'none' | 'open' | 'edit' | 'bookmark' | 'delete';
export const LINK_ACTIONS: readonly LinkAction[] = [
	'none',
	'open',
	'edit',
	'bookmark',
	'delete',
];

export const PRIVATE_LOCK_MODES = [
	'manual',
	'leave',
	'screen',
	'timeout',
] as const;
export const PRIVATE_LOCK_MINUTES = [1, 5, 15, 30, 60] as const;

const SITE_ICONS = ['off', 'server', 'direct'] as const;
export type SiteIcons = (typeof SITE_ICONS)[number];

const OPEN_WITH = ['system', 'inapp', 'app'] as const;
export type OpenWith = (typeof OPEN_WITH)[number];

const BAR_SIZES = ['full', 'scroll', 'compact'] as const;
export type BarSize = (typeof BAR_SIZES)[number];

const BAR_LABELS = ['active', 'always', 'never'] as const;
export type BarLabels = (typeof BAR_LABELS)[number];

export type Preferences = {
	/**
	Which platform's design the app imitates. Defaults to the phone's own.
	*/
	look: Look;
	/**
	A rounded bar that floats above the content, instead of one fixed to the bottom edge.
	*/
	floatingBar: boolean;
	/**
	With the floating bar: `full` spans the screen, `compact` is a small pill of icons, and `scroll` is full until the list
	is scrolled down.
	*/
	barSize: BarSize;
	/**
	Which tabs show their name under the icon, on either bar: only the one open (the default), all of them, or none.
	A small floating bar never has room for names.
	*/
	barLabels: BarLabels;
	/**
	With the iOS look: frost the floating bar and buttons with a blur of what scrolls behind them. Off draws them as solid
	surfaces, which is lighter on a slow phone. Stays on this phone, because what a phone can draw smoothly is its own.
	*/
	glassEffect: boolean;
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
	What swiping a link in an open session card to the right, and to the left, does. Sync with the rest of the app's look.
	*/
	linkSwipeRight: LinkAction;
	linkSwipeLeft: LinkAction;
	/**
	How the Bookmarks and Sessions screens list their columns and folders: a row of chips to swipe across, or a list of
	all of them that opens one at a time. Sync with the rest of the app's look.
	*/
	bookmarkView: ListView;
	sessionView: ListView;
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
	While a server is connected, sync the regular library about every 15 minutes with the app closed, and redraw the
	Bookmarks widgets with what came in. On by default. Stays on this phone, whose battery it uses.
	*/
	backgroundSync: boolean;
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
	`screen` (the default) when the screen turns off, `timeout` after a while without use. Only a library with a password locks.
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

/**
How to read one preference: `read` returns the value, or `undefined` when the stored one is missing or not valid.
*/
type Field<Value> = {
	default: Value;
	scope: 'synced' | 'device';
	read: (raw: unknown) => Value | undefined;
};

const oneOf =
	<Value extends string>(choices: readonly Value[]) =>
	(raw: unknown): Value | undefined =>
		choices.find((choice) => choice === raw);

const bool = (raw: unknown) => (typeof raw === 'boolean' ? raw : undefined);
const text = (raw: unknown) => (typeof raw === 'string' ? raw : undefined);

const synced = <Value>(
	defaultValue: Value,
	read: Field<Value>['read'],
): Field<Value> => ({default: defaultValue, scope: 'synced', read});
const device = <Value>(
	defaultValue: Value,
	read: Field<Value>['read'],
): Field<Value> => ({default: defaultValue, scope: 'device', read});

const FIELDS: {[Key in keyof Preferences]: Field<Preferences[Key]>} = {
	look: synced('auto', oneOf(LOOKS)),
	floatingBar: synced(true, bool),
	barSize: synced('scroll', oneOf(BAR_SIZES)),
	barLabels: synced('active', oneOf(BAR_LABELS)),
	glassEffect: device(true, bool),
	lastColumnId: device('', text),
	tapAction: synced('open', oneOf(['open', 'edit'])),
	swipeRight: synced('delete', oneOf(ROW_ACTIONS)),
	swipeLeft: synced('edit', oneOf(ROW_ACTIONS)),
	sessionSwipeRight: synced('delete', oneOf(SESSION_ACTIONS)),
	sessionSwipeLeft: synced('archive', oneOf(SESSION_ACTIONS)),
	linkSwipeRight: synced('delete', oneOf(LINK_ACTIONS)),
	linkSwipeLeft: synced('bookmark', oneOf(LINK_ACTIONS)),
	bookmarkView: synced('chips', oneOf(LIST_VIEWS)),
	sessionView: synced('chips', oneOf(LIST_VIEWS)),
	sessionTap: synced('expand', oneOf(['expand', 'open'])),
	// The main button has to do something, so `none` is not a value.
	sessionMain: synced(
		'open',
		oneOf(SESSION_ACTIONS.filter((action) => action !== 'none')),
	),
	cleanOnSave: synced(true, bool),
	syncSettings: device(true, bool),
	syncPrivate: device(true, bool),
	backgroundSync: device(true, bool),
	// An earlier version stored a switch: on asked the server or the site, off showed none.
	siteIcons: synced('server', (raw) =>
		raw === true ? 'direct' : oneOf(SITE_ICONS)(raw),
	),
	savePreview: synced(true, bool),
	accent: synced('default', (raw) => (isAccent(raw) ? raw : undefined)),
	theme: synced('system', oneOf(['system', 'light', 'dark'])),
	showPrivateButton: device(true, bool),
	privateLockMode: device('screen', oneOf(PRIVATE_LOCK_MODES)),
	privateLockMinutes: device(5, (raw) =>
		PRIVATE_LOCK_MINUTES.find((minutes) => minutes === raw),
	),
	openWith: device('system', oneOf(OPEN_WITH)),
	openApp: device('', text),
	privateOpenWith: device('same', oneOf([...OPEN_WITH, 'same'])),
	privateOpenApp: device('', text),
	compactSessions: synced(false, bool),
	showSavedOn: synced(true, bool),
	deviceName: device('', (raw) => cleanDeviceName(raw)),
};

const KEYS = Object.keys(FIELDS) as Array<keyof Preferences>;

export const defaults = Object.fromEntries(
	KEYS.map((key) => [key, FIELDS[key].default]),
) as Preferences;

/**
The keys that sync, which the extension keeps in the library's `mobileApp` setting.
*/
export const SYNCED_KEYS = KEYS.filter((key) => FIELDS[key].scope === 'synced');

/**
An earlier size, Icons only, was full width without names. Stored or synced values in that form read as today's pair.
*/
function upgrade(raw: Record<string, unknown>): Record<string, unknown> {
	if (raw.barSize !== 'icons') {
		return raw;
	}

	return {
		...raw,
		barSize: 'full',
		barLabels: BAR_LABELS.includes(raw.barLabels as BarLabels)
			? raw.barLabels
			: 'never',
	};
}

const asRecord = (value: unknown): Record<string, unknown> =>
	typeof value === 'object' && value !== null
		? upgrade(value as Record<string, unknown>)
		: {};

function readKeys(
	value: unknown,
	keys: ReadonlyArray<keyof Preferences>,
): Partial<Preferences> {
	const raw = asRecord(value);
	const found: Record<string, unknown> = {};
	for (const key of keys) {
		const read = (FIELDS[key] as Field<unknown>).read(raw[key]);
		if (read !== undefined) {
			found[key] = read;
		}
	}

	return found;
}

/**
Reads stored or backed up preferences. A value that is missing or not valid falls back to its default.
*/
export function parsePreferences(saved: unknown): Preferences {
	return {...defaults, ...readKeys(saved, KEYS)};
}

/**
The preferences that sync, as the plain values the extension keeps for the phones.
*/
export function syncedPreferences(
	prefs: Preferences,
): Record<string, string | boolean> {
	return Object.fromEntries(
		SYNCED_KEYS.map((key) => [key, prefs[key] as string | boolean]),
	);
}

/**
Reads synced preferences from another phone. Anything that is not a valid value is left out, so one bad entry never
changes the rest, and a key this version does not know is ignored.
*/
export function readSyncedPreferences(value: unknown): Partial<Preferences> {
	return readKeys(value, SYNCED_KEYS);
}
