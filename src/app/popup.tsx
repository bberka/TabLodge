import {
	lazy,
	Suspense,
	useEffect,
	useMemo,
	useState,
	type SyntheticEvent,
	type MouseEvent,
} from 'react';
import {createRoot} from 'react-dom/client';
import {
	Bookmark,
	BookmarkPlus,
	PanelsTopLeft,
	Layers2,
	Settings2,
	ArrowRight,
	LoaderCircle,
	ChevronDown,
	ChevronUp,
	ArrowLeftRight,
	RotateCcw,
	Info,
	PanelRightOpen,
	Pin,
	AppWindow,
} from 'lucide-react';
import {
	Button,
	Checkbox,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	ScrollArea,
	Switch,
	TooltipProvider,
	IconTooltip,
} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider} from '../shared/theme';
import {
	StatusLine,
	TabLodgeMark,
	saveWindowLabel,
	send,
	restoreSummary,
	switchSummary,
	useHasSavableTabs,
	useStatus,
	useTabLodgeState,
	useTabSelection,
	forceAddAction,
	duplicatesNote,
	plural,
} from './common';
import type {SaveScope, Session} from './types';
import {archivedFolderId} from './session-folders';
import {LinkSummary} from './favicon';
import {useSessionNameAsk} from './name-session-dialog';
import {PROJECT} from './project';
import {webUrl} from './web-url';
import type {BookmarkColumnDraft} from './bookmark-column-picker';
import {cn} from '@/lib/utils';

// Keep the icon registry out of the popup's initial load.
const BookmarkColumnPicker = lazy(async () => ({
	default: (await import('./bookmark-column-picker')).BookmarkColumnPicker,
}));

/**
Stable fallback so memoized values do not see a new array on every render.
*/
const NO_SESSIONS: Session[] = [];
const NO_ORIGINS: readonly string[] = [];

// Older Chromium builds and some forks lack the side panel API.
const hasSidePanel = typeof chrome.sidePanel?.open === 'function';

// Web tabs from chrome.tabs.query, which always carries an id for tabs in normal windows.
type WebTab = chrome.tabs.Tab & {id: number; url: string};

