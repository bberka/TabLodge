import {useEffect, useMemo, useRef, useState, type SyntheticEvent} from 'react';
import {
	Archive,
	ArrowDown,
	ArrowDownUp,
	ArrowUp,
	BookmarkPlus,
	ChevronRight,
	Columns2,
	Copy,
	Download,
	Edit3,
	FolderPlus,
	LockKeyhole,
	MoreHorizontal,
	MoreVertical,
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
	EmptyState,
	LoadingLine,
	StatusLine,
	TabLodgeMark,
	send,
	splitNote,
	useStatus,
	useTabLodgeState,
} from './common';
import {BackupDialog, ImportDialog, downloadFile} from './data-transfer';
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
	RestoreMode,
	RestoreTarget,
	SavedTab as SavedTabRecord,
	Session,
	SessionFields,
	SessionSort,
	Settings,
	TabLodgeMessages,
} from './types';
import {PROJECT} from './project';

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
	confirmLabel: string;
	run: () => Promise<void>;
	busy?: boolean;
};
type FolderDialog = {
	mode: 'create' | 'rename';
	folder?: Folder;
};
type DialogState = 'bookmark' | 'details' | FolderDialog | null;
type BookmarkDraft = Partial<SavedTabRecord> & {columnId?: string};

const messageOf = (reason: unknown) =>
	(reason as {message?: string} | null | undefined)?.message;

const ALL = 'all';
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

