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
	RefreshCw,
	Sun,
	Keyboard,
	Laptop,
	Trash2,
	Download,
	Bookmark,
	Database,
	Plus,
	ChartColumn,
	Eraser,
	LifeBuoy,
	MousePointerClick,
	Globe,
	Layers2,
	Upload,
	Search,
	X,
	ChevronDown,
	ArrowDown,
	ArrowUp,
	Check,
	Inbox,
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
	Popover,
	PopoverTrigger,
	PopoverContent,
} from '../shared/ui';
import '../../styles/extension-app.css';
import {ACCENTS, DEFAULT_ACCENT} from '../shared/accents';
import {ThemeProvider, useTheme} from '../shared/theme';
import {
	SHORTCUTS_HINT,
	isFirefox,
	toolbarOpensSidePanel,
	openShortcutsPage,
} from '../shared/browser';
import {radioTargetIndex} from '../shared/radio-keys';
import type {
	ActionResult,
	BookmarkQuickAction,
	EraseScope,
	SessionQuickAction,
	Settings,
} from '../shared/types';
import {
	matchesAnyTerm,
	matchesQuery,
	rankByQuery,
	scoreQuery,
	sortByQuery,
	searchTerms,
} from '../shared/fuzzy';
import {
	excludedHostError,
	normalizeExcludedHost,
	parseExcludedLines,
} from '../shared/excluded-sites';
import {bookmarkShareGroups} from '../shared/export-formats';
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
	plural,
	send,
	useStatus,
	useTabLodgeState,
	type IconComponent,
} from './common';
import {
	ImportDialog,
	RecoveryTools,
	SnapshotsDialog,
	TabStatsDialog,
	TrashDialog,
	useShareDialog,
} from './lazy-dialogs';
import {canOpenPrivateWindow} from './link-target';
import {offerUndo} from './recovery-core';
import {initialSearchQuery, withSearchParam} from './page-params';
import {Highlight} from './highlight';
import {PROJECT} from './project';
import {ColumnSelect} from './column-select';
import {
	PrivateStorageSettings,
	PRIVATE_STORAGE_TITLE,
	PRIVATE_STORAGE_WORDS,
} from './private-storage';
import {PrivateWindowAppearance} from './private-window-appearance';
import {PrivateSyncSettings} from './private-sync-settings';
import {SYNC_TITLE, SYNC_WORDS, SyncSettings} from './sync-settings';
import {sectionId} from './settings-sections';
import {
	RECOVERY_TITLE,
	SETTING_WORDS,
	settingsFieldGroups,
	type SettingField,
} from './settings-fields';
import {
	SiteSourcesSettings,
	SourcesHeaderActions,
	SOURCES_DESCRIPTION,
	SOURCES_TITLE,
	SOURCES_WORDS,
	useSiteSources,
} from './site-sources-settings';
import {PrivateLockGate} from './private-lock-ui';
import {cn} from '@/lib/utils';

