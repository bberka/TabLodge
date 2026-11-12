import {useState, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {
	Code,
	ArrowUpRight,
	BookOpen,
	Bookmark,
	Bug,
	Check,
	CircleHelp,
	Database,
	ExternalLink,
	Globe,
	Keyboard,
	Layers2,
	LifeBuoy,
	Link2,
	MoreHorizontal,
	MousePointer2,
	MousePointerClick,
	RotateCcw,
	Scale,
	Search,
	Settings2,
	Tag,
	X,
} from 'lucide-react';
import {Badge, Button, Input, TooltipProvider} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider} from '../shared/theme';
import {SHORTCUTS_HINT, isFirefox, openShortcutsPage} from '../shared/browser';
import {PrivateWindowAppearance} from './private-window-appearance';
import {AppHeader, type IconComponent} from './common';
import {PROJECT} from './project';

const SHORTCUTS_URL = 'chrome://extensions/shortcuts';
const normalizeSearchText = (value: string) =>
	value
		.toLocaleLowerCase()
		.replaceAll(/[^0-9a-z]+/g, ' ')
		.trim();

type GuideEntry = {
	title: string;
	body: ReactNode;
	searchText: string;
	gesture?: {
		label: string;
		icon: IconComponent;
	};
};

type GuideAction = {
	label: string;
	href: string;
	icon?: IconComponent;
};

type GuideSection = {
	id: string;
	title: string;
	icon: IconComponent;
	intro: string;
	keywords: string[];
	entries: GuideEntry[];
	action?: GuideAction;
};

function GestureBadge({
	label,
	icon: Icon,
}: {
	label: string;
	icon: IconComponent;
}) {
	return (
		<Badge variant="accent" className="gap-1.5 whitespace-nowrap">
			<Icon className="h-3.5 w-3.5" aria-hidden="true" />
			{label}
		</Badge>
	);
}

function MenuLocation({label}: {label: string}) {
	return (
		<Badge
			variant="outline"
			className="mx-0.5 inline-flex align-middle gap-1 whitespace-nowrap"
		>
			{label}
			<MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
			<span>menu</span>
		</Badge>
	);
}

function Key({children}: {children: ReactNode}) {
	return (
		<kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-medium text-foreground">
			{children}
		</kbd>
	);
}

