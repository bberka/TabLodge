/*
Every setting's name and hint, in one place. The rows read their text from here, and the search matches against the
same text, so the two cannot drift apart.
*/
export type Row = {label: string; hint?: string};

export const ROWS = {
	style: {label: 'Style'},
	floatingBar: {
		label: 'Floating tab bar',
		hint: 'A rounded bar above the content',
	},
	syncSettings: {
		label: 'Sync settings',
		hint: "Your settings follow your other devices when sync is on: this app's look and gestures, and the extension's settings. Turning it on sends this phone's.",
	},
	theme: {label: 'Theme', hint: "Light, dark, or your phone's setting"},
	accent: {
		label: 'Accent color',
		hint: "Buttons and highlights. System follows your phone's color",
	},
	compactSessions: {
		label: 'Compact session cards',
		hint: 'Tighter cards without the tab icon strip',
	},
	sessionIcons: {
		label: 'Tab icons on session cards',
		hint: 'The small icons under a session name. Same as the extension',
	},
	showSavedOn: {
		label: 'Show where a session was saved',
		hint: 'The device name on a session card',
	},
	expandSessions: {
		label: 'Keep sessions expanded',
		hint: "Show every session's tabs without opening it. Same as the extension",
	},
	showPrivateButton: {
		label: 'Lock button on the main screens',
		hint: 'A shortcut on Bookmarks and Sessions. Off hides that a private library exists; Settings always has the entry',
	},
	tap: {label: 'Tap a bookmark'},
	swipeRight: {label: 'Swipe right'},
	swipeLeft: {label: 'Swipe left'},
	cleanOnSave: {
		label: 'Clean links when saving',
		hint: 'Remove tracking parameters such as utm_source',
	},
	siteIcons: {
		label: 'Site icons',
		hint: "Show each site's icon. Loaded through your sync server when connected, otherwise from the site itself",
	},
	cleanTitles: {
		label: 'Clean page titles',
		hint: 'Remove counters such as (3) from titles',
	},
	removeTracking: {
		label: 'Remove tracking parameters',
		hint: 'When opening links. Saved links stay as they are',
	},
	showUnder: {label: 'Show under a title'},
	shortenAddresses: {
		label: 'Shorten addresses',
		hint: 'Hide https:// and www.',
	},
	markInsecure: {
		label: 'Mark links that are not secure',
		hint: 'An open lock next to http:// links',
	},
	markLocal: {
		label: 'Mark local links too',
		hint: 'Addresses on this device or home network',
	},
	spacing: {label: 'Bookmark spacing'},
	sortSessions: {label: 'Sort sessions'},
} satisfies Record<string, Row>;

/**
A card of settings. `aliases` are other words that should find the whole card, such as "dark" for the look.
*/
export type Section = {title: string; aliases: string[]; rows: Row[]};

export const SECTIONS = {
	appearance: {
		title: 'Appearance',
		aliases: [
			'look',
			'theme',
			'design',
			'android',
			'ios',
			'material',
			'color',
			'colour',
			'primary',
			'material you',
			'dynamic',
			'dark',
			'light',
			'night',
		],
		rows: [ROWS.style, ROWS.theme, ROWS.accent, ROWS.floatingBar],
	},
	syncApp: {
		title: 'Sync settings',
		aliases: ['phones', 'devices', 'share settings'],
		rows: [ROWS.syncSettings],
	},
	sessions: {
		title: 'Sessions',
		aliases: [
			'compact',
			'dense',
			'cards',
			'icons',
			'favicon',
			'expand',
			'collapse',
			'hide',
			'device',
			'links',
			'address',
		],
		rows: [
			ROWS.compactSessions,
			ROWS.sessionIcons,
			ROWS.showSavedOn,
			ROWS.expandSessions,
		],
	},
	bookmarks: {
		title: 'Bookmarks',
		aliases: [
			'gesture',
			'swipe',
			'tap',
			'open',
			'edit',
			'move',
			'delete',
			'favicon',
			'icon',
		],
		rows: [
			ROWS.tap,
			ROWS.swipeRight,
			ROWS.swipeLeft,
			ROWS.cleanOnSave,
			ROWS.siteIcons,
		],
	},
	extension: {
		title: 'Same as your extension',
		aliases: ['browser', 'url', 'link', 'address', 'sessions', 'density'],
		rows: [
			ROWS.cleanTitles,
			ROWS.removeTracking,
			ROWS.showUnder,
			ROWS.shortenAddresses,
			ROWS.markInsecure,
			ROWS.markLocal,
			ROWS.spacing,
			ROWS.sortSessions,
		],
	},
	private: {
		title: 'Private library',
		aliases: [
			'incognito',
			'private windows',
			'pin',
			'password',
			'forget',
			'lock',
		],
		rows: [ROWS.showPrivateButton],
	},
	sync: {
		title: 'Sync',
		aliases: [
			'server',
			'connect',
			'token',
			'address',
			'disconnect',
			'sync now',
			'offline',
		],
		rows: [],
	},
	development: {
		title: 'Development',
		aliases: ['sample data', 'clear library', 'debug'],
		rows: [],
	},
} satisfies Record<string, Section>;

export const normalizeQuery = (text: string) => text.trim().toLocaleLowerCase();

const has = (text: string, query: string) =>
	text.toLocaleLowerCase().includes(query);

export const rowHit = (row: Row, query: string) =>
	has(`${row.label} ${row.hint ?? ''}`, query);

/**
True when the title or an alias matches, so the whole card shows.
*/
export const headHit = (section: Section, query: string) =>
	has(section.title, query) ||
	section.aliases.some((alias) => has(alias, query));

/**
Whether a card shows anything for the query: its name, an alias, or one of its rows.
*/
export function sectionVisible(section: Section, query: string): boolean {
	return (
		query === '' ||
		headHit(section, query) ||
		section.rows.some((row) => rowHit(row, query))
	);
}
