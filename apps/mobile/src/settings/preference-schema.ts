/*
What the phone's preferences are: each one's type, default, validation, and whether it travels with the library. This
file holds no storage and no React Native, so every rule here runs under Node. `preferences.ts` keeps the current values
and saves them.

A preference syncs with the other phones through the library's `mobileApp` setting, unless `ANDROID_PREFERENCES` in
the shared `setting-scopes.ts` scopes it to this device, with the reason. Adding one means one entry in `FIELDS` and
one there; the types and every reader follow from them.
*/
import {isAccent} from '../../../extension/src/shared/accent-colors';
import {cleanDeviceName} from '../../../extension/src/shared/device';
import {ANDROID_PREFERENCES} from '../../../extension/src/shared/setting-scopes';

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
	surfaces, which is lighter on a slow phone.
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
	What swiping a session card to the right, and to the left, does.
	*/
	sessionSwipeRight: SessionAction;
	sessionSwipeLeft: SessionAction;
	/**
	What swiping a link in an open session card to the right, and to the left, does.
	*/
	linkSwipeRight: LinkAction;
	linkSwipeLeft: LinkAction;
	/**
	How the Bookmarks and Sessions screens list their columns and folders: a row of chips to swipe across, or a list of
	all of them that opens one at a time.
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
	Share the synced preferences through sync, so phones that use one library behave alike. On by default, like the
	extension's Sync settings.
	*/
	syncSettings: boolean;
	/**
	Keep the private library in step with the server. Off, it stays on this phone only.
	*/
	syncPrivate: boolean;
	/**
	While a server is connected, sync the regular library about every 15 minutes with the app closed, and redraw the
	Bookmarks widgets with what came in. On by default.
	*/
	backgroundSync: boolean;
	/**
	Look the page up while saving a link, to show its icon and fill in its title: a phone only lookup, which also fills in
	the title of a bare shared address. Through the sync server when one is connected, otherwise from the site itself.
	On by default. The extension's hover card, `linkPreviews`, is a different setting.
	*/
	savePreview: boolean;
	/**
	The accent color: `default` (TabLodge's, the default), `system` (the phone's own), a preset id, or `#rrggbb`.
	*/
	accent: string;
	/**
	Light, dark, or the phone's own setting (the default).
	*/
	theme: Theme;
	/**
	Show the button that opens the private library on Bookmarks and Sessions, while a server is connected. On by default,
	though it tells anyone holding the phone that a private library exists.
	*/
	showPrivateButton: boolean;
	/**
	When the private library locks by itself: `manual` only by hand, `leave` when the app goes behind another one,
	`screen` (the default) when the screen turns off, `timeout` after a while without use. Only a library with a password locks.
	*/
	privateLockMode: 'manual' | 'leave' | 'screen' | 'timeout';
	/**
	How many minutes without use `timeout` waits.
	*/
	privateLockMinutes: number;
	/**
	Where a link opens: the default browser, an in-app tab, or the browser in `openApp`.
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
	Session cards without the tab icon strip and the saved-on line, and with tighter tab rows.
	*/
	compactSessions: boolean;
	/**
	Where a message with an Undo appears: at the top of the screen (the default) or above the tab bar.
	*/
	messagePosition: 'top' | 'bottom';
	/**
	Show which device saved a session on its card.
	*/
	showSavedOn: boolean;
	/**
	The name this phone puts on the sessions it saves. Empty means the phone's own make and model.
	*/
	deviceName: string;
};

/**
How to read one preference: `read` returns the value, or `undefined` when the stored one is missing or not valid.
*/
type Field<Value> = {
	default: Value;
	read: (raw: unknown) => Value | undefined;
};

const oneOf =
	<Value extends string>(choices: readonly Value[]) =>
	(raw: unknown): Value | undefined =>
		choices.find((choice) => choice === raw);

const bool = (raw: unknown) => (typeof raw === 'boolean' ? raw : undefined);
const text = (raw: unknown) => (typeof raw === 'string' ? raw : undefined);

