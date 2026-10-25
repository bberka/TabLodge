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
	Laptop,
	Trash2,
	Settings2,
	Download,
	Bookmark,
	Database,
	PanelRightOpen,
	Plus,
	LockKeyhole,
	Eraser,
	MousePointerClick,
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
} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider, useTheme} from '../shared/theme';
import {
	EmptyState,
	LoadError,
	AppHeader,
	PageShell,
	SectionCard,
	StatusLine,
	send,
	useStatus,
	useTabLodgeState,
	type IconComponent,
} from './common';
import type {ActionResult, EraseScope, Settings} from './types';
import {BackupDialog, ImportDialog} from './data-transfer';
import type {ExportData} from './export-formats';
import {initialSearchQuery, withSearchParam} from './page-params';
import {
	excludedHostError,
	normalizeExcludedHost,
	parseExcludedLines,
} from './excluded-sites';
import {
	highlightSegments,
	matchesAnyTerm,
	matchesQuery,
	rankByQuery,
	scoreQuery,
	searchTerms,
} from './fuzzy';
import {PROJECT} from './project';

// Settings keys whose value has the given type, so switch rows only bind boolean settings and select rows string ones.
type SettingKey<V> = {
	[K in keyof Settings]-?: Settings[K] extends V ? K : never;
}[keyof Settings];
type System = 'sessions' | 'bookmarks';
// `requires`: a switch that must be on for this row to apply; the row is inset and disabled while it is off.
// `systems`: the row is hidden (and not searchable) while any listed system is turned off.
type SettingField = {
	label: string;
	help: string;
	requires?: SettingKey<boolean>;
	systems?: System[];
} & (
	| {name: SettingKey<boolean>; type: 'switch'}
	| {name: SettingKey<string>; type: 'select'; options: Array<[string, string]>}
);
const messageOf = (reason: unknown) =>
	(reason as {message?: string} | null | undefined)?.message;
