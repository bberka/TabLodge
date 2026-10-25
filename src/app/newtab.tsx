import {
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
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	BookmarkPlus,
	Download,
	ExternalLink,
	GripVertical,
	Link2,
	MoreHorizontal,
	Pencil,
	Plus,
	Info,
	Search,
	Settings2,
	Trash2,
	PanelsTopLeft,
	Copy,
	FolderInput,
	SquareArrowOutUpRight,
	Upload,
} from 'lucide-react';
import {
	Badge,
	Button,
	Checkbox,
	ConfirmationDialog,
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
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
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	TooltipProvider,
	IconTooltip,
	ExpandingSearch,
} from '../shared/ui';
import type {ButtonProps} from '../components/ui/button';
import '../../styles/extension-app.css';
import {ThemeProvider} from '../shared/theme';
import {
	Brand,
	EmptyState,
	StatusLine,
	send,
	useStatus,
	useTabLodgeState,
} from './common';
import {SessionManager} from './dashboard';
import {BackupDialog, ImportDialog} from './data-transfer';
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
	parseSessionDragData,
	sessionDropPrompt,
	shouldBlockDocumentDrop,
} from './interaction-actions';
import type {
	Bookmark,
	BookmarkColumn as BookmarkColumnData,
	InsertPosition,
	LinkEntry,
	Settings,
} from './types';
import {PROJECT} from './project';

type DialogKind = 'bookmark' | 'column' | 'move';
type DragKind = NonNullable<ReturnType<typeof dragPayloadKind>>;
type BookmarkAction =
	| 'open'
	| 'open-new'
	| 'edit'
	| 'move'
	| 'copy'
	| 'delete'
	| 'earlier'
	| 'later';
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
};
type ColumnDraft = {
	id: string | null;
	name: string;
};
type MoveDraft = Bookmark & {targetColumnId: string};
/**
`discard`: delete the column's bookmarks instead of moving them ("Don't keep the bookmarks").
*/
type ColumnDeletion = {
	column: BookmarkColumnData;
	remaining: BookmarkColumnData[];
	count: number;
	targetColumnId: string;
	discard: boolean;
};
type ConfirmationRequest = {
	title: string;
	description: string;
	confirmLabel?: string;
	confirmVariant?: ButtonProps['variant'];
	run: () => Promise<void> | void;
	busy?: boolean;
};
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

/**
Stable fallbacks so memoized values and effects do not see a new array on every render.
*/
const NO_COLUMNS: BookmarkColumnData[] = [];
const NO_BOOKMARKS: Bookmark[] = [];
const UNFILED_COLUMN = {id: 'bookmark-unfiled', name: 'Unfiled'};
/**
Column-picker value for "New column…" in the bookmark dialog.
*/
const NEW_COLUMN = '__new-column__';
const localFaviconUrl = (url: string) =>
	chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);
