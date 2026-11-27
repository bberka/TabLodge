import {
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
	ListPlus,
	AppWindow,
	CopyMinus,
	FileDown,
	Download,
	X,
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch,
	TooltipProvider,
	IconTooltip,
} from '../shared/ui';
import '../../styles/extension-app.css';
import {
	canOpenSidePanel,
	isFirefox,
	openSidePanel as openPanel,
} from '../shared/browser';
import {ThemeProvider} from '../shared/theme';
import type {ActionResult, SaveScope, Session} from '../shared/types';
import {columnForUrl} from '../shared/column-sites';
import {webUrl} from '../shared/web-url';
import {isSharedPageUrl} from '../shared/sync/shared-pages';
import {archivedFolderId} from '../shared/session-folders';
import {defaultTargetSession} from '../shared/save-rules';
import {PrivateWindowMark} from './private-window-appearance';
import {
	LoadingLine,
	StatusLine,
	TabLodgeMark,
	saveWindowLabel,
	send,
	switchSummary,
	useHasSavableTabs,
	useStatus,
	useTabLodgeState,
	useTabSelection,
	reportSessionSave,
	showSaveFailure,
	plural,
} from './common';
import {LinkSummary} from './favicon';
import {useSessionNameAsk} from './name-session-dialog';
import {PROJECT} from './project';
import {defaultBookmarkColumnId} from './default-column';
import {offerUndo, reportSessionRestore} from './recovery-core';
import {
	closeDuplicateTabs,
	useDuplicateTabCount,
} from './duplicate-tabs-action';
import type {BookmarkColumnDraft} from './bookmark-column-picker';
import {PrivateLockGate} from './private-lock-ui';
import {NotesField} from './notes-field';
import {type TagEdit, TagsField} from './bookmark-tags';
import {keptCopyMessage, openPageCopy} from './page-copies';
import {cn} from '@/lib/utils';

const loadColumnPicker = async () => import('./bookmark-column-picker');

const NO_SESSIONS: Session[] = [];
const NO_ORIGINS: readonly string[] = [];

const hasSidePanel = canOpenSidePanel;

type WebTab = chrome.tabs.Tab & {id: number; url: string};