const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;
const listing = (parts: string[]) =>
	parts.length < 2
		? parts.join('')
		: `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
// Typed into the "Erase everything" dialog before its confirm button enables.
const ERASE_WORD = 'ERASE';

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
// `system`: the whole section collapses to a "turned off" line while that system is off.
const settingsGroups: Array<{
	title: string;
	icon: IconComponent;
	description?: string;
	system?: System;
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
				name: 'autoFocusSearchOnNewTab',
				label: 'Focus search when opening a new tab',
				help: `Shows a search box at the top of the ${PROJECT.name} page and puts the cursor in it. Chromium may keep focus in the address bar on new tabs unless ${PROJECT.name} is opened as a normal tab.`,
				type: 'switch',
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
			},
			{
				name: 'actionMode',
				label: 'Toolbar button action',
				help: 'The default is a compact popup. Only Open Dashboard opens the full page in a separate tab.',
				type: 'select',
				options: [
					['popup', 'Open the quick action popup'],
					['current-window', 'Save selected tabs, or this window'],
					['full-window', 'Save the full window, including tab groups'],
					['current-group', 'Save the active tab group'],
					[
						'current-tab-to-group',
						'Send current tab to first unlocked session',
					],
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
				name: 'sessionsOnTop',
				systems: ['sessions', 'bookmarks'],
				label: 'Show sessions at the top',
				help: 'Put the sessions section above the bookmark board.',
				type: 'switch',
			},
			{
				name: 'urlDisplayMode',
				label: 'Show URLs as',
				help: 'How web addresses appear under bookmarks and saved session links.',
				type: 'select',
				options: [
					['domain', 'Domain only'],
					['full', 'Full URL'],
					['none', 'Hide'],
				],
			},
		],
	},
	{
		title: 'When saving',
		system: 'sessions',
		icon: Settings2,
		fields: [
			{
				name: 'includePinnedTabs',
				label: 'Include pinned tabs',
				help: 'Pinned tabs are ignored by default. When enabled, they are stored before any close operation and regain their pinned state on restore.',
				type: 'switch',
			},
			{
				name: 'closeOnSave',
				label: 'Close tabs after saving',
				help: 'Tabs are stored first and checked again before removal. Pinned tabs close only when inclusion is enabled.',
				type: 'switch',
			},
			{
				name: 'saveDuplicateHandling',
				label: 'When a saved URL is saved again',
				help: 'Applies to saving tabs. Rejected duplicates are not stored twice, but their tabs still close if close-after-save is on.',
				type: 'select',
				options: [
					['allow', 'Allow duplicates'],
					['reject', 'Reject duplicates silently'],
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
				name: 'openDashboardAfterSave',
				label: `Open ${PROJECT.name} after saving`,
				help: 'Open the saved session in a separate browser tab after a save action.',
				type: 'switch',
			},
		],
	},
	{
		title: 'Side Panel',
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
		system: 'sessions',
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
				help: 'Choose whether saved tabs stay, are removed, or the session is archived. Locked sessions always keep their tabs.',
				type: 'select',
				options: [
					['keep', 'Keep saved tabs'],
					['remove', 'Remove restored tabs'],
					['archive', 'Archive the session'],
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
		],
	},
	{
		title: 'Session display',
		system: 'sessions',
		icon: Settings2,
		fields: [
			{
				name: 'sessionSort',
				label: 'Sort sessions by default',
				help: 'Newest first is used only when no sort choice has been stored yet.',
				type: 'select',
				options: [
					['newest', 'Newest first'],
					['oldest', 'Oldest first'],
					['name', 'Name A–Z'],
					['tabs', 'Most tabs'],
					['custom', 'Custom order'],
				],
			},
			{
				name: 'sessionLayout',
				label: 'Session layout',
				help: 'Show sessions in a single list, or as a two-column grid on wide pages.',
				type: 'select',
				options: [
					['list', 'List'],
					['grid', 'Grid'],
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
				help: 'Choose whether clicking a session title opens its details or restores it.',
				type: 'select',
				options: [
					['edit', 'Edit session details'],
					['restore', 'Restore the session'],
				],
			},
			{
				name: 'copyFormat',
				label: 'Copy session links as',
				help: 'Choose a local text format when copying saved session links.',
				type: 'select',
				options: [
					['markdown', 'Markdown'],
					['rich', 'Rich text (falls back to title and URL)'],
					['title-url', 'Title, then URL'],
					['url-title', 'URL, then title'],
					['url', 'URL only'],
				],
			},
		],
	},
	{
		title: 'Bookmark board',
		system: 'bookmarks',
		icon: Bookmark,
		fields: [
			{
				name: 'bookmarkClickAction',
				label: 'When clicking a bookmark',
				help: 'Choose what happens when you click a bookmark. The bookmark menu can always open it either way.',
				type: 'select',
				options: LINK_ACTIONS,
			},
			{
				name: 'showBookmarkQuickActions',
				label: 'Show quick actions on bookmarks',
				help: 'Add a small actions button next to each bookmark’s menu button for opening, copying, editing, or deleting.',
				type: 'switch',
			},
			{
				name: 'stretchBookmarkColumns',
				label: 'Extend bookmark columns to available height',
				help: 'Columns in the same row match the tallest one.',
				type: 'switch',
			},
		],
	},
];

// Text of a settings row that the search box looks through: its label, help, and (for selects) option labels.
const fieldSearchText = (field: SettingField) => [
	field.label,
	field.help,
	...(field.type === 'select' ? field.options.map(([, label]) => label) : []),
];

// The sections that are not generated from `settingsGroups`, with the extra words people may search for.
const APPEARANCE = {
	title: 'Appearance',
	help: 'System follows your device and updates automatically.',
	text: [
		'Appearance',
		'System follows your device and updates automatically.',
		'System',
		'Light',
		'Dark',
		'theme',
		'color mode',
	],
};
const SYSTEMS = {
	title: 'Systems',
	description: 'Switch a system off without deleting its saved data.',
	note: 'At least one system must remain enabled. Disabled systems keep their data and reject changes until re-enabled.',
};
const SYSTEM_ROWS = [
	{
		name: 'sessionsEnabled',
		label: 'Sessions',
		help: 'Save, organize, and restore tab sessions.',
		otherLabel: 'Bookmarks',
	},
	{
		name: 'bookmarksEnabled',
		label: 'Bookmarks',
		help: 'Keep a local library of browser bookmarks.',
		otherLabel: 'Sessions',
	},
] as const;
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
	const {theme, setTheme} = useTheme();
	const [settings, setSettings] = useState<Partial<Settings>>({});
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
	const [confirmDefaults, setConfirmDefaults] = useState(false);
	const [resetBusy, setResetBusy] = useState(false);
	const [erase, setErase] = useState<{
		sessions: boolean;
		bookmarks: boolean;
		busy: boolean;
	} | null>(null);
	const [backupData, setBackupData] = useState<ExportData | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const eraseFocusRef = useRef<HTMLElement | null>(null);
	const dataRef = useRef<HTMLDivElement>(null);
	// The search box: `?q=` keeps the query across reloads; "/" and Ctrl/Cmd+K focus it, Escape clears it.
	const searchRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState(() => initialSearchQuery(location.search));
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
		if (!state?.settings) {
			return;
		}

		setSettings(state.settings);
		setExcluded(state.settings.excludedOrigins || []);
	}, [state]);

	// Values come from the switch and select controls below, so they match the setting's type.
	async function updateSetting(name: keyof Settings, value: boolean | string) {
		if (name === 'toolbarOpens' && value === 'sidepanel' && !chrome.sidePanel) {
			showStatus(
				'The browser Side Panel API is unavailable in this version.',
				true,
			);
			return;
		}

		if (
			['sessionsEnabled', 'bookmarksEnabled'].includes(name) &&
			value === false
		) {
			const otherName =
				name === 'sessionsEnabled' ? 'bookmarksEnabled' : 'sessionsEnabled';
			if (settings[otherName] === false) {
				showStatus('Keep Sessions or Bookmarks enabled.', true);
				return;
			}
		}

		setSettings((current) => ({...current, [name]: value}));
		const result = await send('UPDATE_SETTINGS', {
			settings: {[name]: value},
		});
		if (result?.ok) {
			showStatus('Setting saved.');
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
			bulkMode
				? `Excluded ${plural(result.added, 'website')}.`
				: 'Website exclusion added.',
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
			showStatus(
				'Default settings restored. Saved sessions and bookmarks were left unchanged.',
				false,
				{toast: true},
			);
		} catch {
			showStatus(
				'Settings were reset, but the appearance choice could not be changed.',
				true,
			);
		}

		setConfirmDefaults(false);
	}

	// Live counts for the Data section and the erase confirmations.
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
	const eraseScope: EraseScope | null = erase
		? erase.sessions && erase.bookmarks
			? 'all'
			: erase.sessions
				? 'sessions'
				: erase.bookmarks
					? 'bookmarks'
					: null
		: null;
	const eraseLabel = {
		sessions: 'Erase sessions',
		bookmarks: 'Erase bookmarks',
		all: 'Erase everything',
	};

	function askErase(trigger: HTMLElement) {
		eraseFocusRef.current = trigger;
		setErase({sessions: false, bookmarks: false, busy: false});
	}

	// Erasing everything also asks for ERASE_WORD; the confirmation dialog enables its button only once it is typed.
	async function confirmErase() {
		if (!erase || !eraseScope || erase.busy) {
			return;
		}

		setErase({...erase, busy: true});
		let result:
			| ActionResult<'ERASE_DATA'>
			| {ok: false; error: string | undefined}
			| undefined;
		try {
			result = await send('ERASE_DATA', {scope: eraseScope});
		} catch (reason) {
			result = {ok: false, error: messageOf(reason)};
		}

		if (!result?.ok) {
			setErase((current) => current && {...current, busy: false});
			showStatus(
				result?.error || 'Could not erase that data. Nothing was changed.',
				true,
			);
			return;
		}

		// The erase button is disabled once nothing is left, so focus returns to the Data section.
		eraseFocusRef.current = dataRef.current;
		setErase(null);
		await reload();
		const erased = [
			...(eraseScope === 'bookmarks'
				? []
				: [plural(result.sessions, 'session')]),
			...(eraseScope === 'sessions'
				? []
				: [plural(result.bookmarks, 'bookmark')]),
		];
		showStatus(`Erased ${listing(erased)}. Settings were kept.`, false, {
			toast: true,
		});
	}

	// Nothing renders until the saved state arrives, so the page opens on its themed background without a flash.
	if (!state) {
		return error ? (
			<PageShell data-brand="tablodge" className="max-w-4xl">
				<PageTop />
				<LoadError message={error} />
			</PageShell>
		) : null;
	}

	// ---- Search: every section lists its rows' searchable text; a matching section title keeps all its rows.
	const searching = searchTerms(query).length > 0;
	const titleHit = (title: string) => searching && matchesQuery(query, [title]);
	const pick = <T,>(
		title: string,
		items: readonly T[],
		textOf: (item: T) => string[],
	): T[] =>
		!searching || titleHit(title)
			? [...items]
			: rankByQuery(query, items, textOf);
	const systemOn = (system: System) =>
		settings[system === 'sessions' ? 'sessionsEnabled' : 'bookmarksEnabled'] !==
		false;
	const fieldShown = (field: SettingField) =>
		(field.systems ?? []).every((system) => systemOn(system));
	const hl = (text: string) => <Highlight text={text} query={query} />;

	const showAppearance = matchesQuery(query, APPEARANCE.text);
	const systemRows = pick(SYSTEMS.title, SYSTEM_ROWS, (row) => [
		row.label,
		row.help,
	]);
	// A group whose system is off collapses to one line (and is skipped by search); single rows can hide too.
	const collapsedGroups = searching
		? []
		: settingsGroups.filter((group) => group.system && !systemOn(group.system));
	const groupScore = (fields: SettingField[]) =>
		Math.max(
			0,
			...fields.map((field) => scoreQuery(query, fieldSearchText(field))),
		);
	const visibleGroups = settingsGroups
		.filter((group) => !group.system || systemOn(group.system))
		.map((group) => ({
			group,
			fields: pick(
				group.title,
				group.fields.filter((field) => fieldShown(field)),
				fieldSearchText,
			),
		}))
		.filter((entry) => entry.fields.length)
		.map((entry, index) => ({...entry, index}))
		.toSorted((a, b) =>
			searching && !titleHit(a.group.title) && !titleHit(b.group.title)
				? groupScore(b.fields) - groupScore(a.fields) || a.index - b.index
				: a.index - b.index,
		);

	const dataRows: DataRowDef[] = [
		{
			key: 'backup',
			icon: Download,
			label: 'Back up',
			help: 'Save bookmarks or sessions to a file.',
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
					disabled={!bookmarkCount && sessions.length === 0}
					onClick={() =>
						setBackupData(
							settings.bookmarksEnabled !== false && bookmarkCount > 0
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
			help: 'Bring in bookmarks or sessions from a file or your browser.',
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
					disabled={sessionParts.length === 0 && bookmarkParts.length === 0}
					onClick={(event) => askErase(event.currentTarget)}
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
	const showExcluded =
		(!searching || settings.sessionsEnabled !== false) &&
		matchesQuery(query, [
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
	const matchCount =
		Number(showAppearance) +
		systemRows.length +
		visibleGroups.reduce((sum, entry) => sum + entry.fields.length, 0) +
		collapsedGroups.length +
		visibleData.length +
		Number(showExcluded) +
		Number(showDefaults);
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
		<PageShell data-brand="tablodge" className="max-w-4xl">
			<PageTop />
			<div role="search" className="relative -mt-3 mb-6">
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
			<p className="sr-only" role="status" aria-live="polite">
				{searching
					? matchCount
						? `${plural(matchCount, 'setting')} found.`
						: 'No settings found.'
					: ''}
			</p>

			{searching && !matchCount ? (
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
			) : (
				<div className="grid gap-5">
					{showAppearance && (
						<section className="flex flex-col justify-between gap-5 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-center">
							<div>
								<h2 className="font-semibold">{hl(APPEARANCE.title)}</h2>
								<p className="mt-1 text-sm text-muted-foreground">
									{hl(APPEARANCE.help)}
								</p>
							</div>
							<div
								className="flex flex-wrap gap-2"
								role="radiogroup"
								aria-label="Appearance"
							>
								{(
									[
										['system', Laptop, 'System'],
										['light', Sun, 'Light'],
										['dark', Moon, 'Dark'],
									] as const
								).map(([value, Icon, label]) => (
									<Button
										key={value}
										type="button"
										variant={theme === value ? 'default' : 'outline'}
										size="sm"
										role="radio"
										aria-checked={theme === value}
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
						</section>
					)}

					{systemRows.length > 0 && (
						<SectionCard
							title={hl(SYSTEMS.title)}
							description={SYSTEMS.description}
							icon={Settings2}
						>
							<div className="space-y-1">
								{systemRows.map(({name, label, help, otherLabel}) => {
									const locked =
										settings[
											`${otherLabel.toLowerCase()}Enabled` as
												'sessionsEnabled' | 'bookmarksEnabled'
										] === false;
									return (
										<SettingRow
											key={name}
											label={hl(label)}
											help={hl(help)}
											noteId={`${name}-note`}
											note={
												locked &&
												`Stays on while ${otherLabel} is off. Turn ${otherLabel} on to change this.`
											}
										>
											<Switch
												checked={settings[name] !== false}
												readOnly={locked}
												aria-label={label}
												aria-describedby={locked ? `${name}-note` : undefined}
												onCheckedChange={(value) => updateSetting(name, value)}
											/>
										</SettingRow>
									);
								})}
							</div>
							{(!searching || titleHit(SYSTEMS.title)) && (
								<p className="mt-4 rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
									{SYSTEMS.note}
								</p>
							)}
						</SectionCard>
					)}

					{[
						...visibleGroups.map(({group, fields}) => ({
							group,
							fields,
							off: false,
						})),
						...collapsedGroups.map((group) => ({
							group,
							fields: [] as SettingField[],
							off: true,
						})),
					]
						.toSorted(
							(a, b) =>
								settingsGroups.indexOf(a.group) -
								settingsGroups.indexOf(b.group),
						)
						.map(({group, fields, off}) =>
							off ? (
								<SectionCard
									key={group.title}
									title={group.title}
									description={group.description}
									icon={group.icon}
								>
									<div className="flex flex-wrap items-center justify-between gap-3">
										<p className="text-sm text-muted-foreground">
											{group.system === 'sessions'
												? 'Sessions are turned off.'
												: 'Bookmarks are turned off.'}
										</p>
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												updateSetting(
													group.system === 'sessions'
														? 'sessionsEnabled'
														: 'bookmarksEnabled',
													true,
												)
											}
										>
											Turn on
										</Button>
									</div>
								</SectionCard>
							) : (
								<SectionCard
									key={group.title}
									title={hl(group.title)}
									description={group.description}
									icon={group.icon}
								>
									<div className="divide-y divide-border/70">
										{fields.map((field) => (
											<SettingRow
												key={field.name}
												label={hl(field.label)}
												help={hl(field.help)}
												hint={
													searching &&
													field.type === 'select' &&
													!matchesQuery(query, [field.label, field.help])
														? field.options
																.map(([, label]) => label)
																.filter((label) => matchesAnyTerm(query, label))
														: undefined
												}
												inset={Boolean(field.requires)}
												highlight={query}
											>
												{field.type === 'switch' ? (
													<Switch
														checked={
															field.name === 'stretchBookmarkColumns'
																? settings.stretchBookmarkColumns !== false
																: Boolean(settings[field.name])
														}
														aria-label={field.label}
														disabled={
															field.requires !== undefined &&
															settings[field.requires] === false
														}
														onCheckedChange={(value) =>
															updateSetting(field.name, value)
														}
													/>
												) : (
													<Select
														value={settings[field.name] || field.options[0][0]}
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
								</SectionCard>
							),
						)}

					{visibleData.length > 0 && (
						<SectionCard
							title={hl(DATA.title)}
							description={DATA.description}
							icon={Database}
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
							title={hl(EXCLUDED.title)}
							description={EXCLUDED.description}
							icon={Settings2}
							action={
								settings.sessionsEnabled !== false && (
									<Button variant="outline" size="sm" onClick={openSiteDialog}>
										<Plus className="h-4 w-4" />
										Add site
									</Button>
								)
							}
						>
							{settings.sessionsEnabled === false ? (
								<div className="flex flex-wrap items-center justify-between gap-3">
									<p className="text-sm text-muted-foreground">
										Sessions are turned off.
									</p>
									<Button
										variant="outline"
										size="sm"
										onClick={() => updateSetting('sessionsEnabled', true)}
									>
										Turn on
									</Button>
								</div>
							) : (
								<>
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
								</>
							)}
						</SectionCard>
					)}

					{showDefaults && (
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-4">
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
				description={`${PROJECT.name} preferences will return to their default values. Saved sessions and bookmarks will not be changed.`}
				confirmLabel="Restore defaults"
				busy={resetBusy}
				onOpenChange={setConfirmDefaults}
				onConfirm={restoreDefaults}
			/>
			<ConfirmationDialog
				open={Boolean(erase)}
				title="Erase data?"
				description="Choose what to erase. This can’t be undone. Settings and excluded sites are kept."
				requireText={eraseScope === 'all' ? ERASE_WORD : undefined}
				confirmLabel={eraseScope ? eraseLabel[eraseScope] : 'Erase'}
				confirmDisabled={!eraseScope}
				busy={Boolean(erase?.busy)}
				restoreFocusTo={eraseFocusRef.current}
				onOpenChange={(open) => !open && !erase?.busy && setErase(null)}
				onConfirm={confirmErase}
			>
				<div className="grid gap-2">
					{(
						[
							['sessions', 'Sessions', sessionParts],
							['bookmarks', 'Bookmarks', bookmarkParts],
						] as const
					).map(([key, label, parts]) => (
						<div
							key={key}
							className={`flex items-start rounded-lg border border-border ${parts.length === 0 ? 'opacity-60' : 'has-[[data-state=checked]]:border-destructive/60 has-[[data-state=checked]]:bg-destructive/5'}`}
						>
							<Checkbox
								id={`erase-${key}`}
								className="ml-3.5 mt-3.5"
								disabled={parts.length === 0 || Boolean(erase?.busy)}
								checked={Boolean(erase?.[key])}
								onCheckedChange={(checked) =>
									setErase((current) =>
										current ? {...current, [key]: checked === true} : current,
									)
								}
							/>
							<Label
								htmlFor={`erase-${key}`}
								className={`block min-w-0 flex-1 py-3 pl-3 pr-3.5 ${parts.length === 0 ? 'cursor-not-allowed' : 'cursor-pointer'}`}
							>
								<span className="block text-sm font-medium">{label}</span>
								<span className="block text-xs font-normal leading-5 text-muted-foreground">
									{parts.length > 0 ? listing(parts) : 'Nothing saved.'}
								</span>
							</Label>
						</div>
					))}
				</div>
			</ConfirmationDialog>
			<BackupDialog
				state={state}
				data={backupData}
				open={Boolean(backupData)}
				showStatus={showStatus}
				onOpenChange={(open) => !open && setBackupData(null)}
			/>
			<ImportDialog
				open={importOpen}
				initialKind={
					settings.bookmarksEnabled === false ? 'sessions' : 'bookmarks'
				}
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
										className={`min-h-5 text-xs leading-5 ${siteError ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
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
										className={`min-h-5 text-xs leading-5 ${siteFieldError ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
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
			<footer className="mt-6 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
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

// A subtle <mark> around the parts of `text` that match the search query; the text itself never changes, so nothing shifts.
function Highlight({text, query}: {text: string; query: string}) {
	if (!query.trim()) {
		return <>{text}</>;
	}

	return (
		<>
			{highlightSegments(text, query).map((segment, index) =>
				segment.match ? (
					<mark
						key={index}
						className="rounded-sm bg-primary/15 px-0 text-inherit"
					>
						{segment.text}
					</mark>
				) : (
					<Fragment key={index}>{segment.text}</Fragment>
				),
			)}
		</>
	);
}

function SettingRow({
	label,
	help,
	note,
	noteId,
	hint,
	highlight = '',
	inset,
	children,
}: {
	label: ReactNode;
	help?: ReactNode;
	note?: ReactNode;
	noteId?: string;
	/** Select options that matched the search while the label and help did not. */ hint?: string[];
	highlight?: string;
	inset?: boolean;
	children?: ReactNode;
}) {
	return (
		<div
			className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between ${inset ? 'pl-5' : ''}`}
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
				{Boolean(note) && (
					<p
						id={noteId}
						className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-primary"
					>
						<LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						{note}
					</p>
				)}
			</div>
			<div className="shrink-0">{children}</div>
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
