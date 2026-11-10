import {
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type DragEvent,
	type SyntheticEvent,
	type PointerEvent as ReactPointerEvent,
} from 'react';
import {createRoot} from 'react-dom/client';
import {
	type LucideIcon,
	ArchiveRestore,
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	ExternalLink,
	ListPlus,
	BookmarkPlus,
	Save,
	Square,
	SquareCheck,
	SquarePlus,
	Download,
	FolderPlus,
	HelpCircle,
	Settings as SettingsIcon,
	SunMoon,
	HardDriveDownload,
	History,
	Inbox,
	LayoutGrid,
	MoreHorizontal,
	PanelLeft,
	Pencil,
	Plus,
	Search,
	Share2,
	Trash2,
	X,
	PanelsTopLeft,
	Upload,
} from 'lucide-react';
import {
	ActionContextMenu,
	ActionDropdownMenu,
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
	Input,
	Label,
	RadioCard,
	RadioCardGroup,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	ScrollArea,
	TooltipProvider,
	IconTooltip,
	ExpandingSearch,
	type MenuAction,
} from '../shared/ui';
import {DropIndicator as InsertionLine} from '../components/ui/drop-indicator';
import '../../styles/extension-app.css';
import {ThemeProvider, useTheme} from '../shared/theme';
import {LoadMore, usePagedLimit} from '../shared/load-more';
import {useStableCallbacks} from '../shared/use-stable';
import {ACTION_ICONS} from './action-icons';
import {focusAfterMove, neighborId, type MoveDirection} from './reorder';
import {
	AppHeader,
	EmptyState,
	StatusLine,
	saveWindowLabel,
	send,
	useStatus,
	plural,
	useTabLodgeState,
	useTabSelection,
	forceAddAction,
	duplicatesNote,
} from './common';
import {useSessionNameAsk} from './name-session-dialog';
import {SessionManager} from './dashboard';
import {
	FinderPalette,
	FinderTrigger,
	emitFinderEvent,
	type FinderAction,
} from './finder';
import {
	BackupDialog,
	ImportDialog,
	SnapshotsDialog,
	TrashDialog,
	useShareDialog,
} from './lazy-dialogs';
import {RecoveryBanner} from './recovery-banner';
import {
	emitRecoveryEvent,
	offerCloseTabsUndo,
	offerTrashUndo,
	offerUndo,
	useRecoveryEvents,
	type TrashFilter,
} from './recovery-core';
import {DEFAULT_COLUMN_ICON, getIcon} from './icon-registry';
import {archivedFolderId} from './session-folders';
import {ColumnLabel, IconLabel} from './icon-label';
import {IconNameField} from './icon-picker';
import {Favicon, LinkSummary} from './favicon';
import {displayUrl} from './url-display';
import {bookmarkGridTemplate} from './bookmark-layout';
import {siteName, webUrl} from './web-url';
import {stripTrackingParameters} from './tracking-parameters';
import {InsecureMarkFor} from './insecure-mark';
import {openLink, openOwnPage} from './link-target';
import type {ExportData} from './export-formats';
import {
	initialSearchQuery,
	newColumnRequested,
	stripSearchParams,
} from './page-params';
import {
	BOOKMARK_DRAG_TYPE,
	COLUMN_DRAG_TYPE,
	SESSION_DRAG_TYPE,
	dragPayloadKind,
	applyLinkDrag,
	parseDraggedLink,
	parseSessionDragData,
	shouldBlockDocumentDrop,
} from './interaction-actions';
import type {
	Bookmark,
	BookmarkBoardView,
	BookmarkColumn as BookmarkColumnData,
	InsertPosition,
	LinkEntry,
	Settings,
	BookmarkQuickAction,
} from './types';
import {ColumnSelect} from './column-select';
import {SaveTargetFields, type SaveTarget} from './save-target';
import {PrivateSetupGate} from './private-storage';
import {PrivateWindowAppearance} from './private-window-appearance';
import {
	BookmarkColumnPicker,
	NEW_BOOKMARK_COLUMN,
	resolveBookmarkColumn,
	type BookmarkColumnDraft,
} from './bookmark-column-picker';
import {takeStateRequest} from './state-preload';
import {cn} from '@/lib/utils';

const initialStateRequest = takeStateRequest();

type DialogKind =
	'bookmark' | 'column' | 'move' | 'paste-links' | 'delete-column';
type DragKind = NonNullable<ReturnType<typeof dragPayloadKind>>;
type BookmarkAction =
	| 'click'
	| 'open'
	| 'open-new'
	| 'edit'
	| 'move'
	| 'move-up'
	| 'move-down'
	| 'copy'
	| 'select'
	| 'select-range'
	| 'delete';
type OnBookmarkAction = (
	action: BookmarkAction,
	bookmark: Bookmark,
) => void | Promise<void>;
/**
`columnId` NEW_COLUMN creates a column named `newColumnName` and saves the bookmark into it.
*/
type BookmarkDraft = {
	id?: string | null;
	title: string;
	url: string;
	columnId: string;
	newColumnName?: string;
	newColumnIcon?: string;
};
type ColumnDraft = {
	id: string | null;
	name: string;
	icon?: string;
};
type MoveDraft = {bookmarkIds: string[]; targetColumnId: string};
type BookmarkSelectionMode = 'off' | 'hover' | 'on';
type PointerColumnDrag = {
	pointerId: number;
	columnId: string;
	startX: number;
	startY: number;
	dragging: boolean;
	targetColumnId: string | null;
	position: InsertPosition;
};
/**
Where a drag would land: a column edge (column drags) or a slot next to a bookmark card.
*/
type DropIndicator = {
	kind: DragKind;
	columnId: string;
	targetBookmarkId?: string | null;
	position: InsertPosition;
};
type ColumnRef = Pick<BookmarkColumnData, 'id' | 'name'>;
type FocusColumnItem = {
	id: string;
	name: string;
	icon?: string;
	count: number;
	column: BookmarkColumnData;
	unfiled?: boolean;
};

/**
Stable fallbacks so memoized values and effects do not see a new array on every render.
*/
const NO_COLUMNS: BookmarkColumnData[] = [];
const NO_BOOKMARKS: Bookmark[] = [];
const UNFILED_COLUMN: BookmarkColumnData = {
	id: 'bookmark-unfiled',
	name: 'Unfiled',
	createdAt: 0,
	isDefault: true,
};
const MoveBookmarkIcon = ACTION_ICONS.move;
/**
What each quick-action button on a bookmark row does.
*/
const QUICK_ACTIONS: Record<
	BookmarkQuickAction,
	{label: string; icon: LucideIcon; action: BookmarkAction}
> = {
	'open-current': {
		label: 'Open in this tab',
		icon: ACTION_ICONS.openHere,
		action: 'open',
	},
	'open-new': {
		label: 'Open in new tab',
		icon: ACTION_ICONS.openNew,
		action: 'open-new',
	},
	copy: {label: 'Copy link', icon: ACTION_ICONS.copy, action: 'copy'},
	edit: {label: 'Edit', icon: ACTION_ICONS.edit, action: 'edit'},
	delete: {label: 'Delete', icon: ACTION_ICONS.remove, action: 'delete'},
	move: {label: 'Move to', icon: ACTION_ICONS.move, action: 'move'},
	'move-up': {label: 'Move up', icon: ArrowUp, action: 'move-up'},
	'move-down': {label: 'Move down', icon: ArrowDown, action: 'move-down'},
};
/**
Column-picker value for "New column…" in the bookmark dialog.
*/
const NEW_COLUMN = '__new-column__';
type BraveNavigator = Navigator & {brave?: {isBrave: () => Promise<boolean>}};

