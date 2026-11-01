import {
	Fragment,
	useEffect,
	useRef,
	useState,
	type SyntheticEvent,
	type ReactNode,
} from 'react';
import {createRoot} from 'react-dom/client';
import {
	LayoutDashboard,
	Moon,
	RotateCcw,
	Sun,
	Keyboard,
	Laptop,
	Trash2,
	Download,
	Bookmark,
	Database,
	PanelRightOpen,
	Plus,
	Eraser,
	LifeBuoy,
	MousePointerClick,
	Globe,
	Layers2,
	Upload,
	Search,
	X,
} from 'lucide-react';
import {
	Button,
	Checkbox,
	ConfirmationDialog,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch,
	Textarea,
	TooltipProvider,
	IconTooltip,
} from '../shared/ui';
import '../../styles/extension-app.css';
import {ACCENTS, DEFAULT_ACCENT} from '../shared/accents';
import {ThemeProvider, useTheme} from '../shared/theme';
import {radioTargetIndex} from '../shared/radio-keys';
import {AccentPalette} from './accent-palette';
import {
	EmptyState,
	LoadError,
	AppHeader,
	LoadingLine,
	PageShell,
	SectionCard,
	StatusLine,
	messageOf,
	openShortcutsPage,
	plural,
	send,
	useStatus,
	useTabLodgeState,
	type IconComponent,
} from './common';
import type {ActionResult, EraseScope, Settings} from './types';
import {
	BackupDialog,
	ImportDialog,
	RecoveryTools,
	SnapshotsDialog,
	TrashDialog,
} from './lazy-dialogs';
import {offerUndo} from './recovery-core';
import type {ExportData} from './export-formats';
import {initialSearchQuery, withSearchParam} from './page-params';
import {
	excludedHostError,
	normalizeExcludedHost,
	parseExcludedLines,
} from './excluded-sites';
import {
	matchesAnyTerm,
	matchesQuery,
	rankByQuery,
	scoreQuery,
	sortByQuery,
	searchTerms,
} from './fuzzy';
import {Highlight} from './highlight';
import {PROJECT} from './project';
import {ColumnSelect} from './column-select';
import {
	PrivateStorageSettings,
	PRIVATE_STORAGE_TITLE,
	PRIVATE_STORAGE_WORDS,
} from './private-storage';
import {cn} from '@/lib/utils';