const safeWebUrl = (value: unknown) => {
	if (typeof value !== 'string' || value.length > 16_384) {
		return null;
	}

	try {
		const url = new URL(value);
		return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
};

function domainName(url: string) {
	try {
		return new URL(url).hostname.replace(/^www\./i, '');
	} catch {
		return url;
	}
}

const plural = (count: number, noun: string) =>
	`${count} ${count === 1 ? noun : `${noun}s`}`;
const bookmarkCount = (count: number) => plural(count, 'bookmark');

function NewTab() {
	const {state, error, reload} = useTabLodgeState();
	const [status, showStatus] = useStatus();
	const [busy, setBusy] = useState('');
	// `?q=` (from the "Search … in TabLodge" selection menu) prefills both searches once, then leaves the URL.
	const [initialQuery] = useState(() => initialSearchQuery(location.search));
	const [bookmarkSearch, setBookmarkSearch] = useState(initialQuery);
	const [dialog, setDialog] = useState<DialogKind | null>(null);
	const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(
		null,
	);
	// The deletion details stay set while the dialog closes, so its title never renders from cleared state.
	const [columnDeletion, setColumnDeletion] = useState<ColumnDeletion | null>(
		null,
	);
	const [columnDeletionOpen, setColumnDeletionOpen] = useState(false);
	const [backupData, setBackupData] = useState<ExportData | null>(null);
	const [importOpen, setImportOpen] = useState(false);
	const confirmFocusRef = useRef<HTMLElement | null>(null);
	const pointerColumnDragRef = useRef<PointerColumnDrag | null>(null);
	const [columnDropIndicator, setColumnDropIndicator] =
		useState<DropIndicator | null>(null);
	const [bookmarkEdit, setBookmarkEdit] = useState<BookmarkDraft | null>(null);
	const [columnEdit, setColumnEdit] = useState<ColumnDraft | null>(null);
	const [moveBookmark, setMoveBookmark] = useState<MoveDraft | null>(null);
	const [externalPromptHandled, setExternalPromptHandled] = useState(false);
	const columns = state?.bookmarkColumns || NO_COLUMNS;
	const bookmarks = state?.bookmarks || NO_BOOKMARKS;
	const settings: Partial<Settings> = state?.settings || {};
	const enabled = Boolean(settings.newTabEnabled);
	const sessionsEnabled = settings.sessionsEnabled !== false;
	const bookmarksEnabled = settings.bookmarksEnabled !== false;
	// Columns in a grid row share the tallest one's height (grid's default stretch); off keeps their natural height.
	const stretchColumns = settings.stretchBookmarkColumns !== false;
	const filteredBookmarks = useMemo(() => {
		const needle = bookmarkSearch.trim().toLocaleLowerCase();
		return bookmarks.filter(
			(bookmark) =>
				!needle ||
				[bookmark.title, bookmark.url, domainName(bookmark.url)].some((value) =>
					String(value || '')
						.toLocaleLowerCase()
						.includes(needle),
				),
		);
	}, [bookmarks, bookmarkSearch]);

	// Drops the one-time `?q=` from the address bar after the first render.
	useEffect(() => {
		if (initialQuery) {
			history.replaceState(null, '', stripSearchParams(location, ['q']));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on purpose
	}, []);

	useEffect(() => {
		if (!state || externalPromptHandled || !bookmarksEnabled) {
			return;
		}

		const params = new URLSearchParams(location.search);
		const url = safeWebUrl(params.get('bookmarkUrl'));
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
				'bookmark-unfiled';
		setBookmarkEdit({
			title: params.get('bookmarkTitle') || domainName(url),
			url,
			columnId,
			newColumnName: '',
		});
		setDialog('bookmark');
	}, [state, externalPromptHandled, bookmarksEnabled, columns]);

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

	async function saveWindow() {
		setBusy('save-window');
		const result = await send('SAVE_TABS', {scope: 'window'});
		setBusy('');
		if (!result?.ok) {
			showStatus(result?.error || 'Could not save this window.', true);
			return;
		}

		await reload();
	}

	async function openDefaultNewTab() {
		setBusy('default-page');
		const result = await send('OPEN_DEFAULT_NEW_TAB');
		if (result?.ok) {
			return;
		}

		setBusy('');
		showStatus(
			result?.error || 'Could not open the browser’s new-tab page.',
			true,
		);
	}

	function openBookmarkEditor(
		bookmark: Bookmark | null = null,
		preferredColumn = columns[0]?.id || 'bookmark-unfiled',
	) {
		setBookmarkEdit({
			id: bookmark?.id || null,
			title: bookmark?.title || '',
			url: bookmark?.url || '',
			columnId: bookmark?.columnId || preferredColumn,
		});
		setDialog('bookmark');
	}

	function openColumnEditor(column: BookmarkColumnData | null = null) {
		setColumnEdit({id: column?.id || null, name: column?.name || ''});
		setDialog('column');
	}

	async function saveBookmark(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!bookmarkEdit || busy === 'bookmark-save') {
			return;
		}

		setBusy('bookmark-save');
		try {
			let {columnId} = bookmarkEdit;
			// "New column…": create the column first, then save the bookmark into it.
			if (columnId === NEW_COLUMN) {
				const name = bookmarkEdit.newColumnName?.trim() || '';
				if (!name) {
					return;
				}

				const created = await send('CREATE_BOOKMARK_COLUMN', {name});
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
				})
			: await send('CREATE_BOOKMARK_COLUMN', {name: columnEdit.name});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not save that column.', true);
			return;
		}

		setDialog(null);
		setColumnEdit(null);
		await reload();
	}

	function deleteColumn(column: BookmarkColumnData) {
		const remaining = columns.filter((entry) => entry.id !== column.id);
		const count = bookmarks.filter(
			(bookmark) => bookmark.columnId === column.id,
		).length;
		confirmFocusRef.current = document.activeElement as HTMLElement | null;
		setColumnDeletion({
			column,
			remaining,
			count,
			targetColumnId: remaining[0]?.id || '',
			discard: false,
		});
		setColumnDeletionOpen(true);
	}

	async function confirmDeleteColumn() {
		if (!columnDeletion || !columnDeletionOpen) {
			return;
		}

		const {column, count, targetColumnId, remaining, discard} = columnDeletion;
		const discardBookmarks = discard && count > 0;
		const result = await send('DELETE_BOOKMARK_COLUMN', {
			columnId: column.id,
			targetColumnId:
				remaining.length > 0 && !discardBookmarks ? targetColumnId : null,
			discardBookmarks,
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not delete that column.', true);
			return;
		}

		setColumnDeletionOpen(false);
		await reload();
	}

	function askConfirmation(details: ConfirmationRequest) {
		confirmFocusRef.current = document.activeElement as HTMLElement | null;
		setConfirmation(details);
	}

	async function runConfirmation() {
		if (!confirmation || confirmation.busy) {
			return;
		}

		const current = confirmation;
		setConfirmation({...current, busy: true});
		try {
			await current.run();
			setConfirmation(null);
		} catch (reason) {
			showStatus(
				String(
					(reason as {message?: unknown} | null | undefined)?.message ||
						'That action could not be completed.',
				),
				true,
			);
			setConfirmation({...current, busy: false});
		}
	}

	async function moveColumnBy(column: BookmarkColumnData, offset: number) {
		const index = columns.findIndex((entry) => entry.id === column.id);
		const target = columns[index + offset];
		if (!target) {
			return;
		}

		const result = await send('REORDER_BOOKMARK_COLUMN', {
			columnId: column.id,
			targetColumnId: target.id,
			position: offset < 0 ? 'before' : 'after',
		});
		if (result?.ok) {
			await reload();
		} else {
			showStatus(result?.error || 'Could not reorder columns.', true);
		}
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
			setColumnDropIndicator(
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
			setColumnDropIndicator(null);
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
			setColumnDropIndicator(null);
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
	async function reorderBookmark(
		bookmark: Bookmark,
		action: 'earlier' | 'later',
	) {
		const siblings = bookmarks.filter(
			(entry) => entry.columnId === bookmark.columnId,
		);
		const index = siblings.findIndex((entry) => entry.id === bookmark.id);
		const target = siblings[index + (action === 'earlier' ? -1 : 1)];
		if (!target) {
			return;
		}

		const result = await send('REORDER_BOOKMARK', {
			bookmarkId: bookmark.id,
			targetColumnId: bookmark.columnId,
			targetBookmarkId: target.id,
			position: action === 'earlier' ? 'before' : 'after',
		});
		if (result?.ok) {
			await reload();
		} else {
			showStatus(result?.error || 'Could not reorder that bookmark.', true);
		}
	}

	async function moveBookmarkToColumn(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!moveBookmark) {
			return;
		}

		const result = await send('REORDER_BOOKMARK', {
			bookmarkId: moveBookmark.id,
			targetColumnId: moveBookmark.targetColumnId,
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not move that bookmark.', true);
			return;
		}

		setDialog(null);
		setMoveBookmark(null);
		await reload();
	}

	async function bookmarkAction(action: BookmarkAction, bookmark: Bookmark) {
		if (action === 'open') {
			globalThis.location.assign(bookmark.url);
			return;
		}

		if (action === 'open-new') {
			await chrome.tabs.create({url: bookmark.url});
			return;
		}

		if (action === 'edit') {
			openBookmarkEditor(bookmark);
			return;
		}

		if (action === 'move') {
			setMoveBookmark({...bookmark, targetColumnId: bookmark.columnId});
			setDialog('move');
			return;
		}

		if (action === 'copy') {
			try {
				await navigator.clipboard.writeText(bookmark.url);
			} catch {
				showStatus(
					'The URL could not be copied. Check clipboard permissions and try again.',
					true,
				);
			}

			return;
		}

		if (action === 'delete') {
			askConfirmation({
				title: `Delete “${bookmark.title}”?`,
				description: `This permanently removes the bookmark from ${PROJECT.name}.`,
				confirmLabel: 'Delete bookmark',
				async run() {
					const result = await send('DELETE_BOOKMARK', {
						bookmarkId: bookmark.id,
					});
					if (!result?.ok) {
						throw new Error(result?.error || 'Could not delete that bookmark.');
					}

					await reload();
				},
			});
			return;
		}

		if (action === 'earlier' || action === 'later') {
			await reorderBookmark(bookmark, action);
		}
	}

	async function addDroppedLinks(
		links: LinkEntry[],
		columnId: string,
		targetBookmarkId: string | null,
		position: InsertPosition,
	) {
		const result = await send('ADD_BOOKMARKS', {
			bookmarks: links,
			columnId,
			targetBookmarkId,
			position,
		});
		if (!result?.ok) {
			throw new Error(result?.error || 'Could not save the dropped links.');
		}

		await reload();
	}

	// Drag data must be read synchronously, before the first await.
	async function dropOnColumn(
		event: DragEvent<HTMLElement>,
		column: ColumnRef,
	) {
		const data = event.dataTransfer;
		const kind = dragPayloadKind(data.types);
		setColumnDropIndicator(null);
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

			const result = await send('REORDER_BOOKMARK', {
				bookmarkId,
				targetColumnId: column.id,
				targetBookmarkId,
				position,
			});
			if (result?.ok) {
				await reload();
			} else {
				showStatus(result?.error || 'Could not move that bookmark.', true);
			}

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

			askConfirmation({
				...sessionDropPrompt(session, column.name),
				confirmVariant: 'default',
				run: () =>
					addDroppedLinks(session.links, column.id, targetBookmarkId, position),
			});
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
		const urls = bookmarks
			.filter((bookmark) => bookmark.columnId === column.id)
			.map((bookmark) => bookmark.url);
		if (urls.length === 0) {
			showStatus(`“${column.name}” has no bookmarks to open.`, true);
			return;
		}

		const open = async () => {
			for (const url of urls) {
				await chrome.tabs.create({url, active: false});
			}
		};

		if (urls.length <= 10) {
			return void open().catch(() =>
				showStatus('Some bookmarks could not be opened.', true),
			);
		}

		askConfirmation({
			title: `Open ${urls.length} tabs?`,
			description: `Every bookmark in “${column.name}” opens in a background tab.`,
			confirmLabel: `Open ${urls.length} tabs`,
			confirmVariant: 'default',
			run: open,
		});
	}

	function openBookmarkBackup() {
		if (bookmarks.length === 0 && columns.length === 0) {
			showStatus('There are no bookmarks to back up.', true);
			return;
		}

		setBackupData({kind: 'bookmarks', columns, bookmarks});
	}

	// While loading, the page stays blank (just the themed background) so new tabs open without a flash of text.
	if (!state) {
		return (
			<main
				data-brand="tablodge"
				className="mx-auto min-h-screen max-w-6xl px-5 py-8"
			>
				{error && (
					<p role="alert" className="text-sm font-medium text-destructive">
						{error}{' '}
						<a href="newtab.html" className="underline">
							Reload
						</a>
					</p>
				)}
			</main>
		);
	}

	return (
		<main
			data-brand="tablodge"
			className="mx-auto max-w-[1440px] px-5 py-6 sm:px-8 sm:py-9"
		>
			<header className="mb-8 flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<Brand />
					<span className="h-5 w-px bg-border" aria-hidden="true" />
					<span className="text-sm font-normal text-muted-foreground">
						Dashboard
					</span>
				</div>
				<div className="flex items-center gap-1.5">
					{enabled && sessionsEnabled && (
						<Button size="sm" disabled={busy !== ''} onClick={saveWindow}>
							<PanelsTopLeft />
							{busy === 'save-window' ? 'Saving…' : 'Save this window'}
						</Button>
					)}
					<IconTooltip label="Help">
						<Button asChild variant="ghost" size="icon" className="h-8 w-8">
							<a href="help.html" aria-label="Help">
								<Info />
							</a>
						</Button>
					</IconTooltip>
					<IconTooltip label={`${PROJECT.name} settings`}>
						<Button asChild variant="ghost" size="icon" className="h-8 w-8">
							<a href="options.html" aria-label={`${PROJECT.name} settings`}>
								<Settings2 />
							</a>
						</Button>
					</IconTooltip>
				</div>
			</header>

			{!enabled && (
				<section className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-5">
					<div>
						<h1 className="text-xl font-bold">New tab is off</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							{PROJECT.name}’s local page is still installed by the browser.
						</p>
					</div>
					<div className="flex gap-2">
						<Button
							disabled={busy === 'default-page'}
							onClick={openDefaultNewTab}
						>
							{busy === 'default-page'
								? 'Opening…'
								: 'Open browser’s new-tab page'}
						</Button>
						<Button asChild variant="outline">
							<a href="options.html">
								<Settings2 />
								Settings
							</a>
						</Button>
					</div>
				</section>
			)}
			{enabled && !sessionsEnabled && (
				<section className="mb-6 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
					Sessions are disabled. Your saved data is retained in local storage.
				</section>
			)}

			{bookmarksEnabled && (
				<section
					id="bookmark-library"
					className="scroll-mt-6"
					aria-labelledby="bookmark-title"
				>
					<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
						<div className="flex items-center gap-2">
							<h2
								data-focus-fallback
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
								onChange={setBookmarkSearch}
							/>
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
							<DropdownMenu>
								<IconTooltip label="Import and back up bookmarks">
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											aria-label="Import and back up bookmarks"
										>
											<MoreHorizontal />
										</Button>
									</DropdownMenuTrigger>
								</IconTooltip>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onSelect={() => setImportOpen(true)}>
										<Upload className="h-4 w-4" />
										Import bookmarks…
									</DropdownMenuItem>
									<DropdownMenuItem onSelect={openBookmarkBackup}>
										<Download className="h-4 w-4" />
										Back up bookmarks…
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>
					{bookmarkSearch.trim() && filteredBookmarks.length === 0 ? (
						<EmptyState icon={Search} title="No bookmarks match">
							Search titles, web addresses, and domains.
						</EmptyState>
					) : (
						<div
							className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-3 ${stretchColumns ? 'items-stretch' : 'items-start'}`}
						>
							{columns.map((column, columnIndex) => (
								<BookmarkColumn
									key={column.id}
									column={column}
									index={columnIndex}
									columns={columns}
									bookmarks={filteredBookmarks.filter(
										(bookmark) => bookmark.columnId === column.id,
									)}
									allBookmarks={bookmarks}
									dropIndicator={
										columnDropIndicator?.columnId === column.id
											? columnDropIndicator
											: null
									}
									onAction={bookmarkAction}
									onAdd={() => openBookmarkEditor(null, column.id)}
									onOpenAll={() => openAllInColumn(column)}
									onEdit={() => openColumnEditor(column)}
									onDelete={() => deleteColumn(column)}
									onMove={(offset) => moveColumnBy(column, offset)}
									onPointerDown={(event) =>
										beginColumnPointerDrag(event, column.id)
									}
									onDropOver={setColumnDropIndicator}
									onDrop={(event) => dropOnColumn(event, column)}
									onDragStart={handleInternalDragStart}
									onDragEnd={() => {
										handleInternalDragEnd();
										setColumnDropIndicator(null);
									}}
								/>
							))}
							{(bookmarks.some(
								(bookmark) => bookmark.columnId === 'bookmark-unfiled',
							) ||
								columns.length === 0) && (
								<section
									data-column-id={UNFILED_COLUMN.id}
									aria-label="Unfiled bookmarks"
									className={`flex min-w-0 flex-col rounded-lg border border-border bg-card p-3 ${columnDropIndicator?.columnId === UNFILED_COLUMN.id ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
									onDragOver={(event) =>
										previewBookmarkDrop(
											event,
											UNFILED_COLUMN.id,
											setColumnDropIndicator,
											false,
										)
									}
									onDragLeave={(event) => {
										if (
											!event.currentTarget.contains(
												event.relatedTarget as Node | null,
											)
										) {
											setColumnDropIndicator(null);
										}
									}}
									onDrop={(event) => {
										if (!acceptsDrop(event, false)) {
											return;
										}

										event.preventDefault();
										void dropOnColumn(event, UNFILED_COLUMN);
									}}
									onDragStart={handleInternalDragStart}
									onDragEnd={() => {
										handleInternalDragEnd();
										setColumnDropIndicator(null);
									}}
								>
									<h3 className="mb-3 text-sm font-semibold">Unfiled</h3>
									{filteredBookmarks.some(
										(bookmark) => bookmark.columnId === 'bookmark-unfiled',
									) ? (
										<div className="space-y-1">
											{filteredBookmarks
												.filter(
													(bookmark) =>
														bookmark.columnId === 'bookmark-unfiled',
												)
												.map((bookmark) => {
													const drop =
														columnDropIndicator?.columnId ===
															UNFILED_COLUMN.id &&
														columnDropIndicator.targetBookmarkId === bookmark.id
															? columnDropIndicator
															: null;
													return (
														<BookmarkCard
															key={bookmark.id}
															bookmark={bookmark}
															index={0}
															count={0}
															dropBefore={drop?.position === 'before'}
															dropAfter={drop?.position === 'after'}
															dropActive={Boolean(drop)}
															onAction={bookmarkAction}
														/>
													);
												})}
										</div>
									) : (
										<p className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
											No columns yet. New bookmarks will be kept here until you
											add a column.
										</p>
									)}
								</section>
							)}
						</div>
					)}
					{bookmarks.length === 0 && (
						<div className="mt-4 rounded-md border border-dashed border-border px-4 py-3 text-center text-xs text-muted-foreground">
							Tip: drag a link from your browser onto a column to save it.
						</div>
					)}
				</section>
			)}

			{enabled && sessionsEnabled && (
				<section id="sessions" className="mt-10 border-t border-border pt-8">
					<SessionManager embedded initialQuery={initialQuery} />
				</section>
			)}
			<StatusLine status={error ? {message: error, error: true} : status} />

			<ConfirmationDialog
				open={Boolean(confirmation)}
				title={confirmation?.title}
				description={confirmation?.description}
				confirmLabel={confirmation?.confirmLabel}
				confirmVariant={confirmation?.confirmVariant}
				busy={Boolean(confirmation?.busy)}
				restoreFocusTo={confirmFocusRef.current}
				onOpenChange={(open) => !open && setConfirmation(null)}
				onConfirm={runConfirmation}
			/>
			<ColumnDeletionDialog
				deletion={columnDeletion}
				open={columnDeletionOpen}
				restoreFocusTo={confirmFocusRef.current}
				onOpenChange={setColumnDeletionOpen}
				onChange={(patch) =>
					setColumnDeletion((current) =>
						current ? {...current, ...patch} : current,
					)
				}
				onConfirm={confirmDeleteColumn}
			/>
			<BackupDialog
				data={backupData}
				open={Boolean(backupData)}
				showStatus={showStatus}
				onOpenChange={(open) => !open && setBackupData(null)}
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
								{bookmarkEdit?.id ? 'Edit bookmark' : 'Add bookmark'}
							</DialogTitle>
							<DialogDescription>
								Save a web link to a local column.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<div className="space-y-1.5">
								<Label htmlFor="bookmark-title">Title</Label>
								<Input
									required
									id="bookmark-title"
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
							<div className="space-y-1.5">
								<Label htmlFor="bookmark-column">Column</Label>
								<Select
									value={
										bookmarkEdit?.columnId ||
										columns[0]?.id ||
										'bookmark-unfiled'
									}
									onValueChange={(value) =>
										setBookmarkEdit((old) => old && {...old, columnId: value})
									}
								>
									<SelectTrigger id="bookmark-column">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{columns.map((column) => (
											<SelectItem key={column.id} value={column.id}>
												{column.name}
											</SelectItem>
										))}
										<SelectItem value="bookmark-unfiled">Unfiled</SelectItem>
										<SelectItem value={NEW_COLUMN}>New column…</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{bookmarkEdit?.columnId === NEW_COLUMN && (
								<div className="space-y-1.5">
									<Label htmlFor="bookmark-new-column">New column name</Label>
									<Input
										required
										id="bookmark-new-column"
										maxLength={60}
										placeholder="Reading list"
										data-autofocus=""
										value={bookmarkEdit.newColumnName || ''}
										onChange={(e) =>
											setBookmarkEdit(
												(old) => old && {...old, newColumnName: e.target.value},
											)
										}
									/>
								</div>
							)}
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setDialog(null)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={busy === 'bookmark-save'}>
								{bookmarkEdit?.columnId === NEW_COLUMN
									? 'Create column and save'
									: bookmarkEdit?.id
										? 'Save changes'
										: 'Save bookmark'}
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
								{columnEdit?.id ? 'Rename column' : 'Add bookmark column'}
							</DialogTitle>
							<DialogDescription>
								Choose a name for this bookmark column.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<div className="space-y-1.5">
								<Label htmlFor="column-name">Column name</Label>
								<Input
									required
									autoFocus
									id="column-name"
									maxLength={60}
									value={columnEdit?.name || ''}
									onChange={(e) =>
										setColumnEdit(
											(old) => old && {...old, name: e.target.value},
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
								{columnEdit?.id ? 'Save name' : 'Add column'}
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
							<DialogTitle>Move bookmark</DialogTitle>
							<DialogDescription>
								Move “{moveBookmark?.title}” to another column. It goes to the
								end of that column.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<div className="space-y-1.5">
								<Label htmlFor="move-bookmark-column">Column</Label>
								<Select
									value={moveBookmark?.targetColumnId || columns[0]?.id}
									onValueChange={(value) =>
										setMoveBookmark(
											(old) => old && {...old, targetColumnId: value},
										)
									}
								>
									<SelectTrigger id="move-bookmark-column">
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
							<Button type="submit">Move bookmark</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</main>
	);
}

type ColumnDeletionDialogProps = {
	deletion: ColumnDeletion | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChange: (patch: Partial<ColumnDeletion>) => void;
	onConfirm: () => void;
	restoreFocusTo: HTMLElement | null;
};

// A destructive confirmation with choices: where the column's bookmarks go, or delete them too.
function ColumnDeletionDialog({
	deletion,
	open,
	onOpenChange,
	onChange,
	onConfirm,
	restoreFocusTo,
}: ColumnDeletionDialogProps) {
	const name = deletion?.column.name.trim() || '';
	const count = deletion?.count || 0;
	const remaining = deletion?.remaining || [];
	const discard = Boolean(deletion?.discard && count);
	const moving = count > 0 && !discard && remaining.length > 0;
	const description = count
		? discard
			? `The ${bookmarkCount(count)} in this column will be deleted permanently.`
			: remaining.length > 0
				? `Move ${count === 1 ? 'its bookmark' : `its ${bookmarkCount(count)}`} to another column before deleting this one.`
				: `${count === 1 ? 'Its bookmark' : `Its ${bookmarkCount(count)}`} will remain visible in Unfiled.`
		: 'This column contains no bookmarks.';
	return (
		<ConfirmationDialog
			open={open}
			title={name ? `Delete “${name}”?` : 'Delete this column?'}
			description={description}
			confirmLabel={
				discard ? `Delete column and ${bookmarkCount(count)}` : 'Delete column'
			}
			confirmDisabled={moving && !deletion?.targetColumnId}
			restoreFocusTo={restoreFocusTo}
			onOpenChange={onOpenChange}
			onConfirm={onConfirm}
		>
			{count > 0 && (
				<>
					{moving && (
						<div className="space-y-1.5">
							<Label htmlFor="column-delete-target">Move bookmarks to</Label>
							<Select
								value={deletion?.targetColumnId || ''}
								onValueChange={(value) => onChange({targetColumnId: value})}
							>
								<SelectTrigger id="column-delete-target" data-autofocus="">
									<SelectValue placeholder="Choose a column" />
								</SelectTrigger>
								<SelectContent>
									{remaining.map((entry) => (
										<SelectItem key={entry.id} value={entry.id}>
											{entry.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
					<div className="flex items-center gap-2.5">
						<Checkbox
							id="column-delete-discard"
							checked={discard}
							onCheckedChange={(checked) =>
								onChange({discard: checked === true})
							}
						/>
						<Label
							htmlFor="column-delete-discard"
							className="cursor-pointer font-normal"
						>
							Don’t keep the bookmarks
						</Label>
					</div>
				</>
			)}
		</ConfirmationDialog>
	);
}

function parseDraggedBookmark(
	dataTransfer: DataTransfer | null,
): LinkEntry | null {
	if (!dataTransfer) {
		return null;
	}

	let raw = '';
	let title = '';
	const mozUrl =
		dataTransfer.getData('text/x-moz-url') ||
		dataTransfer.getData('application/x-moz-url');
	if (mozUrl) {
		const [url, ...titleParts] = mozUrl.split(/\r?\n/);
		raw = url;
		title = titleParts.join(' ').trim();
	}

	raw ||=
		dataTransfer
			.getData('text/uri-list')
			.split(/\r?\n/)
			.find((line) => line.trim() && !line.trimStart().startsWith('#')) || '';
	if (!raw) {
		const html = dataTransfer.getData('text/html');
		if (html) {
			const anchor = new DOMParser()
				.parseFromString(html, 'text/html')
				.querySelector('a[href]');
			raw = anchor?.getAttribute('href') || '';
			title ||= anchor?.textContent?.trim() || '';
		}
	}

	raw ||= dataTransfer.getData('text/plain').trim();
	const url = safeWebUrl(raw.trim());
	if (!url) {
		return null;
	}

	return {
		url,
		title: (title || domainName(url))
			.replaceAll(/[\u0000-\u001F\u007F]/g, ' ')
			.trim()
			.slice(0, 500),
	};
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

function handleInternalDragStart(event: DragEvent<HTMLElement>) {
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
		event.dataTransfer.setData(BOOKMARK_DRAG_TYPE, card.dataset.bookmarkId!);
		event.dataTransfer.effectAllowed = 'move';
	}
}

function handleInternalDragEnd() {
	document
		.querySelectorAll('.is-dragging')
		.forEach((node) => node.classList.remove('is-dragging'));
}

type BookmarkColumnProps = {
	column: BookmarkColumnData;
	index: number;
	columns: BookmarkColumnData[];
	bookmarks: Bookmark[];
	allBookmarks: Bookmark[];
	onAction: OnBookmarkAction;
	onAdd: () => void;
	onOpenAll: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onMove: (offset: number) => void;
	onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	dropIndicator: DropIndicator | null;
	onDropOver: (indicator: DropIndicator | null) => void;
	onDrop: (event: DragEvent<HTMLElement>) => Promise<void>;
	onDragStart: (event: DragEvent<HTMLElement>) => void;
	onDragEnd: () => void;
};

function BookmarkColumn({
	column,
	index,
	columns,
	bookmarks,
	allBookmarks,
	onAction,
	onAdd,
	onOpenAll,
	onEdit,
	onDelete,
	onMove,
	onPointerDown,
	dropIndicator,
	onDropOver,
	onDrop,
	onDragStart,
	onDragEnd,
}: BookmarkColumnProps) {
	const siblings = allBookmarks.filter(
		(bookmark) => bookmark.columnId === column.id,
	);
	function leaveColumn(event: DragEvent<HTMLElement>) {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
			onDropOver(null);
		}
	}

	const bookmarkDrop =
		dropIndicator && dropIndicator.kind !== 'column' ? dropIndicator : null;
	const showEndInsertion = bookmarkDrop && !bookmarkDrop.targetBookmarkId;
	return (
		<section
			data-column-id={column.id}
			className={`bookmark-column relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card ${dropIndicator ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
			aria-label={`${column.name} bookmark column`}
			onDragOver={(event) =>
				previewBookmarkDrop(event, column.id, onDropOver, true)
			}
			onDragLeave={leaveColumn}
			onDrop={(event) => {
				if (!acceptsDrop(event, true)) {
					return;
				}

				event.preventDefault();
				void onDrop(event);
			}}
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
		>
			{dropIndicator?.kind === 'column' && (
				<span
					aria-hidden="true"
					className={`pointer-events-none absolute inset-y-1 z-20 w-1 rounded-full bg-primary ${dropIndicator.position === 'before' ? 'left-0' : 'right-0'}`}
				/>
			)}
			<header className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-2">
				<IconTooltip label={`Drag to reorder ${column.name} column`}>
					<button
						draggable
						type="button"
						data-drag-column={column.id}
						aria-label={`Drag to reorder ${column.name} column`}
						className="grid h-8 w-7 touch-none cursor-grab place-items-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
						onPointerDown={onPointerDown}
					>
						<GripVertical className="h-4 w-4" />
					</button>
				</IconTooltip>
				<h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
					{column.name}
				</h3>
				<Badge>{siblings.length}</Badge>
				<DropdownMenu>
					<IconTooltip label={`Options for ${column.name} column`}>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label={`Options for ${column.name} column`}
							>
								<MoreHorizontal className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
					</IconTooltip>
					<DropdownMenuContent align="end">
						<DropdownMenuItem
							disabled={siblings.length === 0}
							onSelect={onOpenAll}
						>
							<SquareArrowOutUpRight className="h-4 w-4" />
							Open all in new tabs
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={onAdd}>
							<BookmarkPlus className="h-4 w-4" />
							Add bookmark here
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={onEdit}>
							<Pencil className="h-4 w-4" />
							Rename column
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onSelect={onDelete}
						>
							<Trash2 className="h-4 w-4" />
							Delete column
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem disabled={index <= 0} onSelect={() => onMove(-1)}>
							<ArrowLeft className="h-4 w-4" />
							Move column left
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={index >= columns.length - 1}
							onSelect={() => onMove(1)}
						>
							<ArrowRight className="h-4 w-4" />
							Move column right
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</header>
			<div className="flex min-h-24 flex-1 flex-col p-2">
				{bookmarks.length > 0 ? (
					<div className="space-y-1">
						{bookmarks.map((bookmark) => (
							<BookmarkCard
								key={bookmark.id}
								bookmark={bookmark}
								index={siblings.findIndex((entry) => entry.id === bookmark.id)}
								count={siblings.length}
								dropBefore={
									bookmarkDrop?.targetBookmarkId === bookmark.id &&
									bookmarkDrop.position === 'before'
								}
								dropAfter={
									bookmarkDrop?.targetBookmarkId === bookmark.id &&
									bookmarkDrop.position === 'after'
								}
								dropActive={bookmarkDrop?.targetBookmarkId === bookmark.id}
								onAction={onAction}
							/>
						))}
					</div>
				) : (
					<p className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
						{allBookmarks.some((bookmark) => bookmark.columnId === column.id)
							? 'No matching links.'
							: 'Drop a bookmark here, or add one from this column’s menu.'}
					</p>
				)}
				{showEndInsertion && (
					<span
						aria-hidden="true"
						className="pointer-events-none block h-0.5 rounded-full bg-primary"
					/>
				)}
			</div>
		</section>
	);
}

type BookmarkCardProps = {
	bookmark: Bookmark;
	index: number;
	count: number;
	onAction: OnBookmarkAction;
	dropBefore?: boolean;
	dropAfter?: boolean;
	dropActive?: boolean;
};

function BookmarkCard({
	bookmark,
	index,
	count,
	onAction,
	dropBefore = false,
	dropAfter = false,
	dropActive = false,
}: BookmarkCardProps) {
	const contextItems = (
		<>
			<ContextMenuItem onSelect={() => onAction('open', bookmark)}>
				<ExternalLink className="h-4 w-4" />
				Open
			</ContextMenuItem>
			<ContextMenuItem onSelect={() => onAction('open-new', bookmark)}>
				<Link2 className="h-4 w-4" />
				Open in new tab
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem onSelect={() => onAction('edit', bookmark)}>
				<Pencil className="h-4 w-4" />
				Edit
			</ContextMenuItem>
			<ContextMenuItem onSelect={() => onAction('copy', bookmark)}>
				<Copy className="h-4 w-4" />
				Copy URL
			</ContextMenuItem>
			<ContextMenuItem onSelect={() => onAction('move', bookmark)}>
				<FolderInput className="h-4 w-4" />
				Move to…
			</ContextMenuItem>
			<ContextMenuItem
				disabled={index <= 0}
				onSelect={() => onAction('earlier', bookmark)}
			>
				<ArrowUp className="h-4 w-4" />
				Move earlier
			</ContextMenuItem>
			<ContextMenuItem
				disabled={index >= count - 1}
				onSelect={() => onAction('later', bookmark)}
			>
				<ArrowDown className="h-4 w-4" />
				Move later
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem
				className="text-destructive focus:text-destructive"
				onSelect={() => onAction('delete', bookmark)}
			>
				<Trash2 className="h-4 w-4" />
				Delete
			</ContextMenuItem>
		</>
	);
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					data-bookmark-id={bookmark.id}
					data-column-id={bookmark.columnId}
					className="bookmark-drop-row relative"
				>
					<span
						aria-hidden="true"
						className={`pointer-events-none absolute -top-1 left-2 right-2 z-10 h-0.5 rounded-full bg-primary ${dropBefore ? 'block' : 'hidden'}`}
					/>
					<article
						draggable
						className={`group flex min-w-0 items-center gap-2 rounded-md p-2 transition-colors hover:bg-muted/75 ${dropActive ? 'bg-primary/10' : ''}`}
					>
						<a
							href={bookmark.url}
							target="_blank"
							rel="noopener noreferrer"
							title={bookmark.title}
							className="flex min-w-0 flex-1 items-start gap-2.5"
						>
							<span className="relative grid h-7 w-7 shrink-0 place-items-center self-start overflow-hidden rounded-md bg-muted text-xs font-bold text-muted-foreground">
								{(domainName(bookmark.url)[0] || '↗').toUpperCase()}
								<img
									src={localFaviconUrl(bookmark.url)}
									alt=""
									className="absolute inset-0 h-full w-full bg-background object-contain"
									onError={(event) => event.currentTarget.remove()}
								/>
							</span>
							<span className="min-w-0 flex-1">
								<strong className="block truncate text-[13px] font-semibold group-hover:text-primary">
									{bookmark.title || domainName(bookmark.url)}
								</strong>
								<small className="mt-0.5 block break-all text-[11px] leading-4 text-muted-foreground">
									{bookmark.url}
								</small>
							</span>
						</a>
						<DropdownMenu>
							<IconTooltip label={`Actions for ${bookmark.title}`}>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8 shrink-0 opacity-70 group-hover:opacity-100"
										aria-label={`Actions for ${bookmark.title}`}
									>
										<MoreHorizontal className="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
							</IconTooltip>
							<DropdownMenuContent align="end">
								{dropdownItems(bookmark, index, count, onAction)}
							</DropdownMenuContent>
						</DropdownMenu>
					</article>
					<span
						aria-hidden="true"
						className={`pointer-events-none absolute -bottom-1 left-2 right-2 z-10 h-0.5 rounded-full bg-primary ${dropAfter ? 'block' : 'hidden'}`}
					/>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>{contextItems}</ContextMenuContent>
		</ContextMenu>
	);
}

function dropdownItems(
	bookmark: Bookmark,
	index: number,
	count: number,
	onAction: OnBookmarkAction,
) {
	return (
		<>
			<DropdownMenuItem onSelect={() => onAction('open', bookmark)}>
				<ExternalLink className="h-4 w-4" />
				Open
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => onAction('open-new', bookmark)}>
				<Link2 className="h-4 w-4" />
				Open in new tab
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem onSelect={() => onAction('edit', bookmark)}>
				<Pencil className="h-4 w-4" />
				Edit
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => onAction('copy', bookmark)}>
				<Copy className="h-4 w-4" />
				Copy URL
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => onAction('move', bookmark)}>
				<FolderInput className="h-4 w-4" />
				Move to…
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={index <= 0}
				onSelect={() => onAction('earlier', bookmark)}
			>
				<ArrowUp className="h-4 w-4" />
				Move earlier
			</DropdownMenuItem>
			<DropdownMenuItem
				disabled={index >= count - 1}
				onSelect={() => onAction('later', bookmark)}
			>
				<ArrowDown className="h-4 w-4" />
				Move later
			</DropdownMenuItem>
			<DropdownMenuSeparator />
			<DropdownMenuItem
				className="text-destructive focus:text-destructive"
				onSelect={() => onAction('delete', bookmark)}
			>
				<Trash2 className="h-4 w-4" />
				Delete
			</DropdownMenuItem>
		</>
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<TooltipProvider>
			<NewTab />
		</TooltipProvider>
	</ThemeProvider>,
);