function Help() {
	const [shortcutsFailed, setShortcutsFailed] = useState(false);
	const [query, setQuery] = useState('');
	const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
	const hasTerms = (value: string) => {
		const normalized = normalizeSearchText(value);
		return terms.every((term) => normalized.includes(term));
	};

	const sections: GuideSection[] = [
		{
			id: 'quick-actions',
			title: 'Quick actions',
			icon: MousePointer2,
			intro:
				'Save a few tabs from the toolbar, or open the full dashboard to manage everything.',
			keywords: [
				'toolbar icon',
				'popup',
				'side panel',
				'save window',
				'action button',
			],
			entries: [
				{
					title: 'Toolbar button',
					body: `By default, the ${PROJECT.name} button opens a compact popup. Choose tabs and a session title there, or select Open Dashboard to open the full page.`,
					searchText:
						'default compact popup choose tabs session title open dashboard full page toolbar button',
				},
				{
					title: 'Change what the button does',
					body: 'In Settings, assign it to save selected tabs, the whole window, a tab group, the active tab, all windows, or to add the active tab to your first session. You can also choose whether to open the saved session afterward.',
					searchText:
						'settings toolbar button action selected tabs window group active tab all windows first session open after saving',
				},
				{
					title: 'Use the side panel',
					body: 'In Chromium browsers, choose Open the side panel in Settings under Toolbar button action. In every browser you can open it from the popup, the toolbar button’s right-click menu, the browser’s sidebar menu, or a keyboard shortcut. The side panel keeps your session list beside the page you are viewing. Its header has icons for the dashboard, recent snapshots, trash bin, and Settings. The TabLodge title and dashboard icon open the dashboard in a new tab.',
					searchText:
						'side panel sidebar session list beside page toolbar icon settings keyboard shortcut',
				},
				{
					title: 'Close duplicate tabs',
					body: 'Use Close duplicate tabs in the popup or at the top of the side panel Tabs section to close extra copies of the same page. Two tabs are duplicates when their web addresses match exactly, so a different query or fragment counts as a different page. It checks the tabs in all your normal windows. The most recently used copy stays open. Pinned tabs and the tab you are viewing in each window are never closed, and when one of them has duplicates, the other copies are closed. A toast offers Undo, which reopens the tabs in their window and position. Reopened tabs load fresh, so they lose scroll position and form data.',
					searchText:
						'close duplicate tabs remove extra copies same page address url pinned active most recently used all windows undo reopen popup side panel',
				},
			],
			action: {label: 'Open Settings', href: 'options.html', icon: Settings2},
		},
		{
			id: 'saving-sessions',
			title: 'Saving sessions',
			icon: Layers2,
			intro:
				'Save a set of tabs to come back to later. Nothing closes unless you turn on close after saving.',
			keywords: [
				'save tabs',
				'selected tabs',
				'pinned tabs',
				'tab groups',
				'session names',
			],
			entries: [
				{
					title: 'Save the tabs you want',
					body: 'Save from the popup, side panel, a keyboard shortcut, or a right-click menu. The save shortcut uses your selected tabs, or the whole window when no tabs are selected. Choose tabs and title in the popup starts with your selected tabs checked.',
					searchText:
						'popup side panel keyboard shortcut right-click menu selected tabs whole window choose tabs and title',
				},
				{
					title: 'What a session keeps',
					body: 'Each saved tab keeps its title, address, and notes. Tab groups are kept unless Ignore tab groups is on. Pinned tabs are skipped by default; turn on Include pinned tabs to save and restore them.',
					searchText:
						'title address url notes tab groups ignore groups pinned tabs include pinned tabs default',
				},
				{
					title: 'Select tabs and bookmark them together',
					body: 'Use the checkbox on a session card to select all its links, or select links one at a time. Ctrl or Command clicks, Shift clicks, and Alt-clicking a saved link also select tabs. The selection bar keeps Open, Bookmark, Export, and Share actions inline. Drag selected tabs to a bookmark column to add them together.',
					searchText:
						'select multiple saved tabs checkbox ctrl command shift alt click open export share bookmark selected drag bookmark column',
				},
				{
					title: 'Name a session',
					body: 'Choose a naming style in Settings. Ask each time prompts in the popup, dashboard, or side panel before saving. A direct-save toolbar action, shortcut, or right-click save opens a small rename window after saving. Leave the name empty to use the fallback name.',
					searchText:
						'name naming style ask each time date first tab custom fallback rename window shortcut right-click',
				},
				{
					title: 'Close tabs after saving',
					body: `This is optional. ${PROJECT.name} saves and checks the session before closing tabs. Pinned tabs close only when Include pinned tabs is on. If a save closes every tab in a window, that window keeps a new tab by default. In Settings you can have it close instead when another browser window is open, and the browser switches to that window. The last window always stays open.`,
					searchText:
						'close tabs after saving delete remove verify pinned tabs include empty window close extra second window',
				},
			],
			action: {
				label: 'Save or naming settings',
				href: 'options.html?q=When+saving',
				icon: Settings2,
			},
		},
		{
			id: 'restoring-sessions',
			title: 'Restoring sessions',
			icon: RotateCcw,
			intro:
				'Restore a whole session or open one saved tab. You can keep the original session and choose where tabs open.',
			keywords: [
				'restore tabs',
				'duplicate tabs',
				'new window',
				'split view',
				'keyboard modifiers',
			],
			entries: [
				{
					title: 'Session card previews',
					body: 'On wide layouts, collapsed session cards show favicon previews for saved tabs. In Settings › Session board, turn off Show favicon previews on session cards to hide the icons and overflow count.',
					searchText:
						'session card collapsed favicon icons preview strip hide overflow count settings session board',
				},
				{
					title: 'Keep or remove restored tabs',
					body: 'Settings controls whether restored tabs stay in their session or are removed after a successful restore. You can also choose the destination window and what to do when a URL is already open.',
					searchText:
						'settings restore keep remove saved tabs successful restore destination current window new window duplicate urls already open skip',
				},
				{
					title: 'Restore saved window size and position',
					body: 'When enabled, sessions opened in a new window use the size and position recorded when you saved the whole window. Your browser or window manager may override those bounds, especially with tiling window managers.',
					searchText:
						'restore saved window size position bounds new window tiling window manager monitors',
				},
				{
					title: 'Switch workspaces',
					body: 'Choose Switch to this session in the menu of a session on the dashboard, or the switch button next to a session in the popup or side panel, to save the tabs in this window as a new session and open that session in their place. Pinned tabs and pages that cannot be saved stay open. The item is off while this window has no tab it could save.',
					searchText:
						'switch workspace context swap replace current window save open another session pinned tabs',
				},
				{
					title: 'Update or split a session',
					body: 'In the menu of a session on the dashboard, choose Replace with this window to swap its links for the web tabs in this window, or Add this window to append the tabs the session does not hold yet. Excluded sites, pinned tabs, and the duplicate setting work as they do when saving, and no tab is opened or closed. The session keeps its name, folder, description, and the notes on links it still holds. To split a session, select some of its links with their checkboxes and choose Split in the selection bar, or Split selected links in the session menu. The links move into a new session next to it. A split view pair moves only when you select both halves, and at least one link must stay behind. Each action shows an Undo button for a couple of minutes.',
					searchText:
						'replace append add window update refresh session split divide new session selected links undo current window',
				},
				{
					title: 'Use a click modifier',
					body: (
						<>
							<Key>Ctrl</Key> or <Key>⌘</Key> click to keep the saved session.{' '}
							<Key>Shift</Key> click to open it in a new window.
						</>
					),
					searchText:
						'ctrl control command cmd meta click keep original session shift click new window',
				},
				{
					title: 'Restore one tab or a split view',
					body: 'For one tab, Settings chooses whether it becomes active or opens in the background. Tabs saved side by side reopen as a split view in Chromium 155 or newer. Settings can instead open them as separate tabs, and the browser may do the same if it cannot recreate the split.',
					searchText:
						'single tab active background split view side by side chromium 155 separate neighboring tabs',
				},
			],
			action: {
				label: 'Restore settings',
				href: 'options.html?q=When+restoring',
				icon: Settings2,
			},
		},
		{
			id: 'bookmarks',
			title: 'Bookmarks',
			icon: BookOpen,
			intro:
				'Keep useful pages on your bookmark board, arranged in columns you choose.',
			keywords: [
				'bookmark board',
				'columns',
				'board view',
				'focus view',
				'drag and drop',
				'browser star',
				'import bookmarks',
				'export bookmarks',
			],
			entries: [
				{
					title: 'Add a page or link',
					body: 'Bookmark the current page from the popup or a right-click menu, or use the Bookmark this page shortcut. When adding, pasting, or importing bookmarks, choose New column in the column selector to name a destination. It is created when you save or import. In Settings, the browser bookmark star can prompt you to add the page here or add it automatically.',
					searchText:
						'add bookmark current page popup right-click shortcut browser star ctrl cmd d automatic prompt',
				},
				{
					title: 'Bookmark quick actions',
					body: 'By default, each bookmark has a quick action button to open it in a new tab. In Settings › Bookmark board, choose up to three actions for buttons beside each bookmark’s menu. Selected actions appear first in the picker, and Move up or Move down changes their order on the bookmark. Remove them all to hide the buttons. Delete moves the bookmark to the trash and offers Undo in a toast.',
					searchText:
						'quick action buttons open new tab bookmark menu copy edit delete checkbox settings',
				},
				{
					title: 'Move and add links',
					body: 'Drag bookmarks between columns to move or reorder them. The page scrolls on its own while you hold a drag near the top or bottom edge of the window or of a scrolling column, faster the closer you get. Without a mouse, open a bookmark’s or column’s menu and choose Move up, Move down, Move left, or Move right; open a session’s menu to move it up or down. Move to sends a bookmark to another column, and Add to session saves its link in a saved session. Drag a browser link or a link from a saved session onto a column. Drop a browser link or a bookmark onto a saved session to add it there too. You can also paste one or more links on the dashboard, outside a text field, to open Add bookmark. Choose Session there to add the links to a saved session instead of a column.',
					searchText:
						'drag reorder move scroll edge keyboard menu up down left right browser link saved session paste one several links dashboard text field add bookmark column',
				},
				{
					title: 'Choose Board or Focus view',
					body: 'Use the view button in the bookmarks toolbar to switch between Board and Focus. Board shows every column in a grid. Focus shows a column list next to one open column. Limit bookmarks shown at a time is on by default, so a busy column scrolls inside the panel instead of making the page tall. The choice is saved in Settings › Bookmark board.',
					searchText:
						'board focus view column list single column switch layout grid panel scroll busy column',
				},
				{
					title: 'Change column width and spacing',
					body: 'In Settings › Bookmark board, Bookmark column width sets how narrow a column can get in Board view, from Narrow to Extra wide. Columns per row sets the most columns in a row, and a smaller window still shows fewer. Default width with Automatic columns keeps the layout from Dashboard width. Bookmark density set to Compact tightens the gaps, padding, and rows in Board and Focus so more bookmarks fit on screen. Focus view always shows one column beside the list, so width and columns per row only change Board.',
					searchText:
						'column width narrow wide extra wide columns per row grid density compact comfortable spacing padding margin tighter board focus layout settings',
				},
				{
					title: 'Keep long columns compact',
					body: 'If a column has many bookmarks, open Settings › Bookmark board and set Limit bookmarks shown at a time. In Board and Focus, the column keeps that many bookmarks visible and scrolls through the rest. All bookmarks stay loaded, so there is no Show more button. This setting is on by default at 16 bookmarks.',
					searchText:
						'limit bookmarks links render many column settings performance scroll pane compact long column all loaded default 16',
				},
				{
					title: 'Select several bookmarks',
					body: 'Use Select bookmarks beside bookmark search to turn selection mode on or off. You can also hold Alt (Option on Mac) and hover a bookmark to reveal its selection checkbox, or choose Select bookmark from its menu. In selection mode, click bookmarks or use Tab and Space to select them. Hold Shift and click, or press Shift+Space, to select every visible bookmark between the last selection and the current one. Clicking with Ctrl (Command on Mac) still opens a link in a new tab. The selection bar keeps Open, Move, Export, Share, Add to session, and Delete actions inline. Drag selected bookmarks within the board or drop them onto a session to add them there. Clear bookmark selection clears the selection, and so does moving the selected bookmarks; Escape exits selection mode. Deleted bookmarks offer Undo and go to the trash bin.',
					searchText:
						'select multiple bulk bookmarks alt option shift range ctrl command checkbox drag move delete undo keyboard space escape',
				},
				{
					title: 'Find duplicate bookmarks',
					body: (
						<>
							Use the <MenuLocation label="Bookmarks toolbar" /> and choose Find
							duplicate bookmarks to list web addresses saved more than once on
							the board, in any column. Each address shows its copies and the
							column each is in. The oldest copy is kept unless you choose
							another. Remove extra copies moves the rest to the trash bin, and
							Undo restores them. Nothing is removed until you choose it.
							Sessions are not checked, because the same address in two sessions
							is normal.
						</>
					),
					searchText:
						'find duplicate bookmarks cleanup remove extra copies same address url saved twice columns keep oldest undo trash bookmarks toolbar menu',
				},
				{
					title: 'Import or export bookmarks',
					body: (
						<>
							On the dashboard, use the{' '}
							<MenuLocation label="Bookmarks toolbar" /> to import a JSON file
							or your browser bookmarks, or export bookmarks. Import lets you
							skip or allow duplicates. Browser bookmark folders become columns;
							folders with the same name merge, and links without a folder go in
							the first column. Use a column’s menu to export that column or all
							bookmarks.
						</>
					),
					searchText:
						'dashboard bookmarks toolbar menu import export JSON browser bookmarks duplicates skip allow',
				},
			],
			action: {
				label: 'Open bookmarks',
				href: 'newtab.html#bookmark-library',
				icon: Bookmark,
			},
		},
		{
			id: 'right-click',
			title: 'Right-click actions',
			icon: MousePointerClick,
			intro: `The action depends on what you right-click. Each browser menu groups ${PROJECT.name} actions under one item.`,
			keywords: [
				'context menu',
				'right click',
				'right-click',
				'link menu',
				'page menu',
				'selection menu',
				'toolbar menu',
			],
			entries: [
				{
					title: 'On a link',
					gesture: {label: 'Right-click a link', icon: Link2},
					body: 'Bookmark the link to a column, or use Save link to session to add it to one of your ten most recent sessions or to the Saved links session without opening it.',
					searchText:
						'right-click link bookmark column save link to session saved links without opening',
				},
				{
					title: 'On a page',
					gesture: {label: 'Right-click the page', icon: MousePointerClick},
					body: 'Bookmark the current page, send this tab to one of your ten most recent sessions or to a new session, or save this tab, its tab group, the whole window, or the tabs to its left or right.',
					searchText:
						'right-click page bookmark current tab send tab to session recent new session tab group whole window left right save',
				},
				{
					title: 'On selected text',
					gesture: {
						label: 'Select text, then right-click',
						icon: MousePointer2,
					},
					body: 'Search your saved tabs and bookmarks for the selected words.',
					searchText:
						'select text selection right-click search saved tabs bookmarks words',
				},
				{
					title: `On the ${PROJECT.name} toolbar icon`,
					gesture: {
						label: `Right-click the ${PROJECT.name} icon`,
						icon: MousePointerClick,
					},
					body: 'Open the dashboard, save this window, exclude the current site from saves, or open Help and Settings. The icon briefly shows a checkmark when an action finishes.',
					searchText:
						'right-click toolbar icon dashboard save window exclude website site help settings checkmark done',
				},
				{
					title: 'In the browser tab strip',
					body: 'Browsers do not let extensions add actions to the tab strip’s own right-click menu.',
					searchText:
						'tab strip browser tab context menu cannot add extension actions unavailable',
				},
			],
			action: {
				label: 'Choose right-click menus',
				href: 'options.html?q=Right-click+menus',
				icon: Settings2,
			},
		},
		{
			id: 'search-and-shortcuts',
			title: 'Search and shortcuts',
			icon: Search,
			intro: 'Find saved items and actions without browsing the whole page.',
			keywords: [
				'global search',
				'command palette',
				'finder',
				'hotkeys',
				'keys',
				'Ctrl K',
				'slash',
			],
			entries: [
				{
					title: 'Search the dashboard',
					body: 'Use the search field to find sessions and saved tabs by name or page details.',
					searchText:
						'search field dashboard sessions saved tabs name page details title url',
				},
				{
					title: 'Open the search palette',
					body: (
						<>
							On the dashboard, press <Key>Ctrl</Key> or <Key>⌘</Key> +{' '}
							<Key>K</Key>, or press <Key>/</Key> when you are not typing in a
							field. Search bookmarks, sessions, open tabs, commands, or the
							web. Your recent sessions are listed before you type. Choose one
							to restore it, or press <Key>Shift</Key> + <Key>Enter</Key> to
							reveal it on the dashboard instead.
						</>
					),
					searchText:
						'dashboard ctrl command cmd meta k slash / search bookmarks sessions open tabs commands web palette recent sessions restore reveal shift enter',
				},
				{
					title: 'Open the palette from any page',
					body: (
						<>
							Press <Key>Ctrl</Key> + <Key>Shift</Key> + <Key>K</Key> (
							<Key>⌘</Key> + <Key>Shift</Key> + <Key>K</Key> on macOS) on any
							page, including pages that use <Key>Ctrl</Key> + <Key>K</Key>{' '}
							themselves and browser pages. The palette appears over the page
							you are on. Browser pages, the Web Store and the PDF viewer cannot
							show it there, so a small window opens on them instead. In
							Settings, Opening TabLodge, you can choose the window everywhere.
							Choosing a session restores it into the window you were in, and{' '}
							<Key>Ctrl</Key> or <Key>⌘</Key> + <Key>Enter</Key> restores it in
							a new window. Links and web searches open in that window&apos;s
							active tab. Press the shortcut again or <Key>Esc</Key> to close
							the palette. A palette window also closes when you click another
							window.
						</>
					),
					searchText:
						'any page global shortcut ctrl shift k command palette window in the current page overlay browser pages restore session new window open search palette close click away focus',
				},
				{
					title: 'Navigate results',
					body: (
						<>
							<Key>↑</Key> and <Key>↓</Key> move through results. Press{' '}
							<Key>Enter</Key> to open one, or <Key>Ctrl</Key> or <Key>⌘</Key> +{' '}
							<Key>Enter</Key> to open it in a new tab. Press <Key>Esc</Key> to
							close the palette.
						</>
					),
					searchText:
						'up down arrows navigate results enter open ctrl command cmd meta new tab escape esc close palette',
				},
				{
					title: 'More actions for a result',
					body: (
						<>
							Press <Key>→</Key> on a session, bookmark, saved tab, or open tab
							(or right-click it) to see its other actions: restore a session
							here or in a new window, reveal it on the dashboard, open a link
							in a new tab or window, copy a link, switch to a tab, or close it.
							Type to filter the actions. Press <Key>Esc</Key> or{' '}
							<Key>Backspace</Key> to go back to the results.
						</>
					),
					searchText:
						'more actions sub menu submenu right arrow context menu restore here new window reveal open copy link switch close tab filter back escape backspace breadcrumb palette',
				},
				{
					title: 'Search from the address bar',
					body: (
						<>
							Type <Key>tl</Key>, then press <Key>Space</Key> or <Key>Tab</Key>,
							and keep typing. Suggestions list open tabs, bookmarks, saved
							tabs, and sessions. <Key>Enter</Key> opens one, or <Key>Alt</Key>{' '}
							+ <Key>Enter</Key> opens it in a new tab. Pressing{' '}
							<Key>Enter</Key> on your own text searches the dashboard.
						</>
					),
					searchText:
						'address bar omnibox url bar keyword tl type space tab suggestions open tabs bookmarks saved tabs sessions enter alt new tab',
				},
				{
					title: 'Change keyboard shortcuts',
					body: (
						<>
							The suggested shortcuts are <Key>Alt</Key> + <Key>Shift</Key> +{' '}
							<Key>S</Key> to save tabs and <Key>Alt</Key> + <Key>Shift</Key> +{' '}
							<Key>D</Key> to bookmark this page, and <Key>Ctrl</Key> +{' '}
							<Key>Shift</Key> + <Key>K</Key> to open the search palette. Your
							browser can change these and assign keys to other actions.
						</>
					),
					searchText:
						'alt shift s save tabs alt shift d bookmark page ctrl shift k search palette browser configure customize shortcut side panel dashboard',
				},
			],
			action: {
				label: 'Configure shortcuts',
				href: SHORTCUTS_URL,
				icon: Keyboard,
			},
		},
		{
			id: 'data-and-recovery',
			title: 'Data and recovery',
			icon: Database,
			intro:
				'Sessions, bookmarks, and backups stay in this browser unless you export or download a copy.',
			keywords: [
				'privacy',
				'local storage',
				'backup',
				'crash recovery',
				'snapshots',
				'trash',
				'undo',
				'export data',
			],
			entries: [
				{
					title: 'Private windows',
					body: isFirefox
						? `${PROJECT.name} does not run in Firefox private windows: it cannot see their tabs, so it never saves them, and its pages are not available there.`
						: 'Enable Allow in Incognito in the browser’s extension settings. New private tabs redirect to the dashboard by default. Turn this off in Settings under Private windows to keep the browser’s page. You can also open the dashboard from the toolbar popup or its shortcut. On the first visit, choose the same library as regular windows, a separate saved library, or a separate temporary library. Change this later in Settings under Private windows. Private windows use their own accent color by default; change or turn it off there. Temporary data clears on browser restart, not when private windows close. Switching modes does not copy or delete libraries. A separate saved library can be locked with a PIN or password from Settings in a private window: it is encrypted on this device, private pages show a lock screen, and it locks again with Lock now, after the idle time (5 minutes by default), when the last private window closes, and when the browser closes. A lost PIN or password cannot be recovered, and a short PIN is weak against copied profile files. Remove the lock before changing the storage mode. Automatic snapshots and backups do not run privately. Exported files remain on disk.',
					searchText:
						'private incognito storage shared separate saved temporary restart dashboard first setup new tab redirect lock unlock pin password encrypt idle',
				},
				{
					title: 'Where data is stored',
					body: `${PROJECT.name} uses this browser’s extension storage. There are no accounts and no ${PROJECT.name} servers. Nothing leaves the browser unless you turn on sync with a server you run yourself. Exported files can contain page addresses, titles, and notes, so keep them private.`,
					searchText:
						'local browser extension storage accounts servers cloud sync privacy exported files addresses urls titles notes private',
				},
				{
					title: 'Sync between devices',
					body: `Run the ${PROJECT.name} sync server yourself, with Docker or on your own Cloudflare account (without a server, Settings under Sync walks you through it: Generate token makes and copies a token, and Deploy to Cloudflare sets the server up on your free Cloudflare account without installing anything), and connect each browser in Settings under Sync with the server address and its token. Sessions, saved tabs, folders, bookmark columns, bookmarks, and display preferences then stay the same on every connected browser, and a change shows up on the others within a moment while they are open. Edits to different items on different devices combine; when two devices change the same item at once, the later edit wins. Snapshots, backups, the trash bin, and per device settings such as the new tab page do not sync. Private windows that use the regular library sync with it. A separate saved private library syncs only if you turn on Sync private windows in Settings from a private window (after you connect, Settings offers to open one); with a PIN or password it is encrypted before it leaves the browser, and other browsers need the same PIN or password to read it. A temporary private library never syncs. Changes made offline are sent when the server can be reached again. While sync is on, the sync icon in the dashboard header shows whether it is up to date, waiting to send changes, or unable to reach the server, and opens the Sync settings. The server stores your library in plain text, so only use one you trust. Disconnect stops syncing and keeps everything on this device.`,
					searchText:
						'sync server self hosted docker cloudflare devices computers token connect disconnect offline merge conflict',
				},
				{
					title: 'Export or import data',
					body: (
						<>
							Session import and export are in the{' '}
							<MenuLocation label="Sessions" />. It can also share all sessions,
							including archived sessions. A session menu can export just that
							session in any format. Bookmark import and export are in the{' '}
							<MenuLocation label="Bookmarks toolbar" />. Settings can export
							bookmarks or create a full ZIP backup with settings, excluded
							sites, theme, snapshots, and the trash bin. Open{' '}
							<a
								href="options.html?q=Data"
								className="font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary focus-visible:rounded-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
							>
								Data settings
							</a>{' '}
							to back up, import, or erase data. When you back up everything,
							you can protect the file with a PIN or a password. Choose a
							password for anything sensitive: a PIN is weak, because anyone
							with the file can try every PIN. TabLodge cannot recover a lost
							PIN or password. Importing a protected file asks for it first, and
							a wrong entry changes nothing. Importing a full backup replaces
							the current data and offers Undo for a short time.
						</>
					),
					searchText:
						'sessions menu share all sessions archived individual session export bookmark toolbar menu import export full backup ZIP settings excluded sites theme snapshots trash bin replace undo encrypt encrypted password protect PIN lost forgotten unlock',
				},
				{
					title: 'Recover after a browser crash',
					body: (
						<>
							Recent snapshots keep copies of open windows and can restore
							everything, one window, or save a copy as a session. On the
							dashboard, open them with the button beside session search and
							sort, from the Recent snapshots icon in the side panel header, or
							the dashboard search palette. Private windows never take
							snapshots, so these entry points are hidden there; save a session
							by hand instead. Crash detection is a best guess because browsers
							do not tell extensions when they shut down.
						</>
					),
					searchText:
						'crash browser closed unexpectedly recovery recent snapshots restore all one window save as session session toolbar side panel search palette',
				},
				{
					title: 'Undo and the trash bin',
					body: (
						<>
							Deleted sessions, saved links, bookmarks, and columns stay in the
							trash until their retention period ends. Settings controls how
							long. On the dashboard, use the Trash bin icon in the header or
							the Sessions menu. Dashboard settings can hide either header
							shortcut. You can also open the bin from the{' '}
							<MenuLocation label="Bookmarks toolbar" />, the Trash bin icon in
							the side panel header, or the search palette. Dashboard deletes,
							imports, actions that open many tabs, and closing duplicate tabs
							also offer Undo for a few seconds.
						</>
					),
					searchText:
						'undo deleted sessions saved links bookmarks columns trash bin retention dashboard header settings sessions menu bookmarks toolbar side panel search palette imports many tabs',
				},
				{
					title: 'Automatic backups',
					body: 'Optional automatic backups are off by default. They keep dated copies of sessions, bookmarks, and settings. Safety backups are also made before some large or destructive changes. Choose backup frequency, retention, and an optional Downloads copy in Settings. Automatic and safety backups are not encrypted. Only a full backup ZIP that you export yourself can be protected with a PIN or password.',
					searchText:
						'automatic backups off default dated copies sessions bookmarks settings safety backup before erase import delete frequency retention downloads permission',
				},
			],
			action: {
				label: 'Open recovery settings',
				href: 'options.html?q=Recovery',
				icon: LifeBuoy,
			},
		},
		{
			id: 'settings',
			title: 'Settings',
			icon: Settings2,
			intro: `Tune how ${PROJECT.name} opens, saves, restores, and displays your library.`,
			keywords: [
				'preferences',
				'startup',
				'theme',
				'excluded websites',
				'site exclusions',
				'data settings',
				'dashboard width',
				'column layout',
				'full width',
			],
			entries: [
				{
					title: 'Find a setting',
					body: 'Use the search box at the top of Settings. Search by setting name or by what you want to change.',
					searchText:
						'search settings box find preference name behavior setting label',
				},
				{
					title: 'Common choices',
					body: `Set dashboard width, startup behavior, session sorting, and automatic archiving for sessions you have not opened in a while. The Archived folder appears when it contains sessions. Archive an active session with its card button or menu. Archived sessions leave active lists but remain available in that folder. In Archived, use Move to folder in the session menu to bring a session back. Choose up to five direct menu actions as session card quick actions: Archive, Delete, Share, Export session, Edit details, Move up, Move down, and Switch to this session. Archive is selected by default and Delete is off. Expanded cards keep enabled quick actions visible without hovering. Choose up to three direct menu actions as bookmark quick actions, including opening, copying, editing, deleting, and moving a bookmark or changing its order. Open in new tab is selected by default. You can also set URL display, bookmark clicks, site exclusions, right-click menus, and whether to open ${PROJECT.name} after saving. Remove common tracking parameters, including the share tracking X, YouTube and Spotify add to links, when opening or copying saved links and when restoring sessions and snapshots. This leaves saved URLs unchanged and is off by default. Wider uses the full width on a 1080p screen and fits four columns. Full width fits as many columns as the screen can hold, while Narrower keeps the board to two columns. Choose Board or Focus as the bookmark view; Focus shows a column list and one open column. Set the bookmark column width, the most columns per row, and a compact density in Settings › Bookmark board. The theme follows your system by default. The accent color for buttons and focus rings starts as TabLodge’s own color. You can pick a preset, any custom color, or System, which follows your operating system’s accent color where it has one, and Reset brings the default back.`,
					searchText:
						'dashboard width narrow narrower default wider full width columns layout board focus view column list column width columns per row density compact comfortable startup behavior session sorting archive old sessions not opened days archive delete share export edit details move up move down switch session session card quick actions hover expanded menu Archived folder move to folder restore move back bookmark quick actions open in this tab open in new tab copy edit delete move to URL tracking parameters utm fbclid gclid site exclusions right-click menus open after save theme system light dark accent color',
				},
				{
					title: 'Control saved data',
					body: 'Settings lets you export bookmarks, erase sessions or bookmarks, restore defaults, and manage recovery data. Under Data, Statistics is a read-only summary: how many sessions and saved tabs you have, how many tabs are open, the ten open tabs you have not used for the longest, and a rough memory estimate. The estimate assumes about 100 MB per loaded tab and 5 MB per unloaded tab, so use the browser Task Manager (Shift+Esc) for real figures.',
					searchText:
						'sessions bookmarks data delete erase export restore defaults recovery settings statistics stats counts saved tabs open tabs oldest unused memory ram',
				},
			],
			action: {label: 'Open Settings', href: 'options.html', icon: Settings2},
		},
		{
			id: 'about',
			title: 'About and feedback',
			icon: CircleHelp,
			intro: `${PROJECT.name} is free and open source under the ${PROJECT.license} License. Version ${PROJECT.version}.`,
			keywords: [
				'about',
				'version',
				'website',
				'source code',
				'github',
				'report a bug',
				'issue',
				'license',
				'changelog',
				'release',
			],
			entries: [
				{
					title: 'Project links',
					body: 'Visit the project website, read the source, report a problem, check release notes, or view the license.',
					searchText:
						'website source code github report problem issue bug release notes changelog license',
				},
			],
		},
	];
	const projectLinks: Array<{
		icon: IconComponent;
		label: string;
		href: string;
	}> = [
		{icon: Globe, label: 'Website', href: PROJECT.websiteUrl},
		{icon: Code, label: 'Source code', href: PROJECT.repoUrl},
		{icon: Bug, label: 'Report an issue', href: PROJECT.issuesUrl},
		{icon: Tag, label: 'Releases and changelog', href: PROJECT.changelogUrl},
		{
			icon: Scale,
			label: `${PROJECT.license} License`,
			href: PROJECT.licenseUrl,
		},
	];
	const visibleSections = sections.flatMap((section) => {
		if (terms.length === 0) {
			return [{...section, visibleEntries: section.entries}];
		}

		const sectionText = [
			section.title,
			section.intro,
			...section.keywords,
		].join(' ');
		const sectionMatches = hasTerms(sectionText);
		const matchingEntries = section.entries.filter((entry) =>
			hasTerms(`${entry.title} ${entry.searchText}`),
		);
		if (!sectionMatches && matchingEntries.length === 0) {
			return [];
		}

		return [
			{
				...section,
				visibleEntries: sectionMatches ? section.entries : matchingEntries,
			},
		];
	});
	const matchingEntriesCount = visibleSections.reduce(
		(count, section) => count + section.visibleEntries.length,
		0,
	);

	return (
		<main className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-9 lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-x-8">
			<div className="lg:col-span-2">
				<AppHeader active="help" />
			</div>
			<h2 className="mb-3 hidden text-sm font-semibold lg:col-start-1 lg:row-start-2 lg:-mt-3 lg:block">
				Browse topics
			</h2>
			<div
				role="search"
				className="relative -mt-3 mb-6 lg:col-start-2 lg:row-start-2"
			>
				<label htmlFor="help-search" className="sr-only">
					Search help
				</label>
				<Search
					className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					id="help-search"
					type="text"
					value={query}
					placeholder="Search help"
					autoComplete="off"
					spellCheck={false}
					className="h-10 pl-9 pr-10"
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Escape') {
							setQuery('');
						}
					}}
				/>
				{query && (
					<Button
						variant="ghost"
						size="icon"
						className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
						aria-label="Clear help search"
						onClick={() => setQuery('')}
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</Button>
				)}
			</div>
			<p className="sr-only" role="status" aria-live="polite">
				{terms.length > 0
					? `${matchingEntriesCount} matching ${matchingEntriesCount === 1 ? 'answer' : 'answers'} in ${visibleSections.length} ${visibleSections.length === 1 ? 'topic' : 'topics'}`
					: ''}
			</p>

			<aside className="mb-4 self-start lg:sticky lg:top-5 lg:-mt-8 lg:mb-0 lg:col-start-1 lg:row-start-3">
				<nav
					aria-label="Help topics"
					className="flex flex-wrap gap-1.5 lg:flex-col lg:items-stretch"
				>
					{visibleSections.map(({id, title, icon: Icon}) => (
						<a
							key={id}
							href={`#${id}`}
							className="inline-flex min-h-9 items-center gap-2 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
						>
							<Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
							{title}
						</a>
					))}
				</nav>
			</aside>

			<div className="min-w-0 lg:col-start-2 lg:row-start-3">
				{visibleSections.length > 0 ? (
					<div>
						{visibleSections.map((section) => {
							const Icon = section.icon;
							return (
								<article
									key={section.id}
									id={section.id}
									className="scroll-mt-6 border-b border-border py-7 first:pt-0"
									aria-labelledby={`${section.id}-title`}
								>
									<header className="flex items-start gap-3">
										<span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
											<Icon className="h-5 w-5" aria-hidden="true" />
										</span>
										<div className="min-w-0">
											<h2
												id={`${section.id}-title`}
												className="text-xl font-semibold tracking-tight"
											>
												{section.title}
											</h2>
											<p className="mt-1 max-w-2xl leading-6 text-muted-foreground">
												{section.intro}
											</p>
										</div>
									</header>
									<div className="mt-4 divide-y divide-border border-t border-border sm:ml-13">
										{section.visibleEntries.map((entry) => (
											<div
												key={entry.title}
												className="grid gap-2 py-4 sm:grid-cols-[minmax(145px,0.34fr)_minmax(0,1fr)] sm:gap-5"
											>
												<div className="flex flex-wrap items-center gap-2">
													<h3 className="text-sm font-semibold">
														{entry.title}
													</h3>
													{entry.gesture && <GestureBadge {...entry.gesture} />}
												</div>
												<p className="max-w-3xl text-sm leading-6 text-muted-foreground">
													{entry.body}
												</p>
											</div>
										))}
									</div>
									{section.action && (
										<div className="mt-4 flex flex-wrap items-center gap-3 sm:ml-13">
											{section.action.href === SHORTCUTS_URL ? (
												<Button
													variant="outline"
													size="sm"
													onClick={async () => {
														setShortcutsFailed(!(await openShortcutsPage()));
													}}
												>
													<Keyboard className="h-4 w-4" aria-hidden="true" />
													{section.action.label}
													<ArrowUpRight
														className="h-4 w-4"
														aria-hidden="true"
													/>
												</Button>
											) : (
												<a
													href={section.action.href}
													className="inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-medium text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
												>
													{section.action.icon && (
														<section.action.icon
															className="h-4 w-4"
															aria-hidden="true"
														/>
													)}
													{section.action.label}
													<ArrowUpRight
														className="h-4 w-4"
														aria-hidden="true"
													/>
												</a>
											)}
											{shortcutsFailed &&
												section.id === 'search-and-shortcuts' && (
													<p
														role="alert"
														className="text-xs text-muted-foreground"
													>
														Your browser did not open the shortcuts page.{' '}
														{SHORTCUTS_HINT}
													</p>
												)}
										</div>
									)}
									{section.id === 'about' && (
										<div className="mt-4 flex flex-wrap gap-2 sm:ml-13">
											{projectLinks.map(({icon: LinkIcon, label, href}) => (
												<Button key={label} asChild variant="outline" size="sm">
													<a
														href={href}
														target="_blank"
														rel="noopener noreferrer"
													>
														<LinkIcon className="h-4 w-4" aria-hidden="true" />
														{label}
														<ExternalLink
															className="h-3.5 w-3.5"
															aria-hidden="true"
														/>
													</a>
												</Button>
											))}
										</div>
									)}
									{terms.length === 0 && section.id === 'right-click' && (
										<p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground sm:ml-13">
											<Check className="h-4 w-4 shrink-0" aria-hidden="true" />
											Each menu location can be enabled separately.
										</p>
									)}
								</article>
							);
						})}
					</div>
				) : (
					<div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
						<Search
							className="mx-auto h-5 w-5 text-muted-foreground"
							aria-hidden="true"
						/>
						<h2 className="mt-3 font-semibold">No help topics found</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Try another word, or clear the search to browse all topics.
						</p>
						<Button
							className="mt-4"
							variant="outline"
							size="sm"
							onClick={() => setQuery('')}
						>
							Clear search
						</Button>
					</div>
				)}
			</div>
		</main>
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<PrivateWindowAppearance>
			<TooltipProvider>
				<Help />
			</TooltipProvider>
		</PrivateWindowAppearance>
	</ThemeProvider>,
);