const field = <Value>(
	defaultValue: Value,
	read: Field<Value>['read'],
): Field<Value> => ({default: defaultValue, read});

const FIELDS: {[Key in keyof Preferences]: Field<Preferences[Key]>} = {
	look: field('auto', oneOf(LOOKS)),
	floatingBar: field(true, bool),
	barSize: field('scroll', oneOf(BAR_SIZES)),
	barLabels: field('active', oneOf(BAR_LABELS)),
	glassEffect: field(true, bool),
	lastColumnId: field('', text),
	tapAction: field('open', oneOf(['open', 'edit'])),
	swipeRight: field('delete', oneOf(ROW_ACTIONS)),
	swipeLeft: field('edit', oneOf(ROW_ACTIONS)),
	sessionSwipeRight: field('delete', oneOf(SESSION_ACTIONS)),
	sessionSwipeLeft: field('archive', oneOf(SESSION_ACTIONS)),
	linkSwipeRight: field('delete', oneOf(LINK_ACTIONS)),
	linkSwipeLeft: field('bookmark', oneOf(LINK_ACTIONS)),
	bookmarkView: field('chips', oneOf(LIST_VIEWS)),
	sessionView: field('chips', oneOf(LIST_VIEWS)),
	sessionTap: field('expand', oneOf(['expand', 'open'])),
	// The main button has to do something, so `none` is not a value.
	sessionMain: field(
		'open',
		oneOf(SESSION_ACTIONS.filter((action) => action !== 'none')),
	),
	cleanOnSave: field(true, bool),
	syncSettings: field(true, bool),
	syncPrivate: field(true, bool),
	backgroundSync: field(true, bool),
	savePreview: field(true, bool),
	accent: field('default', (raw) => (isAccent(raw) ? raw : undefined)),
	theme: field('system', oneOf(['system', 'light', 'dark'])),
	showPrivateButton: field(true, bool),
	privateLockMode: field('screen', oneOf(PRIVATE_LOCK_MODES)),
	privateLockMinutes: field(5, (raw) =>
		PRIVATE_LOCK_MINUTES.find((minutes) => minutes === raw),
	),
	openWith: field('system', oneOf(OPEN_WITH)),
	openApp: field('', text),
	privateOpenWith: field('same', oneOf([...OPEN_WITH, 'same'])),
	privateOpenApp: field('', text),
	compactSessions: field(false, bool),
	messagePosition: field('top', oneOf(['top', 'bottom'])),
	showSavedOn: field(true, bool),
	deviceName: field('', (raw) => cleanDeviceName(raw)),
};

const KEYS = Object.keys(FIELDS) as Array<keyof Preferences>;

export const defaults = Object.fromEntries(
	KEYS.map((key) => [key, FIELDS[key].default]),
) as Preferences;

// Every preference has a scope: one missing fails to compile here, and a scope for no preference fails below.
const scopes: {
	[Key in keyof Preferences]: (typeof ANDROID_PREFERENCES)[Key];
} = ANDROID_PREFERENCES;

/**
The keys that sync to the other phones, which the extension keeps in the library's `mobileApp` setting: every one
not scoped to this device.
*/
export const SYNCED_KEYS: ReadonlyArray<keyof Preferences> = (
	Object.keys(ANDROID_PREFERENCES) as Array<keyof typeof ANDROID_PREFERENCES>
).filter((key) => scopes[key][0] !== 'device');

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
`siteIcons` was a phone preference with `off`, `server`, and `direct`, or earlier a switch; it is now the library's
setting, which has only `server` and `browser`. Each old choice that asked nobody, or the site itself, stands for
`browser`; the rest changes nothing, since `server` is the default.
*/
export function legacySiteIconsOf(stored: unknown): 'browser' | undefined {
	return stored === true || ['off', 'direct'].includes(stored as string)
		? 'browser'
		: undefined;
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
