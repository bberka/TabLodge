// The backup (export), import and share dialogs, shared by the dashboard and Settings › Data.
// File formats live in the pure modules export-formats.ts, import-formats.ts and share-formats.ts.
//
// Share dialog API (used by the session manager and the bookmark board):
//   <ShareDialog open onOpenChange title="Shared sessions" groups={sessions} showStatus={showStatus} />
//     `groups` is any {name, tabs: {title, url}[]}[] (a Session[] fits as is). Optionally pass
//     `sources` ([{id, label, description?, groups}]) to let the user choose what to share.
//   Pages open it through useShareDialog in lazy-dialogs.tsx. The dialog offers: HTML page
//     (download), Markdown / plain links / rich text (copy to clipboard).
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type DragEvent,
	type ReactNode,
} from 'react';
import {
	ArrowLeft,
	Bookmark,
	CircleAlert,
	Archive,
	Download,
	FileJson,
	FileSpreadsheet,
	FileText,
	FileUp,
	Globe,
	Copy,
	Info,
	Link2,
	PanelsTopLeft,
	Upload,
} from 'lucide-react';
import {
	Badge,
	Button,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Label,
	RadioCard,
	RadioCardGroup,
	ScrollArea,
	SegmentedControl,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	useRetainedValue,
} from '../shared/ui';
import {downloadFile} from '../shared/download';
import {offerUndo} from './recovery-core';
import {messageOf, send, type ShowStatus} from './common';
import {writeClipboard} from './interaction-actions';
import {ColumnLabel} from './icon-label';
import {
	shareCounts,
	shareHtmlPage,
	shareLinks,
	shareMarkdown,
	sharePreview,
	shareRich,
	type ShareGroup,
	type ShareMethod,
} from './share-formats';
import {
	buildExport,
	exportCounts,
	exportFilename,
	dateStamp,
	type ExportData,
	type ExportFormat,
	type ExportKind,
} from './export-formats';
import {
	ImportFormatError,
	MAX_IMPORT_BYTES,
	bookmarkImportPayload,
	parseBookmarkTree,
	parseImportFile,
	previewImport,
	sessionImportPayload,
	type ImportKind,
	type ParsedImport,
} from './import-formats';
import type {
	DuplicateMode,
	ImportOptions,
	TabLodgeState,
	TitlePolicy,
} from './types';
import {PROJECT} from './project';
import {fileNamePrefix} from './backup-format';
import {
	FullBackupError,
	buildFullBackup,
	fullBackupFilename,
	looksLikeZip,
	readFullBackup,
	type FullBackupContents,
} from './full-backup';

const plural = (count: number, noun: string, many = `${noun}s`) =>
	`${count.toLocaleString()} ${count === 1 ? noun : many}`;

function KindLabel({kind}: {kind: 'sessions' | 'bookmarks'}) {
	const Icon = kind === 'bookmarks' ? Bookmark : PanelsTopLeft;
	return (
		<span className="inline-flex items-center justify-center gap-1.5">
			<Icon className="h-3.5 w-3.5" aria-hidden="true" />
			{kind === 'bookmarks' ? 'Bookmarks' : 'Sessions'}
		</span>
	);
}

const FORMAT_CHOICES: ReadonlyArray<{
	id: ExportFormat;
	title: string;
	icon: typeof FileJson;
	sessions: string;
	bookmarks: string;
}> = [
	{
		id: 'json',
		title: 'JSON backup',
		icon: FileJson,
		sessions:
			'Full backup you can restore here. Keeps folders, notes, split views, tab groups, and order.',
		bookmarks:
			'Full backup you can restore here. Keeps columns, order, and dates.',
	},
	{
		id: 'html',
		title: 'Browser bookmarks (HTML)',
		icon: Globe,
		sessions:
			'Imports into any browser. Each session becomes a folder; notes and split views are lost.',
		bookmarks: 'Imports into any browser. Each column becomes a folder.',
	},
	{
		id: 'csv',
		title: 'Spreadsheet (CSV)',
		icon: FileSpreadsheet,
		sessions:
			'Title, URL, session, folder, notes, and date per row. For analysis, not a full restore.',
		bookmarks:
			'Title, URL, column, and date per row. For analysis, not a full restore.',
	},
	{
		id: 'markdown',
		title: 'Markdown',
		icon: FileText,
		sessions: 'A readable list of links under each session’s name.',
		bookmarks: 'A readable list of links under each column’s name.',
	},
	{
		id: 'txt',
		title: 'Plain URL list',
		icon: Link2,
		sessions:
			'One web address per line. Titles and everything else are dropped.',
		bookmarks:
			'One web address per line. Titles and everything else are dropped.',
	},
];

/**
What a full backup ZIP holds, listed on the "Everything" choice instead of a format list (it has only one format).
*/
const FULL_BACKUP_CONTENTS = [
	'Sessions and folders',
	'Bookmarks and columns',
	'All settings and excluded sites',
	'Theme',
	'Crash snapshots and the trash bin',
];

const BACKUP_TITLES: Record<ExportKind, (count: number) => string> = {
	sessions: () => 'Back up sessions',
	bookmarks: () => 'Back up bookmarks',
	selected: (count) => `Export ${plural(count, 'selected tab')}`,
};

type BackupScope = 'everything' | 'sessions' | 'bookmarks';

function EverythingLabel() {
	return (
		<span className="inline-flex items-center justify-center gap-1.5">
			<Archive className="h-3.5 w-3.5" aria-hidden="true" />
			Everything
		</span>
	);
}

type BackupDialogProps = {
	/**
	What to export; the dialog keeps showing the last request while it closes.
	*/
	data: ExportData | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	showStatus: ShowStatus;
	/**
	When given (and both systems are on), a Bookmarks/Sessions switch lets the user change what is backed up.
	*/
	state?: TabLodgeState | null;
	/**
	Opens on this choice instead of the requested kind; Settings opens on Everything.
	*/
	initialScope?: BackupScope;
};

