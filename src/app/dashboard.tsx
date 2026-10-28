import {
	memo,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type DragEvent,
	type MouseEvent,
	type SyntheticEvent,
} from 'react';
import {
	AppWindow,
	ArrowDownUp,
	BookmarkPlus,
	ChevronDown,
	ChevronRight,
	Columns2,
	Download,
	ExternalLink,
	FolderPlus,
	Merge,
	History,
	LayoutGrid,
	MoreHorizontal,
	MoreVertical,
	PanelTop,
	Pencil,
	RotateCcw,
	Save,
	Search,
	Share2,
	Trash2,
	Upload,
	X,
} from 'lucide-react';
import {
	Badge,
	Button,
	Checkbox,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	ExpandingSearch,
	Input,
	IconTooltip,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
} from '../shared/ui';
import '../../styles/extension-app.css';
import {
	ActionContextMenu,
	ActionDropdownMenu,
	type MenuAction,
} from '../components/ui/action-menu';
import {DropIndicator} from '../components/ui/drop-indicator';
import {scrollBehavior} from '../shared/motion';
import {LoadMore, usePagedLimit} from '../shared/load-more';
import {useStableCallbacks} from '../shared/use-stable';
import {
	EmptyState,
	LoadingLine,
	StatusLine,
	TabLodgeMark,
	send,
	splitNote,
	useStatus,
	useTabLodgeState,
	restoreFailureText,
	plural,
} from './common';
import {BackupDialog, ImportDialog, useShareDialog} from './lazy-dialogs';
import type {ExportData} from './export-formats';
import {
	activateSessionTitle,
	applyLinkDrag,
	writeClipboard,
} from './interaction-actions';
import type {
	BookmarkColumn,
	Folder,
	InsertPosition,
	RestoreMode,
	RestoreTarget,
	SavedTab as SavedTabRecord,
	Session,
	SessionFields,
	SessionSort,
	Settings,
} from './types';
import {setLinkDragImage, setSessionDragImage} from './drag-preview';
import {DEFAULT_FOLDER_ICON, getIcon} from './icon-registry';
import {hostOf, webUrl} from './web-url';
import {ColumnLabel, FolderLabel, IconLabel} from './icon-label';
import {ACTION_ICONS} from './action-icons';
import {IconNameField} from './icon-picker';
import {Favicon, LinkSummary} from './favicon';
import {displayUrl as simplifiedUrl} from './url-display';
import {InsecureMarkFor} from './insecure-mark';
import {FINDER_EVENT, type FinderEventDetail} from './finder';
import {
	emitRecoveryEvent,
	offerCloseTabsUndo,
	offerTrashUndo,
	offerUndo,
} from './recovery-core';
import {openLink, resolveLinkTarget} from './link-target';

/**
Modifier keys that choose how a restore behaves or extend a tab selection (a mouse or keyboard event satisfies this).
*/
type ClickModifiers = {
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
};
type FolderDialog = {
	mode: 'create' | 'rename';
	folder?: Folder;
	/**
	Create mode only: the session to move into the new folder.
	*/
	moveGroupId?: string;
	/**
	The icon chosen so far in the open dialog.
	*/
	icon?: string;
};
type DialogState = 'bookmark' | 'details' | FolderDialog | null;
type BookmarkDraft = Partial<SavedTabRecord> & {columnId?: string};

const ALL = 'all';
/**
Highlight id for the New folder button while a session is dragged over it.
*/
const NEW_FOLDER_DROP = 'new-folder';
/**
Folder-picker value for "New folder" in the session details dialog.
*/
const NEW_FOLDER = 'new-folder-choice';
const WIDE_PAGE = '(min-width: 768px)';
/**
Tailwind's md breakpoint, tracked so collapsed cards know whether there is room for their preview icons.
*/
function useWidePage() {
	const [wide, setWide] = useState(
		() => globalThis.matchMedia(WIDE_PAGE).matches,
	);
	useEffect(() => {
		const query = globalThis.matchMedia(WIDE_PAGE);
		const update = () => {
			setWide(query.matches);
		};

		update();
		query.addEventListener('change', update);
		return () => {
			query.removeEventListener('change', update);
		};
	}, []);
	return wide;
}

/**
Stable fallbacks so memoized values and effects do not see a new array on every render.
*/
const NO_SESSIONS: Session[] = [];
const NO_FOLDERS: Folder[] = [];
const NO_COLUMNS: BookmarkColumn[] = [];
const NO_SETTINGS: Partial<Settings> = {};
const NO_SELECTION = new Set<string>();
/**
Sessions rendered at first; more are added as the list is scrolled (thousands of cards at once are slow).
*/
const SESSION_PAGE = 40;
const setMember = (set: Set<string>, key: string, member: boolean) => {
	if (member) {
		set.add(key);
	} else {
		set.delete(key);
	}
};

const tabKey = (groupId: string, tabId: string) =>
	JSON.stringify([groupId, tabId]);
const dateText = (value: unknown) => {
	const date = new Date(Number(value));
	return Number.isFinite(date.getTime())
		? new Intl.DateTimeFormat(undefined, {
				dateStyle: 'medium',
				timeStyle: 'short',
			}).format(date)
		: 'Date unavailable';
};

/**
Saved tabs in display order, with the two halves of each split view joined into one entry.
*/
function tabRuns(tabs: SavedTabRecord[]): SavedTabRecord[][] {
	const runs: SavedTabRecord[][] = [];
	for (let index = 0; index < tabs.length; index += 1) {
		const tab = tabs[index];
		const next = tabs[index + 1];
		if (tab.split && next?.split?.id === tab.split.id) {
			runs.push([tab, next]);
			index += 1;
		} else {
			runs.push([tab]);
		}
	}

	return runs;
}