const safeFilename = (value?: string) =>
	String(value || 'session')
		.toLowerCase()
		.replaceAll(/[^0-9a-z]+/g, '-')
		.replaceAll(/^-|-$/g, '') || 'session';
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
	const groups = state?.groups || NO_SESSIONS;
	const folders = state?.folders || NO_FOLDERS;
	const settings: Partial<Settings> = state?.settings || {};
	const folderDialog = typeof dialog === 'object' ? dialog : null;
	const sessionsEnabled = settings.sessionsEnabled !== false;
	const expandAll = settings.expandSessionsByDefault === true;
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

	function shareHtml(exportGroups: Session[]) {
		const esc = (v: unknown) =>
			String(v ?? '').replaceAll(
				/["&'<>]/g,
				(c) =>
					(
						({
							'&': '&amp;',
							'<': '&lt;',
							'>': '&gt;',
							'"': '&quot;',
							"'": '&#39;',
						}) as Record<string, string>
					)[c],
			);
		const title =
			exportGroups.length === 1
				? exportGroups[0].name
				: `Shared ${PROJECT.name} sessions`;
		// Only complete pairs are marked: a share of selected tabs may hold just one half of a split view.
		const splitTabs = new Set(
			exportGroups.flatMap((group) =>
				tabRuns(group.tabs)
					.filter((run) => run.length === 2)
					.flat(),
			),
		);
		const parts = exportGroups
			.map(
				(group) =>
					`<article><header><div><h2>${esc(group.name)}</h2><p>Saved ${esc(dateText(group.createdAt))}</p></div><span>${group.tabs.length} ${group.tabs.length === 1 ? 'tab' : 'tabs'}</span></header>${group.description ? `<p>${esc(group.description)}</p>` : ''}${group.notes ? `<p class="notes">${esc(group.notes)}</p>` : ''}<ol>${group.tabs.map((tab) => `<li><a href="${esc(tab.url)}" target="_blank" rel="noopener noreferrer">${esc(tab.title || tab.url)}</a><small>${esc(tab.url)}${tab.pinned ? ' · Pinned' : ''}${tab.nativeGroup?.title ? ` · ${esc(tab.nativeGroup.title)}` : ''}${splitTabs.has(tab) ? ` · Split view, ${tab.split?.position === 0 ? 'left' : 'right'}` : ''}</small></li>`).join('')}</ol></article>`,
			)
			.join('');
		return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f6fa;color:#222737;font:14px/1.55 system-ui,sans-serif}main{width:min(780px,calc(100% - 32px));margin:40px auto}h1{font-size:30px;letter-spacing:-1px}article{margin:14px 0;border:1px solid #e0e3ed;border-radius:15px;background:#fff;overflow:hidden}header{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid #e0e3ed}h2{margin:0;font-size:18px}header p,header span,small{color:#686f84;font-size:12px}p,ol{margin:16px 20px}p,h1,h2{overflow-wrap:anywhere}header>div{min-width:0}ol{padding-left:22px}li{padding:10px 0;border-top:1px solid #eee}a{display:block;color:#5c54c3;font-weight:650;overflow-wrap:anywhere}small{display:block;margin-top:4px;overflow-wrap:anywhere}.notes{white-space:pre-wrap}</style><main><h1>${esc(title)}</h1><p>Shared from ${PROJECT.name} · ${exportGroups.reduce((sum, g) => sum + g.tabs.length, 0)} saved tabs</p>${parts}</main></html>`;
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
	) {
		const restoreMode =
			requestedMode ||
			(event?.altKey
				? 'archive'
				: event?.ctrlKey || event?.metaKey
					? 'keep'
					: undefined);
		const restoreTarget = event?.shiftKey ? 'always-new-window' : undefined;
		setBusy(`restore:${group.id}`);
		const result = await send('RESTORE_GROUP', {
			groupId: group.id,
			forceRemove,
			restoreMode,
			restoreTarget,
		});
		setBusy('');
		if (!result?.ok) {
			showStatus(result?.error || `Could not restore “${group.name}”.`, true);
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

	function deleteGroup(group: Session) {
		askConfirmation({
			title: `Delete “${group.name}”?`,
			description: `This permanently removes the saved session and its ${group.tabs.length} saved ${group.tabs.length === 1 ? 'tab' : 'tabs'}. It does not close browser tabs.`,
			confirmLabel: 'Delete session',
			async run() {
				const result = await send('DELETE_GROUP', {groupId: group.id});
				if (!result?.ok) {
					throw new Error(result?.error || 'Could not delete this session.');
				}

				await reload();
			},
		});
	}

	function deleteSavedTab(group: Session, tab: SavedTabRecord) {
		const title = tab.title || tab.url;
		askConfirmation({
			title: `Remove “${title}”?`,
			description:
				'This removes the saved link from this session. It does not close the browser tab.',
			confirmLabel: 'Remove saved tab',
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
		const fields: SessionFields = {
			name: String(form.get('name') || ''),
			description: String(form.get('description') || ''),
			notes: String(form.get('notes') || ''),
			folderId: String(form.get('folderId') || 'unfiled'),
			restoreTarget:
				form.get('restoreTarget') === 'default'
					? null
					: ((String(form.get('restoreTarget') || '') ||
							null) as RestoreTarget | null),
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
				? await send('UPDATE_FOLDER', {folderId, name})
				: await send('CREATE_FOLDER', {name});
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
			title: `Delete “${folder.name}”?`,
			description:
				'Sessions in this folder will move to Unfiled. Their saved tabs are preserved.',
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
						{[{id: ALL, name: 'All'}, ...folders].map((folder) => (
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
						))}
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
								<IconTooltip label={`Rename ${selectedFolder.name}`}>
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8"
										aria-label={`Rename ${selectedFolder.name}`}
										onClick={() =>
											setDialog({mode: 'rename', folder: selectedFolder})
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
								<Button size="sm" onClick={() => openBackup('selected')}>
									<Download className="h-4 w-4" />
									Export selected…
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										downloadFile(
											shareHtml(selectedGroups()),
											'text/html;charset=utf-8',
											`${safeFilename(`${PROJECT.name}-shared-tabs`)}.html`,
										);
									}}
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
						<div className="space-y-2" aria-live="polite">
							{visibleGroups.map((group, index) => (
								<GroupCard
									key={group.id}
									group={group}
									folders={folders}
									settings={settings}
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
									downloadShare={() => {
										downloadFile(
											shareHtml([group]),
											'text/html;charset=utf-8',
											`${safeFilename(group.name)}.html`,
										);
									}}
									onExpanded={(next) => setGroupOpen(group.id, next)}
									onRestore={(event) => restoreGroup(group, false, event)}
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
			/>
			<BackupDialog
				data={backupData}
				open={Boolean(backupData)}
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
							<DialogTitle>Edit saved tab</DialogTitle>
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
							<Button type="submit">Save tab</Button>
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
							<DialogTitle>Bookmark saved tab</DialogTitle>
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
								Update this session’s name, notes, folder, and restore location.
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
							<div className="grid gap-4 sm:grid-cols-2">
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
								<div className="min-w-0 space-y-1.5">
									<Label htmlFor="group-restore-target">Restore location</Label>
									<Select
										name="restoreTarget"
										defaultValue={editingGroup?.restoreTarget || 'default'}
									>
										<SelectTrigger id="group-restore-target">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="default">
												Use Settings default
											</SelectItem>
											<SelectItem value="current-window">
												Current window
											</SelectItem>
											<SelectItem value="new-window-unless-only-tab">
												New window unless only tab
											</SelectItem>
											<SelectItem value="always-new-window">
												Always a new window
											</SelectItem>
										</SelectContent>
									</Select>
								</div>
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
							<Button type="submit">Save changes</Button>
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
								{folderDialog?.mode === 'rename'
									? 'Rename folder'
									: 'Create folder'}
							</DialogTitle>
							<DialogDescription>
								Keep related sessions organized together.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<div className="space-y-1.5">
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
									? 'Save folder'
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

function urlDisplay(url: string, mode = 'full') {
	return mode === 'none' ? null : url;
}

type GroupCardProps = {
	group: Session;
	folders: Folder[];
	settings: Partial<Settings>;
	isExpanded: boolean;
	onExpanded: (next: boolean) => void;
	onRestore: (event?: RestoreModifiers) => void;
	onRestoreMode: (mode: RestoreMode) => void;
	onForceRestore: () => void;
	onRestoreTab: (tab: SavedTabRecord, event?: RestoreModifiers) => void;
	onUpdateGroup: (fields: SessionFields) => void;
	onCopy: () => void;
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
	displayMode?: string;
	reorderEnabled: boolean;
	index: number;
	count: number;
	bookmarksEnabled: boolean;
	onBookmark: (tab: SavedTabRecord) => void;
	downloadShare: () => void;
};

function GroupCard({
	group,
	folders,
	settings,
	isExpanded,
	onExpanded,
	onRestore,
	onRestoreMode,
	onForceRestore,
	onRestoreTab,
	onUpdateGroup,
	onCopy,
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
	downloadShare,
}: GroupCardProps) {
	const folderName = folders.find(
		(folder) => folder.id === group.folderId,
	)?.name;
	const previewTabs = group.tabs.slice(0, 6);
	return (
		<article
			id={`session-${group.id}`}
			className={`group/session overflow-hidden rounded-xl border bg-card transition-shadow ${isExpanded ? 'border-primary/30 shadow-sm' : 'border-border hover:border-primary/25'} ${group.archived ? 'opacity-75 grayscale' : ''}`}
			style={group.archived ? ARCHIVED_STYLE : undefined}
			aria-label={`Session ${group.name}`}
		>
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
					onDragStart={(event) =>
						applyLinkDrag(event.dataTransfer, group.tabs, group.name, group.id)
					}
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
				{!isExpanded && (
					<span
						className="hidden shrink-0 items-center -space-x-1.5 md:flex"
						aria-hidden="true"
					>
						{previewTabs.map((tab) => (
							<Favicon
								key={tab.id}
								url={tab.url}
								label={tab.title}
								className="h-6 w-6 rounded-full ring-2 ring-card"
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
					<span className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/session:opacity-100">
						<IconTooltip
							label={group.locked ? 'Unlock session' : 'Lock session'}
						>
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8 text-muted-foreground"
								aria-label={
									group.locked ? `Unlock ${group.name}` : `Lock ${group.name}`
								}
								onClick={() => onUpdateGroup({locked: !group.locked})}
							>
								{group.locked ? <UnlockKeyhole /> : <LockKeyhole />}
							</Button>
						</IconTooltip>
						<IconTooltip
							label={group.archived ? 'Unarchive session' : 'Archive session'}
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
					<Button
						size="sm"
						variant={isExpanded ? 'default' : 'secondary'}
						onClick={onRestore}
					>
						<RotateCcw />
						<span className="hidden sm:inline">Restore</span>
					</Button>
					<DropdownMenu>
						<IconTooltip label="More actions">
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8"
									aria-label={`More actions for ${group.name}`}
								>
									<MoreVertical />
								</Button>
							</DropdownMenuTrigger>
						</IconTooltip>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onSelect={() => onRestoreMode('keep')}>
								<RotateCcw className="h-4 w-4" />
								Restore &amp; keep
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={group.locked}
								onSelect={onForceRestore}
							>
								<Trash2 className="h-4 w-4" />
								Restore &amp; remove
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={() => onRestoreMode('archive')}>
								<Archive className="h-4 w-4" />
								Restore &amp; archive
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={onCopy}>
								<Copy className="h-4 w-4" />
								Copy session links
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={downloadShare}>
								<Share2 className="h-4 w-4" />
								Share HTML
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={onEdit}>
								<Edit3 className="h-4 w-4" />
								Edit details
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								disabled={!reorderEnabled || index === 0}
								onSelect={() => onReorder('up')}
							>
								<ArrowUp className="h-4 w-4" />
								Move up
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={!reorderEnabled || index === count - 1}
								onSelect={() => onReorder('down')}
							>
								<ArrowDown className="h-4 w-4" />
								Move down
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="text-destructive focus:text-destructive"
								onSelect={onDelete}
							>
								<Trash2 className="h-4 w-4" />
								Delete session
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{isExpanded && (
				<div className="border-t border-border">
					{(group.description || group.notes) && (
						<div className="min-w-0 border-b border-border bg-muted/30 px-4 py-2.5 sm:pl-14">
							{group.description && (
								<p className="min-w-0 whitespace-pre-wrap text-sm font-medium [overflow-wrap:anywhere]">
									{group.description}
								</p>
							)}
							{group.notes && (
								<p className="mt-0.5 min-w-0 max-w-2xl whitespace-pre-wrap text-xs text-muted-foreground [overflow-wrap:anywhere]">
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
									splitBadge={splitBadge}
									selected={selected.has(tabKey(group.id, tab.id))}
									selectionActive={selectionActive}
									showBookmark={bookmarksEnabled}
									displayMode={displayMode}
									onSelect={(checked, event) =>
										onSelect(tabKey(group.id, tab.id), checked, event)
									}
									onRestore={(event) => onRestoreTab(tab, event)}
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
	return (
		<span
			className={`relative grid shrink-0 place-items-center overflow-hidden bg-muted text-[10px] font-semibold text-muted-foreground ${className}`}
		>
			{(String(label || hostFor(url)).trim()[0] || '↗').toUpperCase()}
			<img
				className="absolute inset-0 h-full w-full bg-card object-contain p-0.5"
				src={faviconUrl(url)}
				alt=""
				onError={(event) => event.currentTarget.remove()}
			/>
		</span>
	);
}

type SavedTabProps = {
	tab: SavedTabRecord;
	group: Session;
	selected: boolean;
	selectionActive: boolean;
	onSelect: (checked: boolean, event: SelectionModifiers) => void;
	onRestore: (event: RestoreModifiers) => void;
	onBookmark: () => void;
	onDelete: () => void;
	onEditTab: () => void;
	onToggleArchived: () => void;
	showBookmark: boolean;
	displayMode?: string;
	/**
	Shown on the first tab of a split view pair.
	*/
	splitBadge?: boolean;
};

function SavedTab({
	tab,
	group,
	selected,
	selectionActive,
	onSelect,
	onRestore,
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
	const action = 'h-7 w-7 text-muted-foreground hover:text-foreground';
	return (
		<li
			draggable
			style={tab.archived ? ARCHIVED_STYLE : undefined}
			className={`group/tab flex min-w-0 items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60 ${selected ? 'bg-primary/[.07]' : ''} ${tab.archived ? 'opacity-60 grayscale' : ''}`}
			onDragStart={(event) => applyLinkDrag(event.dataTransfer, [tab])}
		>
			<span
				className={`mt-1.5 flex w-4 shrink-0 justify-center transition-opacity ${selected || selectionActive ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover/tab:opacity-100'}`}
			>
				<Checkbox
					checked={selected}
					aria-label={`Select ${label} from ${group.name} for export`}
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
				className="mt-0.5 h-6 w-6 rounded-md"
			/>
			<div className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-1.5">
					<a
						className="truncate text-[13px] font-semibold hover:text-primary hover:underline"
						href={tab.url}
						target="_blank"
						rel="noopener noreferrer"
						title={label}
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
					<p className="mt-0.5 break-all text-[11px] leading-4 text-muted-foreground">
						{displayUrl}
					</p>
				)}
				{tab.notes && (
					<p className="mt-1 whitespace-pre-wrap text-xs italic text-muted-foreground [overflow-wrap:anywhere]">
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
				<IconTooltip label="Edit title and notes">
					<Button
						variant="ghost"
						size="icon"
						className={action}
						aria-label={`Edit title and notes for ${label}`}
						onClick={onEditTab}
					>
						<StickyNote />
					</Button>
				</IconTooltip>
				{tab.archived && (
					<IconTooltip label="Unarchive tab">
						<Button
							variant="ghost"
							size="icon"
							className={action}
							aria-label={`Unarchive ${label}`}
							onClick={onToggleArchived}
						>
							<Archive />
						</Button>
					</IconTooltip>
				)}
				{showBookmark && (
					<IconTooltip label="Bookmark tab">
						<Button
							variant="ghost"
							size="icon"
							className={action}
							aria-label={`Bookmark ${label}`}
							onClick={onBookmark}
						>
							<BookmarkPlus />
						</Button>
					</IconTooltip>
				)}
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
			</div>
		</li>
	);
}