/**
"Back up sessions" / "Back up bookmarks" / "Export N selected tabs": pick a format, then download.
*/
export function BackupDialog({
	data,
	open,
	onOpenChange,
	showStatus,
	state,
	initialScope,
}: BackupDialogProps) {
	const requested = useRetainedValue(data, open && data != null);
	const [format, setFormat] = useState<ExportFormat>('json');
	const [saving, setSaving] = useState(false);
	const [switched, setSwitched] = useState<BackupScope | null>(null);
	useEffect(() => {
		if (!open) {
			return;
		}

		setFormat('json');
		setSaving(false);
		setSwitched(initialScope ?? null);
	}, [open, initialScope]);
	const canSwitch = Boolean(
		state &&
		requested &&
		requested.kind !== 'selected' &&
		state.settings.sessionsEnabled &&
		state.settings.bookmarksEnabled,
	);
	let shown = requested;
	if (
		state &&
		canSwitch &&
		switched &&
		switched !== 'everything' &&
		switched !== requested?.kind
	) {
		shown =
			switched === 'bookmarks'
				? {
						kind: 'bookmarks',
						columns: state.bookmarkColumns,
						bookmarks: state.bookmarks,
					}
				: {kind: 'sessions', groups: state.groups, folders: state.folders};
	}

	const kind = shown?.kind ?? 'sessions';
	const counts = shown ? exportCounts(shown) : {groups: 0, items: 0};
	// "Everything" is the full backup ZIP; Bookmarks or Sessions pick a file format. Selected tabs never offer it.
	const full = switched === 'everything' && kind !== 'selected';
	const scopeOptions =
		kind === 'selected'
			? []
			: [
					{value: 'everything' as const, label: <EverythingLabel />},
					...(canSwitch || kind === 'bookmarks'
						? [
								{
									value: 'bookmarks' as const,
									label: <KindLabel kind="bookmarks" />,
								},
							]
						: []),
					...(canSwitch || kind === 'sessions'
						? [
								{
									value: 'sessions' as const,
									label: <KindLabel kind="sessions" />,
								},
							]
						: []),
				];
	const filename = full
		? fullBackupFilename(PROJECT.name)
		: exportFilename(PROJECT.name, kind, format);
	const summary = full
		? 'All data and settings'
		: kind === 'bookmarks'
			? `${plural(counts.groups, 'column')} · ${plural(counts.items, 'bookmark')}`
			: `${plural(counts.groups, 'session')} · ${plural(counts.items, 'tab')}`;
	async function downloadFull() {
		setSaving(true);
		try {
			const result = await send('GET_FULL_BACKUP', {});
			if (!result?.ok) {
				throw new Error(result?.error || 'Could not read your data.');
			}

			const {bytes, manifest} = buildFullBackup(result, {
				appVersion: PROJECT.version,
			});
			downloadFile(new Uint8Array(bytes), 'application/zip', filename);
			onOpenChange(false);
			showStatus(
				`Saved a full backup (${plural(manifest.counts.sessions, 'session')}, ${plural(manifest.counts.bookmarks, 'bookmark')}, and settings) to ${filename}.`,
				false,
				{toast: true},
			);
		} catch (reason) {
			showStatus(
				String(messageOf(reason) || 'Could not create the file.'),
				true,
			);
		} finally {
			setSaving(false);
		}
	}

	function download() {
		if (full) {
			void downloadFull();
			return;
		}

		if (!shown) {
			return;
		}

		try {
			const file = buildExport(shown, format, {
				appName: PROJECT.name,
			});
			downloadFile(file.content, file.mime, file.filename);
			onOpenChange(false);
			showStatus(`Saved ${summary} to ${file.filename}.`, false, {toast: true});
		} catch (reason) {
			showStatus(
				String(messageOf(reason) || 'Could not create the file.'),
				true,
			);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="lg">
				<DialogHeader>
					<DialogTitle>
						{full ? 'Back up everything' : BACKUP_TITLES[kind](counts.items)}
					</DialogTitle>
					<DialogDescription>
						{full
							? 'One ZIP file you can restore with Import. It is saved to your downloads and is not encrypted.'
							: 'Choose a file format. The file is saved to your downloads; it is plain text, not encrypted.'}
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{scopeOptions.length > 1 && (
						<SegmentedControl
							fullWidth
							label="What to back up"
							value={full ? 'everything' : (kind as 'sessions' | 'bookmarks')}
							options={scopeOptions}
							onValueChange={setSwitched}
						/>
					)}
					{full ? (
						<div className="rounded-lg border border-border p-4">
							<p className="flex items-center gap-2 text-sm font-medium">
								<Archive
									className="h-4 w-4 text-muted-foreground"
									aria-hidden="true"
								/>
								Full backup (ZIP)
							</p>
							<ul className="mt-2 grid gap-1 pl-6 text-sm text-muted-foreground sm:grid-cols-2">
								{FULL_BACKUP_CONTENTS.map((item) => (
									<li key={item} className="list-disc">
										{item}
									</li>
								))}
							</ul>
						</div>
					) : (
						<RadioCardGroup
							label="File format"
							value={format}
							className="sm:grid-cols-2"
							onValueChange={(value) => setFormat(value as ExportFormat)}
						>
							{FORMAT_CHOICES.map((choice) => (
								<RadioCard
									key={choice.id}
									value={choice.id}
									icon={choice.icon}
									title={choice.title}
									badge={
										choice.id === 'json' ? (
											<Badge
												variant="accent"
												className="px-1.5 py-0 text-[10px]"
											>
												Recommended
											</Badge>
										) : undefined
									}
									description={
										kind === 'bookmarks' ? choice.bookmarks : choice.sessions
									}
									className={choice.id === 'json' ? 'sm:col-span-2' : undefined}
								/>
							))}
						</RadioCardGroup>
					)}
					<p
						className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted/70 px-3 py-2 text-xs text-muted-foreground"
						aria-live="polite"
					>
						<span>{summary}</span>
						<span aria-hidden="true">→</span>
						<span className="min-w-0 font-mono text-foreground [overflow-wrap:anywhere]">
							{filename}
						</span>
					</p>
				</DialogBody>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={saving || (!full && !counts.items && !counts.groups)}
						onClick={download}
					>
						<Download />
						Download
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type ShareSource = {
	id: string;
	label: string;
	description?: string;
	groups: ShareGroup[];
};
export type SharePayload = {
	title: string;
	groups?: readonly ShareGroup[];
	sources?: ShareSource[];
};

const SHARE_METHODS: ReadonlyArray<{
	id: ShareMethod;
	title: string;
	icon: typeof FileJson;
	description: string;
	action: 'Download' | 'Copy';
}> = [
	{
		id: 'html',
		title: 'HTML page',
		icon: Globe,
		description: 'A standalone page you can send or open anywhere.',
		action: 'Download',
	},
	{
		id: 'markdown',
		title: 'Markdown',
		icon: FileText,
		description: 'A titled list of links, ready for notes or chat.',
		action: 'Copy',
	},
	{
		id: 'links',
		title: 'Plain links',
		icon: Link2,
		description: 'One web address per line.',
		action: 'Copy',
	},
	{
		id: 'rich',
		title: 'Rich text',
		icon: Copy,
		description: 'Clickable links that paste into documents and email.',
		action: 'Copy',
	},
];

type ShareDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title?: string;
	groups?: readonly ShareGroup[];
	sources?: ShareSource[];
	showStatus: ShowStatus;
};

type SharePreviewPanelProps = {
	preview: ReturnType<typeof sharePreview>;
	pageTitle: string;
	counts: ReturnType<typeof shareCounts>;
	formatLabel: string;
};

function SharePreviewPanel({
	preview,
	pageTitle,
	counts,
	formatLabel,
}: SharePreviewPanelProps) {
	const notShown = [
		...(preview.omittedLinks > 0
			? [plural(preview.omittedLinks, 'more link')]
			: []),
		...(preview.moreGroups > 0
			? [plural(preview.moreGroups, 'more group')]
			: []),
	];

	return (
		<section
			aria-labelledby="share-preview-heading"
			className="rounded-lg border border-border bg-muted/30 p-3"
		>
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<div className="flex items-center gap-2">
					<h3 id="share-preview-heading" className="text-sm font-medium">
						Preview
					</h3>
					<Badge variant="outline">{formatLabel}</Badge>
				</div>
				<p
					className="text-right text-xs text-muted-foreground"
					aria-live="polite"
				>
					{plural(counts.links, 'link')} in {plural(counts.groups, 'group')}
					{notShown.length > 0 && (
						<>
							<span aria-hidden="true"> · </span>
							{notShown.join(' and ')} hidden
						</>
					)}
				</p>
			</div>
			{counts.links === 0 ? (
				<p className="mt-2 text-xs text-muted-foreground">
					No links to preview.
				</p>
			) : preview.format === 'html' ? (
				<div className="mt-3 max-h-[min(24rem,50dvh)] overflow-y-auto rounded-md border border-border bg-background p-3">
					<div className="mx-auto max-w-xl">
						<h4 className="text-base font-semibold leading-tight [overflow-wrap:anywhere]">
							{pageTitle}
						</h4>
						<p className="mt-1 text-[11px] text-muted-foreground">
							Shared from {PROJECT.name} · {plural(counts.links, 'link')}
						</p>
						<div className="mt-3 space-y-2">
							{preview.groups.map((group, groupIndex) => (
								<article
									key={`${group.name}-${groupIndex}`}
									className="overflow-hidden rounded-md border border-border bg-card"
								>
									<div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
										<div className="min-w-0">
											<h5 className="text-xs font-semibold [overflow-wrap:anywhere]">
												{group.name}
											</h5>
											{group.createdAt !== undefined && group.createdAt > 0 && (
												<p className="mt-0.5 text-[10px] text-muted-foreground">
													Saved {new Date(group.createdAt).toLocaleDateString()}
												</p>
											)}
										</div>
										<span className="shrink-0 text-[11px] text-muted-foreground">
											{plural(group.tabs.length + group.moreLinks, 'link')}
										</span>
									</div>
									{group.description && (
										<p className="whitespace-pre-wrap px-3 py-2 text-xs [overflow-wrap:anywhere]">
											{group.description}
										</p>
									)}
									{group.tabs.length > 0 && (
										<ol className="mx-3 my-2 list-decimal pl-5">
											{group.tabs.map((tab, tabIndex) => (
												<li
													key={`${tab.url}-${tabIndex}`}
													className="border-t border-border py-1.5 pl-1"
												>
													<span className="block text-xs font-semibold text-primary [overflow-wrap:anywhere]">
														{tab.title || tab.url}
													</span>
													<span className="mt-0.5 block text-[10px] text-muted-foreground [overflow-wrap:anywhere]">
														{tab.url}
														{tab.pinned ? ' · Pinned' : ''}
														{tab.nativeGroup?.title
															? ` · ${tab.nativeGroup.title}`
															: ''}
													</span>
												</li>
											))}
										</ol>
									)}
								</article>
							))}
							{preview.moreGroups > 0 && (
								<p className="text-[11px] text-muted-foreground">
									and {plural(preview.moreGroups, 'more group')}
								</p>
							)}
						</div>
					</div>
				</div>
			) : preview.format === 'markdown' || preview.format === 'links' ? (
				<pre className="mt-3 max-h-[min(24rem,50dvh)] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed">
					{preview.text}
				</pre>
			) : (
				<div className="mt-3 max-h-[min(24rem,50dvh)] space-y-3 overflow-y-auto rounded-md border border-border bg-background p-3">
					{preview.groups.map((group, groupIndex) => (
						<div key={`${group.name}-${groupIndex}`}>
							<h5 className="text-xs font-semibold [overflow-wrap:anywhere]">
								{group.name}
							</h5>
							<ul className="mt-2 list-disc space-y-1 pl-5">
								{group.tabs.map((tab, tabIndex) => (
									<li key={`${tab.url}-${tabIndex}`}>
										<span
											className="text-xs font-medium text-primary underline underline-offset-2 [overflow-wrap:anywhere]"
											title={tab.url}
										>
											{tab.title || tab.url}
										</span>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

/**
Unified share dialog: choose what to share (when several sources are offered) and how.
*/
export function ShareDialog({
	open,
	onOpenChange,
	title = `Shared ${PROJECT.name} links`,
	groups,
	sources,
	showStatus,
}: ShareDialogProps) {
	const all: ShareSource[] = useMemo(
		() =>
			sources && sources.length > 0
				? sources
				: [{id: 'all', label: title, groups: [...(groups ?? [])]}],
		[sources, groups, title],
	);
	const [sourceId, setSourceId] = useState(all[0].id);
	const [method, setMethod] = useState<ShareMethod>('html');
	useEffect(() => {
		if (!open) {
			return;
		}

		setSourceId(all[0].id);
		setMethod('html');
		// Reset each time the dialog opens only.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `open` on purpose
	}, [open]);
	const source = all.find((entry) => entry.id === sourceId) ?? all[0];
	const counts = shareCounts(source.groups);
	const preview = sharePreview(source.groups, method);
	const chosen = SHARE_METHODS.find((entry) => entry.id === method)!;
	const pageTitle = source.groups.length === 1 ? source.groups[0].name : title;

	async function run() {
		try {
			if (method === 'html') {
				downloadFile(
					shareHtmlPage(pageTitle, source.groups, PROJECT.name),
					'text/html;charset=utf-8',
					`${fileNamePrefix(PROJECT.name)}-shared-${dateStamp(new Date())}.html`,
				);
				showStatus('Saved the shared page.', false, {toast: true});
			} else {
				await writeClipboard(
					method === 'markdown'
						? {text: shareMarkdown(source.groups), html: null}
						: method === 'links'
							? {text: shareLinks(source.groups), html: null}
							: shareRich(source.groups),
				);
				showStatus(`Copied ${plural(counts.links, 'link')}.`, false, {
					toast: true,
				});
			}

			onOpenChange(false);
		} catch (reason) {
			showStatus(
				String(
					messageOf(reason) ||
						'Could not share. Check clipboard permissions and try again.',
				),
				true,
			);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				size="lg"
				className="max-h-[calc(100dvh-1rem)] overflow-hidden"
			>
				<DialogHeader className="shrink-0">
					<DialogTitle>Share</DialogTitle>
					<DialogDescription>
						Choose what to share and how. Nothing leaves your browser.
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="min-h-0 flex-1 overflow-y-auto pr-1">
					{all.length > 1 && (
						<RadioCardGroup
							label="What to share"
							value={source.id}
							onValueChange={setSourceId}
						>
							{all.map((entry) => (
								<RadioCard
									key={entry.id}
									value={entry.id}
									title={entry.label}
									description={
										entry.description ??
										plural(shareCounts(entry.groups).links, 'link')
									}
								/>
							))}
						</RadioCardGroup>
					)}
					<RadioCardGroup
						label="How to share"
						value={method}
						className="sm:grid-cols-2"
						onValueChange={(value) => setMethod(value as ShareMethod)}
					>
						{SHARE_METHODS.map((entry) => (
							<RadioCard
								key={entry.id}
								value={entry.id}
								icon={entry.icon}
								title={entry.title}
								description={entry.description}
							/>
						))}
					</RadioCardGroup>
					<SharePreviewPanel
						preview={preview}
						pageTitle={pageTitle}
						counts={counts}
						formatLabel={chosen.title}
					/>
				</DialogBody>
				<DialogFooter className="shrink-0">
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={counts.links === 0}
						onClick={() => void run()}
					>
						{chosen.action === 'Download' ? <Download /> : <Copy />}
						{chosen.action}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type ImportSource = {type: 'file'; name: string} | {type: 'browser'};
type BookmarkTarget = 'folders' | 'column';

type ImportDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	The kind selected when the dialog opens; the user can switch when both systems are enabled.
	*/
	initialKind: ImportKind;
	/**
	Open on Everything (restore a full backup ZIP) instead of Bookmarks or Sessions; Settings does this.
	*/
	initialScope?: 'everything';
	state: TabLodgeState | null;
	showStatus: ShowStatus;
	/**
	Called after a successful import (the pages also reload on storage changes).
	*/
	onImported?: () => void | Promise<void>;
};

const SUPPORTED_FILES =
	'Full backups (ZIP), JSON backups, browser bookmark files (HTML), CSV, Markdown, plain URL lists, and exports from OneTab, Session Buddy, Tab Session Manager, and Toby.';

function importSummary(
	kind: ImportKind,
	result: {added: number; groups: number; skipped: number; updated: number},
) {
	const parts = [
		kind === 'sessions'
			? `Imported ${plural(result.added, 'tab')} in ${plural(result.groups, 'session')}`
			: `Imported ${plural(result.added, 'bookmark')}${result.groups ? ` · added ${plural(result.groups, 'column')}` : ''}`,
	];
	if (result.skipped) {
		parts.push(`skipped ${plural(result.skipped, 'duplicate')}`);
	}

	if (result.updated) {
		parts.push(`updated ${plural(result.updated, 'title')}`);
	}

	return `${parts.join(' · ')}.`;
}

/**
 Import flow: 1) choose a source (a file, or for bookmarks this browser's bookmarks), 2) preview what
 was detected and choose how duplicates, titles, and columns are handled, 3) import, toast, close.
 */
export function ImportDialog({
	open,
	onOpenChange,
	initialKind,
	initialScope,
	state,
	showStatus,
	onImported,
}: ImportDialogProps) {
	const sessionsEnabled = state?.settings.sessionsEnabled !== false;
	const bookmarksEnabled = state?.settings.bookmarksEnabled !== false;
	const [kind, setKind] = useState<ImportKind>(initialKind);
	// "Everything" only takes a full backup ZIP, which replaces all data and settings.
	const [everything, setEverything] = useState(initialScope === 'everything');
	const [source, setSource] = useState<ImportSource | null>(null);
	const [parsed, setParsed] = useState<ParsedImport | null>(null);
	const [full, setFull] = useState<FullBackupContents | null>(null);
	const [error, setError] = useState('');
	const [reading, setReading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>('skip');
	const [titlePolicy, setTitlePolicy] = useState<TitlePolicy>('existing');
	const [target, setTarget] = useState<BookmarkTarget>('folders');
	const [columnId, setColumnId] = useState('');
	const fileRef = useRef<HTMLInputElement>(null);
	const importButtonRef = useRef<HTMLButtonElement>(null);
	const columns = state?.bookmarkColumns ?? [];

	// Reset on open (never on close) so the closing animation keeps the last content.
	useEffect(() => {
		if (!open) {
			return;
		}

		setKind(
			initialKind === 'sessions' && !sessionsEnabled
				? 'bookmarks'
				: initialKind === 'bookmarks' && !bookmarksEnabled
					? 'sessions'
					: initialKind,
		);
		setEverything(initialScope === 'everything');
		setSource(null);
		setParsed(null);
		setFull(null);
		setError('');
		setReading(false);
		setBusy(false);
		setDragging(false);
		setDuplicateMode('skip');
		setTitlePolicy('existing');
		setTarget('folders');
		setColumnId(columns[0]?.id ?? '');
		// Resets the form each time the dialog opens; later changes to the state or props must not wipe it.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `open` on purpose
	}, [open]);

	const existingUrls = useMemo(
		() =>
			kind === 'sessions'
				? (state?.groups ?? []).flatMap((group) =>
						group.tabs.map((tab) => tab.url),
					)
				: (state?.bookmarks ?? []).map((bookmark) => bookmark.url),
		[kind, state],
	);
	const preview = parsed
		? previewImport(parsed, kind, {
				existingUrls,
				includePinned: state?.settings.includePinnedTabs === true,
				singleColumn: target === 'column',
			})
		: null;
	const step = (parsed || full) && source ? 'preview' : 'source';
	// The source step's focused button unmounts when the preview appears; move focus to the Import action.
	useEffect(() => {
		if (open && step === 'preview') {
			requestAnimationFrame(() => importButtonRef.current?.focus());
		}
	}, [open, step]);
	const nothingNew = Boolean(
		preview &&
		duplicateMode === 'skip' &&
		preview.links > 0 &&
		preview.duplicates >= preview.links &&
		titlePolicy === 'existing',
	);
	const itemNoun = kind === 'sessions' ? 'tab' : 'bookmark';
	// What the Import button promises: links that will be added (duplicates are skipped unless allowed).
	const newLinks = preview
		? duplicateMode === 'skip'
			? Math.max(0, preview.links - preview.duplicates)
			: preview.links
		: 0;
	const importLabel = newLinks
		? `Import ${plural(newLinks, duplicateMode === 'skip' && preview?.duplicates ? `new ${itemNoun}` : itemNoun)}`
		: 'Update titles';

	async function readFile(file: File | undefined) {
		if (fileRef.current) {
			fileRef.current.value = '';
		}

		if (!file) {
			return;
		}

		setError('');
		if (file.size > MAX_IMPORT_BYTES) {
			setError(`“${file.name}” is larger than 45 MB.`);
			return;
		}

		setReading(true);
		try {
			if (looksLikeZip(new Uint8Array(await file.slice(0, 4).arrayBuffer()))) {
				const contents = readFullBackup(
					new Uint8Array(await file.arrayBuffer()),
				);
				if (!contents) {
					setError(
						`“${file.name}” is a ZIP file, but not a ${PROJECT.name} full backup.`,
					);
					return;
				}

				setFull(contents);
				setSource({type: 'file', name: file.name});
				return;
			}

			if (everything) {
				setError(
					`“${file.name}” is not a ${PROJECT.name} full backup (.zip). Choose Bookmarks or Sessions to import other files.`,
				);
				return;
			}

			const result = parseImportFile(await file.text(), file.name);
			setParsed(result);
			setSource({type: 'file', name: file.name});
		} catch (reason) {
			setError(
				reason instanceof ImportFormatError || reason instanceof FullBackupError
					? reason.message
					: `Could not read “${file.name}”.`,
			);
		} finally {
			setReading(false);
		}
	}

	async function readBrowserBookmarks() {
		setError('');
		if (!chrome.bookmarks?.getTree) {
			setError(
				'This browser does not give extensions access to its bookmarks.',
			);
			return;
		}

		setReading(true);
		try {
			const result = parseBookmarkTree(await chrome.bookmarks.getTree());
			if (result.bookmarks.length === 0) {
				setError('This browser has no bookmarks with web links.');
				return;
			}

			setParsed(result);
			setSource({type: 'browser'});
			setKind('bookmarks');
		} catch (reason) {
			setError(
				String(messageOf(reason) || 'Could not read this browser’s bookmarks.'),
			);
		} finally {
			setReading(false);
		}
	}

	function onDrop(event: DragEvent<HTMLElement>) {
		event.preventDefault();
		setDragging(false);
		void readFile(event.dataTransfer.files?.[0]);
	}

	async function runFullImport() {
		if (!full || busy) {
			return;
		}

		setBusy(true);
		try {
			const result = await send('RESTORE_FULL_BACKUP', {
				format: full.manifest.format,
				version: full.manifest.version,
				state: full.state,
				preferences: full.preferences,
				snapshots: full.snapshots,
				trash: full.trash,
			});
			if (!result?.ok) {
				throw new Error(result?.error || 'Could not import this backup.');
			}

			onOpenChange(false);
			await onImported?.();
			offerUndo(
				`Imported the full backup: ${plural(result.sessions, 'session')} and ${plural(result.bookmarks, 'bookmark')}, with settings.`,
				result.undoId,
				showStatus,
				async () => onImported?.(),
			);
		} catch (reason) {
			showStatus(
				String(messageOf(reason) || 'Could not import this backup.'),
				true,
			);
		} finally {
			setBusy(false);
		}
	}

	async function runImport() {
		if (!parsed || !source || busy) {
			return;
		}

		setBusy(true);
		const options: ImportOptions = {
			duplicateMode,
			titlePolicy: duplicateMode === 'skip' ? titlePolicy : 'existing',
			...(kind === 'bookmarks' &&
				target === 'column' &&
				columnId && {targetColumnId: columnId}),
		};
		try {
			let message: string;
			let undoId: string | undefined;
			if (source.type === 'browser') {
				const result = await send('IMPORT_BROWSER_BOOKMARKS', {
					duplicateMode: options.duplicateMode,
					titlePolicy: options.titlePolicy,
					targetColumnId: options.targetColumnId,
				});
				if (!result?.ok) {
					throw new Error(
						result?.error || 'Could not import browser bookmarks.',
					);
				}

				undoId = result.undoId;
				message = importSummary('bookmarks', {
					added: result.bookmarksAdded,
					groups: result.columnsAdded,
					skipped: result.bookmarksSkipped,
					updated: result.bookmarksUpdated,
				});
			} else if (kind === 'sessions') {
				const result = await send('IMPORT_SESSIONS', {
					data: sessionImportPayload(parsed),
					importOptions: options,
				});
				if (!result?.ok) {
					throw new Error(result?.error || 'Could not import this file.');
				}

				undoId = result.undoId;
				message = importSummary('sessions', {
					added: result.count,
					groups: result.groups,
					skipped: result.skipped,
					updated: result.updatedTitles,
				});
			} else {
				const result = await send('IMPORT_BOOKMARKS_FILE', {
					data: bookmarkImportPayload(parsed),
					importOptions: options,
				});
				if (!result?.ok) {
					throw new Error(result?.error || 'Could not import this file.');
				}

				undoId = result.undoId;
				message = importSummary('bookmarks', {
					added: result.bookmarks,
					groups: result.columns,
					skipped: result.skipped,
					updated: result.updatedTitles,
				});
			}

			onOpenChange(false);
			await onImported?.();
			offerUndo(message, undoId, showStatus, async () => onImported?.());
		} catch (reason) {
			showStatus(
				String(messageOf(reason) || 'Could not import this file.'),
				true,
			);
		} finally {
			setBusy(false);
		}
	}

	const title = full
		? 'Review full backup'
		: everything
			? 'Import everything'
			: step === 'preview'
				? `Review ${kind === 'sessions' ? 'session' : 'bookmark'} import`
				: kind === 'sessions'
					? 'Import sessions'
					: 'Import bookmarks';
	const description = full
		? 'This replaces everything here: sessions, bookmarks, settings, snapshots, and trash bin. You can undo it right after.'
		: everything
			? `Restore a ${PROJECT.name} full backup. It replaces sessions, bookmarks, and settings, and you can undo it right after.`
			: step === 'preview'
				? 'Nothing is saved until you choose Import.'
				: kind === 'sessions'
					? `Restore a backup or bring in tabs saved by another tab manager. Each group of tabs becomes a ${PROJECT.name} session.`
					: 'Restore a backup, or bring in bookmarks from a browser or another tool. Folders become columns.';
	const kindSwitch =
		// A full backup restores everything, so choosing Bookmarks or Sessions would only mislead.
		!full && source?.type !== 'browser' ? (
			<SegmentedControl
				fullWidth
				label="What to import"
				value={everything ? 'everything' : kind}
				options={[
					{value: 'everything', label: <EverythingLabel />},
					...(bookmarksEnabled
						? [
								{
									value: 'bookmarks' as const,
									label: <KindLabel kind="bookmarks" />,
								},
							]
						: []),
					...(sessionsEnabled
						? [
								{
									value: 'sessions' as const,
									label: <KindLabel kind="sessions" />,
								},
							]
						: []),
				]}
				onValueChange={(value) => {
					setError('');
					setEverything(value === 'everything');
					if (value !== 'everything') {
						setKind(value);
					}
				}}
			/>
		) : null;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!busy) {
					onOpenChange(next);
				}
			}}
		>
			<DialogContent
				size="lg"
				// The review step uses most of the viewport so the sample list gets the space left over.
				className={
					step === 'preview' && !full ? 'h-[min(90vh,52rem)]' : undefined
				}
			>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{step === 'source' ? (
					<>
						<DialogBody>
							{kindSwitch && <div>{kindSwitch}</div>}
							<section
								aria-labelledby="import-file-heading"
								className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-5 py-6 text-center transition-colors ${dragging ? 'border-primary bg-primary/[.06]' : 'border-border bg-muted/30'}`}
								onDragOver={(event) => {
									if (!event.dataTransfer.types.includes('Files')) {
										return;
									}

									event.preventDefault();
									event.dataTransfer.dropEffect = 'copy';
									setDragging(true);
								}}
								onDragLeave={(event) => {
									if (
										!event.currentTarget.contains(
											event.relatedTarget as Node | null,
										)
									) {
										setDragging(false);
									}
								}}
								onDrop={onDrop}
							>
								<span className="grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
									<FileUp className="h-5 w-5" aria-hidden="true" />
								</span>
								<div className="min-w-0">
									<h3
										id="import-file-heading"
										className="text-sm font-semibold"
									>
										{dragging ? 'Drop the file to read it' : 'Drop a file here'}
									</h3>
									<p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
										{everything
											? `A ${PROJECT.name} full backup (.zip), made with Back up › Everything.`
											: SUPPORTED_FILES}
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={reading}
									data-autofocus=""
									onClick={() => fileRef.current?.click()}
								>
									<Upload />
									{reading ? 'Reading' : 'Choose file'}
								</Button>
								<input
									ref={fileRef}
									type="file"
									className="hidden"
									tabIndex={-1}
									aria-hidden="true"
									accept={
										everything
											? '.zip,application/zip'
											: '.zip,application/zip,.json,.html,.htm,.csv,.tsv,.txt,.md,.markdown,application/json,text/html,text/csv,text/plain,text/markdown'
									}
									onChange={(event) => void readFile(event.target.files?.[0])}
								/>
							</section>
							{kind === 'bookmarks' && !everything && (
								<section
									className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3 sm:flex-row sm:items-center"
									aria-labelledby="import-browser-heading"
								>
									<span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-muted/60 text-muted-foreground">
										<Globe className="h-4 w-4" aria-hidden="true" />
									</span>
									<div className="min-w-0 flex-1">
										<h3
											id="import-browser-heading"
											className="text-sm font-medium"
										>
											This browser’s bookmarks
										</h3>
										<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
											Copies the bookmarks bar and folders. Your browser
											bookmarks are not changed.
										</p>
									</div>
									<Button
										type="button"
										variant="secondary"
										size="sm"
										disabled={reading || !chrome.bookmarks?.getTree}
										className="shrink-0"
										onClick={() => void readBrowserBookmarks()}
									>
										Read bookmarks
									</Button>
								</section>
							)}
							{error && (
								<p
									role="alert"
									className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/[.06] px-3 py-2 text-xs leading-5 text-foreground"
								>
									<CircleAlert
										className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
										aria-hidden="true"
									/>
									<span className="min-w-0">{error}</span>
								</p>
							)}
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
							>
								Cancel
							</Button>
						</DialogFooter>
					</>
				) : full && source ? (
					<>
						<DialogBody>
							<div className="flex min-w-0 items-start gap-3 rounded-lg border border-border px-3.5 py-3">
								<span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
									<Archive className="h-4 w-4" aria-hidden="true" />
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium [overflow-wrap:anywhere]">
										{source.type === 'file' ? source.name : ''}
									</p>
									<p className="mt-0.5 text-xs text-muted-foreground">
										{fullBackupDetails(full)}
									</p>
								</div>
							</div>
							<dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
								<Stat label="Sessions" value={full.counts.sessions} />
								<Stat label="Tabs" value={full.counts.links} />
								<Stat label="Bookmarks" value={full.counts.bookmarks} />
								<Stat label="Columns" value={full.counts.columns} />
								<Stat label="Folders" value={full.counts.folders} />
								<Stat label="Snapshots" value={full.counts.snapshots} />
								<Stat label="Trash bin items" value={full.counts.trash} />
							</dl>
							<ul className="space-y-1 text-xs leading-5 text-muted-foreground">
								<Note>
									Settings, excluded sites, and the theme are replaced too.
								</Note>
								<Note>
									A safety backup of your current data is taken first.
								</Note>
							</ul>
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								className="mr-auto"
								disabled={busy}
								onClick={() => {
									setFull(null);
									setSource(null);
								}}
							>
								<ArrowLeft />
								Back
							</Button>
							<Button
								type="button"
								variant="ghost"
								disabled={busy}
								onClick={() => onOpenChange(false)}
							>
								Cancel
							</Button>
							<Button
								ref={importButtonRef}
								type="button"
								disabled={busy}
								data-autofocus=""
								onClick={() => void runFullImport()}
							>
								{busy ? 'Importing' : 'Replace everything'}
							</Button>
						</DialogFooter>
					</>
				) : (
					parsed &&
					preview &&
					source && (
						<>
							<DialogBody className="flex min-h-0 flex-1 flex-col overflow-y-auto [&>*]:shrink-0">
								{kindSwitch && <div>{kindSwitch}</div>}
								<div className="flex min-w-0 items-start gap-3 rounded-lg border border-border px-3.5 py-3">
									<span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
										{source.type === 'browser' ? (
											<Globe className="h-4 w-4" aria-hidden="true" />
										) : (
											<FileText className="h-4 w-4" aria-hidden="true" />
										)}
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium [overflow-wrap:anywhere]">
											{source.type === 'browser'
												? 'This browser’s bookmarks'
												: source.name}
										</p>
										<p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
											Detected:{' '}
											<span className="font-medium text-foreground">
												{parsed.label}
											</span>
											{parsed.confidence === 'best-effort' && (
												<Badge
													variant="outline"
													className="px-1.5 py-0 text-[10px]"
													title="Read from the file’s structure. Check the sample below."
												>
													best effort
												</Badge>
											)}
										</p>
									</div>
								</div>
								<dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
									<Stat
										label={
											kind === 'sessions'
												? 'Sessions'
												: target === 'column'
													? 'Column'
													: 'Columns'
										}
										value={preview.groups}
									/>
									<Stat
										label={kind === 'sessions' ? 'Tabs' : 'Bookmarks'}
										value={preview.links}
									/>
									<Stat
										label="Already saved"
										value={preview.duplicates}
										tone={preview.duplicates ? 'accent' : undefined}
									/>
									<Stat
										label="Skipped"
										value={preview.invalid + preview.pinnedSkipped}
										tone={
											preview.invalid + preview.pinnedSkipped
												? 'warn'
												: undefined
										}
									/>
								</dl>
								{(preview.invalid > 0 ||
									preview.pinnedSkipped > 0 ||
									parsed.warnings.length > 0) && (
									<ul className="space-y-1 text-xs leading-5 text-muted-foreground">
										{preview.invalid > 0 && (
											<Note>
												{plural(preview.invalid, 'entry', 'entries')} can’t be
												imported: only http and https links are kept.
											</Note>
										)}
										{preview.pinnedSkipped > 0 && (
											<Note>
												{plural(preview.pinnedSkipped, 'pinned tab')} will be
												left out, because Settings › When saving excludes pinned
												tabs.
											</Note>
										)}
										{parsed.warnings.map((warning) => (
											<Note key={warning}>
												{warning}
												{parsed.native &&
												kind === 'sessions' &&
												!parsed.native.sessions
													? ' Its columns would become sessions.'
													: parsed.native &&
														  kind === 'bookmarks' &&
														  !parsed.native.bookmarks
														? ' Its sessions would become columns.'
														: ''}
											</Note>
										))}
									</ul>
								)}
								<div className="flex min-h-[20rem] min-w-0 flex-1 shrink flex-col">
									<p className="mb-1.5 text-xs font-medium text-muted-foreground">
										Preview
										{preview.links > preview.sample.length
											? ` (first ${preview.sample.length} of ${preview.links.toLocaleString()})`
											: ''}
									</p>
									<ScrollArea
										type="auto"
										className="min-h-0 flex-1 rounded-md border border-border"
									>
										<ol className="divide-y divide-border/70">
											{preview.sample.map((item, index) => (
												<li
													key={`${index}-${item.url}`}
													className="min-w-0 px-3 py-1.5"
												>
													<p
														className="truncate text-xs font-medium"
														title={item.title}
													>
														{item.title}
													</p>
													<p
														className="truncate text-[11px] text-muted-foreground"
														title={item.url}
													>
														{kind === 'bookmarks' && target === 'column' ? (
															item.url
														) : (
															<>
																{item.group ? (
																	<span className="text-foreground/70">
																		{item.group} ·{' '}
																	</span>
																) : null}
																{item.url}
															</>
														)}
													</p>
												</li>
											))}
										</ol>
									</ScrollArea>
								</div>
								<div className="grid gap-3 rounded-lg bg-muted/40 p-3">
									<OptionRow
										id="import-duplicates"
										label="Links already saved"
										help={
											preview.duplicates
												? `${plural(preview.duplicates, 'link')} in this import ${preview.duplicates === 1 ? 'is' : 'are'} already saved or repeated.`
												: 'None found.'
										}
									>
										<SegmentedControl
											aria-labelledby="import-duplicates"
											value={duplicateMode}
											options={[
												{value: 'skip', label: 'Skip'},
												{value: 'allow', label: 'Add again'},
											]}
											onValueChange={setDuplicateMode}
										/>
									</OptionRow>
									{duplicateMode === 'skip' && preview.duplicates > 0 && (
										<OptionRow
											id="import-titles"
											label="Their titles"
											help={
												kind === 'sessions'
													? 'Notes are always kept.'
													: undefined
											}
										>
											<SegmentedControl
												aria-labelledby="import-titles"
												value={titlePolicy}
												options={[
													{value: 'existing', label: 'Keep mine'},
													{value: 'latest', label: 'Use imported'},
												]}
												onValueChange={setTitlePolicy}
											/>
										</OptionRow>
									)}
									{kind === 'bookmarks' && (
										<OptionRow
											id="import-target"
											label="Put bookmarks in"
											help={
												target === 'folders'
													? 'Each folder becomes a column (merged by name); links without a folder go to the first column.'
													: undefined
											}
										>
											<div className="flex flex-wrap items-center justify-end gap-2">
												<SegmentedControl
													aria-labelledby="import-target"
													value={target}
													options={[
														{value: 'folders', label: 'Columns from folders'},
														...(columns.length > 0
															? [
																	{
																		value: 'column' as const,
																		label: 'One column',
																	},
																]
															: []),
													]}
													onValueChange={setTarget}
												/>
												{target === 'column' && (
													<Select value={columnId} onValueChange={setColumnId}>
														<SelectTrigger
															className="h-8 w-48 text-xs"
															aria-label="Column for every imported bookmark"
														>
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
												)}
											</div>
										</OptionRow>
									)}
								</div>
								{nothingNew && (
									<p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
										<Info
											className="mt-0.5 h-3.5 w-3.5 shrink-0"
											aria-hidden="true"
										/>
										Everything here is already saved. Choose “Add again” or “Use
										imported” titles to import anyway.
									</p>
								)}
							</DialogBody>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									className="mr-auto"
									disabled={busy}
									onClick={() => {
										setParsed(null);
										setSource(null);
									}}
								>
									<ArrowLeft />
									Back
								</Button>
								<Button
									type="button"
									variant="ghost"
									disabled={busy}
									onClick={() => onOpenChange(false)}
								>
									Cancel
								</Button>
								<Button
									ref={importButtonRef}
									type="button"
									disabled={busy || !preview.links || nothingNew}
									data-autofocus=""
									onClick={() => void runImport()}
								>
									{busy ? 'Importing' : importLabel}
								</Button>
							</DialogFooter>
						</>
					)
				)}
			</DialogContent>
		</Dialog>
	);
}

function fullBackupDetails({manifest}: FullBackupContents) {
	const created = new Date(manifest.createdAt);
	const parts = [
		Number.isNaN(created.getTime())
			? ''
			: `Created ${created.toLocaleString()}`,
		manifest.appVersion ? `${PROJECT.name} ${manifest.appVersion}` : '',
	].filter(Boolean);
	return parts.join(' · ') || 'Full backup';
}

function Stat({
	label,
	value,
	tone,
}: {
	label: string;
	value: number;
	tone?: 'accent' | 'warn';
}) {
	return (
		<div className="min-w-0 rounded-md border border-border px-3 py-2">
			<dt className="truncate text-[11px] font-medium text-muted-foreground">
				{label}
			</dt>
			<dd
				className={`mt-0.5 text-lg font-semibold tabular-nums leading-6 ${tone === 'accent' ? 'text-primary' : tone === 'warn' ? 'text-destructive' : ''}`}
			>
				{value.toLocaleString()}
			</dd>
		</div>
	);
}

function Note({children}: {children: ReactNode}) {
	return (
		<li className="flex items-start gap-2">
			<Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
			<span className="min-w-0">{children}</span>
		</li>
	);
}

function OptionRow({
	id,
	label,
	help,
	children,
}: {
	id: string;
	label: string;
	help?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<Label id={id} className="text-sm font-medium">
					{label}
				</Label>
				{help && (
					<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
						{help}
					</p>
				)}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}
