import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type DragEvent,
	type MouseEvent,
	type SyntheticEvent,
} from 'react';
import {
	AppWindow,
	Archive,
	ArrowDown,
	ArrowDownUp,
	ArrowUp,
	ArrowUpRight,
	BookmarkPlus,
	ChevronDown,
	ChevronRight,
	Columns2,
	Copy,
	Download,
	Edit3,
	ExternalLink,
	FolderInput,
	FolderPlus,
	LayoutGrid,
	LayoutList,
	LockKeyhole,
	MoreHorizontal,
	MoreVertical,
	PanelTop,
	Pencil,
	RotateCcw,
	StickyNote,
	Search,
	Share2,
	Trash2,
	UnlockKeyhole,
	Upload,
	X,
} from 'lucide-react';
import {
	Badge,
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
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
import {
	EmptyState,
	LoadingLine,
	StatusLine,
	TabLodgeMark,
	send,
	splitNote,
	useStatus,
	useTabLodgeState,
} from './common';
import {BackupDialog, ImportDialog, useShareDialog} from './data-transfer';
import type {ExportData} from './export-formats';
import {
	activateSessionTitle,
	applyLinkDrag,
	formatSessionLinks,
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
	TabLodgeMessages,
} from './types';
import {setLinkDragImage, setSessionDragImage} from './drag-preview';
import {DEFAULT_FOLDER_ICON, getIcon} from './icon-registry';
import {IconPickerField} from './icon-picker';
import {openLink, resolveLinkTarget} from './link-target';

/**
Modifier keys that choose how a restore behaves (a mouse or keyboard event satisfies this).
*/
type RestoreModifiers = {
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
};
/**
Modifier keys captured for range/toggle tab selection.
*/
type SelectionModifiers = {
	shiftKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
};
type ReorderDirection = TabLodgeMessages['REORDER_GROUP']['direction'];
type Confirmation = {
	title: string;
	description: string;
	/**
	Muted, truncated line naming the item (kept out of the title).
	*/
	detail?: string;
	confirmLabel: string;
	run: () => Promise<void>;
	busy?: boolean;
};
type FolderDialog = {
	mode: 'create' | 'rename';
	folder?: Folder;
	/**
	The icon chosen so far in the open dialog.
	*/
	icon?: string;
};
type DialogState = 'bookmark' | 'details' | FolderDialog | null;
type BookmarkDraft = Partial<SavedTabRecord> & {columnId?: string};

const messageOf = (reason: unknown) =>
	(reason as {message?: string} | null | undefined)?.message;

const ALL = 'all';
const WIDE_PAGE = '(min-width: 768px)';
/**
Tailwind's md breakpoint, tracked so the grid layout knows whether it shows two columns.
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

// Gray, diagonal-striped treatment for archived sessions and tabs.
const ARCHIVED_STYLE = {
	backgroundImage:
		'repeating-linear-gradient(135deg, transparent 0 8px, rgb(var(--muted) / 0.7) 8px 16px)',
};
const hostFor = (url: string) => {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
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

const faviconUrl = (url: string) =>
	chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);

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
	const groupNameRef = useRef<HTMLInputElement>(null);
	const [bookmarkTab, setBookmarkTab] = useState<BookmarkDraft | null>(null);
	const [editingTab, setEditingTab] = useState<{
		group: Session;
		tab: SavedTabRecord;
	} | null>(null);
	// Written while a restore runs; the value itself is never read, the update just re-renders the page.
	// eslint-disable-next-line @eslint-react/use-state -- write-only on purpose
	const [, setBusy] = useState('');
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [backupData, setBackupData] = useState<ExportData | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const confirmFocusRef = useRef<HTMLElement | null>(null);
	const {openShare, shareDialog} = useShareDialog(showStatus);
	const dragItemRef = useRef<DragItem | null>(null);
	const [dragging, setDragging] = useState<DragItem | null>(null);
	const [dropMark, setDropMark] = useState<DropMark | null>(null);
	const groups = state?.groups || NO_SESSIONS;
	const folders = state?.folders || NO_FOLDERS;
	const settings: Partial<Settings> = state?.settings || {};
	const grid = settings.sessionLayout === 'grid';
	// The grid collapses to one column on narrow pages; drop positions follow what is on screen.
	const wide = useWidePage();
	const sideBySide = grid && wide;
	const folderDialog = typeof dialog === 'object' ? dialog : null;
	const sessionsEnabled = settings.sessionsEnabled !== false;
	const expandAll = settings.expandSessionsByDefault !== false;
	const isOpen = (id: string) =>
		expandAll ? !collapsed.has(id) : expanded.has(id);
	const bookmarksEnabled = settings.bookmarksEnabled !== false;

	const visibleGroups = useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		const archiveView = folderId === 'archived';
		const filtered = groups.filter(
			(group) =>
				(archiveView
					? Boolean(group.archived)
					: !group.archived &&
						(folderId === ALL || group.folderId === folderId)) &&
				(!needle ||
					[
						group.name,
						group.description,
						group.notes,
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

	useEffect(() => {
		if (!state) {
			return;
		}

		if (typeof state.settings?.sessionSort === 'string') {
			setSort(state.settings.sessionSort);
		}

		if (
			folderId !== ALL &&
			folderId !== 'archived' &&
			folders.every((folder) => folder.id !== folderId)
		) {
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
		requestAnimationFrame(() =>
			document
				.querySelector(`#session-${CSS.escape(focusId)}`)
				?.scrollIntoView({
					block: 'center',
					behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
						? 'auto'
						: 'smooth',
				}),
		);
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

				setFolderId(group.archived ? 'archived' : ALL);
				setQuery('');
				setGroupOpen(group.id, true);
				setTimeout(
					() =>
						document
							.querySelector(`#session-${CSS.escape(group.id)}`)
							?.scrollIntoView({block: 'center', behavior: 'smooth'}),
					60,
				);

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
		event: SelectionModifiers,
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
		event?: RestoreModifiers,
		requestedMode?: RestoreMode,
		requestedTarget?: RestoreTarget,
	) {
		const restoreMode =
			requestedMode ||
			(event?.altKey
				? 'archive'
				: event?.ctrlKey || event?.metaKey
					? 'keep'
					: undefined);
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
		event?: RestoreModifiers,
	) {
		const result = await send('RESTORE_TAB', {
			groupId: group.id,
			tabId: tab.id,
			restoreMode: event?.altKey
				? 'archive'
				: event?.ctrlKey || event?.metaKey
					? 'keep'
					: undefined,
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
		}

		await reload();
	}

	async function saveTabDetails(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!editingTab) {
			return;
		}

		const form = new FormData(event.currentTarget);
		const result = await send('UPDATE_TAB', {
			groupId: editingTab.group.id,
			tabId: editingTab.tab.id,
			fields: {
				title: String(form.get('title') || ''),
				notes: String(form.get('notes') || ''),
			},
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not save this tab.', true);
			return;
		}

		setEditingTab(null);
		await reload();
	}

	async function toggleTabArchived(group: Session, tab: SavedTabRecord) {
		const result = await send('UPDATE_TAB', {
			groupId: group.id,
			tabId: tab.id,
			fields: {archived: !tab.archived},
		});
		if (result?.ok) {
			await reload();
		} else {
			showStatus(result?.error || 'Could not update this tab.', true);
		}
	}

	async function updateGroup(group: Session, fields: SessionFields) {
		const result = await send('UPDATE_GROUP', {groupId: group.id, fields});
		if (result?.ok) {
			await reload();
		} else {
			showStatus(result?.error || 'Could not update this session.', true);
		}
	}

	async function copySession(group: Session) {
		const format = settings.copyFormat || 'markdown';
		try {
			await writeClipboard(formatSessionLinks(group, format));
		} catch {
			showStatus(
				'Could not copy session links. Check clipboard permissions and try again.',
				true,
			);
		}
	}

	function askConfirmation(details: Confirmation) {
		confirmFocusRef.current = document.activeElement as HTMLElement | null;
		setConfirmation(details);
	}

	async function runConfirmation() {
		if (!confirmation || confirmation.busy) {
			return;
		}

		const active = confirmation;
		setConfirmation({...active, busy: true});
		try {
			await active.run();
			setConfirmation(null);
		} catch (reason) {
			showStatus(
				messageOf(reason) || 'That action could not be completed.',
				true,
			);
			setConfirmation({...active, busy: false});
		}
	}

	/**
	Asks for confirmation, then deletes; `closeEditor` also closes the details dialog it was asked from.
	*/
	function deleteGroup(group: Session, closeEditor = false) {
		askConfirmation({
			title: 'Delete session?',
			description: `This removes the session and its ${group.tabs.length} saved ${group.tabs.length === 1 ? 'link' : 'links'}. Open tabs stay open.`,
			detail: group.name,
			confirmLabel: 'Delete session',
			async run() {
				const result = await send('DELETE_GROUP', {groupId: group.id});
				if (!result?.ok) {
					throw new Error(result?.error || 'Could not delete this session.');
				}

				if (closeEditor) {
					setDialog(null);
					setEditingGroup(null);
				}

				await reload();
			},
		});
	}

	function deleteSavedTab(group: Session, tab: SavedTabRecord) {
		askConfirmation({
			title: 'Remove link?',
			description: 'It is removed from this session. Open tabs stay open.',
			detail: tab.title || tab.url,
			confirmLabel: 'Remove link',
			async run() {
				const result = await send('DELETE_TAB', {
					groupId: group.id,
					tabId: tab.id,
				});
				if (!result?.ok) {
					throw new Error(result?.error || 'Could not remove this saved tab.');
				}

				await reload();
			},
		});
	}

	async function reorderGroup(group: Session, direction: ReorderDirection) {
		const result = await send('REORDER_GROUP', {
			groupId: group.id,
			direction,
			folderId,
		});
		if (result?.ok) {
			await reload();
		} else {
			showStatus(result?.error || 'Could not reorder this session.', true);
		}
	}

	async function openAllInNewTabs(tabs: SavedTabRecord[]) {
		if (tabs.length === 0) {
			return;
		}

		const run = async () => {
			for (const tab of tabs) {
				await chrome.tabs.create({url: tab.url, active: false});
			}
		};

		if (tabs.length > 10) {
			askConfirmation({
				title: `Open ${tabs.length} tabs?`,
				description: 'They open in the background, in saved order.',
				confirmLabel: `Open ${tabs.length} tabs`,
				async run() {
					await run();
				},
			});
			return;
		}

		await run();
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

	const drag: DragApi = {
		mark: dropMark,
		dragging,
		begin(item) {
			dragItemRef.current = item;
			// Styling the source row right away can cancel the browser's drag, so it waits a frame.
			requestAnimationFrame(() => {
				if (dragItemRef.current === item) {
					setDragging(item);
				}
			});
		},
		end() {
			dragItemRef.current = null;
			setDragging(null);
			setDropMark(null);
		},
		over(group, event) {
			const mark = resolveDropMark(
				group,
				event,
				dragItemRef.current,
				sideBySide,
			);
			if (!mark) {
				return;
			}

			event.preventDefault();
			event.dataTransfer.dropEffect =
				mark.kind !== 'session' && (event.ctrlKey || event.metaKey)
					? 'copy'
					: 'move';
			setDropMark((old) =>
				JSON.stringify(old) === JSON.stringify(mark) ? old : mark,
			);
		},
		leave(event) {
			if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
				setDropMark(null);
			}
		},
		drop(group, event) {
			const item = dragItemRef.current;
			const mark = resolveDropMark(group, event, item, sideBySide);
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

	async function changeSort(value: string) {
		setSort(value);
		const result = await send('UPDATE_SETTINGS', {
			settings: {sessionSort: value as SessionSort},
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not save the sort preference.', true);
		}
	}

	async function changeLayout(layout: 'list' | 'grid') {
		if ((settings.sessionLayout ?? 'list') === layout) {
			return;
		}

		const result = await send('UPDATE_SETTINGS', {
			settings: {sessionLayout: layout},
		});
		if (result?.ok) {
			await reload();
		} else {
			showStatus(result?.error || 'Could not save the layout.', true);
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
		const fields: SessionFields = {
			name: String(form.get('name') || ''),
			description: String(form.get('description') || ''),
			notes: String(form.get('notes') || ''),
			folderId: String(form.get('folderId') || 'unfiled'),
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
		setFocusGroupName(focusName);
		setDialog('details');
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

		if (folderDialog?.mode !== 'rename') {
			setFolderId(result.folder.id);
		}

		setDialog(null);
		await reload();
	}

	function deleteFolder() {
		const folder = folders.find((item) => item.id === folderId);
		if (!folder || folder.isDefault) {
			return;
		}

		askConfirmation({
			title: 'Delete folder?',
			description: 'Its sessions move to Unfiled. No links are lost.',
			detail: folder.name,
			confirmLabel: 'Delete folder',
			async run() {
				const result = await send('DELETE_FOLDER', {folderId});
				if (!result?.ok) {
					throw new Error(result?.error || 'Could not delete this folder.');
				}

				setFolderId(ALL);
				await reload();
			},
		});
	}

	async function openBookmarkPicker(tab: SavedTabRecord) {
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
							<h1
								data-focus-fallback
								id="sessions-title"
								tabIndex={-1}
								className="text-lg font-semibold tracking-tight"
							>
								{folderId === 'archived' ? 'Archived sessions' : 'Sessions'}
							</h1>
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
							<div
								role="group"
								aria-label="Session layout"
								className="mx-0.5 flex items-center rounded-md border border-border p-0.5"
							>
								{(
									[
										['list', 'List layout', LayoutList],
										['grid', 'Grid layout', LayoutGrid],
									] as const
								).map(([value, label, LayoutIcon]) => (
									<IconTooltip key={value} label={label}>
										<Button
											variant="ghost"
											size="icon"
											className={`h-7 w-7 min-h-7 ${(grid ? 'grid' : 'list') === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}
											aria-label={label}
											aria-pressed={(grid ? 'grid' : 'list') === value}
											onClick={() => void changeLayout(value)}
										>
											<LayoutIcon />
										</Button>
									</IconTooltip>
								))}
							</div>
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
										Import sessions…
									</DropdownMenuItem>
									<DropdownMenuItem onSelect={() => openBackup('sessions')}>
										<Download className="h-4 w-4" />
										Back up sessions…
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
								return (
									<button
										key={folder.id}
										type="button"
										aria-pressed={folderId === folder.id}
										className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${folderId === folder.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
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
										<span className="tabular-nums opacity-70">
											{folder.id === ALL
												? groups.filter((group) => !group.archived).length
												: groups.filter(
														(group) =>
															!group.archived && group.folderId === folder.id,
													).length}
										</span>
									</button>
								);
							},
						)}
						<button
							type="button"
							aria-pressed={folderId === 'archived'}
							className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${folderId === 'archived' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
							onClick={() => {
								setFolderId('archived');
								setAnchor(null);
							}}
						>
							<Archive className="h-3.5 w-3.5" />
							Archived
							<span className="tabular-nums opacity-70">
								{groups.filter((group) => group.archived).length}
							</span>
						</button>
						<span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
						<IconTooltip label="New folder">
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8"
								aria-label="New folder"
								onClick={() => setDialog({mode: 'create'})}
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
										onClick={deleteFolder}
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
									Export selected…
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
							icon={folderId === 'archived' ? Archive : Search}
							title={
								query.trim()
									? 'No matching sessions'
									: folderId === 'archived'
										? 'Archive is empty'
										: `Nothing in ${selectedFolder?.name || 'this folder'}`
							}
						>
							{query.trim()
								? 'Try another search term.'
								: folderId === 'archived'
									? 'Archived sessions will appear here.'
									: 'This folder is empty. Save a session or move one here from its details.'}
						</EmptyState>
					) : (
						<div
							className={
								grid
									? 'grid grid-cols-1 items-stretch gap-2 md:grid-cols-2'
									: 'space-y-2'
							}
							aria-live="polite"
						>
							{visibleGroups.map((group, index) => (
								<GroupCard
									key={group.id}
									group={group}
									folders={folders}
									settings={settings}
									grid={grid}
									sideBySide={sideBySide}
									isExpanded={isOpen(group.id)}
									selected={selected}
									selectionActive={selected.size > 0}
									displayMode={settings.urlDisplayMode}
									reorderEnabled={
										sort === 'custom' &&
										!query.trim() &&
										folderId !== 'archived'
									}
									index={index}
									count={visibleGroups.length}
									bookmarksEnabled={bookmarksEnabled}
									otherGroups={groups
										.filter((other) => other.id !== group.id)
										.map((other) => ({id: other.id, name: other.name}))}
									drag={drag}
									onShare={() =>
										openShare({title: group.name, groups: [group]})
									}
									onOpenAll={() => void openAllInNewTabs(group.tabs)}
									onOpenTab={(tab, requested) => void openTab(tab, requested)}
									onCopyTab={(tab) => void copyTabLink(tab)}
									onMoveTab={(tab, toGroupId) =>
										void moveTab(group.id, tab.id, toGroupId)
									}
									onExpanded={(next) => setGroupOpen(group.id, next)}
									onRestore={(event) => restoreGroup(group, false, event)}
									onRestoreTarget={(target) =>
										restoreGroup(group, false, undefined, undefined, target)
									}
									onRestoreMode={(mode) =>
										restoreGroup(group, false, undefined, mode)
									}
									onForceRestore={() => restoreGroup(group, true)}
									onRestoreTab={(tab, event) => restoreTab(group, tab, event)}
									onUpdateGroup={(fields) => updateGroup(group, fields)}
									onCopy={() => copySession(group)}
									onDelete={() => deleteGroup(group)}
									onDeleteTab={deleteSavedTab}
									onEditTab={(tab) => setEditingTab({group, tab})}
									onToggleTabArchived={(tab) => toggleTabArchived(group, tab)}
									onEdit={() => openGroupDetails(group)}
									onEditName={() => openGroupDetails(group, true)}
									onReorder={(direction) => reorderGroup(group, direction)}
									onBookmark={openBookmarkPicker}
									onSelect={(key, checked, event) =>
										changeSelection(key, checked, event)
									}
								/>
							))}
						</div>
					)}
				</section>
			)}

			<StatusLine status={status} />

			<ConfirmationDialog
				open={Boolean(confirmation)}
				title={confirmation?.title}
				description={confirmation?.description}
				confirmLabel={confirmation?.confirmLabel}
				busy={Boolean(confirmation?.busy)}
				restoreFocusTo={confirmFocusRef.current}
				onOpenChange={(open) => !open && setConfirmation(null)}
				onConfirm={runConfirmation}
			>
				{confirmation?.detail && (
					<p
						className="truncate text-xs text-muted-foreground"
						title={confirmation.detail}
					>
						{confirmation.detail}
					</p>
				)}
			</ConfirmationDialog>
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
				onOpenChange={(open) => !open && setEditingTab(null)}
			>
				<DialogContent>
					<form key={editingTab?.tab.id} onSubmit={saveTabDetails}>
						<DialogHeader>
							<DialogTitle>Edit link</DialogTitle>
							<DialogDescription className="break-all">
								{editingTab?.tab.url}
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
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
								Title and notes are shared with every saved copy of this page.
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
							<DialogDescription className="break-all">
								{bookmarkTab?.title || bookmarkTab?.url}
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<div className="space-y-1.5">
								<Label htmlFor="bookmark-column-select">Bookmark column</Label>
								<Select
									value={
										bookmarkTab?.columnId ||
										columns[0]?.id ||
										'bookmark-unfiled'
									}
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
												{column.name}
											</SelectItem>
										))}
										<SelectItem value="bookmark-unfiled">Unfiled</SelectItem>
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
								Update this session’s name, notes, and folder.
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
									maxLength={500}
									rows={2}
									placeholder="Add a project or task"
									defaultValue={editingGroup?.description || ''}
									className="min-h-0 resize-y"
									onKeyDown={(event) => {
										if (event.key !== 'Enter' || event.shiftKey) {
											return;
										}

										event.preventDefault();
										event.currentTarget.form?.requestSubmit();
									}}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="group-notes">Notes</Label>
								<Textarea
									id="group-notes"
									name="notes"
									maxLength={10_000}
									rows={4}
									placeholder="Add a note (optional)"
									defaultValue={editingGroup?.notes || ''}
								/>
							</div>
							<div className="min-w-0 space-y-1.5">
								<Label htmlFor="group-folder">Folder</Label>
								<Select
									name="folderId"
									defaultValue={editingGroup?.folderId || 'unfiled'}
								>
									<SelectTrigger id="group-folder">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{folders.map((folder) => (
											<SelectItem key={folder.id} value={folder.id}>
												{folder.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</DialogBody>
						<DialogFooter className="justify-between">
							{editingGroup && (
								<Button
									type="button"
									variant="destructive"
									disabled={editingGroup.locked}
									title={editingGroup.locked ? 'Unlock to delete' : undefined}
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
							<div className="flex items-end gap-3">
								<div className="min-w-0 flex-1 space-y-1.5">
									<Label htmlFor="folder-name">Folder name</Label>
									<Input
										required
										autoFocus
										id="folder-name"
										name="name"
										maxLength={60}
										defaultValue={folderDialog?.folder?.name || ''}
									/>
								</div>
								<IconPickerField
									id="folder-icon"
									value={folderDialog?.icon}
									defaultIcon={DEFAULT_FOLDER_ICON}
									onChange={(icon) =>
										setDialog((old) =>
											typeof old === 'object' && old ? {...old, icon} : old,
										)
									}
								/>
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
							<Button type="submit">
								{folderDialog?.mode === 'rename'
									? 'Save changes'
									: 'Create folder'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function restoreFailureText(failure?: {
	title?: string;
	url?: string;
	error?: string;
}) {
	return failure ? `${failure.title || failure.url}: ${failure.error}` : '';
}

function urlDisplay(url: string, mode: Settings['urlDisplayMode'] = 'full') {
	return mode === 'none' ? null : mode === 'domain' ? hostFor(url) : url;
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
Drag handlers and state the session manager shares with every card.
*/
type DragApi = {
	mark: DropMark | null;
	dragging: DragItem | null;
	begin: (item: DragItem) => void;
	end: () => void;
	over: (group: Session, event: DragEvent<HTMLElement>) => void;
	leave: (event: DragEvent<HTMLElement>) => void;
	drop: (group: Session, event: DragEvent<HTMLElement>) => void;
};

/**
Where the current drag would land over `group`, or null when dropping there does nothing.
*/
function resolveDropMark(
	group: Session,
	event: DragEvent<HTMLElement>,
	item: DragItem | null,
	sideBySide: boolean,
): DropMark | null {
	if (!item) {
		return null;
	}

	if (item.kind === 'session') {
		if (item.id === group.id) {
			return null;
		}

		const rect = event.currentTarget.getBoundingClientRect();
		// Cards sit side by side in the grid layout, so their order runs left to right.
		const before = sideBySide
			? event.clientX < rect.left + rect.width / 2
			: event.clientY < rect.top + rect.height / 2;
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

const LINE_BEFORE = 'shadow-[inset_0_2px_0_0_rgb(var(--primary))]';
const LINE_AFTER = 'shadow-[inset_0_-2px_0_0_rgb(var(--primary))]';

type GroupCardProps = {
	group: Session;
	folders: Folder[];
	otherGroups: Array<{id: string; name: string}>;
	settings: Partial<Settings>;
	/**
	Two-column grid layout: the card fills its cell and drops are marked left or right.
	*/
	grid: boolean;
	/**
	The grid currently shows two columns, so session drops are marked left or right.
	*/
	sideBySide: boolean;
	isExpanded: boolean;
	onExpanded: (next: boolean) => void;
	onRestore: (event?: RestoreModifiers) => void;
	onRestoreTarget: (target: RestoreTarget) => void;
	onRestoreMode: (mode: RestoreMode) => void;
	onForceRestore: () => void;
	onRestoreTab: (tab: SavedTabRecord, event?: RestoreModifiers) => void;
	onUpdateGroup: (fields: SessionFields) => void;
	onCopy: () => void;
	onShare: () => void;
	onOpenAll: () => void;
	onOpenTab: (tab: SavedTabRecord, requested?: 'current' | 'new') => void;
	onCopyTab: (tab: SavedTabRecord) => void;
	onMoveTab: (tab: SavedTabRecord, toGroupId: string) => void;
	onDelete: () => void;
	onDeleteTab: (group: Session, tab: SavedTabRecord) => void;
	onEditTab: (tab: SavedTabRecord) => void;
	onToggleTabArchived: (tab: SavedTabRecord) => void;
	onEdit: () => void;
	/**
	Session title click in "edit" mode: the details dialog with the name field focused.
	*/
	onEditName: () => void;
	onReorder: (direction: ReorderDirection) => void;
	selected: Set<string>;
	selectionActive: boolean;
	onSelect: (key: string, checked: boolean, event: SelectionModifiers) => void;
	displayMode?: Settings['urlDisplayMode'];
	reorderEnabled: boolean;
	index: number;
	count: number;
	bookmarksEnabled: boolean;
	onBookmark: (tab: SavedTabRecord) => void;
	drag: DragApi;
};
function GroupCard({
	group,
	folders,
	otherGroups,
	settings,
	grid,
	sideBySide,
	isExpanded,
	onExpanded,
	onRestore,
	onRestoreTarget,
	onRestoreMode,
	onForceRestore,
	onRestoreTab,
	onUpdateGroup,
	onCopy,
	onShare,
	onOpenAll,
	onOpenTab,
	onCopyTab,
	onMoveTab,
	onDelete,
	onDeleteTab,
	onEditTab,
	onToggleTabArchived,
	onEdit,
	onEditName,
	onReorder,
	selected,
	selectionActive,
	onSelect,
	displayMode,
	reorderEnabled,
	index,
	count,
	bookmarksEnabled,
	onBookmark,
	drag,
}: GroupCardProps) {
	const folderName = folders.find(
		(folder) => folder.id === group.folderId,
	)?.name;
	const previewTabs = group.tabs.slice(0, 6);
	const mark = drag.mark?.groupId === group.id ? drag.mark : null;
	const draggingSelf =
		drag.dragging?.kind === 'session' && drag.dragging.id === group.id;
	const draggingTabId =
		drag.dragging?.kind === 'tab' && drag.dragging.groupId === group.id
			? drag.dragging.tabId
			: null;
	const actions: MenuAction[] = [
		{
			id: 'restore',
			label: 'Restore',
			icon: RotateCcw,
			onSelect: () => onRestore(),
		},
		{
			id: 'restore-here',
			label: 'Restore in this window',
			icon: PanelTop,
			onSelect: () => onRestoreTarget('current-window'),
		},
		{
			id: 'restore-new-window',
			label: 'Restore in a new window',
			icon: AppWindow,
			onSelect: () => onRestoreTarget('always-new-window'),
		},
		{
			id: 'restore-keep',
			label: 'Restore & keep',
			icon: RotateCcw,
			onSelect: () => onRestoreMode('keep'),
		},
		{
			id: 'restore-remove',
			label: 'Restore & remove',
			icon: Trash2,
			disabled: group.locked,
			onSelect: onForceRestore,
		},
		{
			id: 'restore-archive',
			label: 'Restore & archive',
			icon: Archive,
			onSelect: () => onRestoreMode('archive'),
		},
		{
			id: 'open-all',
			label: 'Open all in new tabs',
			icon: ExternalLink,
			onSelect: onOpenAll,
		},
		{type: 'separator'},
		{id: 'copy', label: 'Copy links', icon: Copy, onSelect: onCopy},
		{id: 'share', label: 'Share', icon: Share2, onSelect: onShare},
		{type: 'separator'},
		{id: 'edit', label: 'Edit details', icon: Edit3, onSelect: onEdit},
		{
			id: 'lock',
			label: group.locked ? 'Unlock' : 'Lock',
			icon: group.locked ? UnlockKeyhole : LockKeyhole,
			onSelect: () => onUpdateGroup({locked: !group.locked}),
		},
		{
			id: 'archive',
			label: group.archived ? 'Unarchive' : 'Archive',
			icon: Archive,
			onSelect: () => onUpdateGroup({archived: !group.archived}),
		},
		{type: 'separator'},
		{
			id: 'up',
			label: 'Move up',
			icon: ArrowUp,
			disabled: !reorderEnabled || index === 0,
			onSelect: () => onReorder('up'),
		},
		{
			id: 'down',
			label: 'Move down',
			icon: ArrowDown,
			disabled: !reorderEnabled || index === count - 1,
			onSelect: () => onReorder('down'),
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
	const restoreActions = actions.filter(
		(action) =>
			action.type !== 'separator' &&
			['restore-here', 'restore-new-window'].includes(action.id),
	);
	return (
		<div className={grid ? 'relative flex min-w-0' : 'relative'}>
			{mark?.kind === 'session' && (
				<span
					aria-hidden="true"
					className={`pointer-events-none absolute z-10 rounded-full bg-primary ${
						sideBySide
							? `inset-y-0 w-0.5 ${mark.position === 'before' ? '-left-1.5' : '-right-1.5'}`
							: `inset-x-0 h-0.5 ${mark.position === 'before' ? '-top-1.5' : '-bottom-1.5'}`
					}`}
				/>
			)}
			<article
				id={`session-${group.id}`}
				className={`group/session overflow-hidden rounded-xl border ${grid ? 'w-full min-w-0' : ''} bg-card transition-shadow ${isExpanded ? 'border-primary/30 shadow-sm' : 'border-border hover:border-primary/25'} ${group.archived ? 'opacity-75 grayscale' : ''} ${mark?.kind === 'into' ? 'border-primary ring-2 ring-primary/40' : ''} ${draggingSelf ? 'opacity-50' : ''}`}
				style={group.archived ? ARCHIVED_STYLE : undefined}
				aria-label={`Session ${group.name}`}
				onDragOver={(event) => drag.over(group, event)}
				onDragLeave={drag.leave}
				onDrop={(event) => drag.drop(group, event)}
			>
				<ActionContextMenu actions={actions}>
					<div className="flex items-center gap-2 px-2 py-2 sm:px-3">
						<IconTooltip
							label={`${isExpanded ? 'Hide' : 'Show'} tabs in ${group.name}`}
						>
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8 shrink-0"
								aria-expanded={isExpanded}
								aria-label={`${isExpanded ? 'Hide' : 'Show'} tabs in ${group.name}`}
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
							aria-label={`${settings.groupTitleAction === 'restore' ? 'Restore' : 'Edit details for'} session ${group.name}`}
							onDragStart={(event) => {
								applyLinkDrag(
									event.dataTransfer,
									group.tabs,
									group.name,
									group.id,
								);
								event.dataTransfer.effectAllowed = 'copyMove';
								setSessionDragImage(event.dataTransfer, group);
								drag.begin({kind: 'session', id: group.id});
							}}
							onDragEnd={drag.end}
							onClick={(event) =>
								activateSessionTitle(
									settings.groupTitleAction,
									{edit: onEditName, restore: onRestore},
									event,
								)
							}
						>
							<span className="flex min-w-0 items-center gap-2">
								<h2
									className="min-w-0 truncate text-sm font-semibold"
									title={group.name}
								>
									{group.name}
								</h2>
								{group.locked && (
									<LockKeyhole
										className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
										aria-label="Locked"
									/>
								)}
								{group.archived && <Badge variant="accent">Archived</Badge>}
							</span>
							<span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
								<span>
									{group.tabs.length} {group.tabs.length === 1 ? 'tab' : 'tabs'}
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
						{!isExpanded && !grid && (
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
							<span
								className={`items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/session:opacity-100 ${grid ? 'hidden' : 'flex'}`}
							>
								<IconTooltip
									label={group.locked ? 'Unlock session' : 'Lock session'}
								>
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8 text-muted-foreground"
										aria-label={
											group.locked
												? `Unlock ${group.name}`
												: `Lock ${group.name}`
										}
										onClick={() => onUpdateGroup({locked: !group.locked})}
									>
										{group.locked ? <UnlockKeyhole /> : <LockKeyhole />}
									</Button>
								</IconTooltip>
								<IconTooltip
									label={
										group.archived ? 'Unarchive session' : 'Archive session'
									}
								>
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8 text-muted-foreground"
										aria-label={
											group.archived
												? `Unarchive ${group.name}`
												: `Archive ${group.name}`
										}
										onClick={() => onUpdateGroup({archived: !group.archived})}
									>
										<Archive />
									</Button>
								</IconTooltip>
								<IconTooltip label="Delete session">
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8 text-muted-foreground hover:text-destructive"
										aria-label={`Delete session ${group.name}`}
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
									onClick={onRestore}
								>
									<RotateCcw />
									<span className="hidden sm:inline">Restore</span>
								</Button>
								<ActionDropdownMenu
									actions={restoreActions}
									trigger={
										<Button
											size="sm"
											variant={isExpanded ? 'default' : 'secondary'}
											className="w-7 rounded-l-none border-l border-background/40 px-0"
											title="Restore options"
											aria-label={`Restore options for ${group.name}`}
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
										aria-label={`More actions for ${group.name}`}
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
						{(group.description || group.notes) && (
							<div className="min-w-0 border-b border-border bg-muted/30 px-4 py-2.5 sm:pl-14">
								{group.description && (
									<p className="min-w-0 whitespace-pre-wrap break-words text-sm font-medium [overflow-wrap:anywhere]">
										{group.description}
									</p>
								)}
								{group.notes && (
									<p className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
										{group.notes}
									</p>
								)}
							</div>
						)}
						<ol className="m-0 list-none p-1 sm:p-1.5">
							{tabRuns(group.tabs).map((run) => {
								const row = (tab: SavedTabRecord, splitBadge = false) => (
									<SavedTab
										key={tab.id}
										tab={tab}
										group={group}
										otherGroups={otherGroups}
										settings={settings}
										splitBadge={splitBadge}
										selected={selected.has(tabKey(group.id, tab.id))}
										selectionActive={selectionActive}
										showBookmark={bookmarksEnabled}
										displayMode={displayMode}
										dragging={draggingTabId === tab.id}
										dropLine={
											mark?.kind === 'tab' && mark.tabId === tab.id
												? mark.position
												: null
										}
										onSelect={(checked, event) =>
											onSelect(tabKey(group.id, tab.id), checked, event)
										}
										onDragBegin={() =>
											drag.begin({
												kind: 'tab',
												groupId: group.id,
												tabId: tab.id,
											})
										}
										onDragEnd={drag.end}
										onRestore={(event) => onRestoreTab(tab, event)}
										onOpen={(requested) => onOpenTab(tab, requested)}
										onCopyLink={() => onCopyTab(tab)}
										onMoveTo={(toGroupId) => onMoveTab(tab, toGroupId)}
										onBookmark={() => onBookmark(tab)}
										onDelete={() => onDeleteTab(group, tab)}
										onEditTab={() => onEditTab(tab)}
										onToggleArchived={() => onToggleTabArchived(tab)}
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
											aria-label={`Split view: ${run.map((tab) => tab.title?.trim() || hostFor(tab.url)).join(' and ')}`}
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
}

function Favicon({
	url,
	label,
	className = '',
}: {
	url: string;
	label?: string;
	className?: string;
}) {
	const [failedUrl, setFailedUrl] = useState('');
	// The icon sits on a transparent background; the letter tile only appears when the icon cannot load.
	return failedUrl === url ? (
		<span
			className={`grid shrink-0 place-items-center overflow-hidden bg-muted text-[10px] font-semibold text-muted-foreground ${className}`}
		>
			{(String(label || hostFor(url)).trim()[0] || '↗').toUpperCase()}
		</span>
	) : (
		<img
			className={`shrink-0 object-contain ${className}`}
			src={faviconUrl(url)}
			alt=""
			onError={() => setFailedUrl(url)}
		/>
	);
}

type SavedTabProps = {
	tab: SavedTabRecord;
	group: Session;
	otherGroups: Array<{id: string; name: string}>;
	settings: Partial<Settings>;
	selected: boolean;
	selectionActive: boolean;
	dragging: boolean;
	dropLine: InsertPosition | null;
	onSelect: (checked: boolean, event: SelectionModifiers) => void;
	onDragBegin: () => void;
	onDragEnd: () => void;
	onRestore: (event: RestoreModifiers) => void;
	onOpen: (requested?: 'current' | 'new') => void;
	onCopyLink: () => void;
	onMoveTo: (toGroupId: string) => void;
	onBookmark: () => void;
	onDelete: () => void;
	onEditTab: () => void;
	onToggleArchived: () => void;
	showBookmark: boolean;
	displayMode?: Settings['urlDisplayMode'];
	/**
	Shown on the first tab of a split view pair.
	*/
	splitBadge?: boolean;
};

const MAX_MOVE_TARGETS = 30;

function SavedTab({
	tab,
	group,
	otherGroups,
	settings,
	selected,
	selectionActive,
	dragging,
	dropLine,
	onSelect,
	onDragBegin,
	onDragEnd,
	onRestore,
	onOpen,
	onCopyLink,
	onMoveTo,
	onBookmark,
	onDelete,
	onEditTab,
	onToggleArchived,
	showBookmark,
	displayMode,
	splitBadge = false,
}: SavedTabProps) {
	const modifierRef = useRef<SelectionModifiers>({});
	const label = tab.title?.trim() || hostFor(tab.url);
	const displayUrl = urlDisplay(tab.url, displayMode);
	const compact = displayUrl === null;
	const action = 'h-7 w-7 text-muted-foreground hover:text-foreground';
	const actions: MenuAction[] = [
		{
			id: 'open-here',
			label: 'Open in this tab',
			icon: ArrowUpRight,
			onSelect: () => onOpen('current'),
		},
		{
			id: 'open-new',
			label: 'Open in new tab',
			icon: ExternalLink,
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
			label: 'Edit title & notes',
			icon: StickyNote,
			onSelect: onEditTab,
		},
		{id: 'copy', label: 'Copy link', icon: Copy, onSelect: onCopyLink},
		{
			id: 'bookmark',
			label: 'Bookmark',
			icon: BookmarkPlus,
			hidden: !showBookmark,
			onSelect: onBookmark,
		},
		{
			id: 'unarchive',
			label: 'Unarchive',
			icon: Archive,
			hidden: !tab.archived,
			onSelect: onToggleArchived,
		},
		{
			id: 'move',
			label: 'Move to session',
			icon: FolderInput,
			type: 'submenu',
			items: otherGroups.slice(0, MAX_MOVE_TARGETS).map((target) => ({
				id: `move-${target.id}`,
				label:
					target.name.length > 40
						? `${target.name.slice(0, 39)}…`
						: target.name,
				onSelect: () => onMoveTo(target.id),
			})),
		},
		{type: 'separator'},
		{
			id: 'remove',
			label: 'Remove',
			icon: X,
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
				style={tab.archived ? ARCHIVED_STYLE : undefined}
				className={`group/tab flex min-w-0 ${compact ? 'items-center' : 'items-start'} gap-2.5 rounded-lg px-2 ${compact ? 'py-1.5' : 'py-2'} transition-colors hover:bg-muted/60 ${selected ? 'bg-primary/[.07]' : ''} ${tab.archived ? 'opacity-60 grayscale' : ''} ${dragging ? 'opacity-40' : ''} ${dropLine === 'before' ? LINE_BEFORE : ''} ${dropLine === 'after' ? LINE_AFTER : ''}`}
				onClick={handleRowClick}
				onDragStart={(event) => {
					event.stopPropagation();
					applyLinkDrag(event.dataTransfer, [tab]);
					event.dataTransfer.effectAllowed = 'copyMove';
					setLinkDragImage(event.dataTransfer, tab);
					onDragBegin();
				}}
				onDragEnd={onDragEnd}
			>
				<span
					className={`${compact ? '' : 'mt-1.5'} flex w-4 shrink-0 justify-center transition-opacity ${selected || selectionActive ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover/tab:opacity-100'}`}
				>
					<Checkbox
						checked={selected}
						aria-label={`Select ${label} from ${group.name}`}
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
							title={label}
							onClick={(event) => {
								if (event.ctrlKey || event.metaKey || event.shiftKey) {
									return;
								}

								event.preventDefault();
								if (
									resolveLinkTarget('session', settings as Settings) === 'none'
								) {
									onSelect(!selected, {});
									return;
								}

								onOpen();
							}}
						>
							{label}
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
						{tab.archived && <Badge variant="outline">Archived</Badge>}
					</span>
					{displayUrl !== null && (
						<p
							className="mt-0.5 break-all text-[11px] leading-4 text-muted-foreground"
							title={tab.url}
						>
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
}