const listing = (parts: string[]) =>
	parts.length < 2
		? parts.join('')
		: `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
const GROUP_ICONS: Record<string, IconComponent> = {
	[`Opening ${PROJECT.name}`]: Laptop,
	Dashboard: LayoutDashboard,
	'When saving': Layers2,
	'Right-click menus': MousePointerClick,
	'When restoring': RotateCcw,
	'Session board': Layers2,
	'Bookmark board': Bookmark,
	[RECOVERY_TITLE]: LifeBuoy,
};
const settingsGroups = settingsFieldGroups({
	appName: PROJECT.name,
	firefox: isFirefox,
	sidePanel: toolbarOpensSidePanel,
	privateWindows: canOpenPrivateWindow,
}).map((group) => ({...group, icon: GROUP_ICONS[group.title] ?? Layers2}));
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
	'Add a backup',
	'undo',
	'deleted items',
	'crash',
	'password',
	'Downloads permission',
];

const footerLinks = [
	{label: 'Source code', href: PROJECT.repoUrl, external: true},
	{label: 'Report an issue', href: PROJECT.issuesUrl, external: true},
	{label: 'Help', href: 'help.html', external: false},
];

const fieldSearchText = (field: SettingField) => [
	field.label,
	field.help,
	...(SETTING_WORDS[field.name] ?? []),
	...('options' in field ? field.options.map(([, label]) => label) : []),
];

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
	description:
		'Sessions and bookmarks are stored in this browser, and on your own server when Sync is on.',
};
const EXCLUDED = {
	title: 'Excluded websites',
	description:
		'Excludes a website and all its subdomains from future session saves. Existing sessions and bookmarks are unchanged.',
	words: ['exclude', 'ignore', 'site', 'origin', 'host', 'domain', 'Add site'],
};
const DEFAULTS = {
	title: 'Restore default settings',
	help: 'Saved sessions and bookmarks are not changed.',
	words: ['Restore defaults', 'reset', 'factory'],
};
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
	...(isFirefox ? [] : [{title: PRIVATE_STORAGE_TITLE, icon: Database}]),
	...settingsGroups.map(({title, icon}) => ({title, icon})),
	{title: DATA.title, icon: Database},
	{title: SYNC_TITLE, icon: RefreshCw},
	{title: SOURCES_TITLE, icon: Inbox},
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
	const loadedSettingsRef = useRef(false);
	const resetGroupRef = useRef(
		async (_title: string, _fields: SettingField[]) => undefined as unknown,
	);
	const savesInFlightRef = useRef(0);
	const [status, showStatus] = useStatus();
	const siteSources = useSiteSources(showStatus);
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
	const [question, setQuestion] = useState<{
		title: string;
		description: string;
		confirmLabel: string;
		run: () => unknown;
		section: string;
	}>();
	const [questionOpen, setQuestionOpen] = useState(false);
	const ask = (next: NonNullable<typeof question>) => {
		setQuestion(next);
		setQuestionOpen(true);
	};

	const {openShare, shareDialog} = useShareDialog(showStatus);
	const [importOpen, setImportOpen] = useState(false);
	const [snapshotsOpen, setSnapshotsOpen] = useState(false);
	const [trashOpen, setTrashOpen] = useState(false);
	const [statsOpen, setStatsOpen] = useState(false);
	const [downloadsGranted, setDownloadsGranted] = useState(false);
	useEffect(() => {
		void Promise.resolve(
			chrome.permissions?.contains({permissions: ['downloads']}),
		)
			.then((granted) => setDownloadsGranted(Boolean(granted)))
			.catch(() => undefined);
	}, []);
	const dataRef = useRef<HTMLDivElement>(null);
	const hashHandledRef = useRef(false);
	useEffect(() => {
		if (!state || hashHandledRef.current) {
			return;
		}

		hashHandledRef.current = true;
		const target = location.hash
			? document.querySelector<HTMLElement>(
					`#${CSS.escape(decodeURIComponent(location.hash.slice(1)))}`,
				)
			: null;
		if (!target) {
			return;
		}

		target.setAttribute('tabindex', '-1');
		target.classList.add('focus:outline-hidden');
		target.scrollIntoView({block: 'start'});
		target.focus({preventScroll: true});
	}, [state]);
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
			if (!result.ok) {
				return;
			}

			setDefaultSettings(result.settings);
			if (loadedSettingsRef.current) {
				return;
			}

			setSettings(result.settings);
			setExcluded(result.settings.excludedOrigins || []);
		});
	}, []);

	useEffect(() => {
		if (!state?.settings || savesInFlightRef.current > 0) {
			return;
		}

		loadedSettingsRef.current = true;
		setSettings(state.settings);
		setExcluded(state.settings.excludedOrigins || []);
	}, [state]);

	async function updateSetting(
		name: keyof Settings,
		value: boolean | string | number | string[],
		savedMessage = 'Setting saved.',
	) {
		if (!state) {
			return;
		}

		if (
			name === 'actionMode' &&
			value === 'sidepanel' &&
			!toolbarOpensSidePanel
		) {
			showStatus(
				'The browser Side Panel API is unavailable in this version.',
				true,
			);
			return;
		}

		if (name === 'autoBackupToDownloads') {
			if (value === true) {
				let granted = false;
				try {
					granted = await chrome.permissions.request({
						permissions: ['downloads'],
					});
				} catch {}

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
				} catch {}

				setDownloadsGranted(false);
			}
		}

		setSettings((current) => ({...current, [name]: value}));
		savesInFlightRef.current += 1;
		try {
			const result = await send('UPDATE_SETTINGS', {
				settings: {[name]: value},
			});
			if (result?.ok) {
				showStatus(savedMessage);
			} else {
				showStatus(result?.error || 'Could not save that setting.', true);
			}
		} finally {
			savesInFlightRef.current -= 1;
			if (savesInFlightRef.current === 0) {
				await reload();
			}
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

	function openSiteDialog() {
		setExcludedDraft('');
		setSiteError('');
		setSiteBusy(false);
		setSiteDialog(true);
	}

	async function addExcludedOrigin(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!state || !siteValid || siteBusy) {
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
		if (!state) {
			return;
		}

		const result = await send('REMOVE_EXCLUDED_ORIGIN', {origin});
		if (result?.ok) {
			setExcluded(result.settings.excludedOrigins || []);
			showStatus('Website exclusion removed.');
		} else {
			showStatus(result?.error || 'Could not remove that website.', true);
		}
	}

	async function restoreDefaults() {
		if (!state || resetBusy) {
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

	if (!state && error) {
		return (
			<PageShell className="max-w-4xl">
				<PageTop />
				<LoadError message={error} />
			</PageShell>
		);
	}

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
	const rowAvailable = (field: SettingField) =>
		!field.when || field.when(settings as Settings);
	const rowDisabled = (field: SettingField) =>
		!state ||
		!rowAvailable(field) ||
		(field.requires !== undefined && settings[field.requires] === false) ||
		(field.enabled !== undefined && !field.enabled(settings as Settings));

	const fieldShown = (field: SettingField) =>
		!state || (rowAvailable(field) && (searching || !rowDisabled(field)));
	const changedFromDefault = (field: SettingField) => {
		if (!state || !defaultSettings) {
			return false;
		}

		const value = settings[field.name];
		const defaultValue = defaultSettings[field.name];
		return Array.isArray(value) && Array.isArray(defaultValue)
			? value.length !== defaultValue.length ||
					value.some((entry, index) => entry !== defaultValue[index])
			: !Object.is(value, defaultValue);
	};

	const resetGroup = async (title: string, fields: SettingField[]) => {
		if (!state || !defaultSettings) {
			return;
		}

		const changed = fields.filter((field) => changedFromDefault(field));
		if (changed.length === 0) {
			return;
		}

		const values = Object.fromEntries(
			changed.map((field) => [field.name, defaultSettings[field.name]]),
		);
		const before = Object.fromEntries(
			changed
				.filter((field) => settings[field.name] !== undefined)
				.map((field) => [field.name, settings[field.name]]),
		);
		setSettings((current) => ({...current, ...values}));
		savesInFlightRef.current += 1;
		try {
			const result = await send('UPDATE_SETTINGS', {settings: values});
			if (result?.ok) {
				showStatus(`Restored ${title} to its defaults.`, false, {
					action: {
						label: 'Undo',
						async onClick() {
							setSettings((current) => ({...current, ...before}));
							const undone = await send('UPDATE_SETTINGS', {settings: before});
							if (undone?.ok) {
								showStatus(`Undone: restored ${title}.`, false, {toast: true});
							} else {
								showStatus(undone?.error || 'Could not undo that.', true);
							}

							await reload();
						},
					},
				});
			} else {
				showStatus(result?.error || 'Could not save those settings.', true);
			}
		} finally {
			savesInFlightRef.current -= 1;
			if (savesInFlightRef.current === 0) {
				await reload();
			}
		}
	};

	resetGroupRef.current = resetGroup;

	const focusSettingControl = (field: SettingField) => {
		const dependency = field.requires ?? field.parent;
		const name = rowDisabled(field) && dependency ? dependency : field.name;
		const row = [
			...document.querySelectorAll<HTMLElement>('[data-setting-row]'),
		].find((element) => element.dataset.settingRow === name);
		const control = row?.querySelector<HTMLElement>(
			'[data-setting-control]:not([disabled]), [role="switch"]:not([disabled]), [role="combobox"]:not([disabled]), input:not([disabled])',
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
	const recoveryTools =
		!searching ||
		titleHit(RECOVERY_TITLE) ||
		matchesQuery(query, RECOVERY_TOOLS_TEXT);
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

	function openDataShare() {
		const sessionData = {
			kind: 'sessions' as const,
			groups: state?.groups ?? [],
			folders: state?.folders ?? [],
		};
		const bookmarks = {
			kind: 'bookmarks' as const,
			columns: state?.bookmarkColumns ?? [],
			bookmarks: state?.bookmarks ?? [],
		};
		openShare({
			title: 'Share and export',
			sources: [
				...(sessionData.groups.length > 0
					? [
							{
								id: 'sessions',
								label: 'All sessions',
								pageTitle: 'Shared sessions',
								groups: sessionData.groups,
								data: sessionData,
							},
						]
					: []),
				...(bookmarks.bookmarks.length > 0
					? [
							{
								id: 'bookmarks',
								label: 'All bookmarks',
								pageTitle: 'Shared bookmarks',
								groups: bookmarkShareGroups(bookmarks),
								data: bookmarks,
							},
						]
					: []),
			],
			backup: true,
			initialSource: 'everything',
		});
	}

	const dataRows: DataRowDef[] = [
		{
			key: 'backup',
			icon: Download,
			label: 'Share and export',
			help: 'Share or save sessions and bookmarks, or back up everything to one file you can restore with Import.',
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
					disabled={!state}
					onClick={openDataShare}
				>
					<Download className="h-4 w-4" />
					Export
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
			key: 'statistics',
			icon: ChartColumn,
			label: 'Statistics',
			help: 'See how many sessions and tabs you have saved, which open tabs you have not used for the longest, and a rough memory estimate.',
			words: [
				'stats',
				'count',
				'saved tabs',
				'oldest tabs',
				'open tabs',
				'memory',
				'RAM',
				'unused',
			],
			action: (
				<Button
					variant="outline"
					className="w-full sm:w-32"
					disabled={!state}
					onClick={() => setStatsOpen(true)}
				>
					<ChartColumn className="h-4 w-4" />
					View
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
					variant="destructive"
					className="w-full sm:w-32"
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
	const showSync = matchesQuery(query, [SYNC_TITLE, ...SYNC_WORDS]);
	const showSources = matchesQuery(query, [
		SOURCES_TITLE,
		SOURCES_DESCRIPTION,
		...SOURCES_WORDS,
	]);
	const showPrivate =
		!isFirefox &&
		matchesQuery(query, [PRIVATE_STORAGE_TITLE, ...PRIVATE_STORAGE_WORDS]);
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
		Number(showSync) +
		Number(showSources) +
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

					case SYNC_TITLE: {
						return showSync;
					}

					case SOURCES_TITLE: {
						return showSources;
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
		<PageShell
			className="max-w-6xl lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-x-8"
			aria-busy={!state}
		>
			{!state && <LoadingLine />}
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
						className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => {
							updateQuery('');
							searchRef.current?.focus();
						}}
					>
						<X className="h-4 w-4" aria-hidden="true" />
					</button>
				) : (
					<span
						className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1 text-[0.6875rem] text-muted-foreground sm:flex"
						aria-hidden="true"
					>
						<kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-sans">
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
								'inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-sm outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring',
								activeSection === id
									? 'bg-primary/10 font-medium text-primary'
									: 'text-muted-foreground hover:bg-muted hover:text-foreground',
							)}
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
								<X aria-hidden="true" />
								Clear search
							</Button>
						}
					>
						Try a different word, such as “tabs”, “restore”, or “back up”.
					</EmptyState>
				</div>
			) : (
				<div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:col-start-2 lg:row-start-3">
					{showAppearance && (
						<SectionCard
							id={sectionId(APPEARANCE.title)}
							title={hl(APPEARANCE.title)}
							description={hl(APPEARANCE.help)}
							icon={Sun}
							className={SECTION_SCROLL_CLASS}
						>
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
						</SectionCard>
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
							description="Where private windows keep their library, how it is locked, and how they look."
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
							reset={
								fields.some((field) => changedFromDefault(field)) && (
									<IconTooltip label={`Reset ${group.title} to default`}>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="h-8 w-8 shrink-0"
											aria-label={`Reset ${group.title} to default`}
											onClick={() => {
												ask({
													title: `Reset ${group.title} to default?`,
													description: `Every changed setting in ${group.title} goes back to its default. You can undo this right after.`,
													confirmLabel: 'Reset',
													run: async () =>
														resetGroupRef.current(group.title, fields),
													section: group.title,
												});
											}}
										>
											<RotateCcw className="h-4 w-4" aria-hidden="true" />
										</Button>
									</IconTooltip>
								)
							}
						>
							<div className="divide-y divide-border/70">
								{fields.map((field) => (
									<SettingRow
										key={field.name}
										settingName={field.name}
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
											'options' in field &&
											!matchesQuery(query, [field.label, field.help])
												? field.options
														.map(([, label]) => label)
														.filter((label) => matchesAnyTerm(query, label))
												: undefined
										}
										inset={Boolean(
											field.requires || field.enabled || field.parent,
										)}
										highlight={query}
										reset={
											changedFromDefault(field) && defaultSettings ? (
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
											) : undefined
										}
									>
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
										) : field.type === 'checkbox-dropdown' ? (
											<QuickActionsSetting
												label={field.label}
												actions={settings[field.name] ?? []}
												options={field.options}
												maxActions={
													'maxActions' in field ? field.maxActions : undefined
												}
												disabled={rowDisabled(field)}
												onChange={(actions) =>
													updateSetting(field.name, actions)
												}
											/>
										) : field.type === 'number-select' ? (
											<NumberSelectSetting
												label={field.label}
												value={
													settings[field.name] ?? Number(field.options[0][0])
												}
												options={field.options}
												custom={field.custom}
												disabled={rowDisabled(field)}
												onCommit={(value) => updateSetting(field.name, value)}
											/>
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
								className="focus-visible:outline-hidden"
								aria-label="Session and bookmark data"
							>
								<div className="divide-y divide-border/70">
									{dataRowElements}
								</div>
							</div>
						</SectionCard>
					)}

					{showSync && (
						<SectionCard
							id={sectionId(SYNC_TITLE)}
							title={hl(SYNC_TITLE)}
							description="Keep your sessions and bookmarks the same in every browser you use, through a server you run."
							icon={RefreshCw}
							className={SECTION_SCROLL_CLASS}
						>
							{chrome.extension?.inIncognitoContext ? (
								<PrivateSyncSettings showStatus={showStatus} />
							) : (
								<>
									<SyncSettings showStatus={showStatus} />
									{!isFirefox && (
										<p className="mt-4 text-xs leading-[1.6667] text-muted-foreground">
											Private windows with their own saved storage sync
											separately. To include them, open Settings in a private
											window.
										</p>
									)}
								</>
							)}
						</SectionCard>
					)}

					{showSources && (
						<SectionCard
							id={sectionId(SOURCES_TITLE)}
							title={hl(SOURCES_TITLE)}
							description={SOURCES_DESCRIPTION}
							icon={Inbox}
							className={SECTION_SCROLL_CLASS}
							action={<SourcesHeaderActions controller={siteSources} />}
						>
							<SiteSourcesSettings
								controller={siteSources}
								columns={state?.bookmarkColumns ?? []}
								settings={settings}
								onCatchUpChange={(mode) => {
									void updateSetting(
										'sourceCatchUp',
										mode,
										mode === 'ask'
											? 'Saved page catch-up asks first.'
											: 'Saved page catch-up adds the missing items.',
									);
								}}
							/>
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
								<Button
									variant="outline"
									size="sm"
									disabled={!state}
									onClick={openSiteDialog}
								>
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
												disabled={!state}
												aria-label={`Remove ${origin} from exclusions`}
												onClick={() => {
													ask({
														title: `Stop excluding ${origin}?`,
														description: `Sessions you save from now on include pages on ${origin} and its subdomains again.`,
														confirmLabel: 'Remove',
														run: async () => removeExcludedOrigin(origin),
														section: EXCLUDED.title,
													});
												}}
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
								disabled={!state || busy === 'defaults'}
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
				open={questionOpen}
				title={question?.title}
				description={question?.description}
				confirmLabel={question?.confirmLabel}
				onOpenChange={setQuestionOpen}
				onConfirm={() => {
					setQuestionOpen(false);
					if (!question) {
						return;
					}

					void (async () => {
						await question.run();
						requestAnimationFrame(() => {
							(
								document.querySelector<HTMLElement>(
									`#${sectionId(question.section)} :is(button, input):not(:disabled)`,
								) ?? searchRef.current
							)?.focus();
						});
					})();
				}}
			/>
			<ConfirmationDialog
				open={confirmDefaults}
				title="Restore default settings?"
				description="Your settings go back to their defaults. Sessions and bookmarks are kept, and you can undo this right after."
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
			{shareDialog}
			<SnapshotsDialog
				confirmDestructive
				open={snapshotsOpen}
				showStatus={showStatus}
				onOpenChange={setSnapshotsOpen}
				onSessionsChanged={reload}
			/>
			<TabStatsDialog
				open={statsOpen}
				sessions={state?.groups ?? []}
				simplifyUrls={settings.simplifyUrls !== false}
				onOpenChange={setStatsOpen}
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
											'min-h-5 text-xs leading-[1.6667]',
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
												<ul className="mt-1 max-h-20 overflow-auto font-mono wrap-anywhere">
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
										className="aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive"
										onChange={(event) => {
											setExcludedDraft(event.target.value);
											setSiteError('');
										}}
									/>
									<p
										id="excluded-origin-message"
										className={cn(
											'min-h-5 text-xs leading-[1.6667]',
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
								<X aria-hidden="true" />
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
			<footer className="mt-6 border-t border-border pt-4 text-xs leading-[1.6667] text-muted-foreground lg:col-start-2">
				<p>
					{PROJECT.name} reads tab details to save sessions and check for
					duplicates. It reads a page only when you choose Keep a copy for it,
					or when you save on a site you added in Sources. Your library is
					stored in this browser’s local extension storage.
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
								className="rounded-xs font-medium hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
		globalThis.addEventListener('focus', read);
		return () => {
			alive = false;
			globalThis.removeEventListener('focus', read);
		};
	}, []);

	return (
		<SectionCard
			id={id}
			title={title}
			description={help}
			icon={Keyboard}
			className={SECTION_SCROLL_CLASS}
			action={
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={async () => setFailed(!(await openShortcutsPage()))}
				>
					<Keyboard className="h-4 w-4" />
					Configure shortcuts
				</Button>
			}
		>
			{failed && (
				<p role="alert" className="text-xs text-muted-foreground">
					Your browser did not open it. {SHORTCUTS_HINT}
				</p>
			)}
			{commands.length > 0 && (
				<dl
					className={cn(
						'grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2',
						failed && 'mt-4',
					)}
				>
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
									<kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
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
		</SectionCard>
	);
}

function QuickActionsSetting<
	Action extends BookmarkQuickAction | SessionQuickAction,
>({
	label,
	actions,
	options,
	maxActions,
	disabled,
	onChange,
}: {
	label: string;
	actions: Action[];
	options: Array<[Action, string]>;
	maxActions?: number;
	disabled: boolean;
	onChange: (actions: Action[]) => void;
}) {
	const [query, setQuery] = useState('');
	const searchRef = useRef<HTMLInputElement>(null);
	const hasMatches = options.some(([, actionLabel]) =>
		actionLabel.toLowerCase().includes(query.toLowerCase()),
	);
	const summary =
		actions.length === 0
			? 'None'
			: actions.length === 1
				? (options.find(([action]) => action === actions[0])?.[1] ??
					'1 selected')
				: `${actions.length} selected`;
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					data-setting-control
					type="button"
					variant="outline"
					size="sm"
					className="w-full justify-between sm:w-64"
					aria-label={`${label}: ${summary}`}
					disabled={disabled}
				>
					<span className="truncate">{summary}</span>
					<ChevronDown aria-hidden="true" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 p-0" aria-label={label}>
				<div className="border-b border-border p-3">
					<Input
						ref={searchRef}
						autoFocus
						value={query}
						placeholder="Find an action"
						aria-label={`Find ${label.toLowerCase()}`}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<p className="mt-2 text-xs text-muted-foreground">
						{maxActions
							? `${actions.length} of ${maxActions} selected`
							: `${actions.length} selected`}
					</p>
					{actions.length > 0 && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="mt-2 h-9 w-full justify-center"
							onClick={() => {
								searchRef.current?.focus();
								onChange([]);
							}}
						>
							<X aria-hidden="true" />
							Clear all
						</Button>
					)}
				</div>
				<div className="max-h-80 overflow-y-auto p-2">
					{actions.length > 0 && (
						<section aria-label="Selected actions">
							<p className="px-2 py-1 text-xs font-medium text-muted-foreground">
								Selected
							</p>
							{actions.map((action, index) => {
								const actionLabel =
									options.find(([item]) => item === action)?.[1] ?? action;
								if (!actionLabel.toLowerCase().includes(query.toLowerCase())) {
									return null;
								}

								return (
									<div
										key={action}
										className="flex min-h-9 items-center gap-1 rounded-xs px-2 text-sm hover:bg-accent"
									>
										<Check
											aria-hidden="true"
											className="mr-1 h-4 w-4 text-primary"
										/>
										<span className="min-w-0 flex-1 truncate">
											{actionLabel}
										</span>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="h-7 w-7"
											aria-label={`Move ${actionLabel} up`}
											disabled={index === 0}
											onClick={() => {
												const reordered = [...actions];
												[reordered[index - 1], reordered[index]] = [
													reordered[index],
													reordered[index - 1],
												];
												onChange(reordered);
											}}
										>
											<ArrowUp aria-hidden="true" className="h-4 w-4" />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="h-7 w-7"
											aria-label={`Move ${actionLabel} down`}
											disabled={index === actions.length - 1}
											onClick={() => {
												const reordered = [...actions];
												[reordered[index], reordered[index + 1]] = [
													reordered[index + 1],
													reordered[index],
												];
												onChange(reordered);
											}}
										>
											<ArrowDown aria-hidden="true" className="h-4 w-4" />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="h-7 px-2"
											aria-label={`Remove ${actionLabel}`}
											onClick={() =>
												onChange(actions.filter((item) => item !== action))
											}
										>
											<X aria-hidden="true" className="h-4 w-4" />
										</Button>
									</div>
								);
							})}
						</section>
					)}
					{!hasMatches && (
						<p className="px-2 py-3 text-sm text-muted-foreground">
							No matching actions
						</p>
					)}
					<section
						aria-label="Available actions"
						className={
							actions.length > 0 ? 'mt-2 border-t border-border pt-2' : ''
						}
					>
						<p className="px-2 py-1 text-xs font-medium text-muted-foreground">
							Available actions
						</p>
						{options
							.filter(
								([action, actionLabel]) =>
									!actions.includes(action) &&
									actionLabel.toLowerCase().includes(query.toLowerCase()),
							)
							.map(([action, actionLabel]) => {
								const atLimit =
									maxActions !== undefined && actions.length >= maxActions;
								return (
									<Button
										key={action}
										type="button"
										variant="ghost"
										disabled={atLimit}
										className="h-9 w-full justify-start px-2 font-normal"
										aria-label={`Add ${actionLabel}`}
										onClick={() => onChange([...actions, action])}
									>
										<Plus aria-hidden="true" className="mr-2 h-4 w-4" />
										{actionLabel}
									</Button>
								);
							})}
					</section>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function SettingRow({
	label,
	help,
	hint,
	highlight = '',
	inset,
	settingName,
	reset,
	children,
}: {
	label: ReactNode;
	help?: ReactNode;
	hint?: string[];
	highlight?: string;
	inset?: boolean;
	settingName: string;
	reset?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div
			data-setting-row={settingName}
			className={cn(
				'flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between',
				inset && 'ml-2 border-l-2 border-border pl-4',
			)}
		>
			<div className="min-w-0">
				<p className="text-sm font-medium">{label}</p>
				{Boolean(help) && (
					<p className="mt-1 max-w-xl text-xs leading-[1.6667] text-muted-foreground">
						{help}
					</p>
				)}
				{hint && hint.length > 0 && (
					<p className="mt-1 text-xs leading-[1.6667] text-muted-foreground">
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
			<div className="flex min-w-0 items-start gap-2 sm:shrink-0 sm:justify-end">
				{Boolean(reset) && (
					<span className="flex h-9 shrink-0 items-center">{reset}</span>
				)}
				<div className="flex min-h-9 min-w-0 flex-1 flex-col justify-center sm:flex-none">
					{children}
				</div>
			</div>
		</div>
	);
}

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

const CUSTOM_OPTION = 'custom';

function NumberSelectSetting({
	label,
	value,
	options,
	custom,
	disabled,
	onCommit,
}: {
	label: string;
	value: number;
	options: Array<[string, string]>;
	custom?: {min: number; max: number; suffix: string};
	disabled: boolean;
	onCommit: (value: number) => void;
}) {
	const [customPicked, setCustomPicked] = useState(false);
	const isPreset = options.some(([option]) => Number(option) === value);
	const showCustom = custom !== undefined && (customPicked || !isPreset);
	return (
		<div className="flex items-center gap-2 sm:flex-col sm:items-end">
			<Select
				value={showCustom ? CUSTOM_OPTION : String(value)}
				disabled={disabled}
				onValueChange={(next) => {
					if (next === CUSTOM_OPTION) {
						setCustomPicked(true);
						return;
					}

					setCustomPicked(false);
					onCommit(Number(next));
				}}
			>
				<SelectTrigger
					className="min-w-0 flex-1 sm:w-64 sm:flex-none"
					aria-label={label}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map(([option, optionLabel]) => (
						<SelectItem key={option} value={option}>
							{optionLabel}
						</SelectItem>
					))}
					{custom && <SelectItem value={CUSTOM_OPTION}>Custom…</SelectItem>}
				</SelectContent>
			</Select>
			{showCustom && custom && (
				<NumberSetting
					label={`${label} (custom)`}
					value={value || custom.min}
					min={custom.min}
					max={custom.max}
					suffix={custom.suffix}
					disabled={disabled}
					onCommit={onCommit}
				/>
			)}
		</div>
	);
}

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
		<div className="flex shrink-0 items-center gap-2 text-sm">
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
					<p className="mt-1 max-w-xl text-xs leading-[1.6667] text-muted-foreground">
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
		<PrivateWindowAppearance>
			<TooltipProvider>
				<PrivateLockGate>
					<Options />
				</PrivateLockGate>
			</TooltipProvider>
		</PrivateWindowAppearance>
	</ThemeProvider>,
);