/**
`initialQuery` prefills the session search (newtab.html?q=…).
*/
export function SessionManager({
	embedded = false,
	initialQuery = '',
}: {embedded?: boolean; initialQuery?: string} = {}) {
	const {state, error, reload} = useTabLodgeState();
	const [status, showStatus] = useStatus();
	const [folderId, setFolderId] = useState(ALL);
	const [folderDropId, setFolderDropId] = useState<string | null>(null);
	const [query, setQuery] = useState(initialQuery);
	const [sort, setSort] = useState<string>('newest');
	const [expanded, setExpanded] = useState(() => new Set<string>());
	// With "Keep sessions expanded by default", sessions are open unless collapsed during this visit.
	const [collapsed, setCollapsed] = useState(() => new Set<string>());
	const [selected, setSelected] = useState(() => new Set<string>());
	const [anchor, setAnchor] = useState<string | null>(null);
	const [dialog, setDialog] = useState<DialogState>(null);
	const [editingGroup, setEditingGroup] = useState<Session | null>(null);
	// Set when a session title click opens the details dialog: the name field gets focus with its text selected.
	const [focusGroupName, setFocusGroupName] = useState(false);
	// Session details: the chosen folder, or NEW_FOLDER with the new folder's icon (its name is a form field).
	const [detailsFolder, setDetailsFolder] = useState('unfiled');
	const [newFolderIcon, setNewFolderIcon] = useState<string | undefined>();
	const groupNameRef = useRef<HTMLInputElement>(null);
	const [bookmarkTab, setBookmarkTab] = useState<BookmarkDraft | null>(null);
	const [tabUrlError, setTabUrlError] = useState('');
	const [editingTab, setEditingTab] = useState<{
		group: Session;
		tab: SavedTabRecord;
	} | null>(null);
	// Written while a restore runs; the value itself is never read, the update just re-renders the page.
	// eslint-disable-next-line @eslint-react/use-state -- write-only on purpose
	const [, setBusy] = useState('');
	const [backupData, setBackupData] = useState<ExportData | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const {openShare, shareDialog} = useShareDialog(showStatus);
	const dragItemRef = useRef<DragItem | null>(null);
	// Drag state lives outside React state: only the cards a drag touches re-render, not the whole list.
	const [dragStore] = useState(() => new DragStore());
	// Bumped to ask the list to scroll to `revealRef` once it is rendered.
	const [revealTick, setRevealTick] = useState(0);
	const revealRef = useRef<{id: string; focus: boolean} | null>(null);
	const groups = state?.groups || NO_SESSIONS;
	const folders = state?.folders || NO_FOLDERS;
	const settings: Partial<Settings> = state?.settings || NO_SETTINGS;
	// Collapsed cards show a row of preview icons only on wide pages.
	const wide = useWidePage();
	const folderDialog = typeof dialog === 'object' ? dialog : null;
	const sessionsEnabled = settings.sessionsEnabled !== false;
	const expandAll = settings.expandSessionsByDefault === true;
	const isOpen = (id: string) =>
		expandAll ? !collapsed.has(id) : expanded.has(id);
	const bookmarksEnabled = settings.bookmarksEnabled !== false;

	const visibleGroups = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		const filtered = groups.filter(
			(group) =>
				(folderId === ALL || group.folderId === folderId) &&
				(!needle ||
					[
						group.name,
						group.description,
						group.sourceWindowName,
						...group.tabs.flatMap((tab) => [
							tab.title,
							tab.url,
							tab.nativeGroup?.title,
						]),
					].some((value) =>
						String(value || '')
							.toLocaleLowerCase()
							.includes(needle),
					)),
		);
		if (sort === 'newest') {
			filtered.sort((a, b) => b.createdAt - a.createdAt);
		}

		if (sort === 'oldest') {
			filtered.sort((a, b) => a.createdAt - b.createdAt);
		}

		if (sort === 'name') {
			filtered.sort((a, b) => a.name.localeCompare(b.name));
		}

		if (sort === 'tabs') {
			filtered.sort((a, b) => b.tabs.length - a.tabs.length);
		}

		return filtered;
	}, [groups, folderId, query, sort]);
	// A new filter, search or sort starts again from the first batch.
	const [visibleLimit, showMore, showUpTo] = usePagedLimit(
		`${folderId}|${query}|${sort}`,
		SESSION_PAGE,
	);
	const renderedGroups = useMemo(
		() => visibleGroups.slice(0, visibleLimit),
		[visibleGroups, visibleLimit],
	);
	const folderNames = useMemo(
		() => new Map(folders.map((folder) => [folder.id, folder.name])),
		[folders],
	);
	const folderCounts = useMemo(() => {
		const counts = new Map<string, number>();
		for (const group of groups) {
			counts.set(group.folderId, (counts.get(group.folderId) ?? 0) + 1);
		}

		return {all: groups.length, byFolder: counts};
	}, [groups]);
	const selectedByGroup = useMemo(() => {
		const byGroup = new Map<string, Set<string>>();
		for (const key of selected) {
			const [groupId, tabId] = JSON.parse(key) as [string, string];
			let ids = byGroup.get(groupId);
			if (!ids) {
				ids = new Set();
				byGroup.set(groupId, ids);
			}

			ids.add(tabId);
		}

		return byGroup;
	}, [selected]);

	useEffect(() => {
		if (!state) {
			return;
		}

		if (typeof state.settings?.sessionSort === 'string') {
			setSort(state.settings.sessionSort);
		}

		if (folderId !== ALL && folders.every((folder) => folder.id !== folderId)) {
			setFolderId(ALL);
		}

		const groupIds = new Set(groups.map((group) => group.id));
		setExpanded((old) => new Set([...old].filter((id) => groupIds.has(id))));
		setCollapsed((old) => new Set([...old].filter((id) => groupIds.has(id))));
		const valid = new Set(
			groups.flatMap((group) =>
				group.tabs.map((tab) => tabKey(group.id, tab.id)),
			),
		);
		setSelected((old) => new Set([...old].filter((key) => valid.has(key))));
		// Reconciles with each new saved state only; changing the folder filter must not re-run it.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `state` on purpose
	}, [state]);

	useEffect(() => {
		const focusId = new URLSearchParams(location.search).get('group');
		if (!focusId || groups.every((group) => group.id !== focusId)) {
			return;
		}

		setGroupOpen(focusId, true);
		revealRef.current = {id: focusId, focus: false};
		setRevealTick((tick) => tick + 1);
		// Focuses the session named in the URL whenever the saved state changes.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `state` on purpose
	}, [state]);

	// Requests from the global finder: reveal a session or folder, or open one of the session dialogs.
	const finderRequestRef = useRef<(detail: FinderEventDetail) => void>(
		() => {},
	);
	finderRequestRef.current = (detail) => {
		switch (detail.type) {
			case 'reveal-session': {
				const group = groups.find((entry) => entry.id === detail.id);
				if (!group) {
					return;
				}

				setFolderId(ALL);
				setQuery('');
				setGroupOpen(group.id, true);
				revealRef.current = {id: group.id, focus: true};
				setRevealTick((tick) => tick + 1);

				break;
			}

			case 'select-folder': {
				setFolderId(detail.id);
				setQuery('');

				break;
			}

			case 'new-folder': {
				setDialog({mode: 'create'});

				break;
			}

			case 'backup-sessions': {
				openBackup('sessions');

				break;
			}

			default: {
				setImportOpen(true);
			}
		}
	};

	useEffect(() => {
		const onRequest = (event: Event) =>
			finderRequestRef.current(
				(event as CustomEvent<FinderEventDetail>).detail,
			);
		globalThis.addEventListener(FINDER_EVENT, onRequest);
		return () => globalThis.removeEventListener(FINDER_EVENT, onRequest);
	}, []);

	// Scrolls to a session asked for by the URL or the palette, rendering more of the list first if it is further down.
	useEffect(() => {
		const reveal = revealRef.current;
		if (!reveal) {
			return;
		}

		const {id} = reveal;

		const index = visibleGroups.findIndex((group) => group.id === id);
		if (index === -1) {
			return;
		}

		if (index >= visibleLimit) {
			showUpTo(index + SESSION_PAGE);
			return;
		}

		revealRef.current = null;
		const frame = requestAnimationFrame(() => {
			const card = document.querySelector(`#session-${CSS.escape(id)}`);
			card?.scrollIntoView({block: 'center', behavior: scrollBehavior()});
			if (reveal.focus) {
				card
					?.querySelector<HTMLElement>('button')
					?.focus({preventScroll: true});
			}
		});
		return () => cancelAnimationFrame(frame);
	}, [revealTick, visibleGroups, visibleLimit, showUpTo]);

	useEffect(() => {
		if (selected.size === 0) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.key !== 'Escape' ||
				event.defaultPrevented ||
				document.querySelector(
					'[role="dialog"], [role="alertdialog"], [role="menu"]',
				)
			) {
				return;
			}

			setSelected(new Set());
			setAnchor(null);
		};

		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [selected.size]);

	function setGroupOpen(id: string, value: boolean) {
		const toggled = (old: Set<string>, include: boolean) => {
			const next = new Set(old);
			if (include) {
				next.add(id);
			} else {
				next.delete(id);
			}

			return next;
		};

		setExpanded((old) => toggled(old, value));
		setCollapsed((old) => toggled(old, !value));
	}

	function visibleTabOrder() {
		return visibleGroups
			.filter((group) => isOpen(group.id))
			.flatMap((group) => group.tabs.map((tab) => tabKey(group.id, tab.id)));
	}

	function changeSelection(
		key: string,
		checked: boolean,
		event: ClickModifiers,
	) {
		setSelected((old) => {
			const next = new Set(old);
			if (event.shiftKey && anchor) {
				const order = visibleTabOrder();
				const first = order.indexOf(anchor);
				const last = order.indexOf(key);
				if (first !== -1 && last !== -1) {
					for (const item of order.slice(
						Math.min(first, last),
						Math.max(first, last) + 1,
					)) {
						setMember(next, item, checked);
					}
				} else {
					setMember(next, key, checked);
				}
			} else if (event.ctrlKey || event.metaKey) {
				setMember(next, key, !next.has(key));
			} else {
				setMember(next, key, checked);
			}

			return next;
		});
		setAnchor(key);
	}

	function openBackup(kind: 'sessions' | 'selected') {
		const exportGroups = kind === 'selected' ? selectedGroups() : groups;
		if (exportGroups.length === 0) {
			showStatus(
				kind === 'selected'
					? 'Select tabs to export first.'
					: 'There are no sessions to back up.',
				true,
			);
			return;
		}

		setBackupData({kind, groups: exportGroups, folders});
	}

	function selectedGroups() {
		return groups.flatMap((group) => {
			const tabs = group.tabs.filter((tab) =>
				selected.has(tabKey(group.id, tab.id)),
			);
			return tabs.length > 0 ? [{...group, tabs}] : [];
		});
	}

	function selectedTabCount() {
		return selectedGroups().reduce((sum, group) => sum + group.tabs.length, 0);
	}

	async function restoreGroup(
		group: Session,
		forceRemove = false,
		event?: ClickModifiers,
		requestedMode?: RestoreMode,
		requestedTarget?: RestoreTarget,
	) {
		const restoreMode =
			requestedMode || (event?.ctrlKey || event?.metaKey ? 'keep' : undefined);
		const restoreTarget =
			requestedTarget ?? (event?.shiftKey ? 'always-new-window' : undefined);
		setBusy(`restore:${group.id}`);
		const result = await send('RESTORE_GROUP', {
			groupId: group.id,
			forceRemove,
			restoreMode,
			restoreTarget,
		});
		setBusy('');
		if (!result?.ok) {
			showStatus(result?.error || 'Could not restore this session.', true);
			return;
		}

		// Only partial failures are reported; a clean restore speaks for itself.
		if (result.failed) {
			showStatus(
				`Restored ${result.count} ${result.count === 1 ? 'tab' : 'tabs'} · ${result.failed} failed${result.failures?.[0] ? ` · ${restoreFailureText(result.failures[0])}` : ''}.`,
				true,
			);
		} else if (result.trashId) {
			offerTrashUndo(
				`Restored ${result.count} ${result.count === 1 ? 'tab' : 'tabs'} and removed ${result.count === 1 ? 'it' : 'them'} from the session.`,
				result.trashId,
				showStatus,
				reload,
			);
		} else if (result.splitsSeparated) {
			showStatus(
				`Restored ${result.count} ${result.count === 1 ? 'tab' : 'tabs'} · ${splitNote(result.splitsSeparated)}.`,
				false,
				{toast: true},
			);
		}

		await reload();
	}

	async function restoreTab(
		group: Session,
		tab: SavedTabRecord,
		event?: ClickModifiers,
	) {
		const result = await send('RESTORE_TAB', {
			groupId: group.id,
			tabId: tab.id,
			restoreMode: event?.ctrlKey || event?.metaKey ? 'keep' : undefined,
			restoreTarget: event?.shiftKey ? 'always-new-window' : undefined,
			activate: event?.ctrlKey || event?.metaKey ? false : undefined,
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not restore this tab.', true);
		} else if (result.failed) {
			showStatus(
				restoreFailureText(result.failures?.[0]) ||
					'This tab could not be restored.',
				true,
			);
		} else if (result.trashId) {
			offerTrashUndo(
				'Restored the tab and removed it from the session.',
				result.trashId,
				showStatus,
				reload,
			);
		}

		await reload();
	}

	async function saveTabDetails(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!editingTab) {
			return;
		}

		const form = new FormData(event.currentTarget);
		const {group, tab} = editingTab;
		const url = webUrl(String(form.get('url') || ''));
		if (!url) {
			setTabUrlError(
				'Enter a web address that starts with http:// or https://.',
			);
			return;
		}

		const result = await send('UPDATE_TAB', {
			groupId: group.id,
			tabId: tab.id,
			fields: {
				title: String(form.get('title') || ''),
				notes: String(form.get('notes') || ''),
				...(url !== tab.url && {url}),
			},
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not save this tab.', true);
			return;
		}

		setEditingTab(null);
		if (url !== tab.url) {
			// Undo puts the link's address, title and notes back; only this one saved link is touched.
			showStatus('Link updated.', false, {
				action: {
					label: 'Undo',
					async onClick() {
						const undone = await send('UPDATE_TAB', {
							groupId: group.id,
							tabId: tab.id,
							fields: {url: tab.url, title: tab.title, notes: tab.notes},
						});
						if (!undone?.ok) {
							showStatus(undone?.error || 'Could not undo that edit.', true);
						}

						await reload();
					},
				},
			});
		}

		await reload();
	}

	async function updateGroup(group: Session, fields: SessionFields) {
		const result = await send('UPDATE_GROUP', {groupId: group.id, fields});
		if (result?.ok) {
			await reload();
		} else {
			showStatus(result?.error || 'Could not update this session.', true);
		}
	}

	/**
	Deletes right away; `closeEditor` also closes the details dialog it was asked from. Undo puts the session back from the trash.
	*/
	async function deleteGroup(group: Session, closeEditor = false) {
		const result = await send('DELETE_GROUP', {groupId: group.id});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not delete this session.', true);
			return;
		}

		if (closeEditor) {
			setDialog(null);
			setEditingGroup(null);
		}

		await reload();
		offerTrashUndo(
			`Session “${group.name}” deleted.`,
			result.trashId,
			showStatus,
			reload,
		);
	}

	async function deleteSavedTab(group: Session, tab: SavedTabRecord) {
		const result = await send('DELETE_TAB', {
			groupId: group.id,
			tabId: tab.id,
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not remove this saved tab.', true);
			return;
		}

		await reload();
		offerTrashUndo('Link removed.', result.trashId, showStatus, reload);
	}

	async function openAllInNewTabs(tabs: SavedTabRecord[]) {
		if (tabs.length === 0) {
			return;
		}

		const opened: number[] = [];
		try {
			for (const tab of tabs) {
				const created = await chrome.tabs.create({url: tab.url, active: false});
				if (created.id !== undefined) {
					opened.push(created.id);
				}
			}
		} catch {
			showStatus('Some tabs could not be opened.', true);
			return;
		}

		// A handful of tabs is routine; a bigger batch gets an Undo that closes them again.
		if (tabs.length > 10) {
			offerCloseTabsUndo(`Opened ${tabs.length} tabs.`, opened, showStatus);
		}
	}

	async function openTab(tab: SavedTabRecord, requested?: 'current' | 'new') {
		try {
			await openLink(tab.url, 'session', settings as Settings, requested);
		} catch {
			showStatus('Could not open this link.', true);
		}
	}

	async function copyTabLink(tab: SavedTabRecord) {
		try {
			await writeClipboard({text: tab.url, html: null});
		} catch {
			showStatus('Could not copy the link. Check clipboard permissions.', true);
		}
	}

	async function moveTab(
		fromGroupId: string,
		tabId: string,
		toGroupId: string,
		targetTabId: string | null = null,
		position?: InsertPosition,
		copy = false,
	) {
		// Where the link sat, so Undo can put it back next to the same neighbor.
		const sourceTabs = groups.find((group) => group.id === fromGroupId)?.tabs;
		const sourceIndex = sourceTabs?.findIndex((tab) => tab.id === tabId) ?? -1;
		const nextSibling = sourceTabs?.[sourceIndex + 1];
		const previousSibling = sourceTabs?.[sourceIndex - 1];
		const targetName = groups.find((group) => group.id === toGroupId)?.name;
		const result = await send('MOVE_TAB', {
			fromGroupId,
			tabId,
			toGroupId,
			targetTabId,
			position,
			copy,
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not move this link.', true);
		} else if (!copy && fromGroupId !== toGroupId && sourceIndex !== -1) {
			showStatus(
				`Moved the link to “${targetName ?? 'another session'}”.`,
				false,
				{
					action: {
						label: 'Undo',
						async onClick() {
							const undone = await send('MOVE_TAB', {
								fromGroupId: toGroupId,
								tabId,
								toGroupId: fromGroupId,
								targetTabId: nextSibling?.id ?? previousSibling?.id ?? null,
								position: nextSibling ? 'before' : 'after',
								// The move emptied the source session: it comes back from the trash with the link.
								restoreTrashId: result.trashId,
							});
							if (!undone?.ok) {
								showStatus(undone?.error || 'Could not undo that move.', true);
							}

							await reload();
						},
					},
				},
			);
		}

		await reload();
	}

	async function placeGroup(
		draggedId: string,
		targetId: string,
		position: InsertPosition,
	) {
		const ids = visibleGroups
			.map((group) => group.id)
			.filter((id) => id !== draggedId);
		const at = ids.indexOf(targetId);
		if (at === -1) {
			return;
		}

		ids.splice(position === 'after' ? at + 1 : at, 0, draggedId);
		setSort('custom');
		const result = await send('SET_GROUP_ORDER', {order: ids});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not reorder sessions.', true);
		}

		await reload();
	}

	// A dragged session may land on any folder chip except All and the folder it already sits in.
	function folderDropTarget(targetId: string) {
		const item = dragItemRef.current;
		if (item?.kind !== 'session' || targetId === ALL) {
			return false;
		}

		const dragged = groups.find((group) => group.id === item.id);
		return Boolean(dragged) && dragged?.folderId !== targetId;
	}

	const drag = {
		begin(item: DragItem) {
			dragItemRef.current = item;
			// Styling the source row right away can cancel the browser's drag, so it waits a frame.
			requestAnimationFrame(() => {
				if (dragItemRef.current === item) {
					dragStore.set({dragging: item});
				}
			});
		},
		end() {
			dragItemRef.current = null;
			setFolderDropId(null);
			dragStore.set({dragging: null, mark: null});
		},
		over(group: Session, event: DragEvent<HTMLElement>) {
			const mark = resolveDropMark(group, event, dragItemRef.current);
			if (!mark) {
				return;
			}

			event.preventDefault();
			event.dataTransfer.dropEffect =
				mark.kind !== 'session' && (event.ctrlKey || event.metaKey)
					? 'copy'
					: 'move';
			const old = dragStore.mark;
			dragStore.set({
				mark: JSON.stringify(old) === JSON.stringify(mark) ? old : mark,
			});
		},
		leave(event: DragEvent<HTMLElement>) {
			if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
				dragStore.set({mark: null});
			}
		},
		drop(group: Session, event: DragEvent<HTMLElement>) {
			const item = dragItemRef.current;
			const mark = resolveDropMark(group, event, item);
			if (!item || !mark) {
				return;
			}

			event.preventDefault();
			const copy = event.ctrlKey || event.metaKey;
			drag.end();
			if (item.kind === 'session' && mark.kind === 'session') {
				void placeGroup(item.id, mark.groupId, mark.position);
			} else if (item.kind === 'tab' && mark.kind !== 'session') {
				void moveTab(
					item.groupId,
					item.tabId,
					group.id,
					mark.kind === 'tab' ? mark.tabId : null,
					mark.kind === 'tab' ? mark.position : undefined,
					copy,
				);
			}
		},
	};

	// One stable object of callbacks for every card: it always calls the latest closures below, so
	// memoized cards and rows are not re-rendered just because a handler was re-created.
	const cardActions = useStableCallbacks<CardActions>({
		expand: setGroupOpen,
		restore: (group, event) => restoreGroup(group, false, event),
		restoreTarget: (group, target) =>
			restoreGroup(group, false, undefined, undefined, target),
		restoreMode: (group, mode) => restoreGroup(group, false, undefined, mode),
		forceRestore: (group) => restoreGroup(group, true),
		restoreTab,
		updateGroup,
		share: (group) => openShare({title: group.name, groups: [group]}),
		openTab,
		copyTab: copyTabLink,
		moveTab: (group, tab, toGroupId) => moveTab(group.id, tab.id, toGroupId),
		deleteGroup: (group) => deleteGroup(group),
		deleteTab: deleteSavedTab,
		editTab: (group, tab) => setEditingTab({group, tab}),
		editGroup: (group) => openGroupDetails(group),
		editName: (group) => openGroupDetails(group, true),
		moveToFolder: moveGroupToFolder,
		merge: mergeGroup,
		newFolderFor: (group) => setDialog({mode: 'create', moveGroupId: group.id}),
		folderTargets: () => folders,
		bookmark: openBookmarkPicker,
		select: changeSelection,
		moveTargets(excludeId) {
			const targets: Array<{id: string; name: string}> = [];
			for (const group of groups) {
				if (group.id === excludeId) {
					continue;
				}

				targets.push({id: group.id, name: group.name});
				if (targets.length === MAX_MOVE_TARGETS) {
					break;
				}
			}

			return targets;
		},
		dragBegin: drag.begin,
		dragEnd: drag.end,
		dragOver: drag.over,
		dragLeave: drag.leave,
		dragDrop: drag.drop,
	});

	async function changeSort(value: string) {
		setSort(value);
		const result = await send('UPDATE_SETTINGS', {
			settings: {sessionSort: value as SessionSort},
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not save the sort preference.', true);
		}
	}

	async function saveBookmark(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!bookmarkTab) {
			return;
		}

		const result = await send('ADD_BOOKMARK', {
			bookmark: {
				title: bookmarkTab.title,
				url: bookmarkTab.url,
				columnId: bookmarkTab.columnId,
			},
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not bookmark this saved tab.', true);
			return;
		}

		setDialog(null);
		setBookmarkTab(null);
		await reload();
	}

	async function saveGroupDetails(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!editingGroup) {
			return;
		}

		const form = new FormData(event.currentTarget);
		let targetFolderId = detailsFolder;
		if (targetFolderId === NEW_FOLDER) {
			const created = await send('CREATE_FOLDER', {
				name: String(form.get('newFolderName') || '').trim(),
				icon: newFolderIcon,
			});
			if (!created?.ok) {
				showStatus(created?.error || 'Could not create the folder.', true);
				return;
			}

			targetFolderId = created.folder.id;
		}

		const fields: SessionFields = {
			name: String(form.get('name') || ''),
			description: String(form.get('description') || ''),
			folderId: targetFolderId,
		};
		const result = await send('UPDATE_GROUP', {
			groupId: editingGroup.id,
			fields,
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not save session details.', true);
			return;
		}

		setDialog(null);
		setEditingGroup(null);
		await reload();
	}

	function openGroupDetails(group: Session, focusName = false) {
		setEditingGroup(group);
		setDetailsFolder(group.folderId || 'unfiled');
		setNewFolderIcon(undefined);
		setFocusGroupName(focusName);
		setDialog('details');
	}

	async function mergeGroup(group: Session, targetId: string) {
		const target = groups.find((item) => item.id === targetId);
		const result = await send('MERGE_GROUPS', {
			sourceGroupId: group.id,
			targetGroupId: targetId,
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not merge these sessions.', true);
			return;
		}

		await reload();
		const duplicates = result.skipped
			? ` ${plural(result.skipped, 'duplicate')} skipped.`
			: '';
		offerUndo(
			`Merged “${group.name}” into “${target?.name ?? 'the session'}”: ${plural(result.added, 'link')} added.${duplicates}`,
			result.undoId,
			showStatus,
			reload,
		);
	}

	async function moveGroupToFolder(
		group: Session,
		targetId: string,
		targetName?: string,
	) {
		if (group.folderId === targetId) {
			return;
		}

		const previous = group.folderId;
		const result = await send('UPDATE_GROUP', {
			groupId: group.id,
			fields: {folderId: targetId},
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not move this session.', true);
			return;
		}

		const name =
			targetName ?? folders.find((folder) => folder.id === targetId)?.name;
		showStatus(`Moved to ${name ?? 'the folder'}.`, false, {
			action: {
				label: 'Undo',
				async onClick() {
					const undone = await send('UPDATE_GROUP', {
						groupId: group.id,
						fields: {folderId: previous},
					});
					if (!undone?.ok) {
						showStatus(undone?.error || 'Could not undo that move.', true);
					}

					await reload();
				},
			},
		});
		await reload();
	}

	async function saveFolder(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		const name = String(
			new FormData(event.currentTarget).get('name') || '',
		).trim();
		if (!name) {
			return;
		}

		const result =
			folderDialog?.mode === 'rename'
				? await send('UPDATE_FOLDER', {
						folderId,
						name,
						icon: folderDialog.icon ?? '',
					})
				: await send('CREATE_FOLDER', {name, icon: folderDialog?.icon});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not save this folder.', true);
			return;
		}

		const moving = folderDialog?.moveGroupId
			? groups.find((entry) => entry.id === folderDialog.moveGroupId)
			: undefined;
		if (folderDialog?.mode !== 'rename' && !moving) {
			setFolderId(result.folder.id);
		}

		setDialog(null);
		if (moving) {
			// The folder exists now; the move reports its own result with Undo.
			await moveGroupToFolder(moving, result.folder.id, result.folder.name);
			return;
		}

		await reload();
	}

	async function deleteFolder(folder: {
		id: string;
		name: string;
		isDefault?: boolean;
	}) {
		if (folder.isDefault) {
			return;
		}

		const moved = folderCounts.byFolder.get(folder.id) ?? 0;
		const result = await send('DELETE_FOLDER', {folderId: folder.id});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not delete this folder.', true);
			return;
		}

		if (folderId === folder.id) {
			setFolderId(ALL);
		}

		await reload();
		offerUndo(
			`Deleted folder “${folder.name}”.${moved > 0 ? ` ${moved} ${moved === 1 ? 'session' : 'sessions'} moved to Unfiled.` : ''}`,
			result.undoId,
			showStatus,
			reload,
		);
	}

	function openBookmarkPicker(tab: SavedTabRecord) {
		setBookmarkTab(tab);
		setDialog('bookmark');
	}

	if (!state) {
		return error ? (
			<StatusLine status={{message: error, error: true}} />
		) : (
			<LoadingLine />
		);
	}

	const selectedCount = selectedTabCount();
	const selectedFolder = folders.find((folder) => folder.id === folderId);
	const columns = state?.bookmarkColumns || NO_COLUMNS;
	return (
		<div
			data-brand="tablodge"
			className={
				embedded
					? 'w-full space-y-6'
					: 'mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-9'
			}
		>
			{!sessionsEnabled && (
				<div className="mb-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
					Sessions are disabled. Saved data is retained; enable Sessions in
					Settings to manage it.
				</div>
			)}
			{sessionsEnabled && (
				<section aria-labelledby="sessions-title">
					<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
						<div className="flex items-center gap-2">
							<h2
								id="sessions-title"
								tabIndex={-1}
								className="text-lg font-semibold tracking-tight"
							>
								Sessions
							</h2>
							<Badge variant="accent">{visibleGroups.length}</Badge>
						</div>
						<div className="flex items-center gap-1">
							<ExpandingSearch
								label="Search sessions and tabs"
								value={query}
								onChange={setQuery}
							/>
							<DropdownMenu>
								<IconTooltip label="Sort sessions">
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											aria-label="Sort sessions"
										>
											<ArrowDownUp />
										</Button>
									</DropdownMenuTrigger>
								</IconTooltip>
								<DropdownMenuContent align="end">
									<DropdownMenuLabel>Sort sessions</DropdownMenuLabel>
									<DropdownMenuRadioGroup
										value={sort}
										onValueChange={(value) => void changeSort(value)}
									>
										{[
											['newest', 'Newest first'],
											['oldest', 'Oldest first'],
											['name', 'Name A–Z'],
											['tabs', 'Most tabs'],
											['custom', 'Custom order'],
										].map(([value, label]) => (
											<DropdownMenuRadioItem key={value} value={value}>
												{label}
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuContent>
							</DropdownMenu>
							<IconTooltip label="Recent snapshots">
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8"
									aria-label="Recent snapshots"
									onClick={() => emitRecoveryEvent({type: 'snapshots'})}
								>
									<History />
								</Button>
							</IconTooltip>
							<DropdownMenu>
								<IconTooltip label="Import and back up sessions">
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											aria-label="Import and back up sessions"
										>
											<MoreHorizontal />
										</Button>
									</DropdownMenuTrigger>
								</IconTooltip>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onSelect={() => setImportOpen(true)}>
										<Upload className="h-4 w-4" />
										Import sessions
									</DropdownMenuItem>
									<DropdownMenuItem onSelect={() => openBackup('sessions')}>
										<Download className="h-4 w-4" />
										Back up sessions
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										onSelect={() =>
											emitRecoveryEvent({type: 'trash', filter: 'sessions'})
										}
									>
										<Trash2 className="h-4 w-4" />
										Trash bin
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>

					<nav
						className="mb-4 flex flex-wrap items-center gap-1"
						aria-label="Session folders"
					>
						{[{id: ALL, name: 'All', icon: undefined}, ...folders].map(
							(folder) => {
								const FolderIcon =
									folder.id === ALL
										? LayoutGrid
										: getIcon(folder.icon, DEFAULT_FOLDER_ICON).component;
								const chip = (
									<button
										key={folder.id}
										type="button"
										aria-pressed={folderId === folder.id}
										data-drop-active={folderDropId === folder.id || undefined}
										className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${folderDropId === folder.id ? 'bg-primary/15 text-foreground ring-2 ring-primary' : folderId === folder.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
										onDragOver={(event) => {
											if (dragItemRef.current?.kind !== 'session') {
												return;
											}

											event.preventDefault();
											if (folderDropTarget(folder.id)) {
												event.dataTransfer.dropEffect = 'move';
												setFolderDropId(folder.id);
											} else {
												event.dataTransfer.dropEffect = 'none';
												setFolderDropId(null);
											}
										}}
										onDragLeave={(event) => {
											if (
												!event.currentTarget.contains(
													event.relatedTarget as Node | null,
												)
											) {
												setFolderDropId((current) =>
													current === folder.id ? null : current,
												);
											}
										}}
										onDrop={(event) => {
											if (!folderDropTarget(folder.id)) {
												return;
											}

											event.preventDefault();
											const item = dragItemRef.current;
											const dragged = groups.find(
												(group) =>
													item?.kind === 'session' && group.id === item.id,
											);
											drag.end();
											if (dragged) {
												void moveGroupToFolder(dragged, folder.id, folder.name);
											}
										}}
										onClick={() => {
											setFolderId(folder.id);
											setAnchor(null);
										}}
									>
										<FolderIcon
											className="size-3.5 shrink-0"
											aria-hidden="true"
										/>
										{folder.name}
										<span className="tabular-nums opacity-90">
											{folder.id === ALL
												? folderCounts.all
												: (folderCounts.byFolder.get(folder.id) ?? 0)}
										</span>
									</button>
								);
								if (!('createdAt' in folder) || folder.isDefault) {
									return chip;
								}

								return (
									<ActionContextMenu
										key={folder.id}
										actions={() => [
											{
												id: 'edit-folder',
												label: 'Edit folder',
												icon: ACTION_ICONS.edit,
												onSelect() {
													setDialog({
														mode: 'rename',
														folder,
														icon: folder.icon,
													});
												},
											},
											{
												id: 'delete-folder',
												label: 'Delete folder',
												icon: ACTION_ICONS.remove,
												destructive: true,
												onSelect() {
													void deleteFolder(folder);
												},
											},
										]}
									>
										{chip}
									</ActionContextMenu>
								);
							},
						)}
						<span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
						<IconTooltip label="New folder">
							<Button
								variant="ghost"
								size="icon"
								className={`h-8 w-8 ${folderDropId === NEW_FOLDER_DROP ? 'bg-primary/15 ring-2 ring-primary' : ''}`}
								aria-label="New folder"
								onClick={() => setDialog({mode: 'create'})}
								// Dropping a session here creates a folder and moves the session into it.
								onDragOver={(event) => {
									if (dragItemRef.current?.kind !== 'session') {
										return;
									}

									event.preventDefault();
									event.dataTransfer.dropEffect = 'move';
									setFolderDropId(NEW_FOLDER_DROP);
								}}
								onDragLeave={(event) => {
									if (
										!event.currentTarget.contains(
											event.relatedTarget as Node | null,
										)
									) {
										setFolderDropId((current) =>
											current === NEW_FOLDER_DROP ? null : current,
										);
									}
								}}
								onDrop={(event) => {
									const item = dragItemRef.current;
									if (item?.kind !== 'session') {
										return;
									}

									event.preventDefault();
									drag.end();
									setDialog({mode: 'create', moveGroupId: item.id});
								}}
							>
								<FolderPlus />
							</Button>
						</IconTooltip>
						{selectedFolder && !selectedFolder.isDefault && (
							<>
								<IconTooltip label={`Edit ${selectedFolder.name}`}>
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8"
										aria-label={`Edit ${selectedFolder.name}`}
										onClick={() =>
											setDialog({
												mode: 'rename',
												folder: selectedFolder,
												icon: selectedFolder.icon,
											})
										}
									>
										<Pencil />
									</Button>
								</IconTooltip>
								<IconTooltip label={`Delete ${selectedFolder.name}`}>
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8 text-muted-foreground hover:text-destructive"
										aria-label={`Delete ${selectedFolder.name}`}
										onClick={() => void deleteFolder(selectedFolder)}
									>
										<Trash2 />
									</Button>
								</IconTooltip>
							</>
						)}
					</nav>
					{selectedCount > 0 && (
						<div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/[.055] px-4 py-3">
							<span className="text-sm font-semibold" aria-live="polite">
								{selectedCount} {selectedCount === 1 ? 'tab' : 'tabs'} selected
							</span>
							<div className="flex flex-wrap gap-2">
								<Button
									size="sm"
									onClick={() =>
										void openAllInNewTabs(
											selectedGroups().flatMap((group) => group.tabs),
										)
									}
								>
									<ExternalLink className="h-4 w-4" />
									Open selected
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => openBackup('selected')}
								>
									<Download className="h-4 w-4" />
									Export selected
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() =>
										openShare({
											title: 'Shared tabs',
											groups: selectedGroups(),
										})
									}
								>
									<Share2 className="h-4 w-4" />
									Share selected
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										setSelected(new Set());
										setAnchor(null);
									}}
								>
									Clear
								</Button>
							</div>
						</div>
					)}

					{groups.length === 0 ? (
						<EmptyState icon={TabLodgeMark} title="No saved sessions">
							Save tabs from the popup, a shortcut, or the right-click menu.
						</EmptyState>
					) : visibleGroups.length === 0 ? (
						<EmptyState
							icon={Search}
							title={
								query.trim()
									? 'No matching sessions'
									: `Nothing in ${selectedFolder?.name || 'this folder'}`
							}
						>
							{query.trim()
								? 'Try another search term.'
								: 'This folder is empty. Save a session or move one here from its details.'}
						</EmptyState>
					) : (
						<div className="space-y-2">
							{renderedGroups.map((group) => (
								<GroupCard
									key={group.id}
									group={group}
									folderName={folderNames.get(group.folderId)}
									settings={settings}
									wide={wide}
									isExpanded={isOpen(group.id)}
									selectedTabs={selectedByGroup.get(group.id) ?? NO_SELECTION}
									selectionActive={selected.size > 0}
									bookmarksEnabled={bookmarksEnabled}
									actions={cardActions}
									dragStore={dragStore}
								/>
							))}
						</div>
					)}
					{visibleGroups.length > renderedGroups.length && (
						<LoadMore
							remaining={visibleGroups.length - renderedGroups.length}
							step={SESSION_PAGE}
							noun="sessions"
							onMore={showMore}
						/>
					)}
				</section>
			)}

			<StatusLine status={status} />

			{shareDialog}
			<BackupDialog
				data={backupData}
				open={Boolean(backupData)}
				state={state}
				showStatus={showStatus}
				onOpenChange={(open) => !open && setBackupData(null)}
			/>
			<ImportDialog
				open={importOpen}
				initialKind="sessions"
				state={state}
				showStatus={showStatus}
				onOpenChange={setImportOpen}
				onImported={() => void reload()}
			/>
			<Dialog
				open={Boolean(editingTab)}
				onOpenChange={(open) => {
					if (open) {
						return;
					}

					setEditingTab(null);
					setTabUrlError('');
				}}
			>
				<DialogContent>
					<form key={editingTab?.tab.id} onSubmit={saveTabDetails}>
						<DialogHeader>
							<DialogTitle>Edit link</DialogTitle>
							<DialogDescription>
								Change the title, address, and notes of this saved link.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							{editingTab && (
								<LinkSummary
									settings={settings}
									title={editingTab.tab.title}
									url={editingTab.tab.url}
								/>
							)}
							<div className="space-y-1.5">
								<Label htmlFor="tab-title">Title</Label>
								<Input
									required
									id="tab-title"
									name="title"
									maxLength={500}
									defaultValue={editingTab?.tab.title || ''}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="tab-url">Address</Label>
								<Input
									required
									id="tab-url"
									name="url"
									type="text"
									inputMode="url"
									maxLength={16_384}
									aria-invalid={Boolean(tabUrlError)}
									aria-describedby={tabUrlError ? 'tab-url-error' : undefined}
									defaultValue={editingTab?.tab.url || ''}
									onChange={() => setTabUrlError('')}
								/>
								{tabUrlError && (
									<p
										id="tab-url-error"
										role="alert"
										className="text-xs text-destructive"
									>
										{tabUrlError}
									</p>
								)}
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="tab-notes">Notes</Label>
								<Textarea
									id="tab-notes"
									name="notes"
									maxLength={10_000}
									rows={4}
									placeholder="Add a note (optional)"
									defaultValue={editingTab?.tab.notes || ''}
								/>
							</div>
							<p className="text-xs text-muted-foreground">
								Title and notes are shared with every saved copy of this page. A
								new address changes only this saved link.
							</p>
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setEditingTab(null)}
							>
								Cancel
							</Button>
							<Button type="submit">Save</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={dialog === 'bookmark'}
				onOpenChange={(open) => !open && setDialog(null)}
			>
				<DialogContent size="sm">
					<form onSubmit={saveBookmark}>
						<DialogHeader>
							<DialogTitle>Bookmark link</DialogTitle>
							<DialogDescription>
								Save this link to a bookmark column.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							{bookmarkTab?.url && (
								<LinkSummary
									title={bookmarkTab.title}
									url={bookmarkTab.url}
									settings={settings}
								/>
							)}
							<div className="space-y-1.5">
								<Label htmlFor="bookmark-column-select">Bookmark column</Label>
								<Select
									value={bookmarkTab?.columnId || columns[0]?.id}
									onValueChange={(value) =>
										setBookmarkTab((old) => ({...old, columnId: value}))
									}
								>
									<SelectTrigger id="bookmark-column-select">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{columns.map((column) => (
											<SelectItem key={column.id} value={column.id}>
												<ColumnLabel column={column} />
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
								onClick={() => setDialog(null)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={!bookmarksEnabled}>
								Save bookmark
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={dialog === 'details'}
				onOpenChange={(open) => !open && setDialog(null)}
			>
				<DialogContent
					onOpenAutoFocus={(event) => {
						if (!focusGroupName || !groupNameRef.current) {
							return;
						}

						event.preventDefault();
						groupNameRef.current.focus();
						groupNameRef.current.select();
					}}
				>
					<form onSubmit={saveGroupDetails}>
						<DialogHeader>
							<DialogTitle>Session details</DialogTitle>
							<DialogDescription>
								Update this session’s name, description, and folder.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<div className="space-y-1.5">
								<Label htmlFor="group-name">Session name</Label>
								<Input
									ref={groupNameRef}
									required
									id="group-name"
									name="name"
									maxLength={120}
									defaultValue={editingGroup?.name || ''}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="group-description">Description</Label>
								<Textarea
									id="group-description"
									name="description"
									maxLength={10_502}
									rows={4}
									placeholder="Add a project, task, or note (optional)"
									defaultValue={editingGroup?.description || ''}
								/>
							</div>
							<div className="min-w-0 space-y-1.5">
								<Label htmlFor="group-folder">Folder</Label>
								<Select value={detailsFolder} onValueChange={setDetailsFolder}>
									<SelectTrigger id="group-folder">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{folders.map((folder) => (
											<SelectItem key={folder.id} value={folder.id}>
												<FolderLabel folder={folder} />
											</SelectItem>
										))}
										<SelectItem value={NEW_FOLDER}>
											<IconLabel icon={FolderPlus}>New folder</IconLabel>
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{detailsFolder === NEW_FOLDER && (
								<IconNameField
									id="group-new-folder"
									label="New folder name"
									nameLabel="New folder name"
									icon={newFolderIcon}
									defaultIcon={DEFAULT_FOLDER_ICON}
									inputProps={{
										required: true,
										autoFocus: true,
										name: 'newFolderName',
										maxLength: 60,
										placeholder: 'Work',
									}}
									onIconChange={setNewFolderIcon}
								/>
							)}
						</DialogBody>
						<DialogFooter className="justify-between">
							{editingGroup && (
								<Button
									type="button"
									variant="destructive"
									onClick={() => deleteGroup(editingGroup, true)}
								>
									<Trash2 />
									Delete
								</Button>
							)}
							<div className="ml-auto flex flex-wrap justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									onClick={() => setDialog(null)}
								>
									Cancel
								</Button>
								<Button type="submit">Save changes</Button>
							</div>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={
					folderDialog?.mode === 'create' || folderDialog?.mode === 'rename'
				}
				onOpenChange={(open) => !open && setDialog(null)}
			>
				<DialogContent size="sm">
					<form onSubmit={saveFolder}>
						<DialogHeader>
							<DialogTitle>
								{folderDialog?.mode === 'rename' ? 'Edit folder' : 'New folder'}
							</DialogTitle>
							<DialogDescription>
								Choose a name and icon to keep related sessions together.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<IconNameField
								id="folder-name"
								label="Name"
								nameLabel="Folder name"
								icon={folderDialog?.icon}
								defaultIcon={DEFAULT_FOLDER_ICON}
								inputProps={{
									required: true,
									autoFocus: true,
									name: 'name',
									maxLength: 60,
									defaultValue: folderDialog?.folder?.name || '',
								}}
								onIconChange={(icon) =>
									setDialog((old) =>
										typeof old === 'object' && old ? {...old, icon} : old,
									)
								}
							/>
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setDialog(null)}
							>
								Cancel
							</Button>
							<Button type="submit">
								{folderDialog?.mode === 'rename'
									? 'Save changes'
									: folderDialog?.moveGroupId
										? 'Create and move'
										: 'Create folder'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function urlDisplay(
	url: string,
	mode: Settings['urlDisplayMode'] = 'full',
	simplify = true,
) {
	// 'url-only' shows the address as the row's main line, so it has no second line.
	return mode === 'none' || mode === 'url-only'
		? null
		: mode === 'domain'
			? hostOf(url)
			: simplifiedUrl(url, simplify);
}

/**
Where a drag would land, drawn as a highlight (into a session) or a line (between sessions or links).
*/
type DropMark =
	| {kind: 'session'; groupId: string; position: InsertPosition}
	| {kind: 'into'; groupId: string}
	| {
			kind: 'tab';
			groupId: string;
			tabId: string;
			position: InsertPosition;
	  };
type DragItem =
	{kind: 'session'; id: string} | {kind: 'tab'; groupId: string; tabId: string};
/**
The drag in progress and where it would land. Cards subscribe to just the slice they draw, so a
drag moving over the list re-renders only the cards whose marker or dimming changed.
*/
class DragStore {
	private readonly listeners = new Set<() => void>();
	mark: DropMark | null = null;
	dragging: DragItem | null = null;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	set(next: {mark?: DropMark | null; dragging?: DragItem | null}) {
		const mark = next.mark === undefined ? this.mark : next.mark;
		const dragging =
			next.dragging === undefined ? this.dragging : next.dragging;
		if (mark === this.mark && dragging === this.dragging) {
			return;
		}

		this.mark = mark;
		this.dragging = dragging;
		for (const listener of this.listeners) {
			listener();
		}
	}
}

function useDragSlice<T>(store: DragStore, select: (store: DragStore) => T): T {
	return useSyncExternalStore(store.subscribe, () => select(store));
}

/**
Handlers the session manager shares with every card. The object never changes, so memoized cards
and rows are not re-rendered by it.
*/
type CardActions = {
	expand: (groupId: string, next: boolean) => void;
	restore: (group: Session, event?: ClickModifiers) => void;
	restoreTarget: (group: Session, target: RestoreTarget) => void;
	restoreMode: (group: Session, mode: RestoreMode) => void;
	forceRestore: (group: Session) => void;
	restoreTab: (
		group: Session,
		tab: SavedTabRecord,
		event?: ClickModifiers,
	) => void;
	updateGroup: (group: Session, fields: SessionFields) => void;
	share: (group: Session) => void;
	openTab: (tab: SavedTabRecord, requested?: 'current' | 'new') => void;
	copyTab: (tab: SavedTabRecord) => void;
	moveTab: (group: Session, tab: SavedTabRecord, toGroupId: string) => void;
	deleteGroup: (group: Session) => void;
	deleteTab: (group: Session, tab: SavedTabRecord) => void;
	editTab: (group: Session, tab: SavedTabRecord) => void;
	editGroup: (group: Session) => void;
	editName: (group: Session) => void;
	moveToFolder: (group: Session, folderId: string) => void;
	merge: (group: Session, targetId: string) => void;
	/**
	Opens the new-folder dialog; saving it creates the folder and moves the session in.
	*/
	newFolderFor: (group: Session) => void;
	/**
	Folders a session can move to (read when a menu opens, never while rendering).
	*/
	folderTargets: () => Folder[];
	bookmark: (tab: SavedTabRecord) => void;
	select: (key: string, checked: boolean, event: ClickModifiers) => void;
	/**
	Sessions a link can be moved to (read when a menu opens, never while rendering).
	*/
	moveTargets: (excludeId: string) => Array<{id: string; name: string}>;
	dragBegin: (item: DragItem) => void;
	dragEnd: () => void;
	dragOver: (group: Session, event: DragEvent<HTMLElement>) => void;
	dragLeave: (event: DragEvent<HTMLElement>) => void;
	dragDrop: (group: Session, event: DragEvent<HTMLElement>) => void;
};

/**
Where the current drag would land over `group`, or null when dropping there does nothing.
*/
function resolveDropMark(
	group: Session,
	event: DragEvent<HTMLElement>,
	item: DragItem | null,
): DropMark | null {
	if (!item) {
		return null;
	}

	if (item.kind === 'session') {
		if (item.id === group.id) {
			return null;
		}

		const rect = event.currentTarget.getBoundingClientRect();
		const before = event.clientY < rect.top + rect.height / 2;
		return {
			kind: 'session',
			groupId: group.id,
			position: before ? 'before' : 'after',
		};
	}

	const row = (event.target as Element).closest<HTMLElement>('[data-tab-id]');
	if (!row?.dataset.tabId) {
		return item.groupId === group.id && !(event.ctrlKey || event.metaKey)
			? null
			: {kind: 'into', groupId: group.id};
	}

	const rect = row.getBoundingClientRect();
	const position: InsertPosition =
		event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
	const run = tabRuns(group.tabs).find((entry) =>
		entry.some((tab) => tab.id === row.dataset.tabId),
	);
	// A split pair moves as a unit: dropping beside one half lands outside the pair.
	if (item.groupId === group.id && run?.some((tab) => tab.id === item.tabId)) {
		return null;
	}

	const tabId =
		run?.length === 2
			? (position === 'before' ? run[0] : run[1]).id
			: row.dataset.tabId;
	return {kind: 'tab', groupId: group.id, tabId, position};
}

type GroupCardProps = {
	group: Session;
	folderName?: string;
	settings: Partial<Settings>;
	/**
	The page is wide enough for the row of preview icons on a collapsed card.
	*/
	wide: boolean;
	isExpanded: boolean;
	/**
	Ids of this session's selected links.
	*/
	selectedTabs: Set<string>;
	selectionActive: boolean;
	bookmarksEnabled: boolean;
	actions: CardActions;
	dragStore: DragStore;
};
const GroupCard = memo(
	({
		group,
		folderName,
		settings,
		wide,
		isExpanded,
		selectedTabs,
		selectionActive,
		bookmarksEnabled,
		actions: handlers,
		dragStore,
	}: GroupCardProps) => {
		const displayMode = settings.urlDisplayMode;
		// Screen readers read these names; a session saved without a name still needs one.
		const name = group.name.trim() || 'Untitled session';
		const previewTabs = group.tabs.slice(0, 6);
		const mark = useDragSlice(dragStore, (store) =>
			store.mark?.kind !== 'tab' && store.mark?.groupId === group.id
				? store.mark
				: null,
		);
		const draggingSelf = useDragSlice(
			dragStore,
			(store) =>
				store.dragging?.kind === 'session' && store.dragging.id === group.id,
		);
		const onRestore = (event?: ClickModifiers) =>
			handlers.restore(group, event);
		const onExpanded = (next: boolean) => handlers.expand(group.id, next);
		const onDelete = () => handlers.deleteGroup(group);
		// One list for the Restore dropdown and the Restore options submenu, so they cannot drift apart.
		const restoreOptions: MenuAction[] = [
			{
				id: 'restore-here',
				label: 'In this window',
				icon: PanelTop,
				onSelect: () => handlers.restoreTarget(group, 'current-window'),
			},
			{
				id: 'restore-new-window',
				label: 'In a new window',
				icon: AppWindow,
				onSelect: () => handlers.restoreTarget(group, 'always-new-window'),
			},
			{type: 'separator'},
			{
				id: 'restore-keep',
				label: 'Keep session after restoring',
				icon: Save,
				onSelect: () => handlers.restoreMode(group, 'keep'),
			},
			{
				id: 'restore-remove',
				label: 'Remove session after restoring',
				icon: Trash2,
				onSelect: () => handlers.forceRestore(group),
			},
		];
		// Built only when the menu opens.
		const actions = (): MenuAction[] => [
			{
				id: 'restore',
				label: 'Restore',
				icon: RotateCcw,
				onSelect: () => onRestore(),
			},
			{
				type: 'submenu',
				id: 'restore-options',
				label: 'Restore options',
				icon: History,
				items: restoreOptions,
			},
			{type: 'separator'},
			{
				id: 'share',
				label: 'Share',
				icon: Share2,
				onSelect: () => handlers.share(group),
			},
			{type: 'separator'},
			{
				id: 'edit',
				label: 'Edit details',
				icon: ACTION_ICONS.edit,
				onSelect: () => handlers.editGroup(group),
			},
			{
				type: 'submenu',
				id: 'move-folder',
				label: 'Move to folder',
				icon: ACTION_ICONS.move,
				items: [
					...handlers.folderTargets().map((folder): MenuAction => ({
						id: `folder-${folder.id}`,
						label:
							folder.name.length > 40
								? `${folder.name.slice(0, 39)}…`
								: folder.name,
						icon: getIcon(folder.icon, DEFAULT_FOLDER_ICON).component,
						checked: folder.id === group.folderId,
						disabled: folder.id === group.folderId,
						onSelect: () => handlers.moveToFolder(group, folder.id),
					})),
					{type: 'separator'},
					{
						id: 'folder-new',
						label: 'Create folder',
						icon: FolderPlus,
						onSelect: () => handlers.newFolderFor(group),
					},
				],
			},
			{
				type: 'submenu',
				id: 'merge',
				label: 'Merge into',
				icon: Merge,
				hidden: handlers.moveTargets(group.id).length === 0,
				items: handlers.moveTargets(group.id).map((target) => ({
					id: `merge-${target.id}`,
					label:
						target.name.length > 40
							? `${target.name.slice(0, 39)}…`
							: target.name,
					onSelect: () => handlers.merge(group, target.id),
				})),
			},
			{type: 'separator'},
			{
				id: 'delete',
				label: 'Delete',
				icon: Trash2,
				destructive: true,
				onSelect: onDelete,
			},
		];
		return (
			<div className="relative">
				{mark?.kind === 'session' && (
					<DropIndicator
						orientation="horizontal"
						className={`inset-x-0 ${mark.position === 'before' ? '-top-[5px]' : '-bottom-[5px]'}`}
					/>
				)}
				<article
					id={`session-${group.id}`}
					className={`tn-card-lazy group/session overflow-hidden rounded-xl border bg-card transition-shadow ${isExpanded ? 'border-primary/30 shadow-sm' : 'border-border hover:border-primary/25'} ${mark?.kind === 'into' ? 'border-primary ring-2 ring-primary/40' : ''} ${draggingSelf ? 'opacity-50' : ''}`}
					aria-label={`Session ${name}`}
					onDragOver={(event) => handlers.dragOver(group, event)}
					onDragLeave={handlers.dragLeave}
					onDrop={(event) => handlers.dragDrop(group, event)}
				>
					<ActionContextMenu actions={actions}>
						<div className="flex items-center gap-2 px-2 py-2 sm:px-3">
							<IconTooltip
								label={`${isExpanded ? 'Hide' : 'Show'} tabs in ${name}`}
							>
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8 shrink-0"
									aria-expanded={isExpanded}
									aria-label={`${isExpanded ? 'Hide' : 'Show'} tabs in ${name}`}
									onClick={() => onExpanded(!isExpanded)}
								>
									<ChevronRight
										className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
									/>
								</Button>
							</IconTooltip>
							<button
								draggable
								type="button"
								className="min-w-0 flex-1 cursor-grab py-1 text-left active:cursor-grabbing"
								aria-expanded={
									settings.groupTitleAction === 'restore' ||
									settings.groupTitleAction === 'edit'
										? undefined
										: isExpanded
								}
								onDragStart={(event) => {
									applyLinkDrag(
										event.dataTransfer,
										group.tabs,
										group.name,
										group.id,
									);
									event.dataTransfer.effectAllowed = 'copyMove';
									setSessionDragImage(event.dataTransfer, group);
									handlers.dragBegin({kind: 'session', id: group.id});
								}}
								onDragEnd={handlers.dragEnd}
								onClick={(event) =>
									activateSessionTitle(
										settings.groupTitleAction,
										{
											edit: () => handlers.editName(group),
											restore: onRestore,
											toggle: () => onExpanded(!isExpanded),
										},
										event,
									)
								}
							>
								<span className="sr-only">
									{settings.groupTitleAction === 'restore'
										? 'Restore session'
										: settings.groupTitleAction === 'edit'
											? 'Edit details for session'
											: isExpanded
												? 'Collapse session'
												: 'Expand session'}
									:{' '}
								</span>
								<span className="flex min-w-0 items-center gap-2">
									<h3
										className="min-w-0 truncate text-sm font-semibold"
										title={group.name}
									>
										{name}
									</h3>
								</span>
								<span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
									<span>
										{group.tabs.length}{' '}
										{group.tabs.length === 1 ? 'tab' : 'tabs'}
									</span>
									<span aria-hidden="true">·</span>
									<span>{dateText(group.createdAt)}</span>
									{folderName && (
										<>
											<span aria-hidden="true">·</span>
											<span>{folderName}</span>
										</>
									)}
								</span>
							</button>
							{!isExpanded && wide && (
								<span
									className="hidden shrink-0 items-center -space-x-1.5 md:flex"
									aria-hidden="true"
								>
									{previewTabs.map((tab) => (
										<Favicon
											key={tab.id}
											url={tab.url}
											label={tab.title}
											className="h-6 w-6 rounded-full bg-card ring-2 ring-card"
										/>
									))}
									{group.tabs.length > previewTabs.length && (
										<span className="grid h-6 min-w-6 place-items-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground ring-2 ring-card">
											+{group.tabs.length - previewTabs.length}
										</span>
									)}
								</span>
							)}
							<div className="flex shrink-0 items-center gap-0.5">
								<span className="items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/session:opacity-100 flex">
									<IconTooltip label="Delete session">
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8 text-muted-foreground hover:text-destructive"
											aria-label={`Delete session ${name}`}
											onClick={onDelete}
										>
											<Trash2 />
										</Button>
									</IconTooltip>
								</span>
								<span className="flex items-center">
									<Button
										size="sm"
										variant={isExpanded ? 'default' : 'secondary'}
										className="rounded-r-none"
										onClick={(event) => onRestore(event)}
									>
										<RotateCcw />
										<span className="hidden sm:inline">Restore</span>
									</Button>
									<ActionDropdownMenu
										actions={restoreOptions}
										trigger={
											<Button
												size="sm"
												variant={isExpanded ? 'default' : 'secondary'}
												className="w-7 rounded-l-none border-l border-background/40 px-0"
												title="Restore options"
												aria-label={`Restore options for ${name}`}
											>
												<ChevronDown />
											</Button>
										}
									/>
								</span>
								<ActionDropdownMenu
									actions={actions}
									trigger={
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											title="More actions"
											aria-label={`More actions for ${name}`}
										>
											<MoreVertical />
										</Button>
									}
								/>
							</div>
						</div>
					</ActionContextMenu>
					{isExpanded && (
						<div className="border-t border-border">
							{group.description && (
								<div className="min-w-0 border-b border-border bg-muted/30 px-4 py-2.5 sm:pl-14">
									<p className="min-w-0 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
										{group.description}
									</p>
								</div>
							)}
							<ol className="m-0 list-none p-1 sm:p-1.5">
								{tabRuns(group.tabs).map((run) => {
									const row = (tab: SavedTabRecord, splitBadge = false) => (
										<SavedTab
											key={tab.id}
											tab={tab}
											group={group}
											settings={settings}
											splitBadge={splitBadge}
											selected={selectedTabs.has(tab.id)}
											selectionActive={selectionActive}
											showBookmark={bookmarksEnabled}
											displayMode={displayMode}
											actions={handlers}
											dragStore={dragStore}
										/>
									);
									if (run.length === 1) {
										return row(run[0]);
									}

									// A split view: both rows share a tinted background, joined by a bracket in the left gutter.
									return (
										<li
											key={`split-${run[0].id}`}
											className="relative my-0.5 rounded-lg bg-muted/40 ring-1 ring-inset ring-border/70"
										>
											<span
												aria-hidden="true"
												className="pointer-events-none absolute bottom-3.5 left-[3px] top-3.5 w-[3px] rounded-full bg-primary/35"
											/>
											<ol
												className="m-0 list-none p-0"
												aria-label={`Split view: ${run.map((tab) => tab.title?.trim() || hostOf(tab.url)).join(' and ')}`}
											>
												{row(run[0], true)}
												{row(run[1])}
											</ol>
										</li>
									);
								})}
							</ol>
						</div>
					)}
				</article>
			</div>
		);
	},
);

type SavedTabProps = {
	tab: SavedTabRecord;
	group: Session;
	settings: Partial<Settings>;
	selected: boolean;
	selectionActive: boolean;
	actions: CardActions;
	dragStore: DragStore;
	showBookmark: boolean;
	displayMode?: Settings['urlDisplayMode'];
	/**
	Shown on the first tab of a split view pair.
	*/
	splitBadge?: boolean;
};

const MAX_MOVE_TARGETS = 30;

const SavedTab = memo(
	({
		tab,
		group,
		settings,
		selected,
		selectionActive,
		actions: handlers,
		dragStore,
		showBookmark,
		displayMode,
		splitBadge = false,
	}: SavedTabProps) => {
		const dragging = useDragSlice(
			dragStore,
			(store) =>
				store.dragging?.kind === 'tab' &&
				store.dragging.groupId === group.id &&
				store.dragging.tabId === tab.id,
		);
		const dropLine = useDragSlice(dragStore, (store) =>
			store.mark?.kind === 'tab' &&
			store.mark.groupId === group.id &&
			store.mark.tabId === tab.id
				? store.mark.position
				: null,
		);
		const onSelect = (checked: boolean, event: ClickModifiers) =>
			handlers.select(tabKey(group.id, tab.id), checked, event);
		const onRestore = (event: ClickModifiers) =>
			handlers.restoreTab(group, tab, event);
		const onOpen = (requested?: 'current' | 'new') =>
			handlers.openTab(tab, requested);
		const onDelete = () => handlers.deleteTab(group, tab);
		const modifierRef = useRef<ClickModifiers>({});
		const label = tab.title?.trim() || hostOf(tab.url);
		const urlOnly = displayMode === 'url-only';
		const simplify = settings.simplifyUrls !== false;
		const rowText = urlOnly ? simplifiedUrl(tab.url, simplify) : label;
		const displayUrl = urlDisplay(tab.url, displayMode, simplify);
		const compact = displayUrl === null;
		const action = 'h-7 w-7 text-muted-foreground hover:text-foreground';
		// Built only when the menu opens.
		const actions = (): MenuAction[] => [
			{
				id: 'open-here',
				label: 'Open in this tab',
				icon: ACTION_ICONS.openHere,
				onSelect: () => onOpen('current'),
			},
			{
				id: 'open-new',
				label: 'Open in new tab',
				icon: ACTION_ICONS.openNew,
				onSelect: () => onOpen('new'),
			},
			{
				id: 'restore',
				label: 'Restore',
				icon: RotateCcw,
				onSelect: () => onRestore({}),
			},
			{type: 'separator'},
			{
				id: 'edit',
				label: 'Edit',
				icon: ACTION_ICONS.edit,
				onSelect: () => handlers.editTab(group, tab),
			},
			{
				id: 'copy',
				label: 'Copy link',
				icon: ACTION_ICONS.copy,
				onSelect: () => handlers.copyTab(tab),
			},
			{
				id: 'bookmark',
				label: 'Bookmark',
				icon: BookmarkPlus,
				hidden: !showBookmark,
				onSelect: () => handlers.bookmark(tab),
			},
			{
				id: 'move',
				label: 'Move to session',
				icon: ACTION_ICONS.move,
				type: 'submenu',
				items: handlers.moveTargets(group.id).map((target) => ({
					id: `move-${target.id}`,
					label:
						target.name.length > 40
							? `${target.name.slice(0, 39)}…`
							: target.name,
					onSelect: () => handlers.moveTab(group, tab, target.id),
				})),
			},
			{type: 'separator'},
			{
				id: 'remove',
				label: 'Remove',
				icon: ACTION_ICONS.remove,
				destructive: true,
				onSelect: onDelete,
			},
		];
		function handleRowClick(event: MouseEvent<HTMLLIElement>) {
			if (
				(event.target as Element).closest(
					'button, input, [role="checkbox"], [role="menu"], [role="menuitem"]',
				)
			) {
				return;
			}

			const modifier = event.ctrlKey || event.metaKey;
			if (modifier || event.shiftKey) {
				event.preventDefault();
				onSelect(modifier ? !selected : true, {
					shiftKey: event.shiftKey,
					ctrlKey: event.ctrlKey,
					metaKey: event.metaKey,
				});
				return;
			}

			if (selectionActive && !(event.target as Element).closest('a')) {
				onSelect(!selected, {});
			}
		}

		return (
			<ActionContextMenu actions={actions}>
				<li
					draggable
					data-tab-id={tab.id}
					className={`group/tab flex min-w-0 ${compact ? 'items-center' : 'items-start'} gap-2.5 relative rounded-lg px-2 ${compact ? 'py-1.5' : 'py-2'} transition-colors hover:bg-muted/60 ${selected ? 'bg-primary/[.07]' : ''} ${dragging ? 'opacity-40' : ''} `}
					onClick={handleRowClick}
					onDragStart={(event) => {
						event.stopPropagation();
						applyLinkDrag(event.dataTransfer, [tab]);
						event.dataTransfer.effectAllowed = 'copyMove';
						setLinkDragImage(event.dataTransfer, tab);
						handlers.dragBegin({
							kind: 'tab',
							groupId: group.id,
							tabId: tab.id,
						});
					}}
					onDragEnd={handlers.dragEnd}
				>
					{dropLine && (
						<DropIndicator
							className={`inset-x-0 ${dropLine === 'before' ? '-top-px' : '-bottom-px'}`}
						/>
					)}
					<span
						className={`${compact ? '' : 'mt-1.5'} flex w-4 shrink-0 justify-center transition-opacity ${selected || selectionActive ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover/tab:opacity-100'}`}
					>
						<Checkbox
							checked={selected}
							aria-label={`Select ${label} from ${group.name.trim() || 'Untitled session'}`}
							onPointerDown={(event) => {
								modifierRef.current = {
									shiftKey: event.shiftKey,
									ctrlKey: event.ctrlKey,
									metaKey: event.metaKey,
								};
							}}
							onKeyDown={(event) => {
								modifierRef.current = {
									shiftKey: event.shiftKey,
									ctrlKey: event.ctrlKey,
									metaKey: event.metaKey,
								};
							}}
							onCheckedChange={(checked) =>
								onSelect(Boolean(checked), modifierRef.current)
							}
						/>
					</span>
					<Favicon
						url={tab.url}
						label={label}
						className={`${compact ? 'h-5 w-5' : 'mt-0.5 h-6 w-6'} rounded-sm`}
					/>
					<div className="min-w-0 flex-1">
						<span className="flex min-w-0 items-center gap-1.5">
							<a
								className="truncate text-[13px] font-semibold hover:text-primary hover:underline"
								href={tab.url}
								target="_blank"
								rel="noopener noreferrer"
								title={urlOnly ? tab.url : label}
								aria-label={
									urlOnly && tab.title?.trim()
										? `${tab.title.trim()} (${tab.url})`
										: undefined
								}
								onClick={(event) => {
									if (event.ctrlKey || event.metaKey || event.shiftKey) {
										return;
									}

									event.preventDefault();
									if (
										resolveLinkTarget('session', settings as Settings) ===
										'none'
									) {
										onSelect(!selected, {});
										return;
									}

									onOpen();
								}}
							>
								{(urlOnly || compact) && (
									<InsecureMarkFor url={tab.url} settings={settings} />
								)}
								{rowText}
							</a>
							{splitBadge && (
								<Badge
									className="shrink-0 gap-1 px-1.5"
									title="Saved from a split view; restores side by side"
								>
									<Columns2 className="h-3 w-3" aria-hidden="true" />
									Split
								</Badge>
							)}
							{tab.pinned && <Badge>Pinned</Badge>}
							{tab.nativeGroup?.title && (
								<Badge
									className="min-w-0 max-w-[12rem]"
									title={tab.nativeGroup.title}
								>
									<span className="truncate">{tab.nativeGroup.title}</span>
								</Badge>
							)}
						</span>
						{displayUrl !== null && (
							<p
								className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground"
								title={tab.url}
							>
								<InsecureMarkFor url={tab.url} settings={settings} />
								{displayUrl}
							</p>
						)}
						{tab.notes && (
							<p className="mt-1 whitespace-pre-wrap break-words text-xs italic text-muted-foreground [overflow-wrap:anywhere]">
								{tab.notes}
							</p>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/tab:opacity-100">
						<IconTooltip label="Restore tab">
							<Button
								variant="ghost"
								size="icon"
								className={action}
								aria-label={`Restore ${label}`}
								onClick={(event) => onRestore(event)}
							>
								<RotateCcw />
							</Button>
						</IconTooltip>
						<IconTooltip label="Remove from session">
							<Button
								variant="ghost"
								size="icon"
								className="h-7 w-7 text-muted-foreground hover:text-destructive"
								aria-label={`Remove ${label} from saved session`}
								onClick={onDelete}
							>
								<X />
							</Button>
						</IconTooltip>
						<ActionDropdownMenu
							actions={actions}
							trigger={
								<Button
									variant="ghost"
									size="icon"
									className={action}
									title="More actions"
									aria-label={`More actions for ${label}`}
								>
									<MoreVertical />
								</Button>
							}
						/>
					</div>
				</li>
			</ActionContextMenu>
		);
	},
);
