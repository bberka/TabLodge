import {BOOKMARK_SORT_OPTIONS} from '../shared/bookmark-rules';
import type {
	BookmarkQuickAction,
	SessionQuickAction,
	Settings,
} from '../shared/types';

export type FieldEnvironment = {
	appName: string;
	firefox: boolean;
	sidePanel: boolean;
	privateWindows: boolean;
};

export type SettingKey<V> = {
	[K in keyof Settings]-?: Settings[K] extends V ? K : never;
}[keyof Settings];
export type SettingField = {
	label: string;
	help: string;
	requires?: SettingKey<boolean>;
	enabled?: (settings: Settings) => boolean;
	parent?: keyof Settings;
	when?: (settings: Settings) => boolean;
} & (
	| {name: SettingKey<boolean>; type: 'switch'}
	| {
			name: SettingKey<number>;
			type: 'number';
			min: number;
			max: number;
			suffix: string;
	  }
	| {name: SettingKey<string>; type: 'select'; options: Array<[string, string]>}
	| {
			name: SettingKey<number>;
			type: 'number-select';
			options: Array<[string, string]>;
			custom?: {min: number; max: number; suffix: string};
	  }
	| {
			name: SettingKey<BookmarkQuickAction[]>;
			type: 'checkbox-dropdown';
			options: Array<[BookmarkQuickAction, string]>;
			maxActions: number;
	  }
	| {
			name: SettingKey<SessionQuickAction[]>;
			type: 'checkbox-dropdown';
			options: Array<[SessionQuickAction, string]>;
			maxActions: number;
	  }
	| {name: SettingKey<string>; type: 'column'}
	| {name: SettingKey<string>; type: 'url'; placeholder: string}
	| {name: SettingKey<string>; type: 'text'; placeholder: string}
);
const LINK_ACTIONS: Array<[string, string]> = [
	['none', 'None'],
	['current', 'Open in this tab'],
	['new', 'Open in new tab'],
];
export type SettingsFieldGroup = {
	title: string;
	description?: string;
	fields: SettingField[];
};

export const RECOVERY_TITLE = 'Recovery & backups';