function Popup() {
	const privateWindow = chrome.extension.inIncognitoContext;
	const {state, error, reload} = useTabLodgeState();
	const [status, showStatus] = useStatus();
	const [busy, setBusy] = useState('');
	const [bookmarkOpen, setBookmarkOpen] = useState(false);
	const [bookmarkTab, setBookmarkTab] = useState<
		| ({
				title: string;
				url: string;
				notes: string;
		  } & TagEdit)
		| null
	>(null);
	const [columnId, setColumnId] = useState('');
	const [picker, setPicker] = useState<Awaited<
		ReturnType<typeof loadColumnPicker>
	> | null>(null);
	const [earlyColumns, setEarlyColumns] = useState<
		ActionResult<'GET_BOOKMARK_PROMPT'> | undefined
	>();
	const [newColumn, setNewColumn] = useState<BookmarkColumnDraft>({name: ''});
	const [sessionOpen, setSessionOpen] = useState(false);
	const [sessionTab, setSessionTab] = useState<{
		title: string;
		url: string;
	} | null>(null);
	const [sessionId, setSessionId] = useState('');
	const [chooseOpen, setChooseOpen] = useState(false);
	const [currentTabs, setCurrentTabs] = useState<WebTab[]>([]);
	const [selectedIds, setSelectedIds] = useState<number[]>([]);
	const [groupName, setGroupName] = useState('');
	const [allowPinnedOnce, setAllowPinnedOnce] = useState(false);
	const [windowId, setWindowId] = useState<number | undefined>();
	const [pageSavable, setPageSavable] = useState(true);
	const [sharedPageUrl, setSharedPageUrl] = useState<string>();
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
	const duplicateCount = useDuplicateTabCount();
	const recentSessions = useMemo(
		() => groups.toSorted((a, b) => b.createdAt - a.createdAt).slice(0, 5),
		[groups],
	);
	const pickerSessions = useMemo(
		() => groups.toSorted((a, b) => b.updatedAt - a.updatedAt),
		[groups],
	);
	const early = earlyColumns?.ok ? earlyColumns : undefined;
	const columns = state?.bookmarkColumns ?? early?.bookmarkColumns ?? [];
	const defaultColumnId = state
		? defaultBookmarkColumnId(columns, state.bookmarks)
		: early?.defaultColumnId;
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
		let alive = true;
		chrome.tabs
			.query({active: true, lastFocusedWindow: true})
			.then(([tab]) => {
				if (alive) {
					setPageSavable(Boolean(webUrl(tab?.url)));
				}
			})
			.catch(() => undefined);
		return () => {
			alive = false;
		};
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
			})
			.catch(() => {
				if (alive) {
					showStatus('Could not read tabs in this window.', true);
				}
			});
		return () => {
			alive = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the two inputs on purpose
	}, [chooseOpen, includePinnedTabs]);

	async function save(
		scope: SaveScope,
		options: {tabIds?: number[]; groupName?: string} = {},
	) {
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
			reportSessionSave(result, {
				closeOnSave: state?.settings?.closeOnSave !== false,
				showStatus,
				reload,
			});
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

	useEffect(() => {
		let active = true;
		void loadColumnPicker().then((loaded) => {
			if (active) {
				setPicker(loaded);
			}
		});
		void (async () => {
			try {
				const [tab] = await chrome.tabs.query({
					active: true,
					lastFocusedWindow: true,
				});
				const url = webUrl(tab?.url);
				if (active && url && isSharedPageUrl(url)) {
					setSharedPageUrl(url);
				}

				const result = url
					? await send('GET_BOOKMARK_PROMPT', {url})
					: undefined;
				if (active) {
					setEarlyColumns(result);
				}
			} catch {}
		})();

		return () => {
			active = false;
		};
	}, []);

	async function keepCopy() {
		setBusy('copy-current');
		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				lastFocusedWindow: true,
			});
			if (tab?.id === undefined || !webUrl(tab.url)) {
				showStatus('Open a regular web page to keep a copy of it.', true);
				return;
			}

			const result = await send('KEEP_PAGE_COPY', {tabId: tab.id});
			showStatus(keptCopyMessage(result), !result.ok, {
				toast: true,
				...(result.ok && {
					action: {
						label: 'Open copy',
						async onClick() {
							await openPageCopy(result.url);
							window.close();
						},
					},
				}),
			});
		} finally {
			setBusy('');
		}
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

			let ready = state ?? early;
			if (!ready) {
				const fetched = await send('GET_BOOKMARK_PROMPT', {url});
				if (fetched.ok) {
					ready = fetched;
					setEarlyColumns(fetched);
				}
			}

			const claimed = columnForUrl(
				state?.bookmarkColumns ?? ready?.bookmarkColumns ?? columns,
				url,
			);
			if (claimed) {
				if (
					state
						? state.bookmarks.some(
								(bookmark) =>
									bookmark.url === url && bookmark.columnId === claimed.id,
							)
						: (ready && 'existingColumnId' in ready
								? ready.existingColumnId
								: undefined) === claimed.id
				) {
					showStatus(`Already in “${claimed.name}”.`, false, {toast: true});
					return;
				}

				const added = await send('ADD_BOOKMARK', {
					bookmark: {title: tab.title || url, url, columnId: claimed.id},
				});
				if (!added?.ok) {
					showSaveFailure(showStatus, added, 'Could not bookmark this page.');
					return;
				}

				showStatus(`Saved to “${claimed.name}”.`, false, {toast: true});
				await reload();
				return;
			}

			const {NEW_BOOKMARK_COLUMN: newColumnValue} = await loadColumnPicker();
			setBookmarkTab({title: tab.title || url, url, notes: ''});
			setColumnId(
				(ready && 'defaultColumnId' in ready
					? ready.defaultColumnId
					: undefined) ||
					defaultColumnId ||
					newColumnValue,
			);
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

	async function startAddToSession() {
		if (pickerSessions.length === 0) {
			showStatus('Save a session first, then add pages to it.', true);
			return;
		}

		setBusy('session-current');
		try {
			const [tab] = await chrome.tabs.query({
				active: true,
				lastFocusedWindow: true,
			});
			const url = webUrl(tab?.url);
			if (!url) {
				showStatus('Open a regular web page to add it to a session.', true);
				return;
			}

			setSessionTab({title: tab.title || url, url});
			setSessionId(
				(
					defaultTargetSession(groups, state?.folders ?? []) ??
					pickerSessions[0]
				).id,
			);
			setSessionOpen(true);
		} catch {
			showStatus(
				'Could not read the current page. Open a regular web page and try again.',
				true,
			);
		} finally {
			setBusy('');
		}
	}

	async function addToSession(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		const target = pickerSessions.find((group) => group.id === sessionId);
		if (!sessionTab || !target || busy === 'session-save') {
			return;
		}

		setBusy('session-save');
		try {
			const result = await send('ADD_LINKS_TO_SESSION', {
				groupId: target.id,
				links: [sessionTab],
			});
			if (!result?.ok) {
				showSaveFailure(
					showStatus,
					result,
					'Could not add this page to the session.',
				);
				return;
			}

			setSessionOpen(false);
			setSessionTab(null);
			await reload();
			offerUndo(
				`Added to “${target.name}”.`,
				result.undoId,
				showStatus,
				reload,
			);
		} catch (reason) {
			showStatus(
				reason instanceof Error
					? reason.message
					: 'Could not add this page to the session.',
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
				showSaveFailure(showStatus, result, 'Could not bookmark this page.');
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
			reportSessionRestore(result, group.name, showStatus, reload);

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
		} catch {}

		await openPage(url);
	}

	function openSidePanel() {
		if (windowId === undefined && !isFirefox) {
			return;
		}

		openPanel(windowId).then(
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

	if (!state && !error) {
		return (
			<main
				className={cn(
					'flex w-[380px] max-w-full items-center justify-center text-foreground',
					'h-[560px]',
				)}
			>
				<LoadingLine className="py-0" />
			</main>
		);
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
		<main
			className={cn(
				'flex w-[380px] max-w-full flex-col overflow-hidden text-foreground',
				'h-[560px]',
			)}
		>
			<header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
				<h1 className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
					{privateWindow ? (
						<span
							role="img"
							aria-label="Private window"
							title="Private window"
							className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground"
						>
							<PrivateWindowMark className="h-6 w-6" />
						</span>
					) : (
						<span className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
							<TabLodgeMark className="h-[18px] w-[18px]" />
						</span>
					)}
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
				{sharedPageUrl && (
					<section
						aria-labelledby="popup-shared-page"
						className="mb-4 rounded-lg border border-primary/30 bg-primary/6 p-3"
					>
						<h2 id="popup-shared-page" className="text-sm font-medium">
							A shared page of links
						</h2>
						<p className="mt-0.5 text-xs text-muted-foreground">
							Review its columns or sessions, then add them to {PROJECT.name}.
						</p>
						<Button
							size="sm"
							className="mt-2"
							onClick={() =>
								void openPage(
									chrome.runtime.getURL(
										`newtab.html?importLink=${encodeURIComponent(sharedPageUrl)}`,
									),
								)
							}
						>
							<Download aria-hidden="true" />
							Add this shared page
						</Button>
					</section>
				)}
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
					{!pageSavable && (
						<p id="page-unsavable" className="sr-only">
							This page cannot be saved.
						</p>
					)}
					<Button
						className="h-11 w-full justify-start gap-3 px-3 text-sm"
						variant="outline"
						disabled={busy !== '' || !pageSavable}
						title={pageSavable ? undefined : 'This page cannot be saved'}
						aria-describedby={pageSavable ? undefined : 'page-unsavable'}
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
						size="sm"
						className="w-full justify-start gap-3 px-3"
						variant="outline"
						disabled={busy !== '' || !pageSavable}
						title={pageSavable ? undefined : 'This page cannot be saved'}
						aria-describedby={pageSavable ? undefined : 'page-unsavable'}
						onClick={startAddToSession}
					>
						{busy === 'session-current' ? (
							<LoaderCircle className="h-4 w-4 animate-spin" />
						) : (
							<ListPlus className="h-4 w-4" />
						)}{' '}
						Add this page to a session
					</Button>
					{!privateWindow && (
						<Button
							size="sm"
							className="w-full justify-start gap-3 px-3"
							variant="outline"
							disabled={busy !== '' || !pageSavable}
							title={pageSavable ? undefined : 'This page cannot be saved'}
							aria-describedby={pageSavable ? undefined : 'page-unsavable'}
							onClick={() => void keepCopy()}
						>
							{busy === 'copy-current' ? (
								<LoaderCircle className="h-4 w-4 animate-spin" />
							) : (
								<FileDown className="h-4 w-4" />
							)}{' '}
							Keep a copy
						</Button>
					)}
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
					<Button
						size="sm"
						variant="outline"
						className="w-full justify-start gap-3 px-3"
						disabled={busy !== '' || duplicateCount === 0}
						onClick={() => void closeDuplicateTabs(showStatus)}
					>
						<CopyMinus className="h-4 w-4" aria-hidden="true" />
						{duplicateCount === 0
							? 'No duplicate tabs'
							: `Close ${plural(duplicateCount, 'duplicate tab')}`}
					</Button>
					{!state?.settings?.includePinnedTabs && (
						<div className="flex min-h-8 items-center justify-between gap-3 rounded-md border border-dashed border-border px-3">
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
									placeholder="Named by your Settings"
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
			<Dialog open={sessionOpen} onOpenChange={setSessionOpen}>
				<DialogContent size="sm">
					<form onSubmit={addToSession}>
						<DialogHeader>
							<DialogTitle>Add this page to a session</DialogTitle>
							<DialogDescription className="wrap-anywhere">
								The page stays open and is added at the end of the session.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							{sessionTab && (
								<LinkSummary
									title={sessionTab.title}
									url={sessionTab.url}
									settings={state?.settings}
								/>
							)}
							<div className="space-y-1.5">
								<Label htmlFor="popup-session">Session</Label>
								<Select value={sessionId} onValueChange={setSessionId}>
									<SelectTrigger id="popup-session">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{pickerSessions.map((group) => (
											<SelectItem key={group.id} value={group.id}>
												{group.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setSessionOpen(false)}
							>
								<X aria-hidden="true" />
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={!sessionTab || busy === 'session-save'}
							>
								<ListPlus aria-hidden="true" />
								{busy === 'session-save' ? 'Adding' : 'Add to session'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog open={bookmarkOpen} onOpenChange={setBookmarkOpen}>
				<DialogContent size="sm">
					<form onSubmit={saveBookmark}>
						<DialogHeader>
							<DialogTitle>Bookmark this page</DialogTitle>
							<DialogDescription className="wrap-anywhere">
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
								{picker ? (
									<picker.BookmarkColumnPicker
										id="bookmark-column"
										columns={columns}
										value={columnId}
										draft={newColumn}
										onDraftChange={setNewColumn}
										onValueChange={setColumnId}
									/>
								) : (
									<p className="sr-only" role="status">
										Loading columns
									</p>
								)}
							</div>
							{bookmarkTab && (
								<NotesField
									id="bookmark-notes"
									value={bookmarkTab.notes}
									onChange={(notes) =>
										setBookmarkTab((old) => old && {...old, notes})
									}
								/>
							)}
							{bookmarkTab && (
								<TagsField
									id="bookmark-tags"
									url={bookmarkTab.url}
									value={bookmarkTab}
									onChange={(tagged) =>
										setBookmarkTab((old) => old && {...old, ...tagged})
									}
								/>
							)}
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setBookmarkOpen(false)}
							>
								<X aria-hidden="true" />
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={!bookmarkTab || busy === 'bookmark-save'}
							>
								<BookmarkPlus aria-hidden="true" />
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
			<PrivateLockGate>
				<Popup />
			</PrivateLockGate>
		</TooltipProvider>
	</ThemeProvider>,
);
