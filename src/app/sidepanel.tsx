import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
} from 'react';
import {createRoot} from 'react-dom/client';
import {
	Bookmark,
	Check,
	ChevronRight,
	ExternalLink,
	History,
	Layers,
	LayoutDashboard,
	MoreVertical,
	PanelTop,
	ArrowLeftRight,
	RotateCcw,
	Save,
	Search,
	Settings2,
	Trash2,
	X,
} from 'lucide-react';
import {
	Button,
	Checkbox,
	Input,
	ScrollArea,
	TooltipProvider,
	IconTooltip,
} from '../shared/ui';
import {
	ActionContextMenu,
	ActionDropdownMenu,
	type MenuAction,
} from '../components/ui/action-menu';
import '../../styles/extension-app.css';
import {ThemeProvider} from '../shared/theme';
import {LoadMore, usePagedLimit} from '../shared/load-more';
import {
	Brand,
	EmptyState,
	LoadingLine,
	LoadError,
	StatusLine,
	restoreSummary,
	send,
	useStatus,
	useTabLodgeState,
	forceAddAction,
	duplicatesNote,
	plural,
	switchSummary,
	useHasSavableTabs,
} from './common';
import {useSessionNameAsk} from './name-session-dialog';
import {Favicon} from './favicon';
import {resolveLinkTarget} from './link-target';
import {InsecureMarkFor} from './insecure-mark';
import {savedUrlSet} from './saved-urls';
import {SnapshotsDialog, TrashDialog} from './lazy-dialogs';
import type {Bookmark as SavedBookmark, Session, Settings} from './types';
import {PROJECT} from './project';
import {archivedFolderId} from './session-folders';
import {siteName, webUrl} from './web-url';
import {stripTrackingParameters} from './tracking-parameters';
import {ACTION_ICONS} from './action-icons';
import {cn} from '@/lib/utils';

type PanelTab = 'bookmarks' | 'sessions' | 'tabs';

const NO_BOOKMARKS: SavedBookmark[] = [];
const NO_SESSIONS: Session[] = [];
const NO_ORIGINS: readonly string[] = [];
const UNFILED = 'bookmark-unfiled';

/**
Opens a saved link from the side panel. The panel itself must never navigate, so "this tab" means
the active tab of the panel's window rather than `openLink`'s page navigation.
*/
async function openSavedLink(
	url: string,
	kind: 'bookmark' | 'session',
	settings: Settings,
	requested?: 'current' | 'new',
) {
	const safe = webUrl(url);
	if (!safe) {
		throw new Error('This item does not contain a valid web address.');
	}

	const destination = settings.removeTrackingParameters
		? stripTrackingParameters(safe)
		: safe;
	const action = resolveLinkTarget(kind, settings, {requested});
	if (action === 'none') {
		return;
	}

	if (action === 'current') {
		const [active] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (active?.id !== undefined) {
			await chrome.tabs.update(active.id, {url: destination});
			return;
		}
	}

	await chrome.tabs.create({url: destination});
}

function useWindowTabs() {
	const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
	const timerRef = useRef<number>(undefined);
	const refresh = useCallback(async () => {
		try {
			setTabs(await chrome.tabs.query({currentWindow: true}));
		} catch {
			setTabs([]);
		}
	}, []);
	useEffect(() => {
		const schedule = () => {
			globalThis.clearTimeout(timerRef.current);
			timerRef.current = globalThis.setTimeout(() => void refresh(), 80);
		};

		void refresh();
		const events = [
			chrome.tabs.onCreated,
			chrome.tabs.onRemoved,
			chrome.tabs.onUpdated,
			chrome.tabs.onActivated,
			chrome.tabs.onMoved,
			chrome.tabs.onAttached,
			chrome.tabs.onDetached,
		];
		for (const event of events) {
			event.addListener(schedule);
		}

		return () => {
			globalThis.clearTimeout(timerRef.current);
			for (const event of events) {
				event.removeListener(schedule);
			}
		};
	}, [refresh]);
	return tabs;
}