export const settingsFieldGroups = ({
	appName,
	firefox,
	sidePanel,
	privateWindows,
}: FieldEnvironment): SettingsFieldGroup[] => [
	{
		title: `Opening ${appName}`,
		fields: [
			...(firefox
				? []
				: ([
						{
							name: 'newTabEnabled',
							label: `Use ${appName} for new tabs`,
							help: `Show saved bookmarks and sessions on ${appName}’s local new-tab page.`,
							type: 'switch',
						},
						{
							name: 'newTabFallback',
							label: 'When off, new tabs show',
							help: 'Browsers cannot remove an extension’s new-tab page while it is installed, so new tabs hand off to this page right away. The address bar may keep focus on the browser’s own page but not on a blank or custom one; click it or press Ctrl+L.',
							type: 'select',
							options: [
								['browser', 'Browser’s new tab page'],
								['blank', 'Blank page'],
								['custom', 'Custom page'],
							],
							when: (current) => !current.newTabEnabled,
							parent: 'newTabEnabled',
						},
						{
							name: 'newTabFallbackUrl',
							label: 'Custom new tab page',
							help: 'A web address starting with http:// or https://. Without a valid one, new tabs show the browser’s page.',
							type: 'url',
							placeholder: 'https://example.com',
							when: (current) =>
								!current.newTabEnabled && current.newTabFallback === 'custom',
							parent: 'newTabEnabled',
						},
					] satisfies SettingField[])),
			{
				name: 'autoFocusSearchOnNewTab',
				label: 'Focus search when opening a new tab',
				help: 'Opens the search palette whenever a new tab opens. The browser may keep focus in the address bar until you click the page.',
				type: 'switch',
				requires: firefox ? undefined : 'newTabEnabled',
			},
			{
				name: 'paletteLocation',
				label: 'Open the search palette',
				help: 'Where the “Open the search palette” shortcut shows the palette. “In the current page” appears over the page you are on, and only when the shortcut is pressed. Browser pages, the Web Store and the PDF viewer cannot show it, so they open the window instead.',
				type: 'select',
				options: [
					['page', 'In the current page'],
					['window', 'Window'],
				],
			},
			{
				name: 'keepLodgePinned',
				label: `Keep ${appName} pinned and always open`,
				help: `Pins one ${appName} tab per window and keeps it open. Links opened from it always open in a new tab.`,
				type: 'switch',
			},
			{
				name: 'openDashboardOnStartup',
				label: `Open ${appName} when the browser starts`,
				help: `Start with your saved sessions or the local ${appName} page.`,
				type: 'switch',
			},
			{
				name: 'startupBehavior',
				label: 'On browser startup',
				help: `Choose what ${appName} opens when startup behavior is enabled.`,
				type: 'select',
				options: [
					['dashboard', `Open the ${appName} page`],
					['last-session', 'Restore the newest session'],
				],
				requires: 'openDashboardOnStartup',
			},
			{
				name: 'actionMode',
				label: 'Toolbar button action',
				help: sidePanel
					? 'The default is a compact popup. Only Open Dashboard opens the full page in a separate tab. The side panel is also available from the browser’s sidebar or menu, and via the “Open side panel” shortcut.'
					: 'The default is a compact popup. Only Open Dashboard opens the full page in a separate tab. The side panel opens as a sidebar from the popup, the toolbar button’s menu, or the “Open side panel” shortcut.',
				type: 'select',
				options: [
					['popup', 'Open the quick action popup'],
					...(sidePanel
						? ([['sidepanel', 'Open the side panel']] as Array<
								[string, string]
							>)
						: []),
					['current-window', 'Save selected tabs, or this window'],
					['full-window', 'Save the whole window'],
					['current-group', 'Save the active tab group'],
					['current-tab-to-group', 'Send current tab to first session'],
					['current-tab', 'Save only the active tab'],
					['all-windows', 'Save tabs from all windows'],
				],
			},
			{
				name: 'dashboardBehavior',
				label: `When ${appName} is already open`,
				help: `Choose whether to switch to the open ${appName} page or move it here.`,
				type: 'select',
				options: [
					['switch', 'Switch to the open dashboard'],
					['move', 'Move it to this window'],
				],
			},
		],
	},
	{
		title: 'Dashboard',
		fields: [
			{
				name: 'dashboardWidth',
				label: 'Dashboard width',
				help: 'Choose the dashboard width and how many bookmark columns fit across it. Wider uses the full width on a 1080p screen and fits 4 columns. Full width fits as many columns as the screen can hold. Narrower keeps the board to 2 columns.',
				type: 'select',
				options: [
					['narrower', 'Narrower'],
					['default', 'Default'],
					['wider', 'Wider'],
					['full', 'Full width'],
				],
			},
			{
				name: 'sessionsOnTop',
				label: 'Show sessions at the top',
				help: 'Put the sessions section above the bookmark board.',
				type: 'switch',
			},
			{
				name: 'showSaveWindowButton',
				label: 'Show Save this window button in the header',
				help: 'Hide this shortcut to keep the header compact. You can still save tabs from the popup, keyboard shortcut, or right-click menu.',
				type: 'switch',
			},
			{
				name: 'linkPreviews',
				label: 'Preview links on hover',
				help: 'Rest the pointer on a bookmark or saved tab, or focus it, to see its page image and description. Needs a sync server, which fetches the page, so the server and the site see its address. Off by default.',
				type: 'switch',
			},
			{
				name: 'siteIcons',
				label: 'Site icons',
				help: 'For links the browser has no icon for, such as imported ones. Through my server asks your sync server, which fetches the icon, so sites never see this browser; without a server nothing is asked. Browser only shows just the icons the browser has.',
				type: 'select',
				options: [
					['server', 'Through my server'],
					['browser', 'Browser only'],
				],
			},
			{
				name: 'showTrashBinButton',
				label: 'Show Trash bin button in the header',
				help: 'Hide this shortcut to keep the header compact. The Trash bin remains in the dashboard menu, side panel, and search palette.',
				type: 'switch',
			},
			{
				name: 'toastPosition',
				label: 'Toast position',
				help: 'Where messages with an Undo button appear: on TabLodge pages, in the Sources notice on a site, and after Save quote. Default is the bottom center, and the bottom right on a site.',
				type: 'select',
				options: [
					['default', 'Default'],
					['top-left', 'Top left'],
					['top', 'Top center'],
					['top-right', 'Top right'],
					['bottom-left', 'Bottom left'],
					['bottom', 'Bottom center'],
					['bottom-right', 'Bottom right'],
				],
			},
			{
				name: 'toastDuration',
				label: 'Messages stay',
				help: 'How long a toast stays before it closes. Longer is twice the usual time. Until dismissed keeps it until you close it. It always stays while the pointer or focus is on it. Undo for a library change is offered for just under two minutes; after that the message can stay without the button.',
				type: 'select',
				options: [
					['default', 'Default'],
					['longer', 'Longer'],
					['dismiss', 'Until dismissed'],
				],
			},
			{
				name: 'urlDisplayMode',
				label: 'Show URLs as',
				help: 'How web addresses appear under bookmarks and saved session links. Full URL only hides the title and shows the address instead.',
				type: 'select',
				options: [
					['domain', 'Domain only'],
					['full', 'Full URL'],
					['url-only', 'Full URL only'],
					['none', 'Hide'],
				],
			},
			{
				name: 'simplifyUrls',
				label: 'Simplify addresses',
				help: 'Hide https://, http:// and www. in shown addresses.',
				type: 'switch',
			},
			{
				name: 'removeTrackingParameters',
				label: 'Remove tracking parameters',
				help: 'Remove common tracking parameters such as utm_source, fbclid and gclid, and the share tracking X, YouTube and Spotify add to links, when opening or copying saved links and when restoring sessions and snapshots. The URLs stored in your library stay unchanged. This is off by default.',
				type: 'switch',
			},
			{
				name: 'markInsecureLinks',
				label: 'Mark insecure (http) links',
				help: 'Shows an amber lock next to http addresses.',
				type: 'switch',
			},
			{
				name: 'markLocalLinks',
				label: 'Also mark local addresses',
				help: 'Mark localhost and home-network addresses too.',
				type: 'switch',
				requires: 'markInsecureLinks',
			},
		],
	},
	{
		title: 'When saving',
		fields: [
			{
				name: 'includePinnedTabs',
				label: 'Include pinned tabs',
				help: 'Pinned tabs are ignored by default. When enabled, they are stored before any close operation and regain their pinned state on restore.',
				type: 'switch',
			},
			{
				name: 'ignoreTabGroups',
				label: 'Ignore tab groups',
				help: 'Saved tabs do not remember their browser tab groups, so they restore ungrouped. Sessions you already saved are not changed.',
				type: 'switch',
			},
			{
				name: 'closeOnSave',
				label: 'Close tabs after saving',
				help: 'Tabs are stored first and checked again before removal. Pinned tabs close only when inclusion is enabled. Extension only: the phone has no browser tabs to close.',
				type: 'switch',
			},
			{
				name: 'emptyWindowAfterSave',
				label: 'When a save empties a window',
				help: 'A window whose tabs all close keeps a new tab by default. Choose to close it instead when another browser window is open, and switch to that window. The last window always stays open.',
				type: 'select',
				parent: 'closeOnSave',
				when: (current) => current.closeOnSave,
				options: [
					['new-tab', 'Keep it open with a new tab'],
					['close-extra', 'Close it if another window is open'],
				],
			},
			{
				name: 'saveDuplicateHandling',
				label: 'When a saved URL is saved again',
				help: 'Applies to saving tabs and bookmarks. A session or column never holds the same address twice. This setting decides whether an address saved somewhere else is saved again. Rejected tabs stay open, and the save shows a toast with a Force add button to store them anyway.',
				type: 'select',
				options: [
					['allow', 'Allow duplicates'],
					['reject', 'Reject duplicates'],
				],
			},
			{
				name: 'saveDuplicateTitle',
				label: 'Title when a URL is already saved',
				help: 'Choose whether saved copies keep their title or take the latest page title. Notes are always shared between copies of the same page.',
				type: 'select',
				options: [
					['existing', 'Keep the existing title'],
					['latest', 'Use the latest title'],
				],
			},
			{
				name: 'saveSplitTabs',
				label: 'When the active tab is in a split view',
				help: 'Applies to Save selected tabs (shortcut and right-click menus) and to the toolbar’s selected-tabs mode. Only the active split view is reduced; other split views are saved in full. Whole-window saves always keep both tabs, and tabs picked in the popup are saved as chosen.',
				type: 'select',
				options: [
					['both', 'Save both tabs'],
					['focused', 'Save only the focused tab'],
				],
			},
			{
				name: 'cleanTitles',
				label: 'Clean page titles',
				help: 'Removes notification counts and unread markers from the start of page titles when saving tabs and bookmarks, so “(1) YouTube” is saved as “YouTube”.',
				type: 'switch',
			},
			{
				name: 'sessionNameStyle',
				label: 'Session name',
				help: 'How a new session is named. A saved tab group keeps its own title, and a title typed in the popup always wins. “Ask each time” shows a dialog to name the session before it is saved; saving with a shortcut, right-click menu or toolbar button saves first and then opens a small window to rename it. The Android app follows this too: its name field on the save sheet is where it asks.',
				type: 'select',
				options: [
					['title', 'First tab title'],
					['datetime', 'Date and time'],
					['date-title', 'Date and first tab'],
					['custom', 'Custom'],
					['ask', 'Ask each time'],
				],
			},
			{
				name: 'sessionNameFallback',
				label: 'Name to use when left empty',
				help: 'The name a session gets when you leave the name empty, and when it is saved without a chance to ask.',
				enabled: (current) => current.sessionNameStyle === 'ask',
				when: (current) => current.sessionNameStyle === 'ask',
				parent: 'sessionNameStyle',
				type: 'select',
				options: [
					['title', 'First tab title'],
					['datetime', 'Date and time'],
					['date-title', 'Date and first tab'],
					['custom', 'Custom'],
				],
			},
			{
				name: 'sessionNameTemplate',
				label: 'Session name template',
				help: 'Placeholders: {date}, {time}, {weekday}, {title}, {domain}, {count} (tabs saved), {window} (window number when saving all windows).',
				type: 'text',
				placeholder: '{date} · {title}',
				parent: 'sessionNameStyle',
				when: (current) =>
					current.sessionNameStyle === 'custom' ||
					(current.sessionNameStyle === 'ask' &&
						current.sessionNameFallback === 'custom'),
			},
			{
				name: 'openDashboardAfterSave',
				label: `Open ${appName} after saving`,
				help: 'Open the saved session in a separate browser tab after a save action.',
				type: 'switch',
			},
		],
	},
	{
		title: 'Right-click menus',
		description: `Each menu groups its actions under one ${appName} item. In Firefox and Chrome 150 or newer, the Page actions also appear when you right-click a tab.`,
		fields: [
			{
				name: 'contextMenusEnabled',
				label: 'Show in right-click menus',
				help: `Add ${appName} actions to the browser’s right-click menus. Changes apply right away.`,
				type: 'switch',
			},
			{
				name: 'contextMenuLinksEnabled',
				requires: 'contextMenusEnabled',
				label: 'Links, images, and videos',
				help: 'Bookmark a link, an image, or a video to a column.',
				type: 'switch',
			},
			{
				name: 'contextMenuPageEnabled',
				requires: 'contextMenusEnabled',
				label: 'Page',
				help: 'Bookmark the page to a column, send this tab to a recent session, keep a copy of the page, or save the selected tabs, this window, or all windows.',
				type: 'switch',
			},
			{
				name: 'contextMenuSelectionEnabled',
				requires: 'contextMenusEnabled',
				label: 'Selection',
				help: 'Search your saved tabs and bookmarks for the selected text, or save it as a quote on the page.',
				type: 'switch',
			},
			{
				name: 'contextMenuActionEnabled',
				requires: 'contextMenusEnabled',
				label: 'Toolbar icon',
				help: `Right-click the ${appName} toolbar icon to open the dashboard or the side panel, save this window, exclude the site, or open Help and Settings.`,
				type: 'switch',
			},
		],
	},
	{
		title: 'When restoring',
		fields: [
			{
				name: 'restoreTarget',
				label: 'Open restored tabs in',
				help: 'Choose whether to use this window, a new window when this one has other tabs, or always a new window.',
				type: 'select',
				options: [
					['current-window', 'Current window'],
					[
						'new-window-unless-only-tab',
						'New window unless this is the only tab',
					],
					['always-new-window', 'Always a new window'],
				],
			},
			{
				name: 'restoreWindowBounds',
				label: 'Restore saved window size and position',
				help: 'When restoring a session in a new window, use the size and screen position recorded when you saved the whole window. This is off by default. Your browser or window manager may override the saved bounds, especially with tiling window managers.',
				type: 'switch',
			},
			{
				name: 'restoreMode',
				label: 'After restoring a session',
				help: 'Choose whether saved tabs stay in the session or are removed once they are restored.',
				type: 'select',
				options: [
					['keep', 'Keep saved tabs'],
					['remove', 'Remove restored tabs'],
				],
			},
			{
				name: 'restoreDuplicateHandling',
				label: 'When a URL is already open',
				help: 'This applies to restores only. Import duplicate choices appear only in the relevant import dialog.',
				type: 'select',
				options: [
					['skip', 'Skip duplicates'],
					['open', 'Open duplicates'],
				],
			},
			...(firefox
				? []
				: ([
						{
							name: 'restoreSplitTabs',
							label: 'Tabs saved from a split view',
							help: 'Reopen both tabs side by side in one tab slot (Chromium 155 or newer). If the browser can’t split them, they open as neighboring tabs. Restoring one tab of a pair opens just that tab.',
							type: 'select',
							options: [
								['split', 'Keep them side by side'],
								['separate', 'Open as separate tabs'],
							],
						},
					] satisfies SettingField[])),
			{
				name: 'unloadRestoredTabs',
				label: 'Unload background restored tabs',
				help: 'Ask the browser to discard background tabs after restore when the browser supports it. Active, pinned, and split view tabs are left alone.',
				type: 'switch',
			},
			{
				name: 'unloadRestoredTabsThreshold',
				label: 'Only when restoring more than',
				help: 'Smaller restores keep every tab loaded.',
				requires: 'unloadRestoredTabs',
				type: 'number',
				min: 1,
				max: 500,
				suffix: 'tabs',
			},
		],
	},
	{
		title: 'Session board',
		fields: [
			{
				name: 'sessionSort',
				label: 'Sort sessions',
				help: 'How sessions are ordered. Choosing a sort in the Sessions toolbar changes this setting too, so it is the last order you picked, here or on the toolbar, and Android uses it as well.',
				type: 'select',
				options: [
					['newest', 'Newest first'],
					['oldest', 'Oldest first'],
					['opened', 'Last opened'],
					['name', 'Name A–Z'],
					['tabs', 'Most tabs'],
					['custom', 'Custom order'],
				],
			},
			{
				name: 'autoArchiveDays',
				label: 'Archive sessions not opened for',
				help: 'Moves a session to the Archived folder (created if missing) when you have not restored or edited it for this long. Nothing is deleted, and you can move sessions back at any time. Checked daily and at browser start. The Android app follows this too, checking when it starts.',
				type: 'number-select',
				options: [
					['0', 'Never'],
					['7', '1 week'],
					['30', '30 days'],
					['90', '90 days'],
					['365', '1 year'],
				],
				custom: {min: 1, max: 3650, suffix: 'days'},
			},
			{
				name: 'sessionFolderView',
				label: 'Session folder view',
				help: 'Automatic shows the folders as a vertical list beside the sessions once there are more than nine, on a window at least 1024 pixels wide. List and Chips always use that layout. The view button in the Sessions toolbar changes it too.',
				type: 'select',
				options: [
					['auto', 'Automatic'],
					['list', 'List'],
					['chips', 'Chips'],
				],
			},
			{
				name: 'expandSessionsByDefault',
				label: 'Keep sessions expanded by default',
				help: `Show every session’s saved tabs when the ${appName} page opens, including sessions saved later. You can still collapse or expand each one.`,
				type: 'switch',
			},
			{
				name: 'showSessionFaviconPreviews',
				label: 'Show favicon previews on session cards',
				help: 'Show the tab icons and overflow count on collapsed session cards. Turn this off to hide the preview strip.',
				type: 'switch',
			},
			{
				name: 'sessionQuickActions',
				label: 'Quick actions on session cards',
				help: 'Choose up to five buttons from the session menu and reorder them in the picker. Archive is on by default and Delete is off. Enabled actions stay visible while a card is expanded.',
				type: 'checkbox-dropdown',
				maxActions: 5,
				options: [
					['archive', 'Archive'],
					['delete', 'Delete'],
					['share', 'Share'],
					['edit', 'Edit details'],
					['move-up', 'Move up'],
					['move-down', 'Move down'],
					['switch-to', 'Switch to this session'],
				],
			},
			{
				name: 'sessionLinkClickAction',
				label: 'When clicking a saved session link',
				help: 'Choose what happens when you click a link inside a saved session.',
				type: 'select',
				options: LINK_ACTIONS,
			},
			{
				name: 'groupTitleAction',
				label: 'Clicking a session title',
				help: 'Choose whether clicking a session title expands or collapses it, opens its details, or restores it.',
				type: 'select',
				options: [
					['toggle', 'Expand or collapse the session'],
					['edit', 'Open session details'],
					['restore', 'Restore the session'],
				],
			},
		],
	},
	{
		title: 'Bookmark board',
		fields: [
			{
				name: 'bookmarkBoardView',
				label: 'Bookmark view',
				help: 'Focus (the default) shows a column list, starting with All, next to one open column. Board shows every column in a grid. Limit bookmarks shown at a time is on by default, so a busy column scrolls inside the panel instead of stretching the page.',
				type: 'select',
				options: [
					['focus', 'Focus'],
					['board', 'Board'],
				],
			},
			{
				name: 'bookmarkSort',
				label: 'Sort bookmarks',
				help: 'Manual order is your own order and the only one you can rearrange by dragging. The other sorts change only what is shown. The sort button in the bookmarks toolbar changes this too.',
				type: 'select',
				options: BOOKMARK_SORT_OPTIONS.map(([value, label]) => [value, label]),
			},
			{
				name: 'showAllBookmarks',
				label: 'Show All in the bookmark list',
				help: 'The first item of the Focus view, and of the Android app, that lists every bookmark of every column. Turn it off to start in a column. The Android app follows this too.',
				type: 'switch',
			},
			{
				name: 'bookmarkClickAction',
				label: 'When clicking a bookmark',
				help: 'Choose what happens when you click a bookmark. The bookmark menu can always open it either way.',
				type: 'select',
				options: [...LINK_ACTIONS, ['menu', 'Open action menu']],
			},
			{
				name: 'bookmarkQuickActions',
				label: 'Quick actions on bookmarks',
				help: 'Choose up to three buttons from the bookmark menu and reorder them in the picker. Remove all to hide them.',
				type: 'checkbox-dropdown',
				maxActions: 3,
				options: [
					['open-current', 'Open in this tab'],
					['open-new', 'Open in new tab'],
					...(privateWindows
						? [
								['open-private', 'Open in a private window'] as [
									BookmarkQuickAction,
									string,
								],
							]
						: []),
					['copy', 'Copy link'],
					['edit', 'Edit'],
					['delete', 'Delete'],
					['move', 'Move to column…'],
					['move-up', 'Move up'],
					['move-down', 'Move down'],
				],
			},
			{
				name: 'stretchBookmarkColumns',
				label: 'Extend bookmark columns to available height',
				help: 'Columns in the same row match the tallest one.',
				type: 'switch',
			},
			{
				name: 'bookmarkColumnWidth',
				label: 'Bookmark column width',
				help: 'The narrowest a column in Board view can get before the grid fits fewer across. Default keeps the layout set by Dashboard width. Focus view always shows one column beside the list.',
				type: 'select',
				options: [
					['narrow', 'Narrow'],
					['default', 'Default'],
					['wide', 'Wide'],
					['extra-wide', 'Extra wide'],
				],
			},
			{
				name: 'bookmarkColumnsPerRow',
				label: 'Columns per row',
				help: 'The most columns Board view puts in a row. Automatic fits as many as the width allows. A narrow window still shows fewer, so columns never get too small.',
				type: 'number-select',
				options: [
					['0', 'Automatic'],
					['1', '1 column'],
					['2', '2 columns'],
					['3', '3 columns'],
					['4', '4 columns'],
					['5', '5 columns'],
					['6', '6 columns'],
				],
			},
			{
				name: 'bookmarkDensity',
				label: 'Bookmark density',
				help: 'Compact tightens the gaps, padding, and row height of the bookmark board in both Board and Focus views, so more bookmarks fit on screen.',
				type: 'select',
				options: [
					['comfortable', 'Comfortable'],
					['compact', 'Compact'],
				],
			},
			{
				name: 'limitBookmarksPerColumn',
				label: 'Limit bookmarks shown at a time',
				help: 'On by default. Each column in Board and Focus keeps the number below visible and scrolls through the rest. All bookmarks stay loaded. Off keeps the current display behavior. Extension only: the phone shows one column at a time and scrolls it.',
				type: 'switch',
			},
			{
				name: 'bookmarkColumnPageSize',
				label: 'Show at a time',
				help: 'How many bookmarks fit in a column before it starts scrolling. Defaults to 16. Extension only.',
				requires: 'limitBookmarksPerColumn',
				type: 'number',
				min: 1,
				max: 500,
				suffix: 'bookmarks',
			},
			{
				name: 'browserBookmarkAction',
				label: 'When you bookmark a page in the browser',
				help: `Use the browser’s own bookmark button (star, Ctrl/Cmd+D) as usual and ${appName} can offer to keep the page on the bookmark board too. Only a single bookmark for the page you are on counts; syncing, imports and pastes are ignored. Removing the browser bookmark never removes the ${appName} one.`,
				type: 'select',
				options: [
					['off', 'Do nothing'],
					['ask', `Ask to add it to ${appName}`],
					['add', 'Add it to a column automatically'],
				],
			},
			{
				name: 'browserBookmarkColumn',
				label: 'Column for browser bookmarks',
				help: 'Where automatically added bookmarks go. The first column is used if this one no longer exists.',
				type: 'column',
				when: (current) => current.browserBookmarkAction === 'add',
				parent: 'browserBookmarkAction',
			},
			{
				name: 'pasteLinkToBookmark',
				label: 'Paste a link to add a bookmark',
				help: `Pasting a link anywhere on the ${appName} page except a text field opens Add bookmark with the link and its title filled in. Several links, one per line, open a list to add them all. Both dialogs can add to a saved session instead of a column. Extension only: the phone saves links from the share sheet and its Add button.`,
				type: 'switch',
			},
		],
	},
	{
		title: RECOVERY_TITLE,
		description: 'Snapshots and backups never leave this computer.',
		fields: [
			{
				name: 'snapshotsEnabled',
				label: 'Keep crash-recovery snapshots',
				help: 'Brings back your open windows after a crash.',
				type: 'switch',
			},
			{
				name: 'snapshotIntervalMinutes',
				requires: 'snapshotsEnabled',
				label: 'Add to the history every',
				help: 'How often one joins Recent snapshots.',
				type: 'number-select',
				options: [
					['5', '5 minutes'],
					['15', '15 minutes'],
					['30', '30 minutes'],
				],
			},
			{
				name: 'snapshotKeep',
				requires: 'snapshotsEnabled',
				label: 'Snapshots to keep',
				help: 'The oldest are dropped first.',
				type: 'number-select',
				options: [
					['10', '10 snapshots'],
					['25', '25 snapshots'],
					['50', '50 snapshots'],
				],
			},
			{
				name: 'autoBackup',
				label: 'Automatic backups',
				help: 'Dated copies of your sessions, bookmarks and settings.',
				type: 'select',
				options: [
					['off', 'Off'],
					['daily', 'Daily'],
					['weekly', 'Weekly'],
				],
			},
			{
				name: 'autoBackupKeep',
				enabled: (current) => current.autoBackup !== 'off',
				parent: 'autoBackup',
				label: 'Backups to keep',
				help: 'Skipped when nothing changed.',
				type: 'number-select',
				options: [
					['7', 'Last 7'],
					['30', 'Last 30'],
				],
			},
			{
				name: 'autoBackupToDownloads',
				enabled: (current) => current.autoBackup !== 'off',
				parent: 'autoBackup',
				label: 'Also save a copy to Downloads',
				help: `Saves each one to Downloads/${appName}.`,
				type: 'switch',
			},
			{
				name: 'askBeforeDeleting',
				label: 'Ask before deleting',
				help: 'Asks before a bookmark, session or column is deleted. Off, it is deleted at once with Undo. The Android app follows this too.',
				type: 'switch',
			},
			{
				name: 'trashRetentionDays',
				label: 'Keep items in the trash bin for',
				help: 'Then deleted items are removed for good. The Android app follows this too.',
				type: 'number-select',
				options: [
					['7', '7 days'],
					['30', '30 days'],
					['90', '90 days'],
				],
			},
			{
				name: 'defaultShareMode',
				label: 'Default shared link type',
				help: 'Whether Get a link starts as a Snapshot (frozen copy) or a Live link (updates when the column or session syncs). The Android app follows this too.',
				type: 'select',
				options: [
					['snapshot', 'Snapshot'],
					['live', 'Live link'],
				],
			},
		],
	},
];

