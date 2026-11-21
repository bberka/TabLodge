// The sections of the Settings page as the finder lists them. The Settings page names its section anchors with
// `sectionId`, and the a11y check (scripts/a11y/settings.ts) fails when a section it renders is missing here or an
// entry here points at no section, so a new Settings section must be added to this list. No browser APIs here: that
// check imports this file in Node, so it imports nothing either; its entries are global-search.ts's FinderSetting. The fields in the sections are listed by
// settings-finder.ts. The fields in the sections are listed by
// settings-finder.ts.

export const sectionId = (title: string) =>
	`settings-${title.toLowerCase().replaceAll(/[^0-9a-z]+/g, '-')}`;

type Section = {
	title: string;
	keywords: readonly string[];
	/**
	A part of another section: the finder lists it by its own name and opens that section.
	*/
	within?: string;
};

const sections = (appName: string, firefox: boolean): Section[] => [
	{
		title: 'Appearance',
		keywords: ['theme', 'dark mode', 'light mode', 'accent color', 'colour'],
	},
	{title: 'Keyboard shortcuts', keywords: ['keys', 'hotkey', 'keybinding']},
	// Firefox keeps the add-on out of private windows, so it has no private library.
	...(firefox
		? []
		: [
				{
					title: 'Private windows',
					keywords: [
						'private library',
						'incognito',
						'lock',
						'password',
						'change password',
						'passcode',
					],
				},
			]),
	{
		title: `Opening ${appName}`,
		keywords: ['new tab', 'startup', 'pinned tab', 'palette', 'toolbar button'],
	},
	{
		title: 'Dashboard',
		keywords: [
			'layout',
			'view',
			'links',
			'addresses',
			'toast',
			'toast position',
			'messages',
			'notifications',
			'undo',
		],
	},
	{
		title: 'When saving',
		keywords: ['save tabs', 'duplicates', 'close tabs'],
	},
	{title: 'Right-click menus', keywords: ['context menu']},
	{title: 'When restoring', keywords: ['restore session', 'open', 'window']},
	{title: 'Session board', keywords: ['sessions', 'folders', 'cards']},
	{
		title: 'Bookmark board',
		keywords: ['bookmark board layout', 'columns', 'cards', 'focus view'],
	},
	{
		title: 'Recovery & backups',
		keywords: [
			'backup',
			'restore from a backup',
			'snapshots',
			'crash',
			'trash',
			'downloads',
		],
	},
	{
		title: 'Data',
		keywords: [
			'import',
			'export',
			'share and export',
			'erase',
			'storage',
			'statistics',
		],
	},
	{title: 'Sync', keywords: ['server', 'devices', 'self hosted']},
	{
		title: 'Shared pages',
		within: 'Sync',
		keywords: ['share links', 'published', 'shared links'],
	},
	{
		title: 'Sources',
		keywords: [
			'add a site',
			'site sources',
			'reddit',
			'youtube',
			'github',
			'hacker news',
			'keep saves off the site',
		],
	},
	{
		title: 'Excluded websites',
		keywords: ['exclude', 'ignore', 'blocked sites', 'domain'],
	},
	{title: 'Restore default settings', keywords: ['reset', 'defaults']},
];

/**
Every Settings section and sub-page, for the finder. The anchor the Settings page scrolls to is `target ?? id`.
*/
export const settingsSections = (
	appName: string,
	firefox: boolean,
): Array<{
	id: string;
	target?: string;
	title: string;
	detail?: string;
	keywords: string[];
}> =>
	sections(appName, firefox).map(({title, keywords, within}) => ({
		id: sectionId(title),
		target: within && sectionId(within),
		title,
		detail: within,
		keywords: ['settings', ...keywords],
	}));