function Popup() {
	const {state, error, reload} = useTabLodgeState();
	const [status, showStatus] = useStatus();
	const [busy, setBusy] = useState('');
	const [bookmarkOpen, setBookmarkOpen] = useState(false);
	const [bookmarkTab, setBookmarkTab] = useState<{
		title: string;
		url: string;
	} | null>(null);
	const [columnId, setColumnId] = useState('');
	const [newColumn, setNewColumn] = useState<BookmarkColumnDraft>({name: ''});
	const [chooseOpen, setChooseOpen] = useState(false);
	const [currentTabs, setCurrentTabs] = useState<WebTab[]>([]);
	const [selectedIds, setSelectedIds] = useState<number[]>([]);
	const [groupName, setGroupName] = useState('');
	const [allowPinnedOnce, setAllowPinnedOnce] = useState(false);
	// Read ahead of the click: sidePanel.open must run inside the user gesture, without awaiting anything first.
	const [windowId, setWindowId] = useState<number | undefined>();
	const {ask: askSessionName, dialog: nameDialog} = useSessionNameAsk(
		state?.settings,
	);

	const allGroups = state?.groups || NO_SESSIONS;
	const archivedId = archivedFolderId(state?.folders || []);
	const groups = useMemo(
		() => allGroups.filter((group) => group.folderId !== archivedId),
		[allGroups, archivedId],
	);
	const tabCount = useMemo(
		() => groups.reduce((sum, group) => sum + (group.tabs?.length || 0), 0),
		[groups],
	);
	const includePinnedTabs =
		state?.settings?.includePinnedTabs === true || allowPinnedOnce;
	const tabSelection = useTabSelection(
		state?.settings?.includePinnedTabs === true,
	);
	const canSwitch = useHasSavableTabs(
		state?.settings?.includePinnedTabs === true,
		state?.settings?.excludedOrigins ?? NO_ORIGINS,
	);
	const recentSessions = useMemo(
		() => groups.toSorted((a, b) => b.createdAt - a.createdAt).slice(0, 5),
		[groups],
	);
	const columns = state?.bookmarkColumns || [];
	const eligibleTabs = useMemo(
		() =>
			currentTabs.filter(
				(tab) => webUrl(tab.url) && (includePinnedTabs || !tab.pinned),
			),
		[currentTabs, includePinnedTabs],
	);

	useEffect(() => {
		if (!hasSidePanel) {
			return;
		}

		void chrome.windows
			.getCurrent()
			.then((current) => setWindowId(current.id))
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		if (!chooseOpen) {
			return;
		}

		let alive = true;
		chrome.tabs
			.query({currentWindow: true})
			.then((tabs) => {
				if (!alive) {
					return;
				}

				const valid = tabs.filter((tab): tab is WebTab =>
					Boolean(webUrl(tab.url)),
				);
				setCurrentTabs(valid);
				const highlighted = valid.filter(
					(tab) => tab.highlighted && (includePinnedTabs || !tab.pinned),
				);
				// The two halves of the active split view can both be highlighted; together they are one tab-strip slot, not a selection.
				const slots = new Set(
					highlighted.map((tab) =>
						(tab.splitViewId ?? -1) >= 0
							? `split:${tab.splitViewId}`
							: `tab:${tab.id}`,
					),
				).size;
				const initial =
					slots > 1
						? highlighted
						: valid.filter((tab) => includePinnedTabs || !tab.pinned);
				setSelectedIds(initial.map((tab) => tab.id));
				const active = valid.find((tab) => tab.active);
				setGroupName(
					active?.title ? `Saved from ${active.title}`.slice(0, 120) : '',
				);
			})
			.catch(() => {
				if (alive) {
					showStatus('Could not read tabs in this window.', true);
				}
			});
		return () => {
			alive = false;
		};
		// ShowStatus is recreated every render; the tab list only reloads when these two change.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the two inputs on purpose
	}, [chooseOpen, includePinnedTabs]);

	async function save(
		scope: SaveScope,
		options: {tabIds?: number[]; groupName?: string} = {},
	) {
		// "Choose tabs and title" already has a title field, so only the quick buttons ask.
		let typedName = options.groupName;
		if (options.tabIds === undefined) {
			const answer = await askSessionName({scope});
			if (!answer) {
				return;
			}

			typedName = answer.name;
		}

		setBusy(scope);
		const result = await send('SAVE_TABS', {
			scope,
			includePinned: allowPinnedOnce,
			...options,
			groupName: typedName,
		});
		setBusy('');
		if (result?.ok) {
			showStatus(
				`Saved ${plural(result.count, 'tab')} in ${plural(result.groups, 'session')}.${duplicatesNote(result.skipped)}`,
				false,
				result.rejectedTabIds.length > 0
					? {
							action: forceAddAction(result.rejectedTabIds, showStatus, reload),
						}
					: {toast: true},
			);
			setChooseOpen(false);
			await reload();
		} else {
			showStatus(result?.error || 'Could not save these tabs.', true);
		}
	}

	function toggleTab(id: number, checked: boolean) {
		setSelectedIds((current) =>
			checked
				? [...new Set([...current, id])]
				: current.filter((value) => value !== id),
		);
	}

	async function startBookmark() {
		setBusy('bookmark-current');
		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				lastFocusedWindow: true,
			});
			const url = webUrl(tab?.url);
			if (!url) {
				showStatus('Open a regular web page to bookmark it.', true);
				return;
			}

			const {NEW_BOOKMARK_COLUMN: newColumnValue} =
				await import('./bookmark-column-picker');
			setBookmarkTab({title: tab.title || url, url});
			setColumnId(columns[0]?.id || newColumnValue);
			setNewColumn({name: ''});
			setBookmarkOpen(true);
		} catch {
			showStatus(
				'Could not read the current page. Open a regular web page and try again.',
				true,
			);
		} finally {
			setBusy('');
		}
	}

	async function saveBookmark(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!bookmarkTab || busy === 'bookmark-save') {
			return;
		}

		setBusy('bookmark-save');
		try {
			const {resolveBookmarkColumn} = await import('./bookmark-column-picker');
			const target = await resolveBookmarkColumn(columnId, newColumn);
			setColumnId(target);
			const result = await send('ADD_BOOKMARK', {
				bookmark: {...bookmarkTab, columnId: target},
			});
			if (!result?.ok) {
				showStatus(result?.error || 'Could not bookmark this page.', true);
				return;
			}

			setBookmarkOpen(false);
			setBookmarkTab(null);
			showStatus('Bookmark saved.', false, {toast: true});
			await reload();
		} catch (reason) {
			showStatus(
				reason instanceof Error
					? reason.message
					: 'Could not bookmark this page.',
				true,
			);
		} finally {
			setBusy('');
		}
	}

	// Ctrl/Cmd keeps the saved tabs, Shift opens a new window, as on the TabLodge page.
	async function restoreSession(
		group: Session,
		event: MouseEvent<HTMLButtonElement>,
	) {
		setBusy(`restore:${group.id}`);
		const result = await send('RESTORE_GROUP', {
			groupId: group.id,
			restoreMode: event.ctrlKey || event.metaKey ? 'keep' : undefined,
			restoreTarget: event.shiftKey ? 'always-new-window' : undefined,
		});
		setBusy('');
		if (result?.ok) {
			showStatus(restoreSummary(result), Boolean(result.failed), {
				toast: true,
			});
			await reload();
		} else {
			showStatus(result?.error || `Could not restore “${group.name}”.`, true);
		}
	}

	async function switchToSession(group: Session) {
		setBusy(`restore:${group.id}`);
		const result = await send('SWITCH_WORKSPACE', {groupId: group.id});
		setBusy('');
		if (result?.ok) {
			showStatus(switchSummary(result, group.name), Boolean(result.failed), {
				toast: true,
			});
			await reload();
		} else {
			showStatus(result?.error || `Could not switch to “${group.name}”.`, true);
		}
	}

	// Info opens the Help page, switching to it when it is already open.
	async function openHelp() {
		const url = chrome.runtime.getURL('help.html');
		try {
			const existing = (await chrome.tabs.query({})).find((tab) =>
				tab.url?.startsWith(url),
			);
			if (existing?.id !== undefined) {
				await chrome.tabs.update(existing.id, {active: true});
				await chrome.windows.update(existing.windowId, {focused: true});
				window.close();
				return;
			}
		} catch {
			/*
			Open a new Help tab instead.
			*/
		}

		await openPage(url);
	}

	function openSidePanel() {
		if (windowId === undefined) {
			return;
		}

		chrome.sidePanel.open({windowId}).then(
			() => window.close(),
			(reason: unknown) =>
				showStatus(
					reason instanceof Error && reason.message
						? reason.message
						: 'Could not open the side panel.',
					true,
				),
		);
	}

	async function openPage(url: string) {
		await chrome.tabs.create({url, active: true});
		window.close();
	}

	async function openSettings() {
		await chrome.runtime.openOptionsPage();
		window.close();
	}

	// Chrome sizes the popup to its content (max 800x600) and 100vh is circular there, so the
	// popup has a fixed size: a stable header and footer with the body scrolling in between.
	// Until the saved state arrives only the fixed-size frame renders, so the popup neither flashes text nor resizes.
	if (!state && !error) {
		return <main className="h-[560px] w-[380px] bg-background" />;
	}

	const stats = [
		{
			icon: PanelsTopLeft,
			count: groups.length,
			label: groups.length === 1 ? 'session' : 'sessions',
		},
		{
			icon: AppWindow,
			count: tabCount,
			label: tabCount === 1 ? 'tab' : 'tabs',
		},
		{
			icon: Bookmark,
			count: state?.bookmarks?.length || 0,
			label: state?.bookmarks?.length === 1 ? 'bookmark' : 'bookmarks',
		},
	];
	return (
		<main className="flex h-[560px] w-[380px] flex-col overflow-hidden bg-background text-foreground">
			<header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
				<h1 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
					<span className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
						<TabLodgeMark className="h-[18px] w-[18px]" />
					</span>
					{PROJECT.name}
				</h1>
				<div className="flex items-center gap-1">
					{error && (
						<span
							className="mr-1 rounded-full border border-destructive/40 bg-card px-2.5 py-1 text-xs font-medium text-destructive"
							title={error}
						>
							Offline
						</span>
					)}
					{hasSidePanel && (
						<IconTooltip label="Open side panel">
							<Button
								variant="ghost"
								size="icon"
								aria-label="Open side panel"
								disabled={windowId === undefined}
								onClick={openSidePanel}
							>
								<PanelRightOpen className="h-4 w-4" />
							</Button>
						</IconTooltip>
					)}
					<IconTooltip label="Help">
						<Button
							variant="ghost"
							size="icon"
							aria-label="Help"
							onClick={() => void openHelp()}
						>
							<Info className="h-4 w-4" />
						</Button>
					</IconTooltip>
					<IconTooltip label="Open settings">
						<Button
							variant="ghost"
							size="icon"
							aria-label="Open settings"
							onClick={openSettings}
						>
							<Settings2 className="h-4 w-4" />
						</Button>
					</IconTooltip>
				</div>
			</header>
			<ScrollArea className="min-h-0 flex-1" viewportClassName="p-4">
				{stats.length > 0 && (
					<dl
						className={cn(
							'mb-4 grid divide-x divide-border rounded-lg border border-border bg-card py-2.5',
							stats.length === 3
								? 'grid-cols-3'
								: stats.length === 2
									? 'grid-cols-2'
									: 'grid-cols-1',
						)}
						aria-label={`Saved in ${PROJECT.name}`}
					>
						{stats.map(({icon: Icon, count, label}) => (
							<div
								key={label}
								className="flex min-w-0 flex-col-reverse items-center gap-0.5 px-2"
							>
								<dt className="truncate text-xs text-muted-foreground">
									{label}
								</dt>
								<dd className="flex items-center gap-1.5 text-base font-semibold tabular-nums">
									<Icon
										className="h-3.5 w-3.5 shrink-0 text-primary"
										aria-hidden="true"
									/>
									{count}
								</dd>
							</div>
						))}
					</dl>
				)}
				<div className="space-y-2">
					<Button
						size="sm"
						className="w-full justify-start gap-3 px-3"
						variant="outline"
						disabled={busy !== ''}
						onClick={startBookmark}
					>
						{busy === 'bookmark-current' ? (
							<LoaderCircle className="h-4 w-4 animate-spin" />
						) : (
							<BookmarkPlus className="h-4 w-4" />
						)}{' '}
						Bookmark this page
					</Button>
					<Button
						className="h-auto w-full justify-start gap-3 px-3 py-2.5 text-left"
						variant="default"
						disabled={busy !== ''}
						onClick={() => save('selected-or-window')}
					>
						{busy === 'selected-or-window' ? (
							<LoaderCircle className="h-4 w-4 animate-spin" />
						) : (
							<PanelsTopLeft className="h-4 w-4" />
						)}
						<span className="flex flex-col items-start gap-0.5 leading-tight">
							<strong className="font-semibold">
								{tabSelection.selected
									? saveWindowLabel(tabSelection)
									: 'Save current window'}
							</strong>
							<small className="text-xs font-normal opacity-90">
								{tabSelection.selected
									? 'Only the tabs selected in the tab strip'
									: 'All tabs in this window'}
							</small>
						</span>
					</Button>
					{tabSelection.selected && (
						<Button
							size="sm"
							variant="outline"
							className="w-full justify-start gap-3 px-3"
							disabled={busy !== ''}
							onClick={() => save('window')}
						>
							<Layers2 className="h-4 w-4" />
							Save whole window
						</Button>
					)}
					<Button
						size="sm"
						variant="outline"
						className="w-full justify-start gap-3 px-3"
						disabled={busy !== ''}
						onClick={() => save('all-windows')}
					>
						<PanelsTopLeft className="h-4 w-4" />
						Save tabs in all windows
					</Button>
					{!state?.settings?.includePinnedTabs && (
						<div className="flex h-8 items-center justify-between gap-3 rounded-md border border-dashed border-border px-3">
							<Label
								htmlFor="popup-include-pinned"
								className="flex min-w-0 cursor-pointer items-center gap-3 text-xs font-medium text-muted-foreground"
							>
								<Pin className="h-4 w-4 shrink-0" aria-hidden="true" />
								Include pinned tabs in this save
							</Label>
							<Switch
								id="popup-include-pinned"
								checked={allowPinnedOnce}
								onCheckedChange={setAllowPinnedOnce}
							/>
						</div>
					)}
					<Button
						size="sm"
						variant="ghost"
						className="w-full justify-between px-3"
						aria-expanded={chooseOpen}
						onClick={() => setChooseOpen((value) => !value)}
					>
						<span className="flex items-center gap-3">
							<Layers2 className="h-4 w-4" />
							Choose tabs and title
						</span>
						{chooseOpen ? (
							<ChevronUp className="h-4 w-4" />
						) : (
							<ChevronDown className="h-4 w-4" />
						)}
					</Button>
					{chooseOpen && (
						<section
							className="rounded-md border border-border bg-card p-3"
							aria-label="Choose tabs to save"
						>
							<div className="mb-3 space-y-1.5">
								<Label htmlFor="quick-session-title">Session title</Label>
								<Input
									id="quick-session-title"
									value={groupName}
									maxLength={120}
									placeholder="Saved session"
									onChange={(event) => setGroupName(event.target.value)}
								/>
							</div>
							<p className="mb-2 text-xs text-muted-foreground">
								Select the tabs to include
								{includePinnedTabs
									? '.'
									: '. Pinned tabs are ignored; enable them in Settings to include them.'}
							</p>
							<ScrollArea
								className="flex max-h-44 flex-col"
								viewportClassName="min-h-0"
							>
								<ul className="space-y-1 pr-2">
									{eligibleTabs.map((tab) => (
										<li key={tab.id}>
											<label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent">
												<Checkbox
													checked={selectedIds.includes(tab.id)}
													aria-label={`Include ${tab.title || tab.url}`}
													onCheckedChange={(checked) =>
														toggleTab(tab.id, checked === true)
													}
												/>
												<span className="min-w-0 flex-1">
													<span className="block truncate font-medium text-foreground">
														{tab.title || tab.url}
													</span>
													<span className="block truncate text-muted-foreground">
														{new URL(tab.url).hostname}
														{tab.pinned ? ' · pinned' : ''}
														{(tab.splitViewId ?? -1) >= 0
															? ' · split view'
															: ''}
													</span>
												</span>
											</label>
										</li>
									))}
									{eligibleTabs.length === 0 && (
										<li className="px-2 py-4 text-center text-xs text-muted-foreground">
											No web tabs are available in this window.
										</li>
									)}
								</ul>
							</ScrollArea>
							<Button
								size="sm"
								className="mt-3 w-full"
								disabled={busy !== '' || selectedIds.length === 0}
								onClick={() =>
									save('selected', {tabIds: selectedIds, groupName})
								}
							>
								{busy === 'selected' ? (
									<LoaderCircle className="h-4 w-4 animate-spin" />
								) : null}
								Save {selectedIds.length} selected{' '}
								{selectedIds.length === 1 ? 'tab' : 'tabs'}
							</Button>
						</section>
					)}
				</div>
				{recentSessions.length > 0 && (
					<section className="mt-4" aria-label="Recent sessions">
						<h2 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">
							Recent sessions
						</h2>
						<ul className="space-y-1">
							{recentSessions.map((group) => (
								<li
									key={group.id}
									className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
								>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-xs font-medium">
											{group.name}
										</span>
										<span className="block text-xs text-muted-foreground">
											{group.tabs.length}{' '}
											{group.tabs.length === 1 ? 'tab' : 'tabs'}
										</span>
									</span>
									<IconTooltip
										label={
											canSwitch
												? 'Switch. Save this window and open this session in it.'
												: 'Switch is off: this window has no tabs to save.'
										}
									>
										<span>
											<Button
												size="icon"
												variant="ghost"
												className="h-7 w-7"
												disabled={busy !== '' || !canSwitch}
												aria-label={`Switch to ${group.name || 'untitled session'}`}
												onClick={() => void switchToSession(group)}
											>
												<ArrowLeftRight className="h-3.5 w-3.5" />
											</Button>
										</span>
									</IconTooltip>
									<IconTooltip label="Restore. Ctrl or Cmd keeps, Shift opens a new window.">
										<Button
											size="icon"
											variant="ghost"
											className="h-7 w-7"
											disabled={busy !== ''}
											aria-label={`Restore ${group.name || 'untitled session'}`}
											onClick={(event) => restoreSession(group, event)}
										>
											<RotateCcw className="h-3.5 w-3.5" />
										</Button>
									</IconTooltip>
								</li>
							))}
						</ul>
					</section>
				)}
			</ScrollArea>
			<footer className="shrink-0 border-t border-border px-4 py-2">
				{status?.message && <StatusLine status={status} />}
				<Button
					variant="ghost"
					size="sm"
					className="w-full justify-between px-2"
					onClick={() => void openPage(chrome.runtime.getURL('newtab.html'))}
				>
					Open Dashboard <ArrowRight className="h-3.5 w-3.5" />
				</Button>
			</footer>
			{nameDialog}
			<Dialog open={bookmarkOpen} onOpenChange={setBookmarkOpen}>
				<DialogContent size="sm">
					<form onSubmit={saveBookmark}>
						<DialogHeader>
							<DialogTitle>Bookmark this page</DialogTitle>
							<DialogDescription className="[overflow-wrap:anywhere]">
								Choose a local {PROJECT.name} column.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							{bookmarkTab && (
								<LinkSummary
									title={bookmarkTab.title}
									url={bookmarkTab.url}
									settings={state?.settings}
								/>
							)}
							<div className="space-y-1.5">
								<Label htmlFor="bookmark-column">Bookmark column</Label>
								<Suspense fallback={<p role="status">Loading columns</p>}>
									<BookmarkColumnPicker
										id="bookmark-column"
										columns={columns}
										value={columnId}
										draft={newColumn}
										onDraftChange={setNewColumn}
										onValueChange={setColumnId}
									/>
								</Suspense>
							</div>
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setBookmarkOpen(false)}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={!bookmarkTab || busy === 'bookmark-save'}
							>
								{busy === 'bookmark-save' ? 'Saving' : 'Save bookmark'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</main>
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<TooltipProvider>
			<Popup />
		</TooltipProvider>
	</ThemeProvider>,
);