export const SETTING_WORDS: Partial<Record<keyof Settings, string[]>> = {
	newTabEnabled: ['new tab page', 'newtab', 'home page', 'start page'],
	newTabFallback: ['new tab fallback', 'blank page', 'browser new tab'],
	newTabFallbackUrl: ['custom new tab', 'new tab url', 'home page address'],
	autoFocusSearchOnNewTab: [
		'search focus',
		'autofocus',
		'new tab search',
		'search palette on new tab',
	],
	paletteLocation: ['search palette', 'finder', 'command palette', 'overlay'],
	keepLodgePinned: ['pinned tab', 'pin', 'always open', 'keep open'],
	openDashboardOnStartup: ['startup', 'launch', 'browser start'],
	startupBehavior: ['startup', 'launch', 'last session', 'newest session'],
	actionMode: ['toolbar button', 'toolbar icon', 'popup', 'side panel'],
	dashboardBehavior: ['already open', 'switch tab', 'move to this window'],
	dashboardWidth: ['width', 'page width', 'narrow', 'wide', 'full width'],
	sessionsOnTop: ['sessions above bookmarks', 'sessions first', 'board order'],
	showSaveWindowButton: ['header buttons', 'save window button', 'header'],
	linkPreviews: ['hover preview', 'link preview', 'page image', 'thumbnail'],
	siteIcons: ['favicons', 'favicon', 'icons', 'link icons'],
	showTrashBinButton: ['header buttons', 'trash', 'deleted'],
	toastPosition: [
		'toast',
		'notification position',
		'message position',
		'snackbar',
	],
	toastDuration: [
		'toast',
		'toast duration',
		'notification',
		'undo message',
		'dismiss',
	],
	urlDisplayMode: ['url display', 'show addresses', 'domain', 'full url'],
	simplifyUrls: ['shorten addresses', 'hide https', 'hide www', 'url display'],
	removeTrackingParameters: [
		'tracking parameters',
		'tracking',
		'utm',
		'fbclid',
		'clean links',
		'clean urls',
	],
	markInsecureLinks: ['http', 'insecure', 'not secure', 'lock', 'warning'],
	markLocalLinks: ['localhost', 'local addresses', 'home network', 'http'],
	includePinnedTabs: ['pinned', 'pinned tabs'],
	ignoreTabGroups: ['tab groups', 'groups', 'ungrouped'],
	closeOnSave: ['close tabs', 'close after saving', 'remove tabs'],
	emptyWindowAfterSave: ['empty window', 'close window', 'last tab'],
	saveDuplicateHandling: ['duplicates', 'duplicate urls', 'same url', 'reject'],
	saveDuplicateTitle: ['duplicate title', 'keep title', 'latest title'],
	saveSplitTabs: ['split view', 'split tabs', 'save split'],
	cleanTitles: ['page titles', 'clean titles', 'unread count', 'title counts'],
	sessionNameStyle: [
		'session name',
		'naming',
		'name sessions',
		'ask for a name',
	],
	sessionNameFallback: ['empty name', 'fallback name', 'default name'],
	sessionNameTemplate: ['name template', 'placeholders', 'custom name'],
	openDashboardAfterSave: ['open after saving', 'show dashboard after save'],
	contextMenusEnabled: ['context menu', 'right click', 'menu'],
	contextMenuLinksEnabled: ['link menu', 'bookmark link', 'image', 'video'],
	contextMenuPageEnabled: ['page menu', 'bookmark page', 'send tab to session'],
	contextMenuSelectionEnabled: [
		'quotes',
		'quote',
		'save quote',
		'selected text',
		'selection menu',
	],
	contextMenuActionEnabled: ['toolbar icon menu', 'action menu'],
	restoreTarget: ['restore', 'new window', 'current window'],
	restoreWindowBounds: ['window size', 'window position', 'bounds'],
	restoreMode: ['keep saved tabs', 'remove restored tabs', 'after restore'],
	restoreDuplicateHandling: ['already open', 'skip duplicates', 'restore'],
	restoreSplitTabs: ['split view', 'side by side', 'split tabs'],
	unloadRestoredTabs: [
		'unload',
		'unloading',
		'discard',
		'memory',
		'background tabs',
	],
	unloadRestoredTabsThreshold: ['unload', 'single tabs', 'number of tabs'],
	sessionSort: ['sort', 'sort order', 'order', 'newest', 'oldest'],
	autoArchiveDays: ['archive', 'auto archive', 'old sessions'],
	sessionFolderView: ['folders', 'folder chips', 'folder list'],
	expandSessionsByDefault: ['expand sessions', 'collapse', 'show all tabs'],
	showSessionFaviconPreviews: ['favicons', 'tab icons', 'session cards'],
	sessionQuickActions: ['quick actions', 'session buttons', 'card buttons'],
	sessionLinkClickAction: ['click a session link', 'saved tab click'],
	groupTitleAction: ['click a session title', 'session title'],
	bookmarkBoardView: ['board view', 'focus view', 'columns view', 'layout'],
	bookmarkSort: ['sort', 'order', 'newest', 'oldest', 'title', 'site'],
	showAllBookmarks: ['show all', 'all bookmarks', 'all view'],
	bookmarkClickAction: ['click a bookmark', 'open bookmark', 'bookmark click'],
	bookmarkQuickActions: ['quick actions', 'bookmark buttons', 'card buttons'],
	stretchBookmarkColumns: ['column height', 'stretch', 'full height'],
	bookmarkColumnWidth: ['column width', 'width', 'narrow', 'wide'],
	bookmarkColumnsPerRow: ['columns across', 'wrap', 'row'],
	bookmarkDensity: ['density', 'compact', 'spacing', 'comfortable'],
	limitBookmarksPerColumn: ['limit', 'show more', 'long columns'],
	bookmarkColumnPageSize: ['page size', 'show more', 'items per column'],
	browserBookmarkAction: ['browser star', 'star', 'bookmark button', 'ctrl+d'],
	browserBookmarkColumn: ['browser star column', 'star column'],
	pasteLinkToBookmark: ['paste', 'paste link', 'clipboard', 'ctrl+v'],
	snapshotsEnabled: ['snapshots', 'crash recovery', 'history', 'recover'],
	snapshotIntervalMinutes: ['snapshot interval', 'history', 'how often'],
	snapshotKeep: ['snapshot count', 'keep snapshots', 'how many'],
	autoBackup: ['backups', 'scheduled backup', 'safety backup'],
	autoBackupKeep: ['backup count', 'keep backups', 'how many backups'],
	autoBackupToDownloads: ['downloads', 'download folder', 'backup file'],
	askBeforeDeleting: [
		'confirm delete',
		'delete confirmation',
		'ask before delete',
		'undo',
		'remove',
	],
	trashRetentionDays: ['trash', 'bin', 'retention', 'deleted items', 'days'],
	defaultShareMode: [
		'share',
		'sharing',
		'shared page',
		'live link',
		'snapshot',
		'default share',
		'password',
	],
};