function NewTab() {
	const {state, error, reload} = useTabLodgeState(initialStateRequest);
	const [status, showStatus] = useStatus();
	const [busy, setBusy] = useState('');
	// `?q=` (from the "Search … in TabLodge" selection menu) prefills both searches once, then leaves the URL.
	const [initialQuery] = useState(() => initialSearchQuery(location.search));
	const [bookmarkSearch, setBookmarkSearch] = useState(initialQuery);
	const [dialog, setDialog] = useState<DialogKind | null>(null);
	const [backupRequest, setBackupRequest] = useState<{
		data: ExportData;
		singleColumn: boolean;
	} | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const {openShare, shareDialog} = useShareDialog(showStatus);
	const pointerColumnDragRef = useRef<PointerColumnDrag | null>(null);
	const [columnDropIndicator, setColumnDropIndicator] =
		useState<DropIndicator | null>(null);
	// Dragover fires many times a second; an unchanged marker must not re-render the page.
	const markDrop = useCallback(
		(next: DropIndicator | null) =>
			setColumnDropIndicator((old) =>
				old === next ||
				(old &&
					next &&
					old.kind === next.kind &&
					old.columnId === next.columnId &&
					old.targetBookmarkId === next.targetBookmarkId &&
					old.position === next.position)
					? old
					: next,
			),
		[],
	);
	const [bookmarkEdit, setBookmarkEdit] = useState<BookmarkDraft | null>(null);
	// Several links pasted at once: each row can be left out before they are added to one column.
	const [pastedLinks, setPastedLinks] = useState<
		Array<LinkEntry & {include: boolean}>
	>([]);
	const [pastedColumn, setPastedColumn] = useState(UNFILED_COLUMN.id);
	// Where an added link goes in the Add bookmark and pasted links dialogs. The choice sticks for the page's lifetime.
	const [saveTarget, setSaveTarget] = useState<SaveTarget>('bookmark');
	const [saveSessionId, setSaveSessionId] = useState('');
	const [pastedNewColumn, setPastedNewColumn] = useState<BookmarkColumnDraft>({
		name: '',
	});
	// Deleting a column with bookmarks: move them to another column, or delete them too.
	const [columnDelete, setColumnDelete] = useState<{
		column: BookmarkColumnData;
		count: number;
		mode: 'move' | 'delete';
		targetColumnId: string;
	} | null>(null);
	const [columnEdit, setColumnEdit] = useState<ColumnDraft | null>(null);
	const [moveBookmark, setMoveBookmark] = useState<MoveDraft | null>(null);
	const [moveBookmarkColumnDraft, setMoveBookmarkColumnDraft] =
		useState<BookmarkColumnDraft>({name: ''});
	const [selectedBookmarks, setSelectedBookmarks] = useState<Set<string>>(
		() => new Set(),
	);
	const [selectionModifier, setSelectionModifier] = useState(false);
	const [bookmarkSelectionEnabled, setBookmarkSelectionEnabled] =
		useState(false);
	const bookmarkSelectionAnchorRef = useRef<string | null>(null);
	const draggedBookmarksRef = useRef<string[]>([]);
	const bookmarkBatchRunningRef = useRef(false);
	const [externalPromptHandled, setExternalPromptHandled] = useState(false);
	const [finderOpen, setFinderOpen] = useState(false);
	const [snapshotsOpen, setSnapshotsOpen] = useState(false);
	const [trashOpen, setTrashOpen] = useState(false);
	const [trashFilter, setTrashFilter] = useState<TrashFilter>('all');
	useRecoveryEvents((type, detail) => {
		if (type === 'snapshots') {
			setSnapshotsOpen(true);
		} else {
			setTrashFilter(detail.filter ?? 'all');
			setTrashOpen(true);
		}
	});
	const autoOpenedFinderRef = useRef(false);
	const {setTheme} = useTheme();
	const columns = state?.bookmarkColumns || NO_COLUMNS;
	const editedBookmark = bookmarkEdit?.id
		? state?.bookmarks.find((entry) => entry.id === bookmarkEdit.id)
		: undefined;
	const bookmarks = state?.bookmarks || NO_BOOKMARKS;
	const selectedBookmarkIds = bookmarks
		.filter((bookmark) => selectedBookmarks.has(bookmark.id))
		.map((bookmark) => bookmark.id);
	const bookmarkSelectionMode: BookmarkSelectionMode = bookmarkSelectionEnabled
		? 'on'
		: selectionModifier
			? 'hover'
			: 'off';
	const movingBookmark =
		moveBookmark?.bookmarkIds.length === 1
			? bookmarks.find(
					(bookmark) => bookmark.id === moveBookmark.bookmarkIds[0],
				)
			: undefined;

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			setSelectionModifier(event.altKey);
			if (
				!(event.type === 'keydown' && event.key === 'Escape') ||
				event.defaultPrevented ||
				document.querySelector('[role="dialog"], [role="menu"]')
			) {
				return;
			}

			setSelectedBookmarks(new Set());
			setBookmarkSelectionEnabled(false);
			bookmarkSelectionAnchorRef.current = null;
		};

		const reset = () => setSelectionModifier(false);
		globalThis.addEventListener('keydown', onKey);
		globalThis.addEventListener('keyup', onKey);
		window.addEventListener('blur', reset);
		return () => {
			globalThis.removeEventListener('keydown', onKey);
			globalThis.removeEventListener('keyup', onKey);
			window.removeEventListener('blur', reset);
		};
	}, []);

	function toggleBookmark(bookmark: Bookmark, range = false) {
		const order = [
			...document.querySelectorAll<HTMLElement>(
				'#bookmark-library [data-bookmark-id]',
			),
		].map((card) => card.dataset.bookmarkId || '');
		const first = order.indexOf(bookmarkSelectionAnchorRef.current || '');
		const last = order.indexOf(bookmark.id);
		const rangeIds =
			range && first !== -1 && last !== -1
				? order.slice(Math.min(first, last), Math.max(first, last) + 1)
				: [bookmark.id];
		setBookmarkSelectionEnabled(true);
		setSelectedBookmarks((old) => {
			const next = new Set(old);
			if (range) {
				for (const id of rangeIds) {
					next.add(id);
				}
			} else if (next.has(bookmark.id)) {
				next.delete(bookmark.id);
			} else {
				next.add(bookmark.id);
			}

			return next;
		});
		bookmarkSelectionAnchorRef.current = bookmark.id;
	}

	useEffect(() => {
		setSelectedBookmarks((old) => {
			const next = new Set(
				[...old].filter((id) =>
					bookmarks.some((bookmark) => bookmark.id === id),
				),
			);
			return next.size === old.size ? old : next;
		});
	}, [bookmarks]);
	const settings: Partial<Settings> = state?.settings || {};
	const {ask: askSessionName, dialog: nameDialog} = useSessionNameAsk(settings);
	const newTabOn = settings.newTabEnabled !== false;
	const tabSelection = useTabSelection(settings.includePinnedTabs === true);
	const bookmarkPageSize = settings.limitBookmarksPerColumn
		? (settings.bookmarkColumnPageSize ?? 16)
		: COLUMN_PAGE;
	// Columns in a grid row share the tallest one's height (grid's default stretch); off keeps their natural height.
	const stretchColumns = settings.stretchBookmarkColumns !== false;
	const bookmarkView = settings.bookmarkBoardView ?? 'board';
	const compactBoard = settings.bookmarkDensity === 'compact';
	const bookmarkGridTemplateColumns = bookmarkGridTemplate(
		settings.bookmarkColumnWidth ?? 'default',
		settings.bookmarkColumnsPerRow ?? 0,
		compactBoard ? 'compact' : 'comfortable',
	);
	const [focusColumnId, setFocusColumnId] = useState('');
	const [railDropId, setRailDropId] = useState<string | null>(null);
	// The Board view caps a column when the limit setting is on, so scrolling
	// inside the column loads the next batch instead of growing the page.
	// Estimated row height and body padding in rem, per density.
	const [rowRem, bodyPaddingRem] = compactBoard ? [2.1, 0.5] : [2.5, 1];
	const cappedColumnBodyHeight = settings.limitBookmarksPerColumn
		? `${Math.min(Math.max(bookmarkPageSize, 1), 16) * rowRem + bodyPaddingRem}rem`
		: undefined;
	const changeBookmarkView = useCallback(
		async (next: BookmarkBoardView) => {
			if (next === bookmarkView) {
				return;
			}

			const result = await send('UPDATE_SETTINGS', {
				settings: {bookmarkBoardView: next},
			});
			if (!result?.ok) {
				showStatus(result?.error || 'Could not save the bookmark view.', true);
				return;
			}

			await reload();
		},
		[bookmarkView, reload, showStatus],
	);
	const dashboardWidth = settings.dashboardWidth ?? 'default';
	const dashboardMaxWidthClass =
		dashboardWidth === 'narrower'
			? 'max-w-5xl'
			: dashboardWidth === 'wider'
				? 'max-w-[1920px]'
				: dashboardWidth === 'full'
					? 'max-w-none'
					: 'max-w-[1440px]';
	const bookmarkGridColumnsClass =
		dashboardWidth === 'full'
			? 'dashboard-columns-auto'
			: dashboardWidth === 'narrower'
				? 'grid-cols-1 sm:grid-cols-2'
				: dashboardWidth === 'wider'
					? 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
					: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3';
	const urlMode = settings.urlDisplayMode ?? 'full';
	const urlSettings = useMemo<UrlSettings>(
		() => ({
			simplifyUrls: settings.simplifyUrls !== false,
			markInsecureLinks: settings.markInsecureLinks !== false,
			markLocalLinks: settings.markLocalLinks === true,
			removeTrackingParameters: settings.removeTrackingParameters === true,
		}),
		[
			settings.simplifyUrls,
			settings.markInsecureLinks,
			settings.markLocalLinks,
			settings.removeTrackingParameters,
		],
	);
	const clickOpensMenu = settings.bookmarkClickAction === 'menu';
	const quickActions = settings.bookmarkQuickActions ?? ['open-new'];
	const autoOpenFinder =
		newTabOn && settings.autoFocusSearchOnNewTab === true && !initialQuery;
	const sessionsOnTop = settings.sessionsOnTop === true;
	const filteredBookmarks = useMemo(() => {
		const needle = bookmarkSearch.trim().toLocaleLowerCase();
		if (!needle) {
			return bookmarks;
		}

		return bookmarks.filter((bookmark) =>
			[bookmark.title, bookmark.url, siteName(bookmark.url)].some((value) =>
				String(value || '')
					.toLocaleLowerCase()
					.includes(needle),
			),
		);
	}, [bookmarks, bookmarkSearch]);
	// Bookmarks per column, computed once instead of filtering the whole list for every column. A column whose
	// bookmarks did not change keeps its array, so its memoized card list is not re-rendered.
	const previousGroupsRef = useRef({
		all: new Map<string, Bookmark[]>(),
		shown: new Map<string, Bookmark[]>(),
	});
	const columnBookmarks = useMemo(() => {
		const previous = previousGroupsRef.current;
		const group = (items: Bookmark[], before: Map<string, Bookmark[]>) => {
			const grouped = new Map<string, Bookmark[]>();
			for (const item of items) {
				const list = grouped.get(item.columnId);
				if (list) {
					list.push(item);
				} else {
					grouped.set(item.columnId, [item]);
				}
			}

			for (const [id, list] of grouped) {
				const old = before.get(id);
				if (
					old?.length === list.length &&
					old.every((item, index) => item === list[index])
				) {
					grouped.set(id, old);
				}
			}

			return grouped;
		};

		const all = group(bookmarks, previous.all);
		const shown =
			filteredBookmarks === bookmarks
				? all
				: group(filteredBookmarks, previous.shown);
		previousGroupsRef.current = {all, shown};
		return {all, shown};
	}, [bookmarks, filteredBookmarks]);

	// With "Use TabLodge for new tabs" off, a tab the browser opened as a new tab is sent on to the browser's page
	// (the service worker decides whether this tab was one); any other visit shows the dashboard as usual.
	const [handoff, setHandoff] = useState<'idle' | 'stay'>('idle');
	const holding = Boolean(state) && !newTabOn && handoff === 'idle';
	useEffect(() => {
		if (!holding) {
			return;
		}

		void (async () => {
			let brave = false;
			try {
				brave = Boolean(await (navigator as BraveNavigator).brave?.isBrave());
			} catch {}

			try {
				const result = await send('HANDOFF_NEW_TAB', {brave});
				if (!result?.ok || !result.handedOff) {
					setHandoff('stay');
				}
			} catch {
				// If the hand-off fails, show the page instead of leaving it blank.
				setHandoff('stay');
			}
		})();
	}, [holding]);

	// Drops the one-time `?q=` from the address bar after the first render.
	useEffect(() => {
		if (initialQuery) {
			history.replaceState(null, '', stripSearchParams(location, ['q']));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on purpose
	}, []);

	useEffect(() => {
		if (!state || externalPromptHandled) {
			return;
		}

		const params = new URLSearchParams(location.search);
		const url = webUrl(params.get('bookmarkUrl'));
		if (!url) {
			return;
		}

		setExternalPromptHandled(true);
		history.replaceState(
			null,
			'',
			stripSearchParams(location, [
				'bookmarkUrl',
				'bookmarkTitle',
				'bookmarkColumn',
			]),
		);
		// BookmarkColumn=new (the "New column…" menu item) preselects a new column; an existing column id selects that column.
		const requested = params.get('bookmarkColumn');
		const columnId = newColumnRequested(requested)
			? NEW_COLUMN
			: columns.find((column) => column.id === requested)?.id ||
				columns[0]?.id ||
				NEW_COLUMN;
		setBookmarkEdit({
			title: params.get('bookmarkTitle') || siteName(url),
			url,
			columnId,
			newColumnName: '',
		});
		setDialog('bookmark');
	}, [state, externalPromptHandled, columns]);

	// Bookmarks are only added by drops on a column or Unfiled. Elsewhere, link drags show the
	// "no drop" cursor and a stray drop is swallowed so the page does not navigate to the link.
	useEffect(() => {
		const guard = (event: globalThis.DragEvent) => {
			if (!shouldBlockDocumentDrop(event)) {
				return;
			}

			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'none';
			}
		};

		document.addEventListener('dragover', guard);
		document.addEventListener('drop', guard);
		return () => {
			document.removeEventListener('dragover', guard);
			document.removeEventListener('drop', guard);
		};
	}, []);

	// Pasting a link outside a text field opens Add bookmark prefilled with it. The title comes from the copied
	// link's text, then from an open tab showing that page, then the domain (no page is ever fetched).
	const pasteToBookmark = settings.pasteLinkToBookmark !== false;
	useEffect(() => {
		if (!pasteToBookmark) {
			return;
		}

		const onPaste = (event: ClipboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				event.defaultPrevented ||
				target?.closest(
					'input, textarea, select, [contenteditable="true"], [contenteditable=""]',
				) ||
				document.querySelector('[role="dialog"], [role="alertdialog"]')
			) {
				return;
			}

			const several = parsePastedLinks(event.clipboardData);
			if (several.length > 1) {
				event.preventDefault();
				void pastedLinkTitles(several).then((links) => {
					setPastedLinks(links.map((link) => ({...link, include: true})));
					setPastedColumn(columns[0]?.id || UNFILED_COLUMN.id);
					setPastedNewColumn({name: ''});
					setDialog('paste-links');
				});
				return;
			}

			const link = parseDraggedBookmark(event.clipboardData);
			if (!link) {
				return;
			}

			event.preventDefault();
			void pastedLinkTitle(link).then((title) => {
				setBookmarkEdit({
					id: null,
					title,
					url: link.url,
					columnId: columns[0]?.id || NEW_COLUMN,
				});
				setDialog('bookmark');
			});
		};

		document.addEventListener('paste', onPaste);
		return () => document.removeEventListener('paste', onPaste);
	}, [pasteToBookmark, columns]);

	async function addPastedLinks(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		const links = pastedLinks
			.filter((link) => link.include)
			.map(({url, title}) => ({url, title}));
		if (links.length === 0) {
			return;
		}

		setBusy('paste-links');
		try {
			if (toSession) {
				await addLinksToChosenSession(links);
				setDialog(null);
				return;
			}

			const columnId = await resolveBookmarkColumn(
				pastedColumn,
				pastedNewColumn,
			);
			setPastedColumn(columnId);
			const result = await addDroppedLinks(
				links,
				columnId,
				null,
				'after',
				true,
			);
			setDialog(null);
			const name =
				columns.find((column) => column.id === columnId)?.name ||
				pastedNewColumn.name ||
				UNFILED_COLUMN.name;
			offerUndo(
				`Added ${plural(result.count, 'bookmark')} to “${name}”.${skippedNote(result.skipped)}`,
				result.undoId,
				showStatus,
				reload,
			);
		} catch (reason) {
			showStatus((reason as Error).message, true);
		} finally {
			setBusy('');
		}
	}

	async function saveWindow() {
		const answer = await askSessionName({scope: 'selected-or-window'});
		if (!answer) {
			return;
		}

		setBusy('save-window');
		const result = await send('SAVE_TABS', {
			scope: 'selected-or-window',
			groupName: answer.name,
		});
		setBusy('');
		if (!result?.ok) {
			showStatus(result?.error || 'Could not save this window.', true);
			return;
		}

		await reload();
		if (result.rejectedTabIds.length > 0) {
			showStatus(
				`${result.count > 0 ? `Saved ${plural(result.count, 'tab')}.` : 'Nothing saved.'}${duplicatesNote(result.skipped)}`,
				false,
				{action: forceAddAction(result.rejectedTabIds, showStatus, reload)},
			);
			return;
		}

		// With "Close tabs after saving" the window just lost its tabs: Undo reopens them from the new session.
		if (
			settings.closeOnSave === false ||
			!result.groupId ||
			result.count === 0
		) {
			return;
		}

		const {groupId} = result;
		showStatus(`Saved ${plural(result.count, 'tab')} and closed them.`, false, {
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
							? `Reopened ${plural(reopened.count, 'tab')}.`
							: reopened?.error || 'Could not reopen the tabs.',
						!reopened?.ok,
						{toast: true},
					);
				},
			},
		});
	}

	function openBookmarkEditor(
		bookmark: Bookmark | null = null,
		preferredColumn = columns[0]?.id || NEW_COLUMN,
	) {
		// A bookmark left in the board's Unfiled area has no column to show, so it starts on the preferred one.
		const own = columns.some((column) => column.id === bookmark?.columnId)
			? bookmark?.columnId
			: undefined;
		setBookmarkEdit({
			id: bookmark?.id || null,
			title: bookmark?.title || '',
			url: bookmark?.url || '',
			columnId: own || preferredColumn,
		});
		setDialog('bookmark');
	}

	function openColumnEditor(column: BookmarkColumnData | null = null) {
		setColumnEdit({
			id: column?.id || null,
			name: column?.name || '',
			icon: column?.icon,
		});
		setDialog('column');
	}

	async function saveBookmark(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!bookmarkEdit || busy === 'bookmark-save') {
			return;
		}

		setBusy('bookmark-save');
		try {
			if (bookmarkToSession) {
				try {
					await addLinksToChosenSession([
						{title: bookmarkEdit.title, url: bookmarkEdit.url},
					]);
					setDialog(null);
					setBookmarkEdit(null);
				} catch (reason) {
					showStatus((reason as Error).message, true);
				}

				return;
			}

			let {columnId} = bookmarkEdit;
			// "New column…": create the column first, then save the bookmark into it.
			if (columnId === NEW_COLUMN) {
				const name = bookmarkEdit.newColumnName?.trim() || '';
				if (!name) {
					return;
				}

				const created = await send('CREATE_BOOKMARK_COLUMN', {
					name,
					icon: bookmarkEdit.newColumnIcon,
				});
				if (!created?.ok) {
					showStatus(created?.error || 'Could not create that column.', true);
					return;
				}

				columnId = created.column.id;
				setBookmarkEdit((old) => old && {...old, columnId});
			}

			const fields = {
				title: bookmarkEdit.title,
				url: bookmarkEdit.url,
				columnId,
			};
			const result = bookmarkEdit.id
				? await send('UPDATE_BOOKMARK', {bookmarkId: bookmarkEdit.id, fields})
				: await send('ADD_BOOKMARK', {bookmark: fields});
			if (!result?.ok) {
				await reload();
				showStatus(result?.error || 'Could not save that bookmark.', true);
				return;
			}

			setDialog(null);
			setBookmarkEdit(null);
			await reload();
		} finally {
			setBusy('');
		}
	}

	async function saveColumn(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!columnEdit?.name.trim()) {
			return;
		}

		const result = columnEdit.id
			? await send('UPDATE_BOOKMARK_COLUMN', {
					columnId: columnEdit.id,
					name: columnEdit.name,
					icon: columnEdit.icon ?? '',
				})
			: await send('CREATE_BOOKMARK_COLUMN', {
					name: columnEdit.name,
					icon: columnEdit.icon,
				});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not save that column.', true);
			return;
		}

		setDialog(null);
		setColumnEdit(null);
		await reload();
	}

	/**
	An empty column is deleted right away. One with bookmarks asks where they go: another column, or deleted with it
	(the only choice when it is the last column). Either way Undo restores the column and puts them back.
	*/
	function requestDeleteColumn(column: BookmarkColumnData) {
		const count = bookmarks.filter(
			(bookmark) => bookmark.columnId === column.id,
		).length;
		if (count === 0) {
			void deleteColumn(column, null);
			return;
		}

		const other = columns.find((item) => item.id !== column.id);
		const index = columns.findIndex((item) => item.id === column.id);
		const neighbour = columns[index + 1] ?? columns[index - 1] ?? other;
		setColumnDelete({
			column,
			count,
			mode: neighbour ? 'move' : 'delete',
			targetColumnId: neighbour?.id ?? '',
		});
		setDialog('delete-column');
	}

	/**
	`targetColumnId` receives the bookmarks; null deletes them with the column.
	*/
	async function deleteColumn(
		column: BookmarkColumnData,
		targetColumnId: string | null,
	) {
		const count = bookmarks.filter(
			(bookmark) => bookmark.columnId === column.id,
		).length;
		const result = await send('DELETE_BOOKMARK_COLUMN', {
			columnId: column.id,
			targetColumnId: targetColumnId ?? UNFILED_COLUMN.id,
			discardBookmarks: targetColumnId === null && count > 0,
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not delete that column.', true);
			return;
		}

		await reload();
		const target = columns.find((item) => item.id === targetColumnId);
		offerTrashUndo(
			count === 0
				? `Column “${column.name}” deleted.`
				: target
					? `Column “${column.name}” deleted. ${plural(count, 'bookmark')} moved to “${target.name}”.`
					: `Column “${column.name}” and ${plural(count, 'bookmark')} deleted.`,
			result.trashId,
			showStatus,
			reload,
		);
	}

	async function confirmDeleteColumn(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!columnDelete) {
			return;
		}

		setDialog(null);
		await deleteColumn(
			columnDelete.column,
			columnDelete.mode === 'move' ? columnDelete.targetColumnId : null,
		);
	}

	function beginColumnPointerDrag(
		event: ReactPointerEvent<HTMLElement>,
		columnId: string,
	) {
		if (
			event.pointerType === 'mouse' ||
			!event.isPrimary ||
			event.button !== 0
		) {
			return;
		}

		pointerColumnDragRef.current = {
			pointerId: event.pointerId,
			columnId,
			startX: event.clientX,
			startY: event.clientY,
			dragging: false,
			targetColumnId: null,
			position: 'before',
		};
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			/*
			Pointer capture is optional.
			*/
		}
	}

	useEffect(() => {
		const onMove = (event: PointerEvent) => {
			const drag = pointerColumnDragRef.current;
			if (
				!drag ||
				drag.pointerId !== event.pointerId ||
				(!drag.dragging &&
					Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <
						8)
			) {
				return;
			}

			drag.dragging = true;
			event.preventDefault();
			const target = document
				.elementFromPoint(event.clientX, event.clientY)
				?.closest<HTMLElement>('[data-column-id]');
			const targetColumnId = target?.dataset.columnId || null;
			const rect = target?.getBoundingClientRect();
			drag.targetColumnId = targetColumnId;
			drag.position =
				rect && event.clientX >= rect.left + rect.width / 2
					? 'after'
					: 'before';
			markDrop(
				targetColumnId
					? {kind: 'column', columnId: targetColumnId, position: drag.position}
					: null,
			);
		};

		const finish = async (event: PointerEvent) => {
			const drag = pointerColumnDragRef.current;
			if (!drag || drag.pointerId !== event.pointerId) {
				return;
			}

			pointerColumnDragRef.current = null;
			markDrop(null);
			if (
				!drag.dragging ||
				!drag.targetColumnId ||
				drag.columnId === drag.targetColumnId
			) {
				return;
			}

			const result = await send('REORDER_BOOKMARK_COLUMN', {
				columnId: drag.columnId,
				targetColumnId: drag.targetColumnId,
				position: drag.position,
			});
			if (result?.ok) {
				await reload();
			} else {
				showStatus(result?.error || 'Could not reorder columns.', true);
			}
		};

		const cancel = (event: PointerEvent) => {
			if (pointerColumnDragRef.current?.pointerId !== event.pointerId) {
				return;
			}

			pointerColumnDragRef.current = null;
			markDrop(null);
		};

		document.addEventListener('pointermove', onMove, {passive: false});
		document.addEventListener('pointerup', finish);
		document.addEventListener('pointercancel', cancel);
		return () => {
			document.removeEventListener('pointermove', onMove);
			document.removeEventListener('pointerup', finish);
			document.removeEventListener('pointercancel', cancel);
		};
		// ShowStatus is recreated every render; the handlers only need the latest reload.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `reload` on purpose
	}, [reload]);
	async function moveBookmarks(
		bookmarkIds: string[],
		targetColumnId: string,
		targetBookmarkId: string | null = null,
		position: InsertPosition = 'after',
	) {
		if (
			bookmarkBatchRunningRef.current ||
			bookmarkIds.includes(targetBookmarkId || '')
		) {
			return false;
		}

		bookmarkBatchRunningRef.current = true;
		setBusy('bookmark-batch');
		try {
			const ordered =
				targetBookmarkId && position === 'after'
					? bookmarkIds.toReversed()
					: bookmarkIds;
			for (const bookmarkId of ordered) {
				const result = await send('REORDER_BOOKMARK', {
					bookmarkId,
					targetColumnId,
					targetBookmarkId,
					position,
				});
				if (!result?.ok) {
					showStatus(
						result?.error ||
							'Could not move all bookmarks. Some may have moved.',
						true,
					);
					return false;
				}
			}

			showStatus(`Moved ${plural(bookmarkIds.length, 'bookmark')}.`);
			return true;
		} finally {
			await reload();
			bookmarkBatchRunningRef.current = false;
			setBusy('');
		}
	}

	async function moveBookmarkToColumn(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!moveBookmark) {
			return;
		}

		try {
			const targetColumnId = await resolveBookmarkColumn(
				moveBookmark.targetColumnId,
				moveBookmarkColumnDraft,
			);
			if (!(await moveBookmarks(moveBookmark.bookmarkIds, targetColumnId))) {
				return;
			}

			setDialog(null);
			setMoveBookmark(null);
			setMoveBookmarkColumnDraft({name: ''});
		} catch (reason) {
			showStatus((reason as Error).message, true);
		}
	}

	function openSelectedBookmarkMove() {
		setMoveBookmarkColumnDraft({name: ''});
		setMoveBookmark({
			bookmarkIds: selectedBookmarkIds,
			targetColumnId: columns[0]?.id || NEW_BOOKMARK_COLUMN,
		});
		setDialog('move');
	}

	/**
	Deletes right away; `closeEditor` also closes the edit dialog it was asked from. Undo restores it from the trash.
	*/
	async function deleteBookmark(bookmark: Bookmark, closeEditor = false) {
		const result = await send('DELETE_BOOKMARK', {bookmarkId: bookmark.id});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not delete that bookmark.', true);
			return;
		}

		if (closeEditor) {
			setDialog(null);
			setBookmarkEdit(null);
		}

		await reload();
		offerTrashUndo('Bookmark deleted.', result.trashId, showStatus, reload);
	}

	async function deleteSelectedBookmarks() {
		if (bookmarkBatchRunningRef.current) {
			return;
		}

		bookmarkBatchRunningRef.current = true;
		setBusy('bookmark-batch');
		const trashIds: string[] = [];
		let deleted = 0;
		try {
			for (const bookmarkId of selectedBookmarkIds) {
				const result = await send('DELETE_BOOKMARK', {bookmarkId});
				if (!result?.ok) {
					showStatus(
						result?.error ||
							'Could not delete all bookmarks. Deleted bookmarks are in the trash bin.',
						true,
					);
					return;
				}

				deleted += 1;
				if (result.trashId) {
					trashIds.push(result.trashId);
				}
			}

			showStatus(
				`${plural(deleted, 'bookmark')} deleted.`,
				false,
				trashIds.length > 0
					? {
							action: {
								label: 'Undo',
								async onClick() {
									for (const id of trashIds.toReversed()) {
										const result = await send('RESTORE_TRASH', {id});
										if (!result?.ok) {
											await reload();
											showStatus(
												result?.error || 'Could not restore all bookmarks.',
												true,
											);
											return;
										}
									}

									await reload();
									showStatus(
										`${plural(trashIds.length, 'bookmark')} restored.`,
										false,
										{toast: true},
									);
								},
							},
						}
					: {toast: true},
			);
		} finally {
			await reload();
			bookmarkBatchRunningRef.current = false;
			setBusy('');
		}
	}

	// Keyboard alternative to dragging: one step earlier or later within the bookmark's column.
	async function moveBookmarkStep(
		bookmark: Bookmark,
		direction: MoveDirection,
	) {
		const siblings = bookmarks.filter(
			(entry) => entry.columnId === bookmark.columnId,
		);
		const target = neighborId(
			siblings.map((entry) => entry.id),
			bookmark.id,
			direction,
		);
		if (!target) {
			return;
		}

		const result = await send('REORDER_BOOKMARK', {
			bookmarkId: bookmark.id,
			targetColumnId: bookmark.columnId,
			targetBookmarkId: target,
			position: direction === 'earlier' ? 'before' : 'after',
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not reorder bookmarks.', true);
			return;
		}

		await reload();
		const position = siblings.findIndex((entry) => entry.id === target) + 1;
		showStatus(
			`Moved “${bookmark.title || siteName(bookmark.url)}” to position ${position} of ${siblings.length}.`,
		);
		focusAfterMove(
			`[data-bookmark-id="${CSS.escape(bookmark.id)}"] [data-move-focus]`,
		);
	}

	// Keyboard alternative to dragging a column header: one step left or right.
	async function moveColumnStep(
		column: BookmarkColumnData,
		direction: MoveDirection,
	) {
		const target = neighborId(
			columns.map((entry) => entry.id),
			column.id,
			direction,
		);
		if (!target) {
			return;
		}

		const result = await send('REORDER_BOOKMARK_COLUMN', {
			columnId: column.id,
			targetColumnId: target,
			position: direction === 'earlier' ? 'before' : 'after',
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not reorder columns.', true);
			return;
		}

		await reload();
		const position = columns.findIndex((entry) => entry.id === target) + 1;
		showStatus(
			`Moved column “${column.name}” to position ${position} of ${columns.length}.`,
		);
		focusAfterMove(
			`section[data-column-id="${CSS.escape(column.id)}"] header [data-move-focus]`,
		);
	}

	// Keyboard alternative to dropping a bookmark on a saved session.
	async function addBookmarkToSession(
		bookmark: Bookmark,
		target: {id: string; name: string},
	) {
		const result = await send('ADD_LINKS_TO_SESSION', {
			groupId: target.id,
			links: [{url: bookmark.url, title: bookmark.title}],
		});
		if (!result?.ok) {
			showStatus(
				result?.error || 'Could not add the link to that session.',
				true,
			);
			return;
		}

		await reload();
		const note = result.skipped ? ' It was already there.' : '';
		offerUndo(
			`Added “${bookmark.title || siteName(bookmark.url)}” to “${target.name}”.${note}`,
			result.undoId,
			showStatus,
			reload,
		);
	}

	function sessionTargets() {
		const archivedId = archivedFolderId(state?.folders ?? []);
		return (state?.groups ?? [])
			.filter((group) => group.folderId !== archivedId)
			.slice(0, MAX_SESSION_TARGETS)
			.map((group) => ({
				id: group.id,
				name: group.name.trim() || 'Untitled session',
			}));
	}

	// The session picker's options, and the destination actually in effect: a session only while one exists to choose.
	const pasteSessions = sessionTargets();
	const pasteSessionId = pasteSessions.some(
		(session) => session.id === saveSessionId,
	)
		? saveSessionId
		: (pasteSessions[0]?.id ?? '');
	const toSession = pasteSessions.length > 0 && saveTarget === 'session';
	const bookmarkToSession = toSession && !bookmarkEdit?.id;

	async function addLinksToChosenSession(links: LinkEntry[]) {
		const name =
			pasteSessions.find((session) => session.id === pasteSessionId)?.name ??
			'';
		const result = await send('ADD_LINKS_TO_SESSION', {
			groupId: pasteSessionId,
			links,
		});
		if (!result?.ok) {
			throw new Error(result?.error || 'Could not add those links.');
		}

		await reload();
		offerUndo(
			`Added ${plural(result.added, 'link')} to “${name}”.${skippedNote(result.skipped)}`,
			result.undoId,
			showStatus,
			reload,
		);
	}

	async function addSelectedBookmarksToSession(target: {
		id: string;
		name: string;
	}) {
		const selected = bookmarks
			.filter((bookmark) => selectedBookmarks.has(bookmark.id))
			.map(({title, url}) => ({title, url}));
		const result = await send('ADD_LINKS_TO_SESSION', {
			groupId: target.id,
			links: selected,
		});
		if (!result?.ok) {
			showStatus(
				result?.error || 'Could not add bookmarks to that session.',
				true,
			);
			return;
		}

		await reload();
		const skipped = result.skipped
			? ` ${plural(result.skipped, 'duplicate')} skipped.`
			: '';
		offerUndo(
			`Added ${plural(result.added, 'link')} to “${target.name}”.${skipped}`,
			result.undoId,
			showStatus,
			reload,
		);
	}

	async function bookmarkAction(action: BookmarkAction, bookmark: Bookmark) {
		if (action === 'select' || action === 'select-range') {
			toggleBookmark(bookmark, action === 'select-range');
			return;
		}

		if (['click', 'open', 'open-new'].includes(action)) {
			try {
				await openLink(
					bookmark.url,
					'bookmark',
					state!.settings,
					action === 'open'
						? 'current'
						: action === 'open-new'
							? 'new'
							: undefined,
				);
			} catch {
				showStatus('That link could not be opened.', true);
			}

			return;
		}

		if (action === 'edit') {
			openBookmarkEditor(bookmark);
			return;
		}

		if (action === 'move') {
			setMoveBookmarkColumnDraft({name: ''});
			setMoveBookmark({
				bookmarkIds: [bookmark.id],
				targetColumnId:
					bookmark.columnId === UNFILED_COLUMN.id
						? columns[0]?.id || NEW_BOOKMARK_COLUMN
						: bookmark.columnId,
			});
			setDialog('move');
			return;
		}

		if (action === 'move-up' || action === 'move-down') {
			await moveBookmarkStep(
				bookmark,
				action === 'move-up' ? 'earlier' : 'later',
			);
			return;
		}

		if (action === 'copy') {
			try {
				await navigator.clipboard.writeText(
					settings.removeTrackingParameters === true
						? stripTrackingParameters(bookmark.url)
						: bookmark.url,
				);
				showStatus('Link copied.', false, {toast: true});
			} catch {
				showStatus(
					'The URL could not be copied. Check clipboard permissions and try again.',
					true,
				);
			}

			return;
		}

		if (action !== 'delete') {
			return;
		}

		await deleteBookmark(bookmark);
	}

	async function addDroppedLinks(
		links: LinkEntry[],
		columnId: string,
		targetBookmarkId: string | null,
		position: InsertPosition,
		undoable = false,
	) {
		const result = await send('ADD_BOOKMARKS', {
			bookmarks: links,
			columnId,
			targetBookmarkId,
			position,
			undoable,
		});
		if (!result?.ok) {
			throw new Error(result?.error || 'Could not save the dropped links.');
		}

		await reload();
		return result;
	}

	// Drag data must be read synchronously, before the first await.
	async function dropOnColumn(
		event: DragEvent<HTMLElement>,
		column: ColumnRef,
	) {
		const data = event.dataTransfer;
		const kind = dragPayloadKind(data.types);
		markDrop(null);
		if (kind === 'column') {
			const columnId = data.getData(COLUMN_DRAG_TYPE);
			if (
				!columnId ||
				columnId === column.id ||
				column.id === UNFILED_COLUMN.id
			) {
				return;
			}

			const rect = event.currentTarget.getBoundingClientRect();
			const position: InsertPosition =
				event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
			const result = await send('REORDER_BOOKMARK_COLUMN', {
				columnId,
				targetColumnId: column.id,
				position,
			});
			if (result?.ok) {
				await reload();
			} else {
				showStatus(result?.error || 'Could not reorder columns.', true);
			}

			return;
		}

		const targetCard = (event.target as Element).closest<HTMLElement>(
			'[data-bookmark-id]',
		);
		const targetBookmarkId = targetCard?.dataset.bookmarkId || null;
		const rect = targetCard?.getBoundingClientRect();
		const position: InsertPosition =
			targetCard && rect && event.clientY < rect.top + rect.height / 2
				? 'before'
				: 'after';
		if (kind === 'bookmark') {
			const bookmarkId = data.getData(BOOKMARK_DRAG_TYPE);
			if (!bookmarkId) {
				return;
			}

			const ids = draggedBookmarksRef.current.includes(bookmarkId)
				? draggedBookmarksRef.current
				: [bookmarkId];
			await moveBookmarks(ids, column.id, targetBookmarkId, position);

			return;
		}

		if (kind === 'session') {
			const session = parseSessionDragData(data.getData(SESSION_DRAG_TYPE));
			if (!session) {
				showStatus(
					'This session has no web links that can be bookmarked.',
					true,
				);
				return;
			}

			try {
				const result = await addDroppedLinks(
					session.links,
					column.id,
					targetBookmarkId,
					position,
					true,
				);
				offerUndo(
					`Added ${plural(result.count, 'link')} to “${column.name}”.${skippedNote(result.skipped)}`,
					result.undoId,
					showStatus,
					reload,
				);
			} catch (reason) {
				showStatus((reason as Error).message, true);
			}

			return;
		}

		if (kind !== 'link') {
			return;
		}

		const parsed = parseDraggedBookmark(data);
		if (!parsed) {
			showStatus('Only regular http and https links can be bookmarked.', true);
			return;
		}

		try {
			await addDroppedLinks([parsed], column.id, targetBookmarkId, position);
		} catch (reason) {
			showStatus((reason as Error).message, true);
		}
	}

	async function openAllInColumn(column: BookmarkColumnData) {
		const bookmarksInColumn = bookmarks.filter(
			(bookmark) => bookmark.columnId === column.id,
		);
		if (bookmarksInColumn.length === 0) {
			showStatus('This column has no bookmarks to open.', true);
			return;
		}

		await openBookmarks(bookmarksInColumn);
	}

	async function openBookmarks(bookmarkEntries: Bookmark[]) {
		const opened: number[] = [];
		try {
			for (const bookmark of bookmarkEntries) {
				const destination =
					settings.removeTrackingParameters === true
						? stripTrackingParameters(bookmark.url)
						: bookmark.url;
				const created = await chrome.tabs.create({
					url: destination,
					active: false,
				});
				if (created.id !== undefined) {
					opened.push(created.id);
				}
			}
		} catch {
			showStatus('Some bookmarks could not be opened.', true);
			return;
		}

		// A handful of tabs is routine; a bigger batch gets an Undo that closes them again.
		if (bookmarkEntries.length > 10) {
			offerCloseTabsUndo(
				`Opened ${bookmarkEntries.length} tabs.`,
				opened,
				showStatus,
			);
		}
	}

	async function openSelectedBookmarks() {
		await openBookmarks(
			bookmarks.filter((bookmark) => selectedBookmarks.has(bookmark.id)),
		);
	}

	function openSelectedBookmarkExport() {
		const selected = bookmarks.filter((bookmark) =>
			selectedBookmarks.has(bookmark.id),
		);
		const columnIds = new Set(selected.map((bookmark) => bookmark.columnId));
		setBackupRequest({
			data: {
				kind: 'bookmarks',
				columns: [
					...columns.filter((column) => columnIds.has(column.id)),
					...(columnIds.has(UNFILED_COLUMN.id) ? [UNFILED_COLUMN] : []),
				],
				bookmarks: selected,
			},
			singleColumn: false,
		});
	}

	function shareSelectedBookmarks() {
		const selected = bookmarks.filter((bookmark) =>
			selectedBookmarks.has(bookmark.id),
		);
		const groups = [
			...columns.map((column) => ({
				name: column.name,
				tabs: selected.filter((bookmark) => bookmark.columnId === column.id),
			})),
			{
				name: UNFILED_COLUMN.name,
				tabs: selected.filter(
					(bookmark) => bookmark.columnId === UNFILED_COLUMN.id,
				),
			},
		].filter((group) => group.tabs.length > 0);
		openShare({title: 'Selected bookmarks', groups});
	}

	function openBookmarkBackup() {
		if (bookmarks.length === 0 && columns.length === 0) {
			showStatus('There are no bookmarks to back up.', true);
			return;
		}

		setBackupRequest({
			data: {kind: 'bookmarks', columns, bookmarks},
			singleColumn: false,
		});
	}

	function openColumnExport(column: BookmarkColumnData) {
		setBackupRequest({
			data: {
				kind: 'bookmarks',
				columns: [column],
				bookmarks: bookmarks.filter(
					(bookmark) => bookmark.columnId === column.id,
				),
			},
			singleColumn: true,
		});
	}

	function shareBookmarks(column?: BookmarkColumnData) {
		const groupFor = (entry: BookmarkColumnData | ColumnRef) => ({
			name: entry.name,
			tabs: bookmarks.filter((bookmark) => bookmark.columnId === entry.id),
		});
		const everything = [
			...columns.map((entry) => groupFor(entry)),
			groupFor(UNFILED_COLUMN),
		].filter((group) => group.tabs.length > 0);
		openShare({
			title: column ? column.name : 'Shared bookmarks',
			sources: [
				...(column
					? [
							{
								id: 'column',
								label: column.name,
								description: plural(groupFor(column).tabs.length, 'bookmark'),
								groups: [groupFor(column)],
							},
						]
					: []),
				{
					id: 'all',
					label: 'All bookmarks',
					description: plural(bookmarks.length, 'bookmark'),
					groups: everything,
				},
			],
		});
	}

	// The latest handlers, so the finder's command list can stay stable between renders.
	const commandHandlersRef = useRef({} as Record<string, () => void>);
	commandHandlersRef.current = {
		saveWindow: () => void saveWindow(),
		newBookmark: () => openBookmarkEditor(),
		newColumn: () => openColumnEditor(),
		backupBookmarks: openBookmarkBackup,
		importData: () => setImportOpen(true),
		toggleTheme() {
			const dark = document.documentElement.style.colorScheme === 'dark';
			void setTheme(dark ? 'light' : 'dark');
		},
		openSettings: () => void openOwnPage('options.html', settings),
		openHelp: () => void openOwnPage('help.html', settings),
	};
	const finderActions = useMemo<FinderAction[]>(() => {
		const h = () => commandHandlersRef.current;
		return [
			{
				id: 'save-window',
				title: saveWindowLabel(tabSelection),
				keywords: ['session', 'tabs', 'store'],
				icon: Save,
				run: () => h().saveWindow(),
			},
			{
				id: 'new-bookmark',
				title: 'New bookmark',
				keywords: ['add', 'link'],
				icon: BookmarkPlus,
				run: () => h().newBookmark(),
			},
			{
				id: 'new-column',
				title: 'New column',
				keywords: ['bookmark', 'add'],
				icon: SquarePlus,
				run: () => h().newColumn(),
			},
			{
				id: 'backup-bookmarks',
				title: 'Back up bookmarks',
				keywords: ['export', 'download', 'save'],
				icon: Download,
				run: () => h().backupBookmarks(),
			},
			{
				id: 'import-bookmarks',
				title: 'Import bookmarks',
				keywords: ['restore', 'load', 'upload'],
				icon: Upload,
				run: () => h().importData(),
			},
			{
				id: 'new-folder',
				title: 'New session folder',
				keywords: ['add', 'sessions'],
				icon: FolderPlus,
				run: () => emitFinderEvent({type: 'new-folder'}),
			},
			{
				id: 'backup-sessions',
				title: 'Back up sessions',
				keywords: ['export', 'download', 'save'],
				icon: HardDriveDownload,
				run: () => emitFinderEvent({type: 'backup-sessions'}),
			},
			{
				id: 'import-sessions',
				title: 'Import sessions',
				keywords: ['restore', 'load', 'upload'],
				icon: ArchiveRestore,
				run: () => emitFinderEvent({type: 'import-sessions'}),
			},
			{
				id: 'recent-snapshots',
				title: 'Recent snapshots',
				keywords: ['crash', 'recover', 'restore session', 'history', 'windows'],
				icon: History,
				run: () => emitRecoveryEvent({type: 'snapshots'}),
			},
			{
				id: 'open-trash',
				title: 'Trash bin',
				keywords: ['deleted', 'undo', 'restore', 'bin', 'recover'],
				icon: Trash2,
				run: () => emitRecoveryEvent({type: 'trash'}),
			},
			{
				id: 'toggle-theme',
				title: 'Toggle light/dark theme',
				keywords: ['appearance', 'dark mode', 'light mode'],
				icon: SunMoon,
				run: () => h().toggleTheme(),
			},
			{
				id: 'open-settings',
				title: 'Open Settings',
				keywords: ['options', 'preferences'],
				icon: SettingsIcon,
				run: () => h().openSettings(),
			},
			{
				id: 'open-help',
				title: 'Open Help',
				keywords: ['shortcuts', 'about', 'guide'],
				icon: HelpCircle,
				run: () => h().openHelp(),
			},
		];
	}, [tabSelection]);

	// Ctrl/Cmd+K, or "/" outside text fields, opens the finder .
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const typing =
				target?.closest('input, textarea, select, [contenteditable="true"]') !==
				null;
			const shortcut =
				(event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) ||
				(event.key === '/' &&
					!typing &&
					!event.ctrlKey &&
					!event.metaKey &&
					!event.altKey);
			if (!shortcut || event.defaultPrevented) {
				return;
			}

			const otherDialog = document.querySelector(
				'[role="dialog"]:not([data-finder]), [role="alertdialog"]',
			);
			if (otherDialog && !document.querySelector('[data-finder]')) {
				return;
			}

			event.preventDefault();
			setFinderOpen((open) => !open);
		};

		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, []);

	// "Focus search when opening a new tab": opens the palette once per page load (not for ?q= links, which prefill
	// the page search instead). A tab loaded in the background gets its input focused once it becomes visible.
	useEffect(() => {
		if (!autoOpenFinder || autoOpenedFinderRef.current) {
			return;
		}

		autoOpenedFinderRef.current = true;
		setFinderOpen(true);
		if (document.visibilityState === 'visible') {
			return;
		}

		const onVisible = () => {
			if (document.visibilityState !== 'visible') {
				return;
			}

			document.removeEventListener('visibilitychange', onVisible);
			document
				.querySelector<HTMLInputElement>('[data-finder] [data-autofocus]')
				?.focus({preventScroll: true});
		};

		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	}, [autoOpenFinder]);

	const unfiledAll = columnBookmarks.all.get(UNFILED_COLUMN.id) ?? NO_BOOKMARKS;
	const unfiledFiltered =
		columnBookmarks.shown.get(UNFILED_COLUMN.id) ?? NO_BOOKMARKS;
	const includeUnfiled = unfiledAll.length > 0 || columns.length === 0;
	const columnFields = (
		<>
			<div className="space-y-1.5">
				<Label htmlFor="bookmark-column">Column</Label>
				<ColumnSelect
					columns={columns}
					value={bookmarkEdit?.columnId || columns[0]?.id || NEW_COLUMN}
					id="bookmark-column"
					onValueChange={(value) =>
						setBookmarkEdit((old) => old && {...old, columnId: value})
					}
				>
					<SelectItem value={NEW_COLUMN}>
						<IconLabel icon={Plus}>New column</IconLabel>
					</SelectItem>
				</ColumnSelect>
			</div>
			{bookmarkEdit?.columnId === NEW_COLUMN && (
				<IconNameField
					id="bookmark-new-column"
					label="New column name"
					nameLabel="New column name"
					icon={bookmarkEdit.newColumnIcon}
					defaultIcon={DEFAULT_COLUMN_ICON}
					inputProps={{
						required: true,
						maxLength: 60,
						placeholder: 'Reading list',
						...({'data-autofocus': ''} as object),
						value: bookmarkEdit.newColumnName || '',
						onChange: (e) =>
							setBookmarkEdit(
								(old) => old && {...old, newColumnName: e.target.value},
							),
					}}
					onIconChange={(icon) =>
						setBookmarkEdit((old) => old && {...old, newColumnIcon: icon})
					}
				/>
			)}
		</>
	);
	const sessionTargetsForBookmarks = sessionTargets();

	// One stable set of callbacks for every column and bookmark, so memoized ones skip re-rendering.
	const boardActions = useStableCallbacks<BoardActions>({
		bookmark: bookmarkAction,
		share: (column) => shareBookmarks(column),
		exportColumn: openColumnExport,
		add: (column) => openBookmarkEditor(null, column.id),
		openAll: openAllInColumn,
		edit: openColumnEditor,
		moveColumn: moveColumnStep,
		addToSession: addBookmarkToSession,
		sessionTargets,
		remove: requestDeleteColumn,
		pointerDown: beginColumnPointerDrag,
		dropOver: markDrop,
		drop: (event, column) => dropOnColumn(event, column),
		dragStart(event) {
			const card = (event.target as Element).closest<HTMLElement>(
				'[data-bookmark-id]',
			);
			const id = card?.dataset.bookmarkId;
			draggedBookmarksRef.current = id
				? selectedBookmarks.has(id)
					? selectedBookmarkIds
					: [id]
				: [];
			const draggedLinks = bookmarks
				.filter((bookmark) => draggedBookmarksRef.current.includes(bookmark.id))
				.map(({title, url}) => ({title, url}));
			handleInternalDragStart(
				event,
				draggedBookmarksRef.current.length,
				draggedLinks,
			);
		},
		dragEnd() {
			draggedBookmarksRef.current = [];
			handleInternalDragEnd();
			markDrop(null);
		},
	});

	// Keep the extension handoff blank, but show a stable shell while the initial state read is in flight.
	if (holding) {
		return <main className="min-h-screen" />;
	}

	if (!state) {
		if (!error) {
			return null;
		}

		return (
			<main className="mx-auto min-h-screen max-w-6xl px-5 py-6 sm:px-8 sm:py-9">
				<AppHeader active="dashboard" />
				<p role="alert" className="text-sm font-medium text-destructive">
					{error}{' '}
					<a href="newtab.html" className="underline">
						Reload
					</a>
				</p>
			</main>
		);
	}

	const focusItems: FocusColumnItem[] = [
		...columns.map((column) => ({
			id: column.id,
			name: column.name,
			icon: column.icon,
			count: columnBookmarks.all.get(column.id)?.length ?? 0,
			column,
			unfiled: false,
		})),
		...(includeUnfiled
			? [
					{
						id: UNFILED_COLUMN.id,
						name: UNFILED_COLUMN.name,
						count: unfiledAll.length,
						column: UNFILED_COLUMN,
						unfiled: true,
					},
				]
			: []),
	];
	const activeFocus =
		focusItems.find((item) => item.id === focusColumnId) ?? focusItems[0];
	const activeFocusIndex = activeFocus
		? columns.findIndex((column) => column.id === activeFocus.id)
		: -1;

	const bookmarksSection = (
		<section
			id="bookmark-library"
			className="scroll-mt-6"
			aria-labelledby="bookmark-title"
		>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<h2
						id="bookmark-title"
						tabIndex={-1}
						className="text-lg font-semibold tracking-tight"
					>
						Bookmarks
					</h2>
					<Badge variant="accent">{bookmarks.length}</Badge>
				</div>
				<div className="flex flex-wrap items-center gap-1">
					<ExpandingSearch
						label="Search bookmarks"
						value={bookmarkSearch}
						status={
							bookmarkSearch.trim()
								? filteredBookmarks.length === 0
									? 'No bookmarks match'
									: `${plural(filteredBookmarks.length, 'bookmark')} found`
								: ''
						}
						onChange={setBookmarkSearch}
					/>
					<IconTooltip
						label={
							bookmarkView === 'board'
								? 'Switch to Focus view'
								: 'Switch to Board view'
						}
					>
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8"
							aria-label={
								bookmarkView === 'board'
									? 'Switch to Focus view'
									: 'Switch to Board view'
							}
							onClick={() =>
								void changeBookmarkView(
									bookmarkView === 'board' ? 'focus' : 'board',
								)
							}
						>
							{bookmarkView === 'board' ? <PanelLeft /> : <LayoutGrid />}
						</Button>
					</IconTooltip>
					<IconTooltip
						label={
							bookmarkSelectionEnabled
								? 'Exit bookmark selection'
								: 'Select bookmarks'
						}
					>
						<Button
							variant={bookmarkSelectionEnabled ? 'secondary' : 'ghost'}
							size="icon"
							className="h-8 w-8"
							aria-label="Select bookmarks"
							aria-pressed={bookmarkSelectionEnabled}
							onClick={() => {
								setBookmarkSelectionEnabled(!bookmarkSelectionEnabled);
								if (!bookmarkSelectionEnabled) {
									return;
								}

								setSelectedBookmarks(new Set());
								bookmarkSelectionAnchorRef.current = null;
							}}
						>
							<SquareCheck />
						</Button>
					</IconTooltip>
					<IconTooltip label="Add bookmark">
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8"
							aria-label="Add bookmark"
							onClick={() => openBookmarkEditor()}
						>
							<BookmarkPlus />
						</Button>
					</IconTooltip>
					<IconTooltip label="Add column">
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8"
							aria-label="Add column"
							onClick={() => openColumnEditor()}
						>
							<Plus />
						</Button>
					</IconTooltip>
					<ActionDropdownMenu
						trigger={
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8"
								aria-label="Import, back up and share bookmarks"
							>
								<MoreHorizontal />
							</Button>
						}
						actions={[
							{
								id: 'import',
								label: 'Import bookmarks',
								icon: Upload,
								onSelect: () => setImportOpen(true),
							},
							{
								id: 'backup',
								label: 'Back up bookmarks',
								icon: Download,
								onSelect: openBookmarkBackup,
							},
							{
								id: 'share',
								label: 'Share bookmarks',
								icon: Share2,
								disabled: bookmarks.length === 0,
								onSelect: () => shareBookmarks(),
							},
							{type: 'separator'},
							{
								id: 'trash',
								label: 'Trash bin',
								icon: Trash2,
								onSelect: () =>
									emitRecoveryEvent({type: 'trash', filter: 'bookmarks'}),
							},
						]}
					/>
				</div>
			</div>
			{selectedBookmarkIds.length > 0 && (
				<div
					className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/[.055] px-4 py-3"
					role="group"
					aria-label="Selected bookmarks"
				>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							size="sm"
							disabled={busy === 'bookmark-batch'}
							onClick={() => void openSelectedBookmarks()}
						>
							<ExternalLink className="h-4 w-4" />
							Open
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={busy === 'bookmark-batch'}
							aria-label="Move bookmarks"
							onClick={openSelectedBookmarkMove}
						>
							<MoveBookmarkIcon className="h-4 w-4" />
							Move
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={busy === 'bookmark-batch'}
							onClick={openSelectedBookmarkExport}
						>
							<Download className="h-4 w-4" />
							Export
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={busy === 'bookmark-batch'}
							onClick={shareSelectedBookmarks}
						>
							<Share2 className="h-4 w-4" />
							Share
						</Button>
						{sessionTargetsForBookmarks.length > 0 && (
							<Select
								value=""
								disabled={busy === 'bookmark-batch'}
								onValueChange={(targetId) => {
									const target = sessionTargetsForBookmarks.find(
										(entry) => entry.id === targetId,
									);
									if (target) {
										void addSelectedBookmarksToSession(target);
									}
								}}
							>
								<SelectTrigger
									aria-label="Add selected bookmarks to session"
									className="h-9 w-auto min-w-36 text-sm"
								>
									<SelectValue placeholder="Add to session" />
								</SelectTrigger>
								<SelectContent>
									{sessionTargetsForBookmarks.map((target) => (
										<SelectItem key={target.id} value={target.id}>
											{target.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
						<Button
							variant="outline"
							size="sm"
							className="text-destructive hover:text-destructive"
							disabled={busy === 'bookmark-batch'}
							onClick={() => void deleteSelectedBookmarks()}
						>
							<Trash2 className="h-4 w-4" />
							Delete
						</Button>
					</div>
					<span role="status" className="text-sm font-semibold">
						{plural(selectedBookmarkIds.length, 'bookmark')} selected
					</span>
					<Button
						variant="ghost"
						size="sm"
						className="ml-auto shrink-0"
						disabled={busy === 'bookmark-batch'}
						aria-label="Clear bookmark selection"
						onClick={() => {
							setSelectedBookmarks(new Set());
							bookmarkSelectionAnchorRef.current = null;
						}}
					>
						<X className="h-4 w-4" />
						Clear
					</Button>
				</div>
			)}
			{bookmarkSearch.trim() && filteredBookmarks.length === 0 ? (
				<EmptyState icon={Search} title="No bookmarks match">
					Search titles, web addresses, and domains.
				</EmptyState>
			) : bookmarkView === 'focus' ? (
				<div
					className={cn(
						'flex flex-col md:flex-row',
						compactBoard ? 'gap-2' : 'gap-4',
					)}
				>
					<nav aria-label="Bookmark columns" className="md:w-56 md:shrink-0">
						<ul className="flex gap-1 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0">
							{focusItems.map((item) => {
								const active = item.id === activeFocus?.id;
								const ItemIcon = item.unfiled
									? Inbox
									: getIcon(item.icon, DEFAULT_COLUMN_ICON).component;
								const itemIndex = columns.findIndex(
									(column) => column.id === item.id,
								);
								const itemSiblings =
									columnBookmarks.all.get(item.id) ?? NO_BOOKMARKS;
								const railButton = (
									<button
										type="button"
										data-focus-column={item.id}
										aria-current={active ? 'true' : undefined}
										aria-controls="focus-column-panel"
										className={cn(
											'flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm md:whitespace-normal',
											compactBoard ? 'py-1' : 'py-1.5',
											active
												? 'bg-primary/10 font-semibold text-primary'
												: 'text-muted-foreground hover:bg-muted hover:text-foreground',
											railDropId === item.id &&
												'ring-2 ring-primary ring-offset-2 ring-offset-background',
										)}
										onDragOver={(event) => {
											if (!acceptsDrop(event, false)) {
												return;
											}

											event.preventDefault();
											setRailDropId(item.id);
										}}
										onDragLeave={(event) => {
											if (
												!event.currentTarget.contains(
													event.relatedTarget as Node | null,
												)
											) {
												setRailDropId(null);
											}
										}}
										onDrop={(event) => {
											setRailDropId(null);
											if (!acceptsDrop(event, false)) {
												return;
											}

											event.preventDefault();
											void boardActions.drop(event, item.column);
										}}
										onClick={() => setFocusColumnId(item.id)}
									>
										<ItemIcon className="size-4 shrink-0" />
										<span className="min-w-0 flex-1 truncate">{item.name}</span>
										<Badge
											variant={active ? 'accent' : 'secondary'}
											className="ml-1"
										>
											{item.count}
										</Badge>
									</button>
								);
								return (
									<li key={item.id} className="shrink-0 md:block">
										{item.unfiled ? (
											railButton
										) : (
											<ActionContextMenu
												actions={() =>
													columnMenuActions(
														item.column,
														itemSiblings,
														itemIndex > 0,
														itemIndex < columns.length - 1,
														boardActions,
													)
												}
											>
												{railButton}
											</ActionContextMenu>
										)}
									</li>
								);
							})}
						</ul>
					</nav>
					<p className="sr-only" role="status" aria-live="polite">
						{activeFocus
							? `Showing ${activeFocus.name}, ${plural(activeFocus.count, 'bookmark')}.`
							: ''}
					</p>
					{activeFocus && (
						<div
							id="focus-column-panel"
							className="flex min-w-0 flex-1 flex-col"
						>
							<BookmarkColumn
								autoLoadMore
								scrollBody={settings.limitBookmarksPerColumn === true}
								renderAll={settings.limitBookmarksPerColumn === true}
								bodyMaxHeight={cappedColumnBodyHeight}
								compact={compactBoard}
								column={activeFocus.column}
								selected={selectedBookmarks}
								selectionMode={bookmarkSelectionMode}
								canMoveEarlier={!activeFocus.unfiled && activeFocusIndex > 0}
								canMoveLater={
									!activeFocus.unfiled && activeFocusIndex < columns.length - 1
								}
								bookmarks={
									columnBookmarks.shown.get(activeFocus.id) ?? NO_BOOKMARKS
								}
								siblings={
									columnBookmarks.all.get(activeFocus.id) ?? NO_BOOKMARKS
								}
								pageSize={bookmarkPageSize}
								dropIndicator={
									columnDropIndicator?.columnId === activeFocus.id
										? columnDropIndicator
										: null
								}
								urlMode={urlMode}
								clickOpensMenu={clickOpensMenu}
								urlSettings={urlSettings}
								quickActions={quickActions}
								actions={boardActions}
								simpleHeader={activeFocus.unfiled}
								allowColumnDrag={false}
								allowColumnDrop={!activeFocus.unfiled}
								ariaLabel={
									activeFocus.unfiled ? 'Unfiled bookmarks' : undefined
								}
								emptyMessage={
									activeFocus.unfiled
										? 'No columns yet. New bookmarks will be kept here until you add a column.'
										: undefined
								}
							/>
						</div>
					)}
				</div>
			) : (
				<div
					className={cn(
						'grid',
						compactBoard ? 'gap-2' : 'gap-4',
						!bookmarkGridTemplateColumns && bookmarkGridColumnsClass,
						stretchColumns ? 'items-stretch' : 'items-start',
					)}
					style={
						bookmarkGridTemplateColumns
							? {gridTemplateColumns: bookmarkGridTemplateColumns}
							: undefined
					}
				>
					{columns.map((column, index) => (
						<BookmarkColumn
							key={column.id}
							autoLoadMore
							column={column}
							selected={selectedBookmarks}
							selectionMode={bookmarkSelectionMode}
							canMoveEarlier={index > 0}
							canMoveLater={index < columns.length - 1}
							bookmarks={columnBookmarks.shown.get(column.id) ?? NO_BOOKMARKS}
							siblings={columnBookmarks.all.get(column.id) ?? NO_BOOKMARKS}
							pageSize={bookmarkPageSize}
							renderAll={settings.limitBookmarksPerColumn === true}
							scrollBody={settings.limitBookmarksPerColumn === true}
							bodyMaxHeight={cappedColumnBodyHeight}
							compact={compactBoard}
							dropIndicator={
								columnDropIndicator?.columnId === column.id
									? columnDropIndicator
									: null
							}
							urlMode={urlMode}
							clickOpensMenu={clickOpensMenu}
							urlSettings={urlSettings}
							quickActions={quickActions}
							actions={boardActions}
						/>
					))}
					{includeUnfiled && (
						<BookmarkColumn
							autoLoadMore
							simpleHeader
							column={UNFILED_COLUMN}
							selected={selectedBookmarks}
							selectionMode={bookmarkSelectionMode}
							canMoveEarlier={false}
							canMoveLater={false}
							bookmarks={unfiledFiltered}
							siblings={unfiledAll}
							pageSize={
								settings.limitBookmarksPerColumn
									? bookmarkPageSize
									: Math.max(unfiledFiltered.length, 1)
							}
							renderAll={settings.limitBookmarksPerColumn === true}
							scrollBody={settings.limitBookmarksPerColumn === true}
							bodyMaxHeight={cappedColumnBodyHeight}
							compact={compactBoard}
							dropIndicator={
								columnDropIndicator?.columnId === UNFILED_COLUMN.id
									? columnDropIndicator
									: null
							}
							urlMode={urlMode}
							clickOpensMenu={clickOpensMenu}
							urlSettings={urlSettings}
							quickActions={quickActions}
							actions={boardActions}
							allowColumnDrag={false}
							allowColumnDrop={false}
							ariaLabel="Unfiled bookmarks"
							emptyMessage="No columns yet. New bookmarks will be kept here until you add a column."
						/>
					)}
				</div>
			)}
			{bookmarks.length === 0 && (
				<div className="mt-4 rounded-md border border-dashed border-border px-4 py-3 text-center text-xs text-muted-foreground">
					Tip: drag a link from your browser onto a column to save it.
				</div>
			)}
		</section>
	);
	const sessionsSection = (
		<section id="sessions" className="scroll-mt-6">
			<SessionManager
				embedded
				initialQuery={initialQuery}
				state={state}
				error={error}
				reload={reload}
			/>
		</section>
	);

	return (
		<main
			className={cn(
				'mx-auto',
				dashboardMaxWidthClass,
				'px-5 py-6 sm:px-8 sm:py-9',
			)}
		>
			<AppHeader active="dashboard">
				<FinderTrigger onClick={() => setFinderOpen(true)} />
				{settings.showSaveWindowButton !== false && (
					<Button
						size="sm"
						disabled={busy !== ''}
						aria-label={saveWindowLabel(tabSelection)}
						onClick={saveWindow}
					>
						<PanelsTopLeft />
						<span className="hidden sm:inline">
							{busy === 'save-window'
								? 'Saving'
								: saveWindowLabel(tabSelection)}
						</span>
					</Button>
				)}
				{settings.showTrashBinButton !== false && (
					<IconTooltip label="Trash bin">
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8"
							aria-label="Trash bin"
							onClick={() => {
								setTrashFilter('all');
								setTrashOpen(true);
							}}
						>
							<Trash2 />
						</Button>
					</IconTooltip>
				)}
			</AppHeader>

			<FinderPalette
				open={finderOpen}
				state={state}
				actions={finderActions}
				onOpenChange={setFinderOpen}
			/>

			<RecoveryBanner
				showStatus={showStatus}
				onReview={() => setSnapshotsOpen(true)}
			/>
			{sessionsOnTop ? sessionsSection : bookmarksSection}
			<hr className="my-8 border-border" aria-hidden="true" />
			{sessionsOnTop ? bookmarksSection : sessionsSection}
			<StatusLine status={error ? {message: error, error: true} : status} />

			{shareDialog}
			{nameDialog}
			<SnapshotsDialog
				open={snapshotsOpen}
				showStatus={showStatus}
				onOpenChange={setSnapshotsOpen}
				onSessionsChanged={reload}
			/>
			<TrashDialog
				open={trashOpen}
				initialFilter={trashFilter}
				showStatus={showStatus}
				onOpenChange={setTrashOpen}
				onChanged={reload}
			/>
			<BackupDialog
				state={state}
				data={backupRequest?.data ?? null}
				open={Boolean(backupRequest)}
				singleColumn={backupRequest?.singleColumn ?? false}
				showStatus={showStatus}
				onOpenChange={(open) => !open && setBackupRequest(null)}
			/>
			<ImportDialog
				open={importOpen}
				initialKind="bookmarks"
				state={state}
				showStatus={showStatus}
				onOpenChange={setImportOpen}
				onImported={() => void reload()}
			/>
			<Dialog
				open={dialog === 'bookmark'}
				onOpenChange={(open) => !open && setDialog(null)}
			>
				<DialogContent>
					<form onSubmit={saveBookmark}>
						<DialogHeader>
							<DialogTitle>
								{bookmarkEdit?.id
									? 'Edit bookmark'
									: bookmarkToSession
										? 'Add link to session'
										: 'Add bookmark'}
							</DialogTitle>
							<DialogDescription>
								{bookmarkToSession
									? 'Add a web link to a saved session.'
									: 'Save a web link to a local column.'}
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							{editedBookmark && (
								<LinkSummary
									settings={settings}
									title={editedBookmark.title}
									url={editedBookmark.url}
								/>
							)}
							<div className="space-y-1.5">
								<Label htmlFor="bookmark-edit-title">Title</Label>
								<Input
									required
									id="bookmark-edit-title"
									maxLength={500}
									value={bookmarkEdit?.title || ''}
									onChange={(e) =>
										setBookmarkEdit(
											(old) => old && {...old, title: e.target.value},
										)
									}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="bookmark-url">Web address</Label>
								<Input
									required
									id="bookmark-url"
									type="url"
									placeholder="https://example.com"
									value={bookmarkEdit?.url || ''}
									onChange={(e) =>
										setBookmarkEdit(
											(old) => old && {...old, url: e.target.value},
										)
									}
								/>
							</div>
							{bookmarkEdit?.id ? (
								columnFields
							) : (
								<SaveTargetFields
									idPrefix="bookmark"
									target={saveTarget}
									sessions={pasteSessions}
									sessionId={pasteSessionId}
									onTargetChange={setSaveTarget}
									onSessionChange={setSaveSessionId}
								>
									{columnFields}
								</SaveTargetFields>
							)}
						</DialogBody>
						<DialogFooter className="justify-between">
							{editedBookmark && (
								<Button
									type="button"
									variant="destructive"
									onClick={() => deleteBookmark(editedBookmark, true)}
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
									<X aria-hidden="true" />
									Cancel
								</Button>
								<Button type="submit" disabled={busy === 'bookmark-save'}>
									<Save aria-hidden="true" />
									{bookmarkToSession
										? 'Add to session'
										: bookmarkEdit?.columnId === NEW_COLUMN
											? 'Create column and save'
											: bookmarkEdit?.id
												? 'Save changes'
												: 'Save bookmark'}
								</Button>
							</div>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={dialog === 'paste-links'}
				onOpenChange={(open) => !open && setDialog(null)}
			>
				<DialogContent size="md">
					<form onSubmit={addPastedLinks}>
						<DialogHeader>
							<DialogTitle>
								Add{' '}
								{plural(pastedLinks.length, toSession ? 'link' : 'bookmark')}
							</DialogTitle>
							<DialogDescription>
								Untick any link you don't want to add.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<ScrollArea className="max-h-72 rounded-md border border-border">
								<ul
									className="divide-y divide-border"
									aria-label="Pasted links"
								>
									{pastedLinks.map((link, index) => (
										<li key={link.url}>
											<label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm">
												<Checkbox
													className="mt-0.5"
													checked={link.include}
													aria-label={`Add ${link.title || link.url}`}
													onCheckedChange={(checked) =>
														setPastedLinks((old) =>
															old.map((entry, at) =>
																at === index
																	? {...entry, include: checked === true}
																	: entry,
															),
														)
													}
												/>
												<Favicon
													url={link.url}
													label={link.title || link.url}
													className="mt-0.5 h-5 w-5 shrink-0"
												/>
												<span className="min-w-0 flex-1">
													<span className="block truncate font-medium">
														{link.title}
													</span>
													<span className="block truncate text-xs text-muted-foreground">
														<InsecureMarkFor
															url={link.url}
															settings={settings}
														/>
														{displayUrl(
															link.url,
															settings.simplifyUrls !== false,
														)}
													</span>
												</span>
											</label>
										</li>
									))}
								</ul>
							</ScrollArea>
							<SaveTargetFields
								idPrefix="pasted-links"
								target={saveTarget}
								sessions={pasteSessions}
								sessionId={pasteSessionId}
								onTargetChange={setSaveTarget}
								onSessionChange={setSaveSessionId}
							>
								<div className="space-y-1.5">
									<Label htmlFor="pasted-links-column">Column</Label>
									<BookmarkColumnPicker
										columns={columns}
										value={pastedColumn}
										id="pasted-links-column"
										draft={pastedNewColumn}
										onDraftChange={setPastedNewColumn}
										onValueChange={setPastedColumn}
									/>
								</div>
							</SaveTargetFields>
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setDialog(null)}
							>
								<X aria-hidden="true" />
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={
									busy === 'paste-links' ||
									pastedLinks.filter((link) => link.include).length === 0
								}
							>
								<ListPlus aria-hidden="true" />
								Add{' '}
								{plural(
									pastedLinks.filter((link) => link.include).length,
									toSession ? 'link' : 'bookmark',
								)}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={dialog === 'column'}
				onOpenChange={(open) => !open && setDialog(null)}
			>
				<DialogContent size="sm">
					<form onSubmit={saveColumn}>
						<DialogHeader>
							<DialogTitle>
								{columnEdit?.id ? 'Edit column' : 'Add column'}
							</DialogTitle>
							<DialogDescription>
								Choose a name and icon for this bookmark column.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<IconNameField
								id="column-name"
								label="Name"
								nameLabel="Column name"
								icon={columnEdit?.icon}
								defaultIcon={DEFAULT_COLUMN_ICON}
								inputProps={{
									required: true,
									autoFocus: true,
									maxLength: 60,
									value: columnEdit?.name || '',
									onChange: (e) =>
										setColumnEdit(
											(old) => old && {...old, name: e.target.value},
										),
								}}
								onIconChange={(icon) =>
									setColumnEdit((old) => old && {...old, icon})
								}
							/>
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setDialog(null)}
							>
								<X aria-hidden="true" />
								Cancel
							</Button>
							<Button type="submit">
								{columnEdit?.id ? (
									<Save aria-hidden="true" />
								) : (
									<FolderPlus aria-hidden="true" />
								)}
								{columnEdit?.id ? 'Save changes' : 'Add column'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={dialog === 'delete-column'}
				onOpenChange={(open) => !open && setDialog(null)}
			>
				<DialogContent size="sm">
					<form onSubmit={confirmDeleteColumn}>
						<DialogHeader>
							<DialogTitle>
								Delete column “{columnDelete?.column.name}”?
							</DialogTitle>
							<DialogDescription>
								It has {plural(columnDelete?.count ?? 0, 'bookmark')}. You can
								undo this right after.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							{columns.some((item) => item.id !== columnDelete?.column.id) ? (
								<RadioCardGroup
									label="Its bookmarks"
									value={columnDelete?.mode ?? 'move'}
									onValueChange={(value) =>
										setColumnDelete(
											(old) =>
												old && {...old, mode: value as 'move' | 'delete'},
										)
									}
								>
									<RadioCard
										value="move"
										icon={ACTION_ICONS.move}
										title="Move them to another column"
										description="They go to the end of the column you pick."
									/>
									<RadioCard
										value="delete"
										icon={Trash2}
										title="Delete them too"
										description="They go to the trash bin with the column."
									/>
								</RadioCardGroup>
							) : null}
							{columnDelete?.mode === 'move' &&
							columns.some((item) => item.id !== columnDelete.column.id) ? (
								<div className="space-y-1.5">
									<Label htmlFor="delete-column-target">
										Move bookmarks to
									</Label>
									<Select
										value={columnDelete.targetColumnId}
										onValueChange={(value) =>
											setColumnDelete(
												(old) => old && {...old, targetColumnId: value},
											)
										}
									>
										<SelectTrigger id="delete-column-target">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{columns
												.filter((item) => item.id !== columnDelete.column.id)
												.map((item) => (
													<SelectItem key={item.id} value={item.id}>
														<ColumnLabel column={item} />
													</SelectItem>
												))}
										</SelectContent>
									</Select>
								</div>
							) : null}
							{columns.every((item) => item.id === columnDelete?.column.id) ? (
								<p className="text-sm text-muted-foreground">
									This is your last column, so its bookmarks are deleted with it
									and go to the trash bin.
								</p>
							) : null}
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setDialog(null)}
							>
								<X aria-hidden="true" />
								Cancel
							</Button>
							<Button type="submit" variant="destructive">
								<Trash2 />
								Delete column
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={dialog === 'move'}
				onOpenChange={(open) => !open && setDialog(null)}
			>
				<DialogContent size="sm">
					<form onSubmit={moveBookmarkToColumn}>
						<DialogHeader>
							<DialogTitle>
								{moveBookmark?.bookmarkIds.length === 1
									? 'Move bookmark to'
									: 'Move bookmarks to'}
							</DialogTitle>
							<DialogDescription>
								Bookmarks go to the end of the column you choose, in their
								current order.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							{movingBookmark ? (
								<LinkSummary
									settings={settings}
									title={movingBookmark.title}
									url={movingBookmark.url}
								/>
							) : (
								<p className="text-sm">
									{plural(moveBookmark?.bookmarkIds.length || 0, 'bookmark')}{' '}
									selected
								</p>
							)}
							<div className="space-y-1.5">
								<Label htmlFor="move-bookmark-column">Column</Label>
								<BookmarkColumnPicker
									columns={columns}
									value={
										moveBookmark?.targetColumnId ||
										columns[0]?.id ||
										NEW_BOOKMARK_COLUMN
									}
									id="move-bookmark-column"
									newColumnLabel="Add column"
									draft={moveBookmarkColumnDraft}
									onValueChange={(value) =>
										setMoveBookmark(
											(old) => old && {...old, targetColumnId: value},
										)
									}
									onDraftChange={setMoveBookmarkColumnDraft}
								/>
							</div>
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setDialog(null)}
							>
								<X aria-hidden="true" />
								Cancel
							</Button>
							<Button type="submit" disabled={busy === 'bookmark-batch'}>
								<ArrowRight aria-hidden="true" />
								{moveBookmark?.bookmarkIds.length === 1
									? 'Move bookmark'
									: 'Move bookmarks'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</main>
	);
}

const skippedNote = (skipped: number) =>
	skipped ? ` ${plural(skipped, 'duplicate')} skipped.` : '';

function parseDraggedBookmark(
	dataTransfer: DataTransfer | null,
): LinkEntry | null {
	const link = parseDraggedLink(dataTransfer);
	return link && {url: link.url, title: link.title || siteName(link.url)};
}

const MAX_PASTED_LINKS = 500;

/**
Every web link in pasted content: one per line in plain text or a URI list, or each link in copied HTML. Lines
that are not a web address are ignored, and repeated addresses are kept once.
*/
function parsePastedLinks(dataTransfer: DataTransfer | null): LinkEntry[] {
	if (!dataTransfer) {
		return [];
	}

	const links = new Map<string, LinkEntry>();
	const add = (raw: string, title = '') => {
		const url = webUrl(raw);
		if (url && !links.has(url) && links.size < MAX_PASTED_LINKS) {
			links.set(url, {
				url,
				title: title
					.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
					.trim()
					.slice(0, 500),
			});
		}
	};

	const html = dataTransfer.getData('text/html');
	if (html) {
		for (const anchor of new DOMParser()
			.parseFromString(html, 'text/html')
			.querySelectorAll('a[href]')) {
			add(anchor.getAttribute('href') || '', anchor.textContent || '');
		}
	}

	if (links.size < 2) {
		links.clear();
		const text = [
			dataTransfer.getData('text/uri-list'),
			dataTransfer.getData('text/plain'),
		].join('\n');
		for (const line of text.split(/\r?\n/)) {
			if (!line.trimStart().startsWith('#')) {
				add(line);
			}
		}
	}

	return [...links.values()];
}

/**
Fills missing titles from open tabs showing the same page, then the domain.
*/
async function pastedLinkTitles(links: LinkEntry[]): Promise<LinkEntry[]> {
	let tabs: chrome.tabs.Tab[] = [];
	try {
		tabs = await chrome.tabs.query({});
	} catch {}

	return links.map((link) => ({
		url: link.url,
		title:
			link.title ||
			tabs
				.find((tab) => tab.url === link.url)
				?.title?.trim()
				.slice(0, 500) ||
			siteName(link.url),
	}));
}

async function pastedLinkTitle(link: LinkEntry): Promise<string> {
	const fallback = link.title || siteName(link.url);
	if (fallback !== siteName(link.url)) {
		return fallback;
	}

	try {
		const tabs = await chrome.tabs.query({});
		const tab = tabs.find(
			(candidate) => candidate.url === link.url && candidate.title?.trim(),
		);
		return tab?.title?.trim().slice(0, 500) || fallback;
	} catch {
		return fallback;
	}
}

// Column, bookmark, session, and link drags are accepted by columns; Unfiled takes all but columns.
function acceptsDrop(event: DragEvent<HTMLElement>, allowColumn: boolean) {
	const kind = dragPayloadKind(event.dataTransfer?.types);
	return Boolean(kind) && (allowColumn || kind !== 'column');
}

function previewBookmarkDrop(
	event: DragEvent<HTMLElement>,
	columnId: string,
	onDropOver: (indicator: DropIndicator | null) => void,
	allowColumn: boolean,
) {
	if (!acceptsDrop(event, allowColumn)) {
		return;
	}

	event.preventDefault();
	const kind = dragPayloadKind(event.dataTransfer.types);
	if (!kind) {
		return;
	}

	if (kind === 'column') {
		const rect = event.currentTarget.getBoundingClientRect();
		onDropOver({
			kind,
			columnId,
			position: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after',
		});
		return;
	}

	event.dataTransfer.dropEffect = kind === 'bookmark' ? 'move' : 'copy';
	const targetCard = (event.target as Element).closest<HTMLElement>(
		'[data-bookmark-id]',
	);
	const rect = targetCard?.getBoundingClientRect();
	onDropOver({
		kind,
		columnId,
		targetBookmarkId: targetCard?.dataset.bookmarkId || null,
		position:
			targetCard && rect && event.clientY < rect.top + rect.height / 2
				? 'before'
				: 'after',
	});
}

function handleInternalDragStart(
	event: DragEvent<HTMLElement>,
	count = 1,
	links: LinkEntry[] = [],
) {
	const handle = (event.target as Element).closest<HTMLElement>(
		'[data-drag-column]',
	);
	const card = (event.target as Element).closest<HTMLElement>(
		'[data-bookmark-id]',
	);
	if (handle) {
		event.dataTransfer.setData(COLUMN_DRAG_TYPE, handle.dataset.dragColumn!);
		event.dataTransfer.effectAllowed = 'move';
	} else if (card) {
		card.classList.add('is-dragging');
		setBookmarkDragImage(event, card, count);
		event.dataTransfer.setData(BOOKMARK_DRAG_TYPE, card.dataset.bookmarkId!);
		if (count > 1) {
			applyLinkDrag(event.dataTransfer, links, `${count} selected bookmarks`);
		} else {
			const link = card.dataset.bookmarkUrl;
			if (link) {
				event.dataTransfer.setData('text/uri-list', link);
				event.dataTransfer.setData('text/plain', link);
				event.dataTransfer.setData(
					'text/x-moz-url',
					`${link}\n${card.dataset.bookmarkTitle || ''}`,
				);
			}
		}

		event.dataTransfer.effectAllowed = 'copyMove';
	}
}

// A compact rounded card (favicon, title, domain) replaces the browser's default drag ghost.
function setBookmarkDragImage(
	event: DragEvent<HTMLElement>,
	card: HTMLElement,
	count: number,
) {
	const title = card.dataset.bookmarkTitle || '';
	const domain = card.dataset.bookmarkDomain || '';
	const ghost = document.createElement('div');
	Object.assign(ghost.style, {
		position: 'fixed',
		top: '-1000px',
		left: '-1000px',
		display: 'flex',
		alignItems: 'center',
		gap: '10px',
		width: '260px',
		padding: '8px 12px',
		borderRadius: '10px',
		border: '1px solid rgb(var(--border))',
		background: 'rgb(var(--card))',
		color: 'rgb(var(--foreground))',
		boxShadow: '0 8px 24px rgb(0 0 0 / 0.25)',
		font: '13px/1.3 system-ui, sans-serif',
		pointerEvents: 'none',
	});
	const icon = card.querySelector<HTMLImageElement>('img[data-favicon]');
	const mark = document.createElement(icon ? 'img' : 'span');
	if (icon && mark instanceof HTMLImageElement) {
		mark.src = icon.src;
	} else {
		mark.textContent = (domain[0] || '↗').toUpperCase();
	}

	Object.assign(mark.style, {
		width: '24px',
		height: '24px',
		flex: 'none',
		objectFit: 'contain',
		textAlign: 'center',
		lineHeight: '24px',
		fontWeight: '700',
	});
	const text = document.createElement('div');
	text.style.minWidth = '0';
	const strong = document.createElement('div');
	strong.textContent = count > 1 ? `${count} bookmarks` : title;
	Object.assign(strong.style, {
		fontWeight: '600',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	});
	const small = document.createElement('div');
	small.textContent = domain;
	Object.assign(small.style, {
		fontSize: '11px',
		color: 'rgb(var(--muted-foreground))',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	});
	text.append(strong, small);
	ghost.append(mark, text);
	document.body.append(ghost);
	event.dataTransfer.setDragImage(ghost, 24, 24);
	setTimeout(() => ghost.remove(), 0);
}

function handleInternalDragEnd() {
	document
		.querySelectorAll('.is-dragging')
		.forEach((node) => node.classList.remove('is-dragging'));
}

/**
Handlers the board shares with every column and bookmark. The object never changes identity.
*/
type BoardActions = {
	bookmark: OnBookmarkAction;
	share: (column: BookmarkColumnData) => void;
	exportColumn: (column: BookmarkColumnData) => void;
	add: (column: BookmarkColumnData) => void;
	openAll: (column: BookmarkColumnData) => void;
	edit: (column: BookmarkColumnData) => void;
	/**
	Keyboard alternative to dragging: moves a column one place earlier or later.
	*/
	moveColumn: (column: BookmarkColumnData, direction: MoveDirection) => void;
	addToSession: (
		bookmark: Bookmark,
		target: {id: string; name: string},
	) => void;
	/**
	Sessions a bookmark can be added to (read when a menu opens, never while rendering).
	*/
	sessionTargets: () => Array<{id: string; name: string}>;
	remove: (column: BookmarkColumnData) => void;
	pointerDown: (
		event: ReactPointerEvent<HTMLElement>,
		columnId: string,
	) => void;
	dropOver: (indicator: DropIndicator | null) => void;
	drop: (
		event: DragEvent<HTMLElement>,
		column: BookmarkColumnData,
	) => Promise<void>;
	dragStart: (event: DragEvent<HTMLElement>) => void;
	dragEnd: () => void;
};

function columnMenuActions(
	column: BookmarkColumnData,
	siblings: Bookmark[],
	canMoveEarlier: boolean,
	canMoveLater: boolean,
	actions: BoardActions,
): MenuAction[] {
	return [
		{
			id: 'open-all',
			label: 'Open all in new tabs',
			icon: ACTION_ICONS.openNew,
			disabled: siblings.length === 0,
			onSelect: () => actions.openAll(column),
		},
		{
			id: 'add',
			label: 'Add bookmark here',
			icon: BookmarkPlus,
			onSelect: () => actions.add(column),
		},
		{
			id: 'share',
			label: 'Share',
			icon: Share2,
			disabled: siblings.length === 0,
			onSelect: () => actions.share(column),
		},
		{
			id: 'export',
			label: 'Export column',
			icon: Download,
			disabled: siblings.length === 0,
			onSelect: () => actions.exportColumn(column),
		},
		{type: 'separator'},
		{
			id: 'edit',
			label: 'Edit column',
			icon: Pencil,
			onSelect: () => actions.edit(column),
		},
		{
			id: 'move-left',
			label: 'Move left',
			icon: ArrowLeft,
			disabled: !canMoveEarlier,
			onSelect: () => actions.moveColumn(column, 'earlier'),
		},
		{
			id: 'move-right',
			label: 'Move right',
			icon: ArrowRight,
			disabled: !canMoveLater,
			onSelect: () => actions.moveColumn(column, 'later'),
		},
		{type: 'separator'},
		{
			id: 'delete',
			label: 'Delete column',
			icon: Trash2,
			destructive: true,
			onSelect: () => actions.remove(column),
		},
	];
}

type BookmarkColumnProps = {
	column: BookmarkColumnData;
	selected: Set<string>;
	selectionMode: BookmarkSelectionMode;
	/**
	The bookmarks to show (after the search).
	*/
	bookmarks: Bookmark[];
	/**
	Every bookmark in the column, in order.
	*/
	siblings: Bookmark[];
	urlMode: NonNullable<Settings['urlDisplayMode']>;
	quickActions: BookmarkQuickAction[];
	clickOpensMenu: boolean;
	urlSettings: UrlSettings;
	dropIndicator: DropIndicator | null;
	canMoveEarlier: boolean;
	canMoveLater: boolean;
	pageSize: number;
	autoLoadMore: boolean;
	actions: BoardActions;
	/**
	Scroll the bookmark list inside the column instead of letting it grow.
	*/
	scrollBody?: boolean;
	/**
	Maximum height of a scrolling body, used when the Board view caps columns.
	*/
	bodyMaxHeight?: string;
	/**
	Draw every bookmark, used by capped panes that scroll instead of loading batches.
	*/
	renderAll?: boolean;
	/**
	Tighter header, body, and row spacing (the compact bookmark density).
	*/
	compact?: boolean;
	/**
	Header without the column icon, menu, or drag handle, used by Unfiled.
	*/
	simpleHeader?: boolean;
	allowColumnDrag?: boolean;
	allowColumnDrop?: boolean;
	ariaLabel?: string;
	emptyMessage?: string;
};

const MAX_SESSION_TARGETS = 30;

/**
Default number of bookmarks first drawn in each column; Settings can use smaller manual batches.
*/
const COLUMN_PAGE = 60;

const BookmarkColumn = memo(
	({
		column,
		selected,
		selectionMode,
		bookmarks,
		siblings,
		urlMode,
		quickActions,
		clickOpensMenu,
		urlSettings,
		dropIndicator,
		canMoveEarlier,
		canMoveLater,
		pageSize,
		autoLoadMore,
		actions,
		scrollBody = false,
		bodyMaxHeight,
		renderAll = false,
		compact = false,
		simpleHeader = false,
		allowColumnDrag = true,
		allowColumnDrop = true,
		ariaLabel,
		emptyMessage,
	}: BookmarkColumnProps) => {
		const [limit, loadMore] = usePagedLimit(
			`${column.id}:${pageSize}`,
			pageSize,
		);
		const shown = renderAll
			? bookmarks
			: bookmarks.length > limit
				? bookmarks.slice(0, limit)
				: bookmarks;
		const lastSibling = siblings.at(-1)?.id;
		const firstSibling = siblings[0]?.id;
		const onDropOver = actions.dropOver;
		function leaveColumn(event: DragEvent<HTMLElement>) {
			if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
				onDropOver(null);
			}
		}

		// Built only when a menu opens.
		const columnActions = () =>
			columnMenuActions(
				column,
				siblings,
				canMoveEarlier,
				canMoveLater,
				actions,
			);
		const ColumnIcon = getIcon(column.icon, DEFAULT_COLUMN_ICON).component;
		const bookmarkDrop =
			dropIndicator && dropIndicator.kind !== 'column' ? dropIndicator : null;
		const showEndInsertion = bookmarkDrop && !bookmarkDrop.targetBookmarkId;
		const header = simpleHeader ? (
			<header
				className={cn(
					'flex shrink-0 items-center gap-2 border-b border-border',
					compact ? 'px-2 py-1' : 'px-3 py-2',
				)}
			>
				<h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
					{column.name}
				</h3>
				<Badge>{siblings.length}</Badge>
			</header>
		) : (
			<header
				draggable={allowColumnDrag}
				data-drag-column={allowColumnDrag ? column.id : undefined}
				title={allowColumnDrag ? 'Drag to reorder' : undefined}
				className={cn(
					'flex shrink-0 items-center gap-2 border-b border-border',
					compact ? 'px-2 py-1' : 'px-3 py-2',
					allowColumnDrag && 'cursor-grab touch-none active:cursor-grabbing',
				)}
				onPointerDown={
					allowColumnDrag
						? (event) => {
								// Buttons in the header (its menu) keep their own taps and clicks.
								if (!(event.target as Element).closest('button')) {
									actions.pointerDown(event, column.id);
								}
							}
						: undefined
				}
			>
				<ColumnIcon className="size-4 shrink-0 text-muted-foreground" />
				<h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
					{column.name}
				</h3>
				<Badge>{siblings.length}</Badge>
				<ActionDropdownMenu
					trigger={
						<Button
							data-move-focus
							variant="ghost"
							size="icon"
							aria-label={`Options for ${column.name} column`}
						>
							<MoreHorizontal className="h-4 w-4" />
						</Button>
					}
					actions={columnActions}
				/>
			</header>
		);
		const body = (
			<div
				role={scrollBody ? 'region' : undefined}
				// Focusable so keyboard users can scroll this region on its own.
				// eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
				tabIndex={scrollBody ? 0 : undefined}
				aria-label={
					scrollBody ? (ariaLabel ?? `${column.name} bookmarks`) : undefined
				}
				style={scrollBody ? {maxHeight: bodyMaxHeight} : undefined}
				className={cn(
					'flex flex-1 flex-col',
					compact ? 'p-1' : 'p-2',
					scrollBody
						? 'min-h-0 overflow-y-auto'
						: compact
							? 'min-h-16'
							: 'min-h-24',
				)}
			>
				{shown.length > 0 ? (
					<div className={compact ? undefined : 'space-y-1'}>
						{shown.map((bookmark) => {
							const targeted = bookmarkDrop?.targetBookmarkId === bookmark.id;
							return (
								<BookmarkCard
									key={bookmark.id}
									bookmark={bookmark}
									selected={selected.has(bookmark.id)}
									selectionMode={selectionMode}
									dropBefore={targeted && bookmarkDrop.position === 'before'}
									dropAfter={targeted && bookmarkDrop.position === 'after'}
									dropActive={targeted}
									canMoveEarlier={bookmark.id !== firstSibling}
									canMoveLater={bookmark.id !== lastSibling}
									urlMode={urlMode}
									clickOpensMenu={clickOpensMenu}
									urlSettings={urlSettings}
									quickActions={quickActions}
									compact={compact}
									sessions={actions}
									onAction={actions.bookmark}
								/>
							);
						})}
						{!renderAll && bookmarks.length > shown.length && (
							<LoadMore
								compact
								remaining={bookmarks.length - shown.length}
								step={pageSize}
								noun="bookmarks"
								autoLoad={autoLoadMore}
								onMore={loadMore}
							/>
						)}
					</div>
				) : (
					<p className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
						{emptyMessage && siblings.length === 0
							? emptyMessage
							: siblings.length > 0
								? 'No matching links.'
								: 'Drop a bookmark here, or add one from this column’s menu.'}
					</p>
				)}
				{showEndInsertion && (
					<div className="relative h-0">
						<InsertionLine className="inset-x-1 top-0.5" />
					</div>
				)}
			</div>
		);
		return (
			<div className="relative flex min-w-0 flex-col">
				{dropIndicator?.kind === 'column' && (
					<InsertionLine
						orientation="vertical"
						className={cn(
							'inset-y-0',
							dropIndicator.position === 'before'
								? '-left-[9px]'
								: '-right-[9px]',
						)}
					/>
				)}
				<section
					data-column-id={column.id}
					className={cn(
						'bookmark-column relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card',
						dropIndicator &&
							dropIndicator.kind !== 'column' &&
							'ring-2 ring-primary ring-offset-2 ring-offset-background',
					)}
					aria-label={ariaLabel ?? `${column.name} bookmark column`}
					onDragOver={(event) =>
						previewBookmarkDrop(event, column.id, onDropOver, allowColumnDrop)
					}
					onDragLeave={leaveColumn}
					onDrop={(event) => {
						if (!acceptsDrop(event, allowColumnDrop)) {
							return;
						}

						event.preventDefault();
						void actions.drop(event, column);
					}}
					onDragStart={actions.dragStart}
					onDragEnd={actions.dragEnd}
				>
					{simpleHeader ? (
						header
					) : (
						<ActionContextMenu actions={columnActions}>
							{header}
						</ActionContextMenu>
					)}
					{simpleHeader ? (
						body
					) : (
						<ActionContextMenu actions={columnActions}>
							{body}
						</ActionContextMenu>
					)}
				</section>
			</div>
		);
	},
);

type BookmarkCardProps = {
	bookmark: Bookmark;
	selected: boolean;
	selectionMode: BookmarkSelectionMode;
	onAction: OnBookmarkAction;
	sessions: Pick<BoardActions, 'addToSession' | 'sessionTargets'>;
	urlMode: NonNullable<Settings['urlDisplayMode']>;
	quickActions: BookmarkQuickAction[];
	/**
	Clicking the card opens its action menu instead of the link.
	*/
	clickOpensMenu?: boolean;
	urlSettings?: UrlSettings;
	dropBefore?: boolean;
	dropAfter?: boolean;
	dropActive?: boolean;
	canMoveEarlier?: boolean;
	canMoveLater?: boolean;
	compact?: boolean;
};

type UrlSettings = Pick<
	Settings,
	| 'simplifyUrls'
	| 'markInsecureLinks'
	| 'markLocalLinks'
	| 'removeTrackingParameters'
>;
const DEFAULT_URL_SETTINGS: UrlSettings = {
	simplifyUrls: true,
	markInsecureLinks: true,
	markLocalLinks: false,
	removeTrackingParameters: false,
};

const BookmarkCard = memo(
	({
		bookmark,
		selected,
		selectionMode,
		onAction,
		sessions,
		urlMode,
		quickActions,
		clickOpensMenu = false,
		urlSettings = DEFAULT_URL_SETTINGS,
		dropBefore = false,
		dropAfter = false,
		dropActive = false,
		canMoveEarlier = false,
		canMoveLater = false,
		compact = false,
	}: BookmarkCardProps) => {
		const [menuOpen, setMenuOpen] = useState(false);
		const act = (action: BookmarkAction) => () => {
			void onAction(action, bookmark);
		};

		const open: MenuAction = {
			id: 'open',
			label: 'Open in this tab',
			icon: ACTION_ICONS.openHere,
			onSelect: act('open'),
		};
		const openNew: MenuAction = {
			id: 'open-new',
			label: 'Open in new tab',
			icon: ACTION_ICONS.openNew,
			onSelect: act('open-new'),
		};
		const edit: MenuAction = {
			id: 'edit',
			label: 'Edit',
			icon: ACTION_ICONS.edit,
			onSelect: act('edit'),
		};
		const copy: MenuAction = {
			id: 'copy',
			label: 'Copy link',
			icon: ACTION_ICONS.copy,
			onSelect: act('copy'),
		};
		const remove: MenuAction = {
			id: 'delete',
			label: 'Delete',
			icon: ACTION_ICONS.remove,
			destructive: true,
			onSelect: act('delete'),
		};
		// One list feeds both the ⋯ menu and the right-click menu so they always match.
		const actions = (): MenuAction[] => [
			{
				id: 'select',
				label: selected ? 'Deselect bookmark' : 'Select bookmark',
				icon: selected ? Square : SquareCheck,
				onSelect: act('select'),
			},
			open,
			openNew,
			{type: 'separator'},
			edit,
			copy,
			{
				id: 'move',
				label: 'Move to',
				icon: ACTION_ICONS.move,
				onSelect: act('move'),
			},
			{
				type: 'submenu',
				id: 'add-to-session',
				label: 'Add to session',
				icon: ListPlus,
				hidden: sessions.sessionTargets().length === 0,
				items: sessions.sessionTargets().map((target) => ({
					id: `session-${target.id}`,
					label:
						target.name.length > 40
							? `${target.name.slice(0, 39)}…`
							: target.name,
					onSelect: () => sessions.addToSession(bookmark, target),
				})),
			},
			{
				id: 'move-up',
				label: 'Move up',
				icon: ArrowUp,
				disabled: !canMoveEarlier,
				onSelect: act('move-up'),
			},
			{
				id: 'move-down',
				label: 'Move down',
				icon: ArrowDown,
				disabled: !canMoveLater,
				onSelect: act('move-down'),
			},
			{type: 'separator'},
			remove,
		];
		const showUrl = urlMode !== 'none';
		const urlOnly = urlMode === 'url-only';
		const cardName = urlOnly
			? displayUrl(bookmark.url, urlSettings.simplifyUrls)
			: bookmark.title || siteName(bookmark.url);
		return (
			<ActionContextMenu actions={actions}>
				<div
					data-bookmark-id={bookmark.id}
					data-bookmark-title={bookmark.title || siteName(bookmark.url)}
					data-bookmark-domain={siteName(bookmark.url)}
					data-bookmark-url={bookmark.url}
					data-column-id={bookmark.columnId}
					className="bookmark-drop-row relative"
					// The column body has its own right-click menu; a card keeps its own.
					onContextMenu={(event) => event.stopPropagation()}
				>
					{dropBefore && <InsertionLine className="inset-x-1 -top-[3px]" />}
					<article
						draggable
						className={cn(
							'group relative flex min-w-0 items-center gap-1 rounded-md',
							compact ? 'px-1.5' : 'px-2',
							showUrl
								? compact
									? 'py-1'
									: 'py-1.5'
								: compact
									? 'py-0.5'
									: 'py-1',
							'transition-colors hover:bg-muted/75',
							(dropActive || selected) && 'bg-primary/10',
						)}
					>
						{selectionMode !== 'off' && (
							<Checkbox
								checked={selected}
								aria-label={`Select bookmark: ${bookmark.title || siteName(bookmark.url)}`}
								className={cn(
									'absolute left-2 top-1/2 z-10 size-6 -translate-y-1/2',
									selectionMode === 'hover' &&
										!selected &&
										'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
								)}
								onClick={(event) =>
									void onAction(
										event.shiftKey ? 'select-range' : 'select',
										bookmark,
									)
								}
							/>
						)}
						<a
							href={
								urlSettings.removeTrackingParameters
									? stripTrackingParameters(bookmark.url)
									: bookmark.url
							}
							rel="noopener noreferrer"
							title={urlOnly ? bookmark.url : bookmark.title}
							aria-label={
								urlOnly && bookmark.title
									? `${bookmark.title} (${bookmark.url})`
									: undefined
							}
							className="flex min-w-0 flex-1 items-center gap-2.5"
							onClick={(event) => {
								if (event.ctrlKey || event.metaKey) {
									return;
								}

								if (event.altKey || selectionMode !== 'off') {
									event.preventDefault();
									void onAction(
										event.shiftKey ? 'select-range' : 'select',
										bookmark,
									);
									return;
								}

								if (event.button !== 0 || event.shiftKey) {
									return;
								}

								event.preventDefault();
								if (clickOpensMenu) {
									setMenuOpen(true);
									return;
								}

								void onAction('click', bookmark);
							}}
						>
							<Favicon
								url={bookmark.url}
								label={siteName(bookmark.url)}
								className={cn(
									showUrl && !compact ? 'h-6 w-6' : 'h-5 w-5',
									'rounded',
									selectionMode !== 'off' &&
										(selectionMode === 'on' || selected
											? 'invisible'
											: 'group-hover:invisible group-focus-within:invisible'),
								)}
							/>
							<span className="min-w-0 flex-1">
								<strong className="block truncate text-[13px] font-semibold group-hover:text-primary">
									{(urlOnly || !showUrl) && (
										<InsecureMarkFor
											url={bookmark.url}
											settings={urlSettings}
										/>
									)}
									{cardName}
								</strong>
								{showUrl && !urlOnly && (
									<small className="block truncate text-[11px] leading-4 text-muted-foreground">
										<InsecureMarkFor
											url={bookmark.url}
											settings={urlSettings}
										/>
										{urlMode === 'domain'
											? siteName(bookmark.url)
											: displayUrl(bookmark.url, urlSettings.simplifyUrls)}
									</small>
								)}
							</span>
						</a>
						{quickActions.map((quickAction) => {
							const {
								icon: QuickIcon,
								label,
								action,
							} = QUICK_ACTIONS[quickAction];
							const disabled =
								(quickAction === 'move-up' && !canMoveEarlier) ||
								(quickAction === 'move-down' && !canMoveLater);
							return (
								<IconTooltip key={quickAction} label={label}>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 shrink-0 opacity-70 group-hover:opacity-100"
										aria-label={`${label}: ${bookmark.title || siteName(bookmark.url)}`}
										disabled={disabled}
										onClick={act(action)}
									>
										<QuickIcon className="h-4 w-4" />
									</Button>
								</IconTooltip>
							);
						})}
						<ActionDropdownMenu
							actions={actions}
							open={menuOpen}
							trigger={
								<Button
									data-move-focus
									variant="ghost"
									size="icon"
									className="h-7 w-7 shrink-0 opacity-70 group-hover:opacity-100"
									aria-label={`Actions for ${bookmark.title || siteName(bookmark.url)}`}
									title="Actions"
								>
									<MoreHorizontal className="h-4 w-4" />
								</Button>
							}
							onOpenChange={setMenuOpen}
						/>
					</article>
					{dropAfter && <InsertionLine className="inset-x-1 -bottom-[3px]" />}
				</div>
			</ActionContextMenu>
		);
	},
);

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<PrivateWindowAppearance>
			<TooltipProvider>
				<PrivateSetupGate>
					<NewTab />
				</PrivateSetupGate>
			</TooltipProvider>
		</PrivateWindowAppearance>
	</ThemeProvider>,
);
