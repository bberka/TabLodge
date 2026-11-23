import {isAccent} from '../../../extension/src/shared/accent-colors';
import {cleanDeviceName} from '../../../extension/src/shared/device';
import {ANDROID_PREFERENCES} from '../../../extension/src/shared/setting-scopes';

const LOOKS = ['auto', 'material', 'ios'] as const;
export type Look = (typeof LOOKS)[number];
const LIST_VIEWS = ['chips', 'list'] as const;
export type ListView = (typeof LIST_VIEWS)[number];

export type Theme = 'system' | 'light' | 'dark';

export type RowAction = 'none' | 'open' | 'edit' | 'move' | 'delete';
export const ROW_ACTIONS: readonly RowAction[] = [
	'none',
	'open',
	'edit',
	'move',
	'delete',
];

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
	look: Look;
	floatingBar: boolean;
	barSize: BarSize;
	barLabels: BarLabels;
	glassEffect: boolean;
	lastColumnId: string;
	tapAction: 'open' | 'edit';
	swipeRight: RowAction;
	swipeLeft: RowAction;
	sessionSwipeRight: SessionAction;
	sessionSwipeLeft: SessionAction;
	linkSwipeRight: LinkAction;
	linkSwipeLeft: LinkAction;
	bookmarkView: ListView;
	sessionView: ListView;
	sessionTap: 'expand' | 'open';
	sessionMain: SessionAction;
	syncSettings: boolean;
	syncPrivate: boolean;
	backgroundSync: boolean;
	savePreview: boolean;
	accent: string;
	theme: Theme;
	showPrivateButton: boolean;
	privateLockMode: 'manual' | 'leave' | 'screen' | 'timeout';
	privateLockMinutes: number;
	openWith: OpenWith;
	openApp: string;
	privateOpenWith: OpenWith | 'same';
	privateOpenApp: string;
	compactSessions: boolean;
	messagePosition: 'top' | 'bottom';
	showSavedOn: boolean;
	deviceName: string;
};

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
	sessionMain: field(
		'open',
		oneOf(SESSION_ACTIONS.filter((action) => action !== 'none')),
	),
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

const scopes: {
	[Key in keyof Preferences]: (typeof ANDROID_PREFERENCES)[Key];
} = ANDROID_PREFERENCES;

export const SYNCED_KEYS: ReadonlyArray<keyof Preferences> = (
	Object.keys(ANDROID_PREFERENCES) as Array<keyof typeof ANDROID_PREFERENCES>
).filter((key) => scopes[key][0] !== 'device');

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

export function legacySiteIconsOf(stored: unknown): 'browser' | undefined {
	return stored === true || ['off', 'direct'].includes(stored as string)
		? 'browser'
		: undefined;
}

export function parsePreferences(saved: unknown): Preferences {
	return {...defaults, ...readKeys(saved, KEYS)};
}

export function syncedPreferences(
	prefs: Preferences,
): Record<string, string | boolean> {
	return Object.fromEntries(
		SYNCED_KEYS.map((key) => [key, prefs[key] as string | boolean]),
	);
}

export function readSyncedPreferences(value: unknown): Partial<Preferences> {
	return readKeys(value, SYNCED_KEYS);
}