/**
A row with a primary button and a "more" menu; the same actions open on right-click.
*/
function ActionRow({
	label,
	actions,
	children,
	selected,
}: {
	label: string;
	actions: MenuAction[];
	/**
	A function receives `openMenu`, which opens the row's ⋯ menu.
	*/
	children: ReactNode | ((openMenu: () => void) => ReactNode);
	selected?: boolean;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	return (
		<ActionContextMenu actions={actions}>
			<div
				className={cn(
					'group flex min-w-0 items-center gap-1 rounded-lg px-1 hover:bg-muted focus-within:bg-muted',
					selected && 'bg-muted',
				)}
			>
				{typeof children === 'function'
					? children(() => setMenuOpen(true))
					: children}
				<ActionDropdownMenu
					open={menuOpen}
					actions={actions}
					trigger={
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 shrink-0 opacity-60 group-hover:opacity-100 group-focus-within:opacity-100"
							aria-label={`Actions for ${label}`}
						>
							<MoreVertical className="h-4 w-4" />
						</Button>
					}
					onOpenChange={setMenuOpen}
				/>
			</div>
		</ActionContextMenu>
	);
}

/**
Rows drawn per section and sections drawn per panel at first (a library can hold thousands); the rest load on demand.
*/
const ROW_PAGE = 30;
const SECTION_PAGE = 12;

function Collapsible({
	title,
	count,
	open,
	onToggle,
	children,
	extra,
}: {
	title: string;
	count: number;
	open: boolean;
	onToggle: () => void;
	/**
	Draws the first `limit` rows.
	*/
	children: (limit: number) => ReactNode;
	extra?: ReactNode;
}) {
	const [limit, setLimit] = useState(ROW_PAGE);
	return (
		<section aria-label={title}>
			<div className="flex items-center gap-1">
				<button
					type="button"
					aria-expanded={open}
					className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={onToggle}
				>
					<ChevronRight
						className={cn(
							'h-3.5 w-3.5 shrink-0 transition-transform',
							open && 'rotate-90',
						)}
					/>
					<span className="truncate">{title}</span>
					<span className="ml-1 font-normal normal-case tracking-normal">
						{count}
					</span>
				</button>
				{extra}
			</div>
			{open && (
				<div>
					{children(limit)}
					{count > limit && (
						<LoadMore
							remaining={count - limit}
							step={ROW_PAGE}
							noun="items"
							onMore={() => setLimit((old) => old + ROW_PAGE)}
						/>
					)}
				</div>
			)}
		</section>
	);
}

function SidePanel() {
	const {state, error, reload} = useTabLodgeState();
	const [status, showStatus] = useStatus();
	const [query, setQuery] = useState('');
	const [chosenPanel, setChosenPanel] = useState<PanelTab | null>(null);
	const [closed, setClosed] = useState<Set<string>>(() => new Set());
	const [opened, setOpened] = useState<Set<string>>(() => new Set());
	const [selected, setSelected] = useState<Set<number>>(() => new Set());
	const [snapshotsOpen, setSnapshotsOpen] = useState(false);
	const [trashOpen, setTrashOpen] = useState(false);
	const windowTabs = useWindowTabs();
	const [sectionLimit, moreSections] = usePagedLimit(
		`${chosenPanel}|${query.trim()}`,
		SECTION_PAGE,
	);
	const settings = state?.settings;
	const canSwitch = useHasSavableTabs(
		settings?.includePinnedTabs === true,
		settings?.excludedOrigins ?? NO_ORIGINS,
	);
	const {ask: askSessionName, dialog: nameDialog} = useSessionNameAsk(settings);
	const search = query.trim().toLocaleLowerCase();
	const matches = useCallback(
		(...values: Array<string | undefined>) =>
			!search ||
			values.some((value) =>
				(value || '').toLocaleLowerCase().includes(search),
			),
		[search],
	);

	const bookmarks = state?.bookmarks || NO_BOOKMARKS;
	const allSessions = state?.groups || NO_SESSIONS;
	const archivedId = archivedFolderId(state?.folders || []);
	const sessions = useMemo(
		() => allSessions.filter((session) => session.folderId !== archivedId),
		[allSessions, archivedId],
	);
	const savedUrls = useMemo(
		() => savedUrlSet(bookmarks, allSessions),
		[bookmarks, allSessions],
	);
	const columns = state?.bookmarkColumns;
	const panel: PanelTab = chosenPanel ?? 'bookmarks';

	const bookmarkGroups = useMemo(() => {
		const known = new Set(columns?.map((column) => column.id));
		const all = [...(columns || []), {id: UNFILED, name: 'Unfiled'}].map(
			(column) => ({
				id: column.id,
				name: column.name,
				items: bookmarks.filter(
					(bookmark) =>
						(bookmark.columnId === column.id ||
							(column.id === UNFILED && !known.has(bookmark.columnId))) &&
						matches(bookmark.title, bookmark.url),
				),
			}),
		);
		return all.filter((column) => column.items.length > 0);
	}, [bookmarks, columns, matches]);

	const visibleSessions = useMemo(
		() =>
			sessions
				.map((session) => ({
					session,
					tabs: matches(session.name)
						? session.tabs
						: session.tabs.filter((tab) => matches(tab.title, tab.url)),
				}))
				.filter(({session, tabs}) => matches(session.name) || tabs.length > 0),
		[sessions, matches],
	);

	const sectionCount =
		panel === 'bookmarks'
			? bookmarkGroups.length
			: panel === 'sessions'
				? visibleSessions.length
				: 0;
	const visibleTabs = windowTabs.filter(
		(tab) => tab.id !== undefined && matches(tab.title, tab.url),
	);
	const selectedIds = [...selected].filter((id) =>
		windowTabs.some((tab) => tab.id === id),
	);

	async function attempt(action: () => Promise<unknown>, failure: string) {
		try {
			await action();
		} catch (reason) {
			showStatus(
				reason instanceof Error && reason.message ? reason.message : failure,
				true,
			);
		}
	}

	async function copy(url: string) {
		await attempt(async () => {
			await navigator.clipboard.writeText(
				settings?.removeTrackingParameters ? stripTrackingParameters(url) : url,
			);
			showStatus('Link copied.', false, {toast: true});
		}, 'Could not copy the link.');
	}

	function linkClick(
		event: MouseEvent,
		url: string,
		kind: 'bookmark' | 'session',
		openMenu?: () => void,
	) {
		// Modified clicks keep the browser's own behavior (new tab, new window).
		if (
			event.button !== 0 ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			!settings
		) {
			return;
		}

		event.preventDefault();
		if (openMenu && resolveLinkTarget(kind, settings) === 'menu') {
			openMenu();
			return;
		}

		void attempt(
			() => openSavedLink(url, kind, settings),
			'Could not open the link.',
		);
	}

	function linkActions(
		url: string,
		kind: 'bookmark' | 'session',
		extra: MenuAction[] = [],
	): MenuAction[] {
		const open = (requested: 'current' | 'new') => () => {
			if (settings) {
				void attempt(
					() => openSavedLink(url, kind, settings, requested),
					'Could not open the link.',
				);
			}
		};

		return [
			{
				id: 'current',
				label: 'Open in this tab',
				icon: ACTION_ICONS.openHere,
				onSelect: open('current'),
			},
			{
				id: 'new',
				label: 'Open in new tab',
				icon: ACTION_ICONS.openNew,
				onSelect: open('new'),
			},
			{
				id: 'copy',
				label: 'Copy link',
				icon: ACTION_ICONS.copy,
				onSelect: () => void copy(url),
			},
			...extra,
		];
	}

	function linkRow(
		url: string,
		title: string,
		kind: 'bookmark' | 'session',
		extra?: MenuAction[],
	) {
		return (
			<ActionRow
				label={title || hostname(url)}
				actions={linkActions(url, kind, extra)}
			>
				{(openMenu) => (
					<a
						href={
							settings?.removeTrackingParameters
								? stripTrackingParameters(url)
								: url
						}
						target="_blank"
						rel="noopener noreferrer"
						title={`${title}\n${url}`}
						className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={(event) => linkClick(event, url, kind, openMenu)}
					>
						<Favicon
							url={url}
							label={hostname(url)}
							className="h-6 w-6 rounded"
						/>
						<span className="min-w-0">
							<strong className="block truncate text-xs font-medium">
								{title || hostname(url)}
							</strong>
							<small className="block truncate text-[11px] text-muted-foreground">
								<InsecureMarkFor url={url} settings={settings ?? {}} />
								{hostname(url)}
							</small>
						</span>
					</a>
				)}
			</ActionRow>
		);
	}

	async function restoreSession(session: Session) {
		await attempt(async () => {
			const result = await send('RESTORE_GROUP', {groupId: session.id});
			if (!result?.ok) {
				throw new Error(result?.error || 'Could not restore this session.');
			}

			showStatus(
				result.failed || result.splitsSeparated
					? restoreSummary(result)
					: `Restored “${session.name}”.`,
				Boolean(result.failed),
				{toast: true},
			);
		}, 'Could not restore this session.');
	}

	async function switchToSession(session: Session) {
		await attempt(async () => {
			const result = await send('SWITCH_WORKSPACE', {groupId: session.id});
			if (!result?.ok) {
				throw new Error(result?.error || 'Could not switch to this session.');
			}

			showStatus(switchSummary(result, session.name), Boolean(result.failed), {
				toast: true,
			});
		}, 'Could not switch to this session.');
	}

	async function saveTabs(
		request: {scope?: 'window'; tabIds?: number[]},
		done: string,
	) {
		const answer = await askSessionName(request);
		if (!answer) {
			return;
		}

		await attempt(async () => {
			const result = await send('SAVE_TABS', {
				...request,
				groupName: answer.name,
			});
			if (!result?.ok) {
				throw new Error(result?.error || 'Could not save these tabs.');
			}

			const {groupId} = result;
			if (result.rejectedTabIds.length > 0) {
				showStatus(
					`${result.count > 0 ? `Saved ${plural(result.count, 'tab')}.` : 'Nothing saved.'}${duplicatesNote(result.skipped)}`,
					false,
					{action: forceAddAction(result.rejectedTabIds, showStatus, reload)},
				);
			} else if (
				settings?.closeOnSave !== false &&
				groupId &&
				result.count > 0
			) {
				// Saved tabs were closed: Undo reopens them in this window from the new session.
				showStatus(done, false, {
					action: {
						label: 'Undo',
						async onClick() {
							const reopened = await send('RESTORE_GROUP', {
								groupId,
								restoreTarget: 'current-window',
								restoreMode: 'keep',
								activate: false,
							});
							showStatus(
								reopened?.ok
									? 'Tabs reopened.'
									: reopened?.error || 'Could not reopen the tabs.',
								!reopened?.ok,
								{toast: true},
							);
						},
					},
				});
			} else {
				showStatus(done, false, {toast: true});
			}

			setSelected(new Set());
			await reload();
		}, 'Could not save these tabs.');
	}

	function toggle(
		set: Set<string>,
		id: string,
		update: (next: Set<string>) => void,
	) {
		const next = new Set(set);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}

		update(next);
	}

	function tabRow(tab: chrome.tabs.Tab) {
		const id = tab.id!;
		const url = tab.url || tab.pendingUrl || '';
		const title = tab.title || hostname(url);
		const actions: MenuAction[] = [
			{
				id: 'switch',
				label: 'Switch to tab',
				icon: ExternalLink,
				onSelect: () => void activate(tab),
			},
			{
				id: 'save',
				label: 'Save this tab',
				icon: Save,
				onSelect: () => void saveTabs({tabIds: [id]}, 'Tab saved.'),
			},
			{
				id: 'copy',
				label: 'Copy link',
				icon: ACTION_ICONS.copy,
				hidden: !url,
				onSelect: () => void copy(url),
			},
			{type: 'separator'},
			{
				id: 'close',
				label: 'Close tab',
				icon: X,
				destructive: true,
				onSelect: () => void chrome.tabs.remove(id),
			},
		];
		return (
			<ActionRow key={id} label={title} actions={actions} selected={tab.active}>
				<Checkbox
					aria-label={`Select ${title}`}
					checked={selected.has(id)}
					onCheckedChange={(value) =>
						setSelected((current) => {
							const next = new Set(current);
							if (value === true) {
								next.add(id);
							} else {
								next.delete(id);
							}

							return next;
						})
					}
				/>
				<button
					type="button"
					title={`${title}\n${url}`}
					className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() => void activate(tab)}
				>
					<Favicon
						url={url}
						label={hostname(url)}
						fallbackSrc={tab.favIconUrl}
						className="h-6 w-6 rounded"
					/>
					<span className="min-w-0">
						<strong
							className={cn(
								'block truncate text-xs',
								tab.active ? 'font-semibold' : 'font-medium',
							)}
						>
							{title}
						</strong>
						<small className="block truncate text-[11px] text-muted-foreground">
							{savedUrls.has(url) && (
								<IconTooltip label="Already saved in a session or bookmark">
									<span
										role="img"
										aria-label="Already saved"
										className="mr-1 inline-block align-[-1px] text-emerald-600 dark:text-emerald-400"
									>
										<Check className="h-3 w-3" aria-hidden="true" />
									</span>
								</IconTooltip>
							)}
							<InsecureMarkFor url={url} settings={settings ?? {}} />
							{hostname(url)}
						</small>
					</span>
				</button>
				<IconTooltip label="Close tab">
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100 focus-visible:opacity-100"
						aria-label={`Close ${title}`}
						onClick={() => void chrome.tabs.remove(id)}
					>
						<X className="h-4 w-4" />
					</Button>
				</IconTooltip>
			</ActionRow>
		);
	}

	async function activate(tab: chrome.tabs.Tab) {
		await attempt(async () => {
			await chrome.tabs.update(tab.id, {active: true});
			await chrome.windows.update(tab.windowId, {focused: true});
		}, 'Could not switch to that tab.');
	}

	function onTabListKeys(event: KeyboardEvent<HTMLDivElement>) {
		const order: PanelTab[] = ['bookmarks', 'sessions', 'tabs'];
		const step =
			event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
		if (!step) {
			return;
		}

		event.preventDefault();
		const next =
			order[(order.indexOf(panel) + step + order.length) % order.length];
		setChosenPanel(next);
		requestAnimationFrame(() =>
			document.querySelector<HTMLElement>(`#sp-tab-${next}`)?.focus(),
		);
	}

	if (!state) {
		return error ? (
			<main className="min-h-screen p-3">
				<LoadError message={error} />
			</main>
		) : (
			<main className="min-h-screen p-3" aria-busy="true">
				<LoadingLine />
			</main>
		);
	}

	const tabsDef: Array<{
		id: PanelTab;
		label: string;
		count: number;
		icon: typeof Bookmark;
	}> = [
		{
			id: 'bookmarks',
			label: 'Bookmarks',
			count: bookmarks.length,
			icon: Bookmark,
		},
		{
			id: 'sessions',
			label: 'Sessions',
			count: sessions.length,
			icon: Layers,
		},
		{id: 'tabs', label: 'Tabs', count: windowTabs.length, icon: PanelTop},
	];
	const searchLabel = panel === 'tabs' ? 'Search open tabs' : `Search ${panel}`;

	return (
		<main className="flex h-screen min-w-0 flex-col overflow-hidden text-foreground">
			<div className="shrink-0 px-3 pt-3">
				<header className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
					<h1 className="sr-only">{PROJECT.name} side panel</h1>
					<Brand newTab />
					<div className="flex shrink-0 items-center gap-1">
						<IconTooltip label="Open dashboard">
							<Button asChild variant="ghost" size="icon" className="h-8 w-8">
								<a
									href="newtab.html"
									target="_blank"
									rel="noopener noreferrer"
									aria-label="Open dashboard"
								>
									<LayoutDashboard className="h-4 w-4" aria-hidden="true" />
								</a>
							</Button>
						</IconTooltip>
						<IconTooltip label="Recent snapshots">
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8"
								aria-label="Recent snapshots"
								onClick={() => setSnapshotsOpen(true)}
							>
								<History className="h-4 w-4" aria-hidden="true" />
							</Button>
						</IconTooltip>
						<IconTooltip label="Trash bin">
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8"
								aria-label="Trash bin"
								onClick={() => setTrashOpen(true)}
							>
								<Trash2 className="h-4 w-4" aria-hidden="true" />
							</Button>
						</IconTooltip>
						<IconTooltip label="Open settings">
							<Button asChild variant="ghost" size="icon" className="h-8 w-8">
								<a
									href="options.html"
									target="_blank"
									rel="noopener noreferrer"
									aria-label="Open settings"
								>
									<Settings2 className="h-4 w-4" aria-hidden="true" />
								</a>
							</Button>
						</IconTooltip>
					</div>
				</header>
				<div className="relative mb-3">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						type="search"
						aria-label={searchLabel}
						placeholder="Search everything"
						value={query}
						className="pl-9"
						onChange={(event) => setQuery(event.target.value)}
					/>
				</div>
				<div
					role="tablist"
					aria-label={`${PROJECT.name} sections`}
					className="mb-2 grid h-9 grid-cols-3 items-stretch gap-1 rounded-lg bg-muted p-1"
					onKeyDown={onTabListKeys}
				>
					{tabsDef.map(({id, label, count, icon: Icon}) => (
						<button
							key={id}
							id={`sp-tab-${id}`}
							type="button"
							role="tab"
							aria-selected={panel === id}
							aria-controls="sp-panel"
							tabIndex={panel === id ? 0 : -1}
							className={cn(
								'flex min-w-0 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
								panel === id && 'bg-background text-foreground shadow-sm',
							)}
							onClick={() => setChosenPanel(id)}
						>
							<Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
							<span className="truncate">{label}</span>
							<span className="text-[10px] font-normal text-muted-foreground">
								{count}
							</span>
						</button>
					))}
				</div>
			</div>
			<ScrollArea className="min-h-0 flex-1" viewportClassName="px-3 pb-3">
				<div
					id="sp-panel"
					role="tabpanel"
					aria-labelledby={`sp-tab-${panel}`}
					className="space-y-2 pt-1"
				>
					{panel === 'bookmarks' &&
						(bookmarkGroups.length === 0 ? (
							<EmptyState
								icon={Bookmark}
								title={search ? 'No bookmarks match' : 'No bookmarks yet'}
							>
								{search ? (
									'Try another title or address.'
								) : (
									<a
										className="font-semibold text-primary hover:underline"
										href="newtab.html#bookmark-library"
										target="_blank"
										rel="noopener noreferrer"
									>
										Add bookmarks in {PROJECT.name}
									</a>
								)}
							</EmptyState>
						) : (
							bookmarkGroups.slice(0, sectionLimit).map((column) => (
								<Collapsible
									key={column.id}
									title={column.name}
									count={column.items.length}
									open={Boolean(search) || !closed.has(column.id)}
									onToggle={() => toggle(closed, column.id, setClosed)}
								>
									{(limit) =>
										column.items
											.slice(0, limit)
											.map((bookmark) => (
												<div key={bookmark.id}>
													{linkRow(bookmark.url, bookmark.title, 'bookmark')}
												</div>
											))
									}
								</Collapsible>
							))
						))}

					{panel === 'sessions' &&
						(visibleSessions.length === 0 ? (
							<EmptyState
								icon={Layers}
								title={search ? 'No sessions match' : 'No sessions yet'}
							>
								{search
									? 'Try another session name, title or address.'
									: 'Save the tabs in this window from the Tabs section.'}
							</EmptyState>
						) : (
							visibleSessions.slice(0, sectionLimit).map(({session, tabs}) => (
								<Collapsible
									key={session.id}
									title={session.name}
									count={tabs.length}
									open={
										Boolean(search) ||
										(settings?.expandSessionsByDefault === true
											? !closed.has(session.id)
											: opened.has(session.id))
									}
									extra={
										<>
											<IconTooltip
												label={
													canSwitch
														? `Switch to ${session.name}`
														: 'Switch is off: this window has no tabs to save.'
												}
											>
												<span>
													<Button
														variant="ghost"
														size="icon"
														className="h-7 w-7 shrink-0"
														disabled={!canSwitch}
														aria-label={`Switch to ${session.name || 'untitled session'}`}
														onClick={() => void switchToSession(session)}
													>
														<ArrowLeftRight className="h-4 w-4" />
													</Button>
												</span>
											</IconTooltip>
											<IconTooltip label={`Restore ${session.name}`}>
												<Button
													variant="ghost"
													size="icon"
													className="h-7 w-7 shrink-0"
													aria-label={`Restore ${session.name || 'untitled session'}`}
													onClick={() => void restoreSession(session)}
												>
													<RotateCcw className="h-4 w-4" />
												</Button>
											</IconTooltip>
										</>
									}
									onToggle={() =>
										settings?.expandSessionsByDefault === true
											? toggle(closed, session.id, setClosed)
											: toggle(opened, session.id, setOpened)
									}
								>
									{(limit) =>
										tabs
											.slice(0, limit)
											.map((tab) => (
												<div key={tab.id}>
													{linkRow(tab.url, tab.title, 'session')}
												</div>
											))
									}
								</Collapsible>
							))
						))}

					{panel === 'tabs' &&
						(visibleTabs.length === 0 ? (
							<EmptyState
								icon={PanelTop}
								title={search ? 'No open tabs match' : 'No tabs'}
							>
								{search ? 'Try another title or address.' : ''}
							</EmptyState>
						) : (
							<div>{visibleTabs.map((tab) => tabRow(tab))}</div>
						))}
					{sectionCount > sectionLimit && (
						<LoadMore
							remaining={sectionCount - sectionLimit}
							step={SECTION_PAGE}
							noun={panel === 'bookmarks' ? 'columns' : 'sessions'}
							onMore={moreSections}
						/>
					)}
				</div>
			</ScrollArea>
			{panel === 'tabs' && (
				<div className="flex shrink-0 gap-2 border-t border-border px-3 py-2">
					<Button
						variant="outline"
						size="sm"
						className="flex-1"
						disabled={selectedIds.length === 0}
						onClick={() =>
							void saveTabs(
								{tabIds: selectedIds},
								`Saved ${selectedIds.length} ${selectedIds.length === 1 ? 'tab' : 'tabs'}.`,
							)
						}
					>
						<Save className="h-4 w-4" />
						Save selected
						{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
					</Button>
					<Button
						size="sm"
						className="flex-1"
						onClick={() => void saveTabs({scope: 'window'}, 'Window saved.')}
					>
						<Save className="h-4 w-4" />
						Save all
					</Button>
				</div>
			)}
			{status?.message && <StatusLine status={status} />}
			{nameDialog}
			<SnapshotsDialog
				open={snapshotsOpen}
				showStatus={showStatus}
				onOpenChange={setSnapshotsOpen}
				onSessionsChanged={reload}
			/>
			<TrashDialog
				open={trashOpen}
				showStatus={showStatus}
				onOpenChange={setTrashOpen}
				onChanged={reload}
			/>
		</main>
	);
}

const hostname = (value: string) => siteName(value) || value || 'Untitled';

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<TooltipProvider>
			<SidePanel />
		</TooltipProvider>
	</ThemeProvider>,
);
