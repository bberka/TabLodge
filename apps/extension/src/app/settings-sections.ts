export const sectionId = (title: string) =>
	`settings-${title.toLowerCase().replaceAll(/[^0-9a-z]+/g, '-')}`;

type Section = {
	title: string;
	keywords: readonly string[];
	within?: string;
};

const sections = (appName: string, firefox: boolean): Section[] => [
	{
		title: 'Appearance',
		keywords: ['theme', 'dark mode', 'light mode', 'accent color', 'colour'],
	},
	{title: 'Keyboard shortcuts', keywords: ['keys', 'hotkey', 'keybinding']},
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
			'catch up',
			'saved page',
			'add them automatically',
			'ask first',
			'not now',
		],
	},
	{
		title: 'Excluded websites',
		keywords: ['exclude', 'ignore', 'blocked sites', 'domain'],
	},
	{title: 'Restore default settings', keywords: ['reset', 'defaults']},
];

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