// Settings keys whose value has the given type, so switch rows only bind boolean settings and select rows string ones.
type SettingKey<V> = {
	[K in keyof Settings]-?: Settings[K] extends V ? K : never;
}[keyof Settings];
// `requires`: a switch that must be on for this row to apply; the row is hidden while it is off (search shows it
// next to its parent, disabled).
type SettingField = {
	label: string;
	help: string;
	requires?: SettingKey<boolean>;
	/**
	Like `requires`, for a dependency that is not a switch (such as "backups are not off"): the row is hidden while false.
	*/
	enabled?: (settings: Settings) => boolean;
	/**
	The row an `enabled` check depends on, so search can show the two together (`requires` names it already).
	*/
	parent?: keyof Settings;
	/**
	The row only exists while this is true for the current settings; otherwise it is hidden and left out of search.
	*/
	when?: (settings: Settings) => boolean;
} & (
	| {name: SettingKey<boolean>; type: 'switch'}
	| {
			name: SettingKey<number>;
			type: 'number';
			min: number;
			max: number;
			/**
			Text after the input, such as "tabs".
			*/
			suffix: string;
	  }
	| {name: SettingKey<string>; type: 'select'; options: Array<[string, string]>}
	| {
			name: SettingKey<number>;
			type: 'number-select';
			/**
			Value (as text) and label of each allowed number.
			*/
			options: Array<[string, string]>;
	  }
	| {name: SettingKey<string>; type: 'column'}
	| {name: SettingKey<string>; type: 'url'; placeholder: string}
	| {name: SettingKey<string>; type: 'text'; placeholder: string}
);
const listing = (parts: string[]) =>
	parts.length < 2
		? parts.join('')
		: `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
const RECOVERY_TITLE = 'Recovery & backups';
// Words people may search for that live in the tools below the Recovery & backups settings.
const RECOVERY_TOOLS_TEXT = [
	'Storage used',
	'Back up now',
	'Recent snapshots',
	'Clear snapshots',
	'Empty trash bin',
	'Trash bin',
	'Backups',
	'Restore a backup',
	'Download a backup',
	'Safety backups',
	'undo',
	'deleted items',
	'crash',
];

const footerLinks = [
	{label: 'Source code', href: PROJECT.repoUrl, external: true},
	{label: 'Report an issue', href: PROJECT.issuesUrl, external: true},
	{label: 'Help', href: 'help.html', external: false},
];

const LINK_ACTIONS: Array<[string, string]> = [
	['none', 'None'],
	['current', 'Open in this tab'],
	['new', 'Open in new tab'],
];
const settingsGroups: Array<{
	title: string;
	icon: IconComponent;
	description?: string;
	fields: SettingField[];
}> = [
	{
		title: `Opening ${PROJECT.name}`,
		icon: Laptop,
		fields: [
			{
				name: 'newTabEnabled',
				label: `Use ${PROJECT.name} for new tabs`,
				help: `Show saved bookmarks and sessions on ${PROJECT.name}’s local new-tab page.`,
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
			{
				name: 'autoFocusSearchOnNewTab',
				label: 'Focus search when opening a new tab',
				help: 'Opens the search palette whenever a new tab opens. Chromium may keep focus in the address bar until you click the page.',
				type: 'switch',
				requires: 'newTabEnabled',
			},
			{
				name: 'keepLodgePinned',
				label: `Keep ${PROJECT.name} pinned and always open`,
				help: `Pins one ${PROJECT.name} tab per window and keeps it open. Links opened from it always open in a new tab.`,
				type: 'switch',
			},
			{
				name: 'openDashboardOnStartup',
				label: `Open ${PROJECT.name} when the browser starts`,
				help: `Start with your saved sessions or the local ${PROJECT.name} page.`,
				type: 'switch',
			},
			{
				name: 'startupBehavior',
				label: 'On browser startup',
				help: `Choose what ${PROJECT.name} opens when startup behavior is enabled.`,
				type: 'select',
				options: [
					['dashboard', `Open the ${PROJECT.name} page`],
					['last-session', 'Restore the newest session'],
				],
				requires: 'openDashboardOnStartup',
			},
			{
				name: 'actionMode',
				label: 'Toolbar button action',
				help: 'The default is a compact popup. Only Open Dashboard opens the full page in a separate tab.',
				type: 'select',
				options: [
					['popup', 'Open the quick action popup'],
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
				label: `When ${PROJECT.name} is already open`,
				help: `Choose whether to switch to the open ${PROJECT.name} page or move it here.`,
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
		icon: LayoutDashboard,
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
				name: 'showTrashBinButton',
				label: 'Show Trash bin button in the header',
				help: 'Hide this shortcut to keep the header compact. The Trash bin remains in the Sessions menu, Bookmarks menu, side panel, and search palette.',
				type: 'switch',
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
		icon: Layers2,
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
				help: 'Tabs are stored first and checked again before removal. Pinned tabs close only when inclusion is enabled.',
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
				help: 'Applies to saving tabs. Rejected duplicates are not stored twice and their tabs stay open. The save shows a toast with a Force add button to store them anyway.',
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
				help: 'How a new session is named. A saved tab group keeps its own title, and a title typed in the popup always wins. “Ask each time” shows a dialog to name the session before it is saved; saving with a shortcut, right-click menu or toolbar button saves first and then opens a small window to rename it.',
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
				label: `Open ${PROJECT.name} after saving`,
				help: 'Open the saved session in a separate browser tab after a save action.',
				type: 'switch',
			},
		],
	},
	{
		title: 'Side panel',
		icon: PanelRightOpen,
		fields: [
			{
				name: 'toolbarOpens',
				label: 'Toolbar icon opens',
				help: `Choose whether the toolbar icon opens the quick popup or the ${PROJECT.name} side panel. The side panel is always available from the browser’s sidebar or side panel menu, and via the “Open side panel” shortcut.`,
				type: 'select',
				options: [
					['popup', 'Popup'],
					['sidepanel', 'Side panel'],
				],
			},
		],
	},
	{
		title: 'Right-click menus',
		icon: MousePointerClick,
		description: `Each menu groups its actions under one ${PROJECT.name} item. Browsers don’t let extensions add to the tab strip’s menu.`,
		fields: [
			{
				name: 'contextMenusEnabled',
				label: 'Show in right-click menus',
				help: `Add ${PROJECT.name} actions to the browser’s right-click menus. Changes apply right away.`,
				type: 'switch',
			},
			{
				name: 'contextMenuLinksEnabled',
				requires: 'contextMenusEnabled',
				label: 'Links',
				help: 'Bookmark a link to a column, or save it to the “Saved links” session without opening it.',
				type: 'switch',
			},
			{
				name: 'contextMenuPageEnabled',
				requires: 'contextMenusEnabled',
				label: 'Page',
				help: 'Bookmark the page to a column, or save this tab, this window, a tab group, or the tabs beside it.',
				type: 'switch',
			},
			{
				name: 'contextMenuSelectionEnabled',
				requires: 'contextMenusEnabled',
				label: 'Selection',
				help: 'Search your saved tabs and bookmarks for the selected text.',
				type: 'switch',
			},
			{
				name: 'contextMenuActionEnabled',
				requires: 'contextMenusEnabled',
				label: 'Toolbar icon',
				help: `Right-click the ${PROJECT.name} toolbar icon to open the dashboard, save this window, exclude the site, or open Help and Settings.`,
				type: 'switch',
			},
		],
	},
	{
		title: 'When restoring',
		icon: RotateCcw,
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
			{
				name: 'singleTabBehavior',
				label: 'When restoring one tab',
				help: 'Choose whether a restored single tab becomes active or opens in the background.',
				type: 'select',
				options: [
					['stay', 'Stay on this page'],
					['switch', 'Switch to the restored tab'],
				],
			},
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
			{
				name: 'unloadRestoredTabs',
				label: 'Unload background restored tabs',
				help: 'Ask Chromium to discard background tabs after restore when the browser supports it. Active, pinned, and split view tabs are left alone.',
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
		icon: Layers2,
		fields: [
			{
				name: 'sessionSort',
				label: 'Sort sessions by default',
				help: 'Newest first is used only when no sort choice has been stored yet.',
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
				help: 'Moves a session to the Archived folder (created if missing) when you have not restored or edited it for this long. Nothing is deleted, and you can move sessions back at any time. Checked daily and at browser start.',
				type: 'number-select',
				options: [
					['0', 'Never'],
					['30', '30 days'],
					['90', '90 days'],
					['180', '180 days'],
					['365', '1 year'],
				],
			},
			{
				name: 'expandSessionsByDefault',
				label: 'Keep sessions expanded by default',
				help: `Show every session’s saved tabs when the ${PROJECT.name} page opens, including sessions saved later. You can still collapse or expand each one.`,
				type: 'switch',
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
		icon: Bookmark,
		fields: [
			{
				name: 'bookmarkClickAction',
				label: 'When clicking a bookmark',
				help: 'Choose what happens when you click a bookmark. The bookmark menu can always open it either way.',
				type: 'select',
				options: [...LINK_ACTIONS, ['menu', 'Open action menu']],
			},
			{
				name: 'showBookmarkQuickActions',
				label: 'Show a quick action on bookmarks',
				help: 'Add one button next to each bookmark’s menu button that does the action you pick below.',
				type: 'switch',
			},
			{
				name: 'bookmarkQuickAction',
				label: 'Quick action',
				help: 'What the button on each bookmark does. Delete still asks first.',
				requires: 'showBookmarkQuickActions',
				type: 'select',
				options: [
					['open-current', 'Open in this tab'],
					['open-new', 'Open in new tab'],
					['copy', 'Copy link'],
					['edit', 'Edit'],
					['delete', 'Delete'],
				],
			},
			{
				name: 'stretchBookmarkColumns',
				label: 'Extend bookmark columns to available height',
				help: 'Columns in the same row match the tallest one.',
				type: 'switch',
			},
			{
				name: 'limitBookmarksPerColumn',
				label: 'Limit bookmarks shown at a time',
				help: 'When on, each column starts with the number below and Show more adds another batch of that size. Off keeps the current display behavior.',
				type: 'switch',
			},
			{
				name: 'bookmarkColumnPageSize',
				label: 'Show at a time',
				help: 'How many bookmarks each column reveals in a batch.',
				requires: 'limitBookmarksPerColumn',
				type: 'number',
				min: 1,
				max: 500,
				suffix: 'bookmarks',
			},
			{
				name: 'browserBookmarkAction',
				label: 'When you bookmark a page in the browser',
				help: `Use the browser’s own bookmark button (star, Ctrl/Cmd+D) as usual and ${PROJECT.name} can offer to keep the page on the bookmark board too. Only a single bookmark for the page you are on counts; syncing, imports and pastes are ignored. Removing the browser bookmark never removes the ${PROJECT.name} one.`,
				type: 'select',
				options: [
					['off', 'Do nothing'],
					['ask', `Ask to add it to ${PROJECT.name}`],
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
				help: `Pasting a link anywhere on the ${PROJECT.name} page except a text field opens Add bookmark with the link and its title filled in. Several links, one per line, open a list to add them all.`,
				type: 'switch',
			},
		],
	},
	{
		title: RECOVERY_TITLE,
		icon: LifeBuoy,
		description: `Everything here stays on this computer. ${PROJECT.name} never uploads snapshots, backups or deleted items.`,
		fields: [
			{
				name: 'snapshotsEnabled',
				label: 'Keep crash-recovery snapshots',
				help: 'Saves a copy of your open windows (web pages only) every few minutes and after changes. If the browser closes unexpectedly, the dashboard offers to restore them.',
				type: 'switch',
			},
			{
				name: 'snapshotIntervalMinutes',
				requires: 'snapshotsEnabled',
				label: 'Add to the history every',
				help: 'How often a snapshot joins the list under Recent snapshots. The latest state is also saved a few seconds after each tab change.',
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
				help: 'Keeps dated copies of your sessions, bookmarks and settings inside the extension’s storage. They can be restored or downloaded below.',
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
				help: 'The oldest are dropped first. Backups are skipped when nothing changed.',
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
				help: `Writes each backup as a dated JSON file to Downloads/${PROJECT.name}. Asks the browser for the optional “Downloads” permission when you turn it on. Very large backups are too big for this; use Download in the list below.`,
				type: 'switch',
			},
			{
				name: 'trashRetentionDays',
				label: 'Keep items in the trash bin for',
				help: 'Deleted sessions, saved links, bookmarks and columns wait in the trash bin this long, then are removed for good automatically.',
				type: 'number-select',
				options: [
					['7', '7 days'],
					['30', '30 days'],
					['90', '90 days'],
				],
			},
		],
	},
];

// Text of a settings row that the search box looks through: its label, help, and (for selects) option labels.
const fieldSearchText = (field: SettingField) => [
	field.label,
	field.help,
	...(field.type === 'select' || field.type === 'number-select'
		? field.options.map(([, label]) => label)
		: []),
];

// The sections that are not generated from `settingsGroups`, with the extra words people may search for.
const SHORTCUTS = {
	title: 'Keyboard shortcuts',
	help: `Review or change ${PROJECT.name} shortcuts on the browser’s extension-shortcuts page.`,
	text: [
		'Keyboard shortcuts',
		'keys',
		'hotkey',
		'keybinding',
		'Configure shortcuts',
		'save window',
		'side panel',
	],
};
const APPEARANCE = {
	title: 'Appearance',
	help: 'System follows your device and updates automatically. The accent color tints buttons, focus rings, and selections. The default is TabLodge’s own color; System follows your operating system’s accent color where it has one.',
	text: [
		'Appearance',
		'System follows your device and updates automatically.',
		'System',
		'Light',
		'Dark',
		'theme',
		'color mode',
		'Accent color',
		'Custom',
		...ACCENTS.map(({label}) => label),
	],
};
const DATA = {
	title: 'Data',
	description: 'Sessions and bookmarks are stored only in this browser.',
};
const EXCLUDED = {
	title: 'Excluded websites',
	description:
		'Excludes a website and all its subdomains from future session saves. Existing sessions and bookmarks are unchanged.',
	words: ['exclude', 'ignore', 'site', 'origin', 'host', 'domain', 'Add site'],
};
const DEFAULTS = {
	title: 'Restore default preferences',
	help: 'Saved sessions and bookmarks are not changed.',
	words: ['Restore defaults', 'reset', 'factory'],
};
const sectionId = (title: string) =>
	`settings-${title.toLowerCase().replaceAll(/[^0-9a-z]+/g, '-')}`;
const SECTION_SCROLL_CLASS = 'scroll-mt-6';
const ACTIVE_SECTION_OFFSET = 120;
const settingsNavigationLabels: Record<string, string> = {
	[SHORTCUTS.title]: 'Shortcuts',
	'When saving': 'Saving',
	'Side panel': 'Side panel',
	'Right-click menus': 'Context menus',
	'When restoring': 'Restoring',
	'Session board': 'Session board',
	'Bookmark board': 'Bookmark board',
	[RECOVERY_TITLE]: 'Recovery',
	[EXCLUDED.title]: 'Excluded sites',
	[DEFAULTS.title]: 'Defaults',
};
const settingsNavigation = [
	{title: APPEARANCE.title, icon: Sun},
	{title: SHORTCUTS.title, icon: Keyboard},
	{title: PRIVATE_STORAGE_TITLE, icon: Database},
	...settingsGroups.map(({title, icon}) => ({title, icon})),
	{title: DATA.title, icon: Database},
	{title: EXCLUDED.title, icon: Globe},
	{title: DEFAULTS.title, icon: RotateCcw},
].map(({title, icon}) => ({
	title,
	label: settingsNavigationLabels[title] ?? title,
	icon,
	id: sectionId(title),
}));

type DataRowDef = {
	key: string;
	icon: IconComponent;
	label: string;
	help: string;
	words: string[];
	action: ReactNode;
};

function Options() {
	const {state, error, reload} = useTabLodgeState();
	const [status, showStatus] = useStatus();
	const {theme, setTheme, accent, systemColor, setAccent} = useTheme();
	const [settings, setSettings] = useState<Partial<Settings>>({});
	const [defaultSettings, setDefaultSettings] = useState<Settings>();
	const [excluded, setExcluded] = useState<string[]>([]);
	const [excludedDraft, setExcludedDraft] = useState('');
	const [bulkMode, setBulkMode] = useState(false);
	const [showInvalid, setShowInvalid] = useState(false);
	const [siteDialog, setSiteDialog] = useState(false);
	const [siteError, setSiteError] = useState('');
	const [siteBusy, setSiteBusy] = useState(false);
	const siteInputRef = useRef<HTMLInputElement>(null);
	const siteTextRef = useRef<HTMLTextAreaElement>(null);
	const [busy, setBusy] = useState('');
	const [resetBusy, setResetBusy] = useState(false);
	const [eraseBusy, setEraseBusy] = useState(false);
	const [eraseOpen, setEraseOpen] = useState(false);
	const [eraseSessions, setEraseSessions] = useState(false);
	const [eraseBookmarks, setEraseBookmarks] = useState(false);
	const [confirmDefaults, setConfirmDefaults] = useState(false);
	const [backupData, setBackupData] = useState<ExportData | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const [snapshotsOpen, setSnapshotsOpen] = useState(false);
	const [trashOpen, setTrashOpen] = useState(false);
	const [downloadsGranted, setDownloadsGranted] = useState(false);
	useEffect(() => {
		void Promise.resolve(
			chrome.permissions?.contains({permissions: ['downloads']}),
		)
			.then((granted) => setDownloadsGranted(Boolean(granted)))
			.catch(() => undefined);
	}, []);
	const dataRef = useRef<HTMLDivElement>(null);
	// The search box: `?q=` keeps the query across reloads; "/" and Ctrl/Cmd+K focus it, Escape clears it.
	const searchRef = useRef<HTMLInputElement>(null);
	const [templateDraft, setTemplateDraft] = useState<string | null>(null);
	const [query, setQuery] = useState(() => initialSearchQuery(location.search));
	const [activeSection, setActiveSection] = useState(settingsNavigation[0].id);
	const searching = searchTerms(query).length > 0;
	useEffect(() => {
		if (!state) {
			return;
		}

		let frame = 0;
		const updateActiveSection = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const atBottom =
					window.scrollY + window.innerHeight >=
					document.documentElement.scrollHeight - 2;
				let first = settingsNavigation[0].id;
				let firstTop = Infinity;
				let active = first;
				let activeTop = -Infinity;
				let last = first;
				let lastTop = -Infinity;

				for (const section of settingsNavigation) {
					const element = document.querySelector(`#${section.id}`);
					if (!element) {
						continue;
					}

					const {top} = element.getBoundingClientRect();
					if (top < firstTop) {
						first = section.id;
						firstTop = top;
					}

					if (top > lastTop) {
						last = section.id;
						lastTop = top;
					}

					if (!(top <= ACTIVE_SECTION_OFFSET && top > activeTop)) {
						continue;
					}

					active = section.id;
					activeTop = top;
				}

				if (atBottom) {
					active = last;
				} else if (activeTop === -Infinity) {
					active = first;
				}

				setActiveSection((current) => (current === active ? current : active));
			});
		};

		updateActiveSection();
		window.addEventListener('scroll', updateActiveSection, {passive: true});
		window.addEventListener('resize', updateActiveSection);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', updateActiveSection);
			window.removeEventListener('resize', updateActiveSection);
		};
	}, [query, state]);
	function updateQuery(value: string) {
		setQuery(value);
		history.replaceState(
			null,
			'',
			withSearchParam(location, 'q', value.trim() ? value : null),
		);
	}

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				event.altKey ||
				document.querySelector('[role=dialog], [role=alertdialog]')
			) {
				return;
			}

			const target = event.target as HTMLElement | null;
			const typing = Boolean(
				target &&
				(target.isContentEditable ||
					/^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName)),
			);
			const commandK =
				(event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
			if (
				!commandK &&
				(event.key !== '/' || typing || event.ctrlKey || event.metaKey)
			) {
				return;
			}

			event.preventDefault();
			searchRef.current?.focus();
			searchRef.current?.select();
		};

		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, []);

	useEffect(() => {
		void send('GET_SETTINGS_DEFAULTS').then((result) => {
			if (result.ok) {
				setDefaultSettings(result.settings);
			}
		});
	}, []);

	useEffect(() => {
		if (!state?.settings) {
			return;
		}

		setSettings(state.settings);
		setExcluded(state.settings.excludedOrigins || []);
	}, [state]);

	// Values come from the switch and select controls below, so they match the setting's type.
	async function updateSetting(
		name: keyof Settings,
		value: boolean | string | number,
		savedMessage = 'Setting saved.',
	) {
		if (name === 'toolbarOpens' && value === 'sidepanel' && !chrome.sidePanel) {
			showStatus(
				'The browser Side Panel API is unavailable in this version.',
				true,
			);
			return;
		}

		// Copies to Downloads need the optional permission; the browser asks for it here, straight from the click.
		if (name === 'autoBackupToDownloads') {
			if (value === true) {
				let granted = false;
				try {
					granted = await chrome.permissions.request({
						permissions: ['downloads'],
					});
				} catch {
					// A request the browser rejects counts as not granted.
				}

				setDownloadsGranted(granted);
				if (!granted) {
					showStatus(
						'The browser did not grant Downloads access, so backups are not copied to your Downloads folder.',
						true,
					);
					return;
				}
			} else {
				try {
					await chrome.permissions.remove({permissions: ['downloads']});
				} catch {
					/*
					The permission may already be gone.
					*/
				}

				setDownloadsGranted(false);
			}
		}

		setSettings((current) => ({...current, [name]: value}));
		const result = await send('UPDATE_SETTINGS', {
			settings: {[name]: value},
		});
		if (result?.ok) {
			showStatus(savedMessage);
		} else {
			await reload();
			showStatus(result?.error || 'Could not save that setting.', true);
		}
	}

	const siteHost = normalizeExcludedHost(excludedDraft) ?? '';
	const siteDuplicate = Boolean(siteHost) && excluded.includes(siteHost);
	const siteFieldError =
		siteError ||
		excludedHostError(excludedDraft) ||
		(siteDuplicate ? 'This website is already excluded.' : '');
	const bulk = parseExcludedLines(excludedDraft, excluded);
	const siteValid = bulkMode
		? bulk.valid.length > 0
		: Boolean(siteHost) && !siteFieldError;

	// Dialog state is reset on open, not on close, so the closing animation never shows an emptied form.
	function openSiteDialog() {
		setExcludedDraft('');
		setSiteError('');
		setSiteBusy(false);
		setSiteDialog(true);
	}

	async function addExcludedOrigin(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!siteValid || siteBusy) {
			return;
		}

		setSiteBusy(true);
		const entries = bulkMode ? bulk.valid : [siteHost];
		let result:
			| ActionResult<'ADD_EXCLUDED_ORIGINS'>
			| {ok: false; error: string | undefined}
			| undefined;
		try {
			result = await send('ADD_EXCLUDED_ORIGINS', {origins: entries});
		} catch (reason) {
			result = {ok: false, error: messageOf(reason)};
		}

		if (!result?.ok) {
			setSiteError(result?.error || 'Could not add that website.');
			setSiteBusy(false);
			return;
		}

		setExcluded(result.settings?.excludedOrigins || [...excluded, ...entries]);
		setSiteDialog(false);
		showStatus(
			result.notAdded > 0
				? `Excluded ${plural(result.added, 'website')}. ${plural(result.notAdded, 'website')} did not fit: the list is full.`
				: bulkMode
					? `Excluded ${plural(result.added, 'website')}.`
					: 'Website exclusion added.',
			result.notAdded > 0,
		);
	}

	async function removeExcludedOrigin(origin: string) {
		const result = await send('REMOVE_EXCLUDED_ORIGIN', {origin});
		if (result?.ok) {
			setExcluded(result.settings.excludedOrigins || []);
			showStatus('Website exclusion removed.');
		} else {
			showStatus(result?.error || 'Could not remove that website.', true);
		}
	}

	async function restoreDefaults() {
		if (resetBusy) {
			return;
		}

		const previousTheme = theme;
		const previousAccent = accent;
		setResetBusy(true);
		setBusy('defaults');
		const result = await send('RESET_SETTINGS');
		setBusy('');
		setResetBusy(false);
		if (!result?.ok) {
			showStatus(
				result?.error || 'Could not restore the default settings.',
				true,
			);
			return;
		}

		setSettings(result.settings);
		setExcluded(result.settings.excludedOrigins || []);
		try {
			await setTheme('system');
			await setAccent(DEFAULT_ACCENT);
		} catch {
			showStatus(
				'Settings were reset, but the appearance choice could not be changed.',
				true,
			);
			return;
		}

		// The appearance is stored apart from the other settings, so Undo puts it back too.
		offerUndo(
			'Default settings restored.',
			result.undoId,
			showStatus,
			async () => {
				await setTheme(previousTheme).catch(() => undefined);
				await setAccent(previousAccent).catch(() => undefined);
				await reload();
			},
		);
	}

	// Live counts for the Data section and its Erase menu.
	const sessions = state?.groups || [];
	const tabs = sessions.reduce(
		(sum, group) => sum + (group.tabs?.length || 0),
		0,
	);
	const sessionFolders = (state?.folders || []).filter(
		(folder) => !folder.isDefault,
	).length;
	const bookmarkCount = state?.bookmarks?.length || 0;
	const bookmarkColumns = (state?.bookmarkColumns || []).filter(
		(column) => !column.isDefault,
	).length;
	const sessionParts = [
		...(sessions.length > 0
			? [`${plural(sessions.length, 'session')} (${plural(tabs, 'tab')})`]
			: []),
		...(sessionFolders ? [plural(sessionFolders, 'session folder')] : []),
	];
	const bookmarkParts = [
		...(bookmarkCount ? [plural(bookmarkCount, 'bookmark')] : []),
		...(bookmarkColumns ? [plural(bookmarkColumns, 'bookmark column')] : []),
	];
	// A safety backup is taken first; Undo puts the data back.
	async function eraseData(scope: EraseScope) {
		if (eraseBusy) {
			return;
		}

		setEraseBusy(true);
		let result:
			| ActionResult<'ERASE_DATA'>
			| {ok: false; error: string | undefined}
			| undefined;
		try {
			result = await send('ERASE_DATA', {scope});
		} catch (reason) {
			result = {ok: false, error: messageOf(reason)};
		}

		setEraseBusy(false);
		if (!result?.ok) {
			showStatus(
				result?.error || 'Could not erase that data. Nothing was changed.',
				true,
			);
			return;
		}

		await reload();
		const erased = [
			...(scope === 'bookmarks' ? [] : [plural(result.sessions, 'session')]),
			...(scope === 'sessions' ? [] : [plural(result.bookmarks, 'bookmark')]),
		];
		offerUndo(
			`Erased ${listing(erased)}. Settings were kept.`,
			result.undoId,
			showStatus,
			reload,
		);
	}

	// Keep the settings navigation visible while the saved state arrives.
	if (!state) {
		return error ? (
			<PageShell className="max-w-4xl">
				<PageTop />
				<LoadError message={error} />
			</PageShell>
		) : (
			<PageShell className="max-w-4xl" aria-busy="true">
				<PageTop />
				<LoadingLine />
			</PageShell>
		);
	}

	// Search: every section lists its rows' searchable text; a matching section title keeps all its rows.
	const titleHit = (title: string) => searching && matchesQuery(query, [title]);
	const pick = <T,>(
		title: string,
		items: readonly T[],
		textOf: (item: T) => string[],
	): T[] =>
		searching
			? titleHit(title)
				? sortByQuery(query, items, textOf)
				: rankByQuery(query, items, textOf)
			: [...items];
	// A row whose `when` check fails does not apply at all (for example the custom new-tab address while TabLodge
	// owns new tabs): it is hidden and left out of search. A row whose parent switch is off (`requires`, `enabled`)
	// is hidden too, but search still shows it next to its parent, disabled, so it can be found.
	const rowAvailable = (field: SettingField) =>
		!field.when || field.when(settings as Settings);
	const rowDisabled = (field: SettingField) =>
		!rowAvailable(field) ||
		(field.requires !== undefined && settings[field.requires] === false) ||
		(field.enabled !== undefined && !field.enabled(settings as Settings));

	const fieldShown = (field: SettingField) =>
		rowAvailable(field) && (searching || !rowDisabled(field));
	const changedFromDefault = (field: SettingField) =>
		defaultSettings !== undefined &&
		!Object.is(settings[field.name], defaultSettings[field.name]);
	const focusSettingControl = (field: SettingField) => {
		const dependency = field.requires ?? field.parent;
		const name = rowDisabled(field) && dependency ? dependency : field.name;
		const row = [
			...document.querySelectorAll<HTMLElement>('[data-setting-row]'),
		].find((element) => element.dataset.settingRow === name);
		const control = row?.querySelector<HTMLElement>(
			'[role="switch"]:not([disabled]), [role="combobox"]:not([disabled]), input:not([disabled])',
		);
		(control ?? searchRef.current)?.focus();
	};

	const hl = (text: string) => <Highlight text={text} query={query} />;
	const showAppearance = matchesQuery(query, APPEARANCE.text);
	const showShortcuts = matchesQuery(query, SHORTCUTS.text);
	const groupScore = (title: string, fields: SettingField[]) =>
		Math.max(
			scoreQuery(query, [title]),
			...fields.map((field) => scoreQuery(query, fieldSearchText(field))),
		);
	// The tools below the Recovery & backups rows (storage, backup list, quick buttons) are searchable as a unit.
	const recoveryTools =
		!searching ||
		titleHit(RECOVERY_TITLE) ||
		matchesQuery(query, RECOVERY_TOOLS_TEXT);
	// While searching, a matching row brings its parent switch and the rows that depend on it (and a matching
	// dependent row brings its parent and siblings), so a setting is never shown without what controls it.
	const withFamilies = (all: SettingField[], matched: SettingField[]) => {
		if (!searching || matched.length === 0) {
			return matched;
		}

		const parentOf = (field: SettingField) => field.requires ?? field.parent;
		const roots = new Set(
			matched.map((field) => parentOf(field) ?? field.name),
		);
		const family = all.filter(
			(field) => roots.has(field.name) || roots.has(parentOf(field)!),
		);
		const seen = new Set<SettingField>();
		const result: SettingField[] = [];
		// Keep the ranking of the best match in each family, with the family in page order.
		for (const field of matched) {
			const root = parentOf(field) ?? field.name;
			for (const member of family) {
				if (
					seen.has(member) ||
					!(member.name === root || parentOf(member) === root)
				) {
					continue;
				}

				seen.add(member);
				result.push(member);
			}
		}

		return result;
	};

	const visibleGroups = settingsGroups
		.map((group) => {
			const shown = group.fields.filter((field) => fieldShown(field));
			return {
				group,
				fields: withFamilies(shown, pick(group.title, shown, fieldSearchText)),
			};
		})
		.filter(
			(entry) =>
				entry.fields.length ||
				(entry.group.title === RECOVERY_TITLE && recoveryTools),
		)
		.map((entry, index) => ({...entry, index}))
		.toSorted((a, b) =>
			searching
				? groupScore(b.group.title, b.fields) -
						groupScore(a.group.title, a.fields) || a.index - b.index
				: a.index - b.index,
		);

	const dataRows: DataRowDef[] = [
		{
			key: 'backup',
			icon: Download,
			label: 'Back up',
			help: 'Save everything, or only bookmarks or sessions, to a file.',
			words: [
				'backup',
				'export',
				'download',
				'save',
				'file',
				'bookmarks',
				'sessions',
			],
			action: (
				<Button
					variant="outline"
					className="w-full sm:w-32"
					// Opens on Everything, which also holds settings, so it is never empty.
					onClick={() =>
						setBackupData(
							bookmarkCount > 0
								? {
										kind: 'bookmarks',
										columns: state.bookmarkColumns,
										bookmarks: state.bookmarks,
									}
								: {
										kind: 'sessions',
										groups: state.groups,
										folders: state.folders,
									},
						)
					}
				>
					<Download className="h-4 w-4" />
					Back up
				</Button>
			),
		},
		{
			key: 'import',
			icon: Upload,
			label: 'Import',
			help: 'Restore a full backup, or bring in bookmarks or sessions from a file or your browser.',
			words: [
				'restore',
				'load',
				'OneTab',
				'Session Buddy',
				'Toby',
				'CSV',
				'HTML',
				'JSON',
				'browser bookmarks',
			],
			action: (
				<Button
					variant="outline"
					className="w-full sm:w-32"
					onClick={() => setImportOpen(true)}
				>
					<Upload className="h-4 w-4" />
					Import
				</Button>
			),
		},
		{
			key: 'erase',
			icon: Eraser,
			label: 'Erase',
			help: 'Delete saved sessions, bookmarks, or both. Settings are kept.',
			words: ['delete', 'remove', 'clear', 'wipe', 'reset data', 'everything'],
			action: (
				<Button
					variant="outline"
					className="w-full border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-32"
					disabled={
						eraseBusy ||
						(sessionParts.length === 0 && bookmarkParts.length === 0)
					}
					onClick={() => {
						setEraseSessions(false);
						setEraseBookmarks(false);
						setEraseOpen(true);
					}}
				>
					<Eraser className="h-4 w-4" />
					Erase
				</Button>
			),
		},
	];
	const visibleData = pick(DATA.title, dataRows, (row) => [
		row.label,
		row.help,
		...row.words,
	]);
	const showExcluded = matchesQuery(query, [
		EXCLUDED.title,
		EXCLUDED.description,
		...EXCLUDED.words,
		...excluded,
	]);
	const showDefaults = matchesQuery(query, [
		DEFAULTS.title,
		DEFAULTS.help,
		...DEFAULTS.words,
	]);
	const showPrivate = matchesQuery(query, [
		PRIVATE_STORAGE_TITLE,
		...PRIVATE_STORAGE_WORDS,
	]);
	const matchCount =
		Number(showPrivate) +
		Number(showAppearance) +
		Number(showShortcuts) +
		visibleGroups.reduce((sum, entry) => sum + entry.fields.length, 0) +
		(searching &&
		recoveryTools &&
		visibleGroups.some((entry) => entry.fields.length === 0)
			? 1
			: 0) +
		visibleData.length +
		Number(showExcluded) +
		Number(showDefaults);
	const visibleGroupTitles = new Set(
		visibleGroups.map(({group}) => group.title),
	);
	const visibleSettingsNavigation = searching
		? settingsNavigation.filter(({title}) => {
				switch (title) {
					case PRIVATE_STORAGE_TITLE: {
						return showPrivate;
					}

					case APPEARANCE.title: {
						return showAppearance;
					}

					case SHORTCUTS.title: {
						return showShortcuts;
					}

					case DATA.title: {
						return visibleData.length > 0;
					}

					case EXCLUDED.title: {
						return showExcluded;
					}

					case DEFAULTS.title: {
						return showDefaults;
					}

					default: {
						return visibleGroupTitles.has(title);
					}
				}
			})
		: settingsNavigation;
	const dataRowElements = visibleData.map((row) => (
		<DataRow
			key={row.key}
			icon={row.icon}
			label={hl(row.label)}
			help={hl(row.help)}
		>
			{row.action}
		</DataRow>
	));

	return (
		<PageShell className="max-w-6xl lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-x-8">
			<div className="lg:col-span-2">
				<PageTop />
			</div>
			<h2 className="mb-3 hidden text-sm font-semibold lg:col-start-1 lg:row-start-2 lg:-mt-3 lg:block">
				Browse settings
			</h2>
			<div role="search" className="relative -mt-3 mb-6 lg:col-start-2">
				<Search
					className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					ref={searchRef}
					type="search"
					aria-label="Search settings"
					placeholder="Search settings"
					value={query}
					autoComplete="off"
					spellCheck={false}
					className="h-10 w-full pl-9 pr-16 [&::-webkit-search-cancel-button]:hidden"
					onChange={(event) => updateQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== 'Escape') {
							return;
						}

						event.preventDefault();
						if (query) {
							updateQuery('');
						} else {
							event.currentTarget.blur();
						}
					}}
				/>
				{query ? (
					<button
						type="button"
						aria-label="Clear search"
						className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => {
							updateQuery('');
							searchRef.current?.focus();
						}}
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</button>
				) : (
					<span
						className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 text-[11px] text-muted-foreground sm:flex"
						aria-hidden="true"
					>
						<kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans">
							/
						</kbd>
					</span>
				)}
			</div>
			<aside className="-mx-1 mb-4 self-start lg:sticky lg:top-5 lg:-mt-8 lg:row-start-3 lg:col-start-1 lg:mx-0 lg:mb-0 lg:w-[190px] lg:max-h-[calc(100vh-2.5rem)] lg:overflow-y-auto">
				<nav
					aria-label="Settings categories"
					className="flex flex-wrap gap-1.5 lg:flex-col lg:items-stretch"
				>
					{visibleSettingsNavigation.map(({icon: Icon, label, id}) => (
						<a
							key={id}
							href={`#${id}`}
							aria-current={activeSection === id ? 'location' : undefined}
							className={cn(
								'inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
								activeSection === id
									? 'bg-primary/10 font-medium text-primary'
									: 'text-muted-foreground hover:bg-muted hover:text-foreground',
							)}
							onClick={(event) => {
								if (!searching) {
									return;
								}

								event.preventDefault();
								updateQuery('');
								requestAnimationFrame(() => {
									document.querySelector(`#${id}`)?.scrollIntoView();
									history.replaceState(
										null,
										'',
										`${location.pathname}${location.search}#${id}`,
									);
								});
							}}
						>
							<Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
							{label}
						</a>
					))}
				</nav>
			</aside>
			<p className="sr-only" role="status" aria-live="polite">
				{searching
					? matchCount
						? `${plural(matchCount, 'setting')} found.`
						: 'No settings found.'
					: ''}
			</p>

			{searching && !matchCount ? (
				<div className="lg:col-start-2 lg:row-start-3">
					<EmptyState
						icon={Search}
						title={`No settings match “${query.trim()}”`}
						action={
							<Button
								variant="outline"
								onClick={() => {
									updateQuery('');
									searchRef.current?.focus();
								}}
							>
								Clear search
							</Button>
						}
					>
						Try a different word, such as “tabs”, “restore”, or “back up”.
					</EmptyState>
				</div>
			) : (
				<div className="grid gap-5 lg:col-start-2 lg:row-start-3">
					{showAppearance && (
						<section
							id={sectionId(APPEARANCE.title)}
							className={cn(
								SECTION_SCROLL_CLASS,
								'flex flex-col gap-4 rounded-lg border border-border bg-card p-5',
							)}
						>
							<div>
								<h2 className="font-semibold">{hl(APPEARANCE.title)}</h2>
								<p className="mt-1 text-sm text-muted-foreground">
									{hl(APPEARANCE.help)}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-3">
								<div
									className="flex flex-wrap gap-2"
									role="radiogroup"
									aria-label="Appearance"
									onKeyDown={(event) => {
										const buttons = [
											...event.currentTarget.querySelectorAll<HTMLButtonElement>(
												'[role="radio"]',
											),
										];
										const next = radioTargetIndex(
											event.key,
											buttons.indexOf(
												document.activeElement as HTMLButtonElement,
											),
											buttons.length,
										);
										if (next === null) {
											return;
										}

										// Arrow keys select as they move, as native radio buttons do.
										event.preventDefault();
										buttons[next].focus();
										buttons[next].click();
									}}
								>
									{APPEARANCE_CHOICES.map(([value, Icon, label]) => (
										<Button
											key={value}
											type="button"
											variant={theme === value ? 'default' : 'outline'}
											size="sm"
											role="radio"
											aria-checked={theme === value}
											tabIndex={theme === value ? 0 : -1}
											onClick={async () => {
												try {
													await setTheme(value);
													showStatus('Appearance saved.');
												} catch {
													showStatus(
														'Could not save the appearance choice.',
														true,
													);
												}
											}}
										>
											<Icon className="h-4 w-4" />
											{label}
										</Button>
									))}
								</div>
								<AccentPalette
									accent={accent}
									systemColor={systemColor}
									onChange={async (next) => {
										try {
											await setAccent(next);
											if (!next.startsWith('#')) {
												showStatus('Accent color saved.');
											}
										} catch {
											showStatus('Could not save the accent color.', true);
										}
									}}
								/>
							</div>
						</section>
					)}
					{showShortcuts && (
						<ShortcutsCard
							id={sectionId(SHORTCUTS.title)}
							title={hl(SHORTCUTS.title)}
							help={hl(SHORTCUTS.help)}
						/>
					)}

					{showPrivate && (
						<SectionCard
							id={sectionId(PRIVATE_STORAGE_TITLE)}
							title={PRIVATE_STORAGE_TITLE}
							description="Choose whether private windows share your normal library or use their own. This choice applies to all private windows."
							icon={Database}
							className={SECTION_SCROLL_CLASS}
						>
							<PrivateStorageSettings showStatus={showStatus} />
						</SectionCard>
					)}
					{visibleGroups.map(({group, fields}) => (
						<SectionCard
							key={group.title}
							id={sectionId(group.title)}
							title={hl(group.title)}
							description={group.description}
							icon={group.icon}
							className={SECTION_SCROLL_CLASS}
						>
							<div className="divide-y divide-border/70">
								{fields.map((field) => (
									<SettingRow
										key={field.name}
										settingName={field.name}
										hasReset={changedFromDefault(field)}
										label={hl(field.label)}
										help={
											field.name === 'sessionNameStyle' ? (
												<>
													{hl(field.help)}
													<SessionNamePreview
														style={settings.sessionNameStyle ?? 'date-title'}
														fallback={
															settings.sessionNameFallback ?? 'date-title'
														}
														template={
															templateDraft ?? settings.sessionNameTemplate
														}
													/>
												</>
											) : (
												hl(field.help)
											)
										}
										hint={
											searching &&
											(field.type === 'select' ||
												field.type === 'number-select') &&
											!matchesQuery(query, [field.label, field.help])
												? field.options
														.map(([, label]) => label)
														.filter((label) => matchesAnyTerm(query, label))
												: undefined
										}
										inset={Boolean(
											field.requires ||
											field.enabled ||
											field.parent ||
											field.when,
										)}
										highlight={query}
									>
										{changedFromDefault(field) && defaultSettings && (
											<IconTooltip label={`Reset ${field.label} to default`}>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="h-8 w-8 shrink-0"
													aria-label={`Reset ${field.label} to default`}
													onClick={() => {
														focusSettingControl(field);
														void updateSetting(
															field.name,
															defaultSettings[field.name],
															`Restored ${field.label} to its default.`,
														);
													}}
												>
													<RotateCcw className="h-4 w-4" aria-hidden="true" />
												</Button>
											</IconTooltip>
										)}
										{field.type === 'switch' ? (
											<Switch
												checked={
													field.name === 'stretchBookmarkColumns'
														? settings.stretchBookmarkColumns !== false
														: field.name === 'autoBackupToDownloads'
															? Boolean(settings.autoBackupToDownloads) &&
																downloadsGranted
															: Boolean(settings[field.name])
												}
												aria-label={field.label}
												disabled={rowDisabled(field)}
												onCheckedChange={(value) =>
													updateSetting(field.name, value)
												}
											/>
										) : field.type === 'url' ? (
											<UrlSetting
												label={field.label}
												disabled={rowDisabled(field)}
												placeholder={field.placeholder}
												value={settings[field.name] ?? ''}
												onCommit={(value) => updateSetting(field.name, value)}
												onInvalid={() =>
													showStatus(
														'Enter a web address that starts with http:// or https://.',
														true,
													)
												}
											/>
										) : field.type === 'text' ? (
											<TextSetting
												label={field.label}
												disabled={rowDisabled(field)}
												placeholder={field.placeholder}
												value={settings[field.name] ?? ''}
												onDraft={setTemplateDraft}
												onCommit={(value) => {
													setTemplateDraft(null);
													return updateSetting(field.name, value);
												}}
											/>
										) : field.type === 'number' ? (
											<NumberSetting
												label={field.label}
												value={settings[field.name] ?? field.min}
												min={field.min}
												max={field.max}
												suffix={field.suffix}
												disabled={rowDisabled(field)}
												onCommit={(value) => updateSetting(field.name, value)}
											/>
										) : field.type === 'column' ? (
											<ColumnSelect
												columns={state?.bookmarkColumns ?? []}
												value={
													state?.bookmarkColumns.some(
														(column) => column.id === settings[field.name],
													)
														? settings[field.name]
														: (state?.bookmarkColumns[0]?.id ?? '')
												}
												disabled={rowDisabled(field)}
												className="w-full sm:w-64"
												aria-label={field.label}
												onValueChange={(value) =>
													updateSetting(field.name, value)
												}
											/>
										) : field.type === 'number-select' ? (
											<Select
												value={String(
													settings[field.name] ?? field.options[0][0],
												)}
												disabled={rowDisabled(field)}
												onValueChange={(value) =>
													updateSetting(field.name, Number(value))
												}
											>
												<SelectTrigger
													className="w-full sm:w-64"
													aria-label={field.label}
												>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{field.options.map(([value, label]) => (
														<SelectItem key={value} value={value}>
															{label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										) : (
											<Select
												value={settings[field.name] || field.options[0][0]}
												disabled={rowDisabled(field)}
												onValueChange={(value) =>
													updateSetting(field.name, value)
												}
											>
												<SelectTrigger
													className="w-full sm:w-64"
													aria-label={field.label}
												>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{field.options.map(([value, label]) => (
														<SelectItem key={value} value={value}>
															{label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										)}
									</SettingRow>
								))}
							</div>
							{group.title === RECOVERY_TITLE && recoveryTools && (
								<RecoveryTools
									showStatus={showStatus}
									onDataChanged={reload}
									onOpenSnapshots={() => setSnapshotsOpen(true)}
									onOpenTrash={() => setTrashOpen(true)}
								/>
							)}
						</SectionCard>
					))}

					{visibleData.length > 0 && (
						<SectionCard
							id={sectionId(DATA.title)}
							title={hl(DATA.title)}
							description={DATA.description}
							icon={Database}
							className={SECTION_SCROLL_CLASS}
						>
							<div
								ref={dataRef}
								tabIndex={-1}
								className="focus-visible:outline-none"
								aria-label="Session and bookmark data"
							>
								<div className="divide-y divide-border/70">
									{dataRowElements}
								</div>
							</div>
						</SectionCard>
					)}

					{showExcluded && (
						<SectionCard
							id={sectionId(EXCLUDED.title)}
							title={hl(EXCLUDED.title)}
							description={EXCLUDED.description}
							icon={Globe}
							className={SECTION_SCROLL_CLASS}
							action={
								<Button variant="outline" size="sm" onClick={openSiteDialog}>
									<Plus className="h-4 w-4" />
									Add site
								</Button>
							}
						>
							{excluded.length > 0 ? (
								<div className="space-y-2">
									{excluded.map((origin) => (
										<div
											key={origin}
											className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
										>
											<span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
												<code className="min-w-0 truncate text-xs">
													{origin}
												</code>
												<span className="text-xs text-muted-foreground">
													Includes subdomains
												</span>
											</span>
											<Button
												variant="ghost"
												size="sm"
												aria-label={`Remove ${origin} from exclusions`}
												onClick={() => removeExcludedOrigin(origin)}
											>
												<Trash2 className="h-4 w-4" />
												Remove
											</Button>
										</div>
									))}
								</div>
							) : (
								<p className="rounded-md bg-muted px-3 py-3 text-sm text-muted-foreground">
									No websites are excluded.
								</p>
							)}
						</SectionCard>
					)}

					{showDefaults && (
						<div
							id={sectionId(DEFAULTS.title)}
							className={cn(
								SECTION_SCROLL_CLASS,
								'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-4',
							)}
						>
							<div>
								<p className="text-sm font-semibold">{hl(DEFAULTS.title)}</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{hl(DEFAULTS.help)}
								</p>
							</div>
							<Button
								variant="outline"
								disabled={busy === 'defaults'}
								onClick={() => setConfirmDefaults(true)}
							>
								<RotateCcw className="h-4 w-4" />
								{busy === 'defaults' ? 'Restoring' : 'Restore defaults'}
							</Button>
						</div>
					)}
				</div>
			)}
			<ConfirmationDialog
				open={confirmDefaults}
				title="Restore default preferences?"
				description="Your preferences go back to their defaults. Sessions and bookmarks are kept, and you can undo this right after."
				confirmLabel="Restore defaults"
				busy={resetBusy}
				onOpenChange={setConfirmDefaults}
				onConfirm={() => {
					setConfirmDefaults(false);
					void restoreDefaults();
				}}
			/>
			<ConfirmationDialog
				open={eraseOpen}
				title="Erase data"
				description="Choose what to erase. A safety backup is kept, and you can undo this right after. Settings are kept."
				confirmLabel="Erase"
				confirmDisabled={!eraseSessions && !eraseBookmarks}
				busy={eraseBusy}
				onOpenChange={setEraseOpen}
				onConfirm={() => {
					setEraseOpen(false);
					void eraseData(
						eraseSessions && eraseBookmarks
							? 'all'
							: eraseSessions
								? 'sessions'
								: 'bookmarks',
					);
				}}
			>
				<div className="grid gap-3 text-sm">
					<Label className="flex items-start gap-2.5 font-normal">
						<Checkbox
							className="mt-0.5"
							checked={eraseSessions}
							disabled={sessionParts.length === 0}
							onCheckedChange={(checked) => setEraseSessions(checked === true)}
						/>
						<span>
							Sessions and folders
							<span className="block text-xs text-muted-foreground">
								{sessionParts.length > 0 ? listing(sessionParts) : 'None saved'}
							</span>
						</span>
					</Label>
					<Label className="flex items-start gap-2.5 font-normal">
						<Checkbox
							className="mt-0.5"
							checked={eraseBookmarks}
							disabled={bookmarkParts.length === 0}
							onCheckedChange={(checked) => setEraseBookmarks(checked === true)}
						/>
						<span>
							Bookmarks and columns
							<span className="block text-xs text-muted-foreground">
								{bookmarkParts.length > 0
									? listing(bookmarkParts)
									: 'None saved'}
							</span>
						</span>
					</Label>
				</div>
			</ConfirmationDialog>
			<BackupDialog
				initialScope="everything"
				state={state}
				data={backupData}
				open={Boolean(backupData)}
				showStatus={showStatus}
				onOpenChange={(open) => !open && setBackupData(null)}
			/>
			<SnapshotsDialog
				confirmDestructive
				open={snapshotsOpen}
				showStatus={showStatus}
				onOpenChange={setSnapshotsOpen}
				onSessionsChanged={reload}
			/>
			<TrashDialog
				confirmDestructive
				open={trashOpen}
				showStatus={showStatus}
				onOpenChange={setTrashOpen}
				onChanged={reload}
			/>
			<ImportDialog
				initialScope="everything"
				open={importOpen}
				initialKind="bookmarks"
				state={state}
				showStatus={showStatus}
				onOpenChange={setImportOpen}
				onImported={() => void reload()}
			/>
			<Dialog open={siteDialog} onOpenChange={setSiteDialog}>
				<DialogContent
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						(siteTextRef.current ?? siteInputRef.current)?.focus();
					}}
				>
					<form noValidate onSubmit={addExcludedOrigin}>
						<DialogHeader>
							<DialogTitle>Exclude a website</DialogTitle>
							<DialogDescription>
								Excludes this domain and all its subdomains, e.g. google.com
								also covers mail.google.com.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<div className="flex items-center justify-between gap-3">
								<Label htmlFor="excluded-bulk">Bulk add</Label>
								<Switch
									id="excluded-bulk"
									checked={bulkMode}
									onCheckedChange={(checked) => {
										setBulkMode(checked);
										setSiteError('');
									}}
								/>
							</div>
							{bulkMode ? (
								<div className="space-y-1.5">
									<Label htmlFor="excluded-origin">Websites</Label>
									<Textarea
										ref={siteTextRef}
										id="excluded-origin"
										rows={8}
										value={excludedDraft}
										placeholder={
											'One website per line, e.g.\nexample.com\nhttps://news.site.org'
										}
										spellCheck={false}
										className="font-mono text-xs"
										aria-describedby="excluded-origin-message"
										onChange={(event) => {
											setExcludedDraft(event.target.value);
											setSiteError('');
										}}
									/>
									<p
										id="excluded-origin-message"
										className={cn(
											'min-h-5 text-xs leading-5',
											siteError
												? 'font-medium text-destructive'
												: 'text-muted-foreground',
										)}
										aria-live="polite"
									>
										{siteError ||
											[
												plural(bulk.valid.length, 'website') +
													' will be excluded',
												bulk.duplicates.length > 0
													? `${bulk.duplicates.length} already excluded`
													: '',
												bulk.invalid.length > 0
													? `${plural(bulk.invalid.length, 'invalid line')} ignored`
													: '',
											]
												.filter(Boolean)
												.join(' · ')}
									</p>
									{bulk.invalid.length > 0 && (
										<div className="text-xs text-muted-foreground">
											<button
												type="button"
												className="underline underline-offset-2"
												aria-expanded={showInvalid}
												onClick={() => setShowInvalid((shown) => !shown)}
											>
												{showInvalid ? 'Hide' : 'Show'} ignored lines
											</button>
											{showInvalid && (
												<ul className="mt-1 max-h-20 overflow-auto font-mono [overflow-wrap:anywhere]">
													{bulk.invalid.map((line, index) => (
														<li key={`${index}-${line}`}>{line}</li>
													))}
												</ul>
											)}
										</div>
									)}
								</div>
							) : (
								<div className="space-y-1.5">
									<Label htmlFor="excluded-origin">Website</Label>
									<Input
										ref={siteInputRef}
										id="excluded-origin"
										value={excludedDraft}
										placeholder="example.com"
										autoComplete="url"
										inputMode="url"
										spellCheck={false}
										aria-invalid={Boolean(siteFieldError)}
										aria-describedby="excluded-origin-message"
										className="aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive"
										onChange={(event) => {
											setExcludedDraft(event.target.value);
											setSiteError('');
										}}
									/>
									<p
										id="excluded-origin-message"
										className={cn(
											'min-h-5 text-xs leading-5',
											siteFieldError
												? 'font-medium text-destructive'
												: 'text-muted-foreground',
										)}
										aria-live="polite"
									>
										{siteFieldError ||
											(siteHost
												? `Will exclude ${siteHost} and its subdomains`
												: 'Paths, ports and www. are ignored.')}
									</p>
								</div>
							)}
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setSiteDialog(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={!siteValid || siteBusy}>
								<Plus className="h-4 w-4" />
								{siteBusy
									? 'Adding'
									: bulkMode
										? `Add ${plural(bulk.valid.length, 'website')}`
										: 'Add site'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<StatusLine status={status} />
			<footer className="mt-6 border-t border-border pt-4 text-xs leading-5 text-muted-foreground lg:col-start-2">
				<p>
					{PROJECT.name} reads tab details only to save sessions and check for
					duplicates. It never reads page contents. Sessions are stored in this
					browser’s local extension storage.
				</p>
				<nav
					aria-label={`About ${PROJECT.name}`}
					className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1"
				>
					<span>
						{PROJECT.name} v{PROJECT.version}
					</span>
					{footerLinks.map(({label, href, external}) => (
						<Fragment key={label}>
							<span aria-hidden="true">·</span>
							<a
								href={href}
								target={external ? '_blank' : undefined}
								rel={external ? 'noopener noreferrer' : undefined}
								className="rounded-sm font-medium hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								{label}
							</a>
						</Fragment>
					))}
				</nav>
			</footer>
		</PageShell>
	);
}

const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

/**
The current shortcut for each command (read with chrome.commands), and a button to the browser's page that changes them.
*/
function ShortcutsCard({
	id,
	title,
	help,
}: {
	id: string;
	title: ReactNode;
	help: ReactNode;
}) {
	const [commands, setCommands] = useState<chrome.commands.Command[]>([]);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let alive = true;
		const read = () => {
			void chrome.commands
				?.getAll?.()
				.then((all) => {
					if (alive) {
						setCommands(all.filter((command) => command.description));
					}
				})
				.catch(() => {});
		};

		read();
		// Shortcuts are changed on another page; pick up the change when the user comes back.
		globalThis.addEventListener('focus', read);
		return () => {
			alive = false;
			globalThis.removeEventListener('focus', read);
		};
	}, []);

	return (
		<section
			id={id}
			className={cn(
				SECTION_SCROLL_CLASS,
				'rounded-lg border border-border bg-card p-5',
			)}
		>
			<div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
				<div>
					<h2 className="font-semibold">{title}</h2>
					<p className="mt-1 text-sm text-muted-foreground">{help}</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="shrink-0"
					onClick={async () => setFailed(!(await openShortcutsPage()))}
				>
					<Keyboard className="h-4 w-4" />
					Configure shortcuts
				</Button>
			</div>
			{failed && (
				<p role="alert" className="mt-2 text-xs text-muted-foreground">
					Your browser did not open it. Paste <code>{SHORTCUTS_URL}</code> into
					the address bar.
				</p>
			)}
			{commands.length > 0 && (
				<dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
					{commands.map((command) => (
						<div
							key={command.name}
							className="flex min-w-0 items-center justify-between gap-3"
						>
							<dt className="min-w-0 truncate text-muted-foreground">
								{command.description}
							</dt>
							<dd className="shrink-0">
								{command.shortcut ? (
									<kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
										{command.shortcut}
									</kbd>
								) : (
									<span className="text-xs text-muted-foreground">Not set</span>
								)}
							</dd>
						</div>
					))}
				</dl>
			)}
		</section>
	);
}

function SettingRow({
	label,
	help,
	hint,
	highlight = '',
	inset,
	settingName,
	hasReset = false,
	children,
}: {
	label: ReactNode;
	help?: ReactNode;
	/** Select options that matched the search while the label and help did not. */ hint?: string[];
	highlight?: string;
	inset?: boolean;
	settingName: string;
	hasReset?: boolean;
	children?: ReactNode;
}) {
	return (
		<div
			data-setting-row={settingName}
			// A setting that depends on the one above sits on a line hanging from it.
			className={cn(
				'flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between',
				inset && 'ml-2 border-l-2 border-primary/50 pl-4',
			)}
		>
			<div className="min-w-0">
				<p className="text-sm font-medium">{label}</p>
				{Boolean(help) && (
					<p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
						{help}
					</p>
				)}
				{hint && hint.length > 0 && (
					<p className="mt-1 text-xs leading-5 text-muted-foreground">
						Option:{' '}
						{hint.map((option, index) => (
							<Fragment key={option}>
								{index > 0 && ', '}
								<Highlight text={option} query={highlight} />
							</Fragment>
						))}
					</p>
				)}
			</div>
			<div
				className={cn(
					'shrink-0',
					hasReset && 'flex flex-wrap items-center justify-end gap-2',
				)}
			>
				{children}
			</div>
		</div>
	);
}

// A web address input that saves on blur or Enter; an address that is not http or https is reported instead of saved.
function UrlSetting({
	label,
	placeholder,
	value,
	onCommit,
	onInvalid,
	disabled = false,
}: {
	label: string;
	placeholder: string;
	value: string;
	onCommit: (value: string) => void;
	onInvalid: () => void;
	disabled?: boolean;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	function commit() {
		const text = draft.trim();
		if (text === value) {
			return;
		}

		if (text && !/^https?:\/\/[^\s/]+/i.test(text)) {
			onInvalid();
			return;
		}

		onCommit(text);
	}

	return (
		<Input
			disabled={disabled}
			type="url"
			inputMode="url"
			value={draft}
			placeholder={placeholder}
			aria-label={label}
			className="h-9 w-full sm:w-64"
			onChange={(event) => setDraft(event.target.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === 'Enter') {
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

// A short text input that saves on blur or Enter.
function TextSetting({
	label,
	placeholder,
	value,
	onCommit,
	onDraft,
	disabled = false,
}: {
	label: string;
	placeholder: string;
	value: string;
	onCommit: (value: string) => void;
	/**
	Called with the text while typing, before it is saved.
	*/
	onDraft?: (value: string) => void;
	disabled?: boolean;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	function commit() {
		if (draft.trim() !== value) {
			onCommit(draft.trim());
		}
	}

	return (
		<Input
			disabled={disabled}
			value={draft}
			placeholder={placeholder}
			aria-label={label}
			maxLength={200}
			className="h-9 w-full sm:w-64"
			onChange={(event) => {
				setDraft(event.target.value);
				onDraft?.(event.target.value);
			}}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === 'Enter') {
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

// "Next save: ..." line under the Session name setting; the service worker formats it with the current window's tabs.
function SessionNamePreview({
	style,
	fallback,
	template,
}: {
	style: Settings['sessionNameStyle'];
	fallback: Settings['sessionNameFallback'];
	template: string | undefined;
}) {
	const [name, setName] = useState('');
	const [asks, setAsks] = useState(false);
	useEffect(() => {
		let current = true;
		const timer = setTimeout(async () => {
			const result = await send('PREVIEW_SESSION_NAME', {
				style,
				fallback,
				template,
			});
			if (!current || !result?.ok) {
				return;
			}

			setName(result.name);
			setAsks(result.asks);
		}, 250);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [style, fallback, template]);

	return name ? (
		<span className="mt-1 block text-foreground">
			{asks ? 'Asked each time; left empty: ' : 'Next save: '}
			<span className="font-medium">{name}</span>
		</span>
	) : null;
}

// A small whole-number input that saves on blur or Enter; the text may be empty or out of range while typing.
function NumberSetting({
	label,
	value,
	min,
	max,
	suffix,
	disabled,
	onCommit,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	suffix: string;
	disabled: boolean;
	onCommit: (value: number) => void;
}) {
	const [draft, setDraft] = useState(String(value));
	useEffect(() => setDraft(String(value)), [value]);
	function commit() {
		const parsed = Math.trunc(Number(draft));
		const next = Number.isFinite(parsed)
			? Math.min(max, Math.max(min, parsed))
			: value;
		setDraft(String(next));
		if (next !== value) {
			onCommit(next);
		}
	}

	return (
		<div className="flex items-center gap-2 text-sm">
			<Input
				type="number"
				inputMode="numeric"
				min={min}
				max={max}
				value={draft}
				disabled={disabled}
				aria-label={label}
				className="h-9 w-20"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key !== 'Enter') {
						return;
					}

					event.preventDefault();
					commit();
				}}
			/>
			<span className="text-muted-foreground">{suffix}</span>
		</div>
	);
}

function DataRow({
	icon: Icon,
	label,
	help,
	children,
}: {
	icon: IconComponent;
	label: ReactNode;
	help: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 items-start gap-3">
				<Icon
					className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<div className="min-w-0">
					<p className="text-sm font-medium">{label}</p>
					<p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
						{help}
					</p>
				</div>
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

const APPEARANCE_CHOICES = [
	['system', Laptop, 'System'],
	['light', Sun, 'Light'],
	['dark', Moon, 'Dark'],
] as const;

function PageTop() {
	return <AppHeader active="settings" />;
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<TooltipProvider>
			<Options />
		</TooltipProvider>
	</ThemeProvider>,
);
