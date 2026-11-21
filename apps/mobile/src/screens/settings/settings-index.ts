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
	barSize: {
		label: 'Floating bar size',
		hint: 'Full, small while scrolling, or always small',
	},
	barLabels: {
		label: 'Tab names',
		hint: 'Under the open tab, under every tab, or hidden',
	},
	glassEffect: {
		label: 'Glass effect',
		hint: 'Frost the floating bar and buttons. Off is lighter on a slow phone',
	},
	openWith: {
		label: 'Open links in',
		hint: 'The default browser, an in-app tab, or one browser',
	},
	openApp: {label: 'Browser', hint: 'The app that opens your links'},
	privateOpenWith: {
		label: 'Private library links',
		hint: 'Open them somewhere other than your other links',
	},
	privateOpenApp: {label: 'Private browser', hint: 'The app for private links'},
	syncSettings: {
		label: 'Sync settings',
		hint: 'Link options reach every device, the look and gestures your other phones. The device name and browsers stay here',
	},
	syncPrivate: {
		label: 'Sync the private library',
		hint: 'Off, it stays on this phone and never reaches your server',
	},
	backgroundSync: {
		label: 'Sync in the background',
		hint: 'About every 15 minutes with the app closed, and updates the widgets',
	},
	theme: {label: 'Theme', hint: "Light, dark, or your phone's setting"},
	accent: {
		label: 'Accent color',
		hint: "Buttons and highlights. System follows your phone's color",
	},
	messagePosition: {
		label: 'Message position',
		hint: 'Where Undo messages appear',
	},
	toastDuration: {
		label: 'Messages stay',
		hint: 'How long an Undo message stays',
	},
	compactSessions: {
		label: 'Compact session cards',
		hint: 'Tighter cards without the tab icon strip',
	},
	sessionIcons: {
		label: 'Tab icons on session cards',
		hint: 'Small icons under the session name',
	},
	showSavedOn: {
		label: 'Show where a session was saved',
		hint: 'The device name on the card',
	},
	expandSessions: {
		label: 'Keep sessions expanded',
		hint: 'Show all tabs without opening a card',
	},
	privateLockMode: {
		label: 'Lock automatically',
		hint: 'When the private library locks without you',
	},
	privateLockMinutes: {
		label: 'Lock after',
		hint: 'How long it waits without use',
	},
	showPrivateButton: {
		label: 'Private library button',
		hint: 'Off keeps a private library out of sight',
	},
	bookmarkView: {
		label: 'Show columns as',
		hint: 'Chips to swipe across, or a list of every column',
	},
	sessionView: {
		label: 'Show folders as',
		hint: 'Chips to swipe across, or a list of every folder',
	},
	sessionTap: {label: 'Tap a session'},
	sessionMain: {label: 'Main button on a session'},
	sessionSwipeRight: {label: 'Swipe a session right'},
	sessionSwipeLeft: {label: 'Swipe a session left'},
	linkSwipeRight: {label: 'Swipe a link right', hint: 'In an open session'},
	linkSwipeLeft: {label: 'Swipe a link left', hint: 'In an open session'},
	tap: {label: 'Tap a bookmark'},
	swipeRight: {label: 'Swipe a bookmark right'},
	swipeLeft: {label: 'Swipe a bookmark left'},
	cleanOnSave: {
		label: 'Clean links when saving',
		hint: 'Removes utm_source and similar',
	},
	siteIcons: {
		label: 'Site icons',
		hint: 'Through your server by default, or from the sites too',
	},
	savePreview: {
		label: 'Preview links when saving',
		hint: 'Fetches the title and icon of the page you save',
	},
	cleanTitles: {
		label: 'Clean page titles',
		hint: 'Remove counters such as (3) from titles',
	},
	removeTracking: {
		label: 'Remove tracking parameters',
		hint: 'When opening links. Saved links stay as they are',
	},
	showUnder: {label: 'Under a bookmark title'},
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
	spacing: {label: 'Compact bookmarks', hint: 'Tighter rows'},
	showAll: {
		label: 'Show All in the bookmark list',
		hint: 'The first item, listing every bookmark. Shared with the extension',
	},
	sortSessions: {label: 'Sort sessions'},
	licences: {
		label: 'Open source licences',
		hint: 'The third party code this app is built from',
	},
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
			'blur',
			'frosted',
			'liquid glass',
			'transparent',
			'toast',
			'snackbar',
			'undo',
			'messages',
		],
		rows: [
			ROWS.style,
			ROWS.theme,
			ROWS.accent,
			ROWS.floatingBar,
			ROWS.barSize,
			ROWS.barLabels,
			ROWS.glassEffect,
			ROWS.messagePosition,
			ROWS.toastDuration,
		],
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
			'swipe',
			'archive',
			'rename',
			'collapse',
			'hide',
			'device',
			'links',
			'address',
		],
		rows: [
			ROWS.sortSessions,
			ROWS.sessionView,
			ROWS.sessionTap,
			ROWS.sessionMain,
			ROWS.sessionSwipeRight,
			ROWS.sessionSwipeLeft,
			ROWS.linkSwipeRight,
			ROWS.linkSwipeLeft,
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
			ROWS.bookmarkView,
			ROWS.tap,
			ROWS.swipeRight,
			ROWS.swipeLeft,
			ROWS.showUnder,
			ROWS.spacing,
			ROWS.showAll,
			ROWS.siteIcons,
			ROWS.savePreview,
		],
	},
	extension: {
		title: 'Links and titles',
		aliases: ['browser', 'url', 'link', 'address', 'sessions', 'density'],
		rows: [
			ROWS.cleanTitles,
			ROWS.removeTracking,
			ROWS.shortenAddresses,
			ROWS.markInsecure,
			ROWS.markLocal,
			ROWS.cleanOnSave,
		],
	},
	openLinks: {
		title: 'Open links',
		aliases: [
			'browser',
			'chrome',
			'firefox',
			'brave',
			'custom tab',
			'in app',
			'default browser',
			'incognito',
			'private mode',
			'private browser',
		],
		rows: [
			ROWS.openWith,
			ROWS.openApp,
			ROWS.privateOpenWith,
			ROWS.privateOpenApp,
		],
	},
	data: {
		title: 'Import and export',
		aliases: [
			'import',
			'export',
			'backup',
			'file',
			'paste',
			'json',
			'csv',
			'html',
			'markdown',
			'onetab',
			'bookmarks file',
			'restore',
			'statistics',
			'stats',
			'erase',
			'delete everything',
			'clear',
		],
		rows: [],
	},
	trash: {
		title: 'Trash',
		aliases: [
			'deleted',
			'recover',
			'restore',
			'bin',
			'undelete',
			'empty trash',
		],
		rows: [],
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
			'lock now',
			'change password',
			'eye',
			'glasses',
		],
		rows: [
			ROWS.showPrivateButton,
			ROWS.privateLockMode,
			ROWS.privateLockMinutes,
		],
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
			'private',
			'background',
			'widget',
			'battery',
		],
		rows: [ROWS.syncPrivate, ROWS.backgroundSync],
	},
	excluded: {
		title: 'Excluded websites',
		aliases: ['exclude', 'block', 'ignore', 'domains', 'sites', 'hosts'],
		rows: [],
	},
	restore: {
		title: 'Restore defaults',
		aliases: ['reset', 'default', 'preferences', 'settings'],
		rows: [],
	},
	about: {
		title: 'About',
		aliases: [
			'licenses',
			'open source',
			'third party',
			'notices',
			'copyright',
			'credits',
			'apache',
			'mit',
		],
		rows: [ROWS.licences],
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

/**
How many settings a search finds: the rows that show, and a card with no rows of its own counts as one.
*/
export function matchCount(query: string): number {
	let count = 0;
	for (const section of Object.values(SECTIONS) as Section[]) {
		if (!sectionVisible(section, query)) {
			continue;
		}

		count +=
			section.rows.length === 0
				? 1
				: headHit(section, query)
					? section.rows.length
					: section.rows.filter((row) => rowHit(row, query)).length;
	}

	return count;
}
