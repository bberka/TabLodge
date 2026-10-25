// The backup (export) and import dialogs, shared by the dashboard and Settings › Data.
// File formats live in the pure modules export-formats.ts and import-formats.ts.
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
	Download,
	FileJson,
	FileSpreadsheet,
	FileText,
	FileUp,
	Globe,
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
import {send, type ShowStatus} from './common';
import {
	buildExport,
	exportCounts,
	exportFilename,
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

const plural = (count: number, noun: string, many = `${noun}s`) =>
	`${count.toLocaleString()} ${count === 1 ? noun : many}`;
const messageOf = (reason: unknown) =>
	(reason as {message?: unknown} | null | undefined)?.message;
const UNFILED_COLUMN_ID = 'bookmark-unfiled';

/**
Starts a download of a generated file.
*/
export function downloadFile(content: string, mime: string, filename: string) {
	const url = URL.createObjectURL(new Blob([content], {type: mime}));
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- Backup / export

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

const BACKUP_TITLES: Record<ExportKind, (count: number) => string> = {
	sessions: () => 'Back up sessions',
	bookmarks: () => 'Back up bookmarks',
	selected: (count) => `Export ${plural(count, 'selected tab')}`,
};

type BackupDialogProps = {
	/**
	What to export; the dialog keeps showing the last request while it closes.
	*/
	data: ExportData | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	showStatus: ShowStatus;
};

/**
"Back up sessions" / "Back up bookmarks" / "Export N selected tabs": pick a format, then download.
*/
export function BackupDialog({
	data,
	open,
	onOpenChange,
	showStatus,
}: BackupDialogProps) {
	const shown = useRetainedValue(data, open && data != null);
	const [format, setFormat] = useState<ExportFormat>('json');
	useEffect(() => {
		if (open) {
			setFormat('json');
		}
	}, [open]);
	const kind = shown?.kind ?? 'sessions';
	const counts = shown ? exportCounts(shown) : {groups: 0, items: 0};
	const filename = exportFilename(PROJECT.name, kind, format);
	const summary =
		kind === 'bookmarks'
			? `${plural(counts.groups, 'column')} · ${plural(counts.items, 'bookmark')}`
			: `${plural(counts.groups, 'session')} · ${plural(counts.items, 'tab')}`;
	function download() {
		if (!shown) {
			return;
		}

		try {
			const file = buildExport(shown, format, {appName: PROJECT.name});
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
					<DialogTitle>{BACKUP_TITLES[kind](counts.items)}</DialogTitle>
					<DialogDescription>
						Choose a file format. The file is saved to your downloads; it is
						plain text, not encrypted.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
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
										<Badge variant="accent" className="px-1.5 py-0 text-[10px]">
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
						disabled={!counts.items && !counts.groups}
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

// ---------------------------------------------------------------- Import

type ImportSource = {type: 'file'; name: string} | {type: 'browser'};
type BookmarkTarget = 'folders' | 'column';

type ImportDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	The kind selected when the dialog opens; the user can switch when both systems are enabled.
	*/
	initialKind: ImportKind;
	state: TabLodgeState | null;
	showStatus: ShowStatus;
	/**
	Called after a successful import (the pages also reload on storage changes).
	*/
	onImported?: () => void | Promise<void>;
};

const SUPPORTED_FILES =
	'JSON backups, browser bookmark files (HTML), CSV, Markdown, plain URL lists, and exports from OneTab, Session Buddy, Tab Session Manager, and Toby.';

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
	state,
	showStatus,
	onImported,
}: ImportDialogProps) {
	const sessionsEnabled = state?.settings.sessionsEnabled !== false;
	const bookmarksEnabled = state?.settings.bookmarksEnabled !== false;
	const [kind, setKind] = useState<ImportKind>(initialKind);
	const [source, setSource] = useState<ImportSource | null>(null);
	const [parsed, setParsed] = useState<ParsedImport | null>(null);
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
		setSource(null);
		setParsed(null);
		setError('');
		setReading(false);
		setBusy(false);
		setDragging(false);
		setDuplicateMode('skip');
		setTitlePolicy('existing');
		setTarget('folders');
		setColumnId(columns[0]?.id ?? UNFILED_COLUMN_ID);
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
	const step = parsed && source ? 'preview' : 'source';
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
			const result = parseImportFile(await file.text(), file.name);
			setParsed(result);
			setSource({type: 'file', name: file.name});
		} catch (reason) {
			setError(
				reason instanceof ImportFormatError
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

	async function runImport() {
		if (!parsed || !source || busy) {
			return;
		}

		setBusy(true);
		const options: ImportOptions = {
			duplicateMode,
			titlePolicy: duplicateMode === 'skip' ? titlePolicy : 'existing',
			...(kind === 'bookmarks' &&
				target === 'column' && {targetColumnId: columnId || UNFILED_COLUMN_ID}),
		};
		try {
			let message: string;
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

				message = importSummary('bookmarks', {
					added: result.bookmarks,
					groups: result.columns,
					skipped: result.skipped,
					updated: result.updatedTitles,
				});
			}

			onOpenChange(false);
			await onImported?.();
			showStatus(message, false, {toast: true});
		} catch (reason) {
			showStatus(
				String(messageOf(reason) || 'Could not import this file.'),
				true,
			);
		} finally {
			setBusy(false);
		}
	}

	const title =
		step === 'preview'
			? `Review ${kind === 'sessions' ? 'session' : 'bookmark'} import`
			: kind === 'sessions'
				? 'Import sessions'
				: 'Import bookmarks';
	const description =
		step === 'preview'
			? 'Nothing is saved until you choose Import.'
			: kind === 'sessions'
				? `Restore a backup or bring in tabs saved by another tab manager. Each group of tabs becomes a ${PROJECT.name} session.`
				: 'Restore a backup, or bring in bookmarks from a browser or another tool. Folders become columns.';
	const kindSwitch =
		sessionsEnabled && bookmarksEnabled && source?.type !== 'browser' ? (
			<SegmentedControl
				label="What to import"
				value={kind}
				options={[
					{
						value: 'bookmarks',
						label: (
							<span className="inline-flex items-center gap-1.5">
								<Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
								Bookmarks
							</span>
						),
					},
					{
						value: 'sessions',
						label: (
							<span className="inline-flex items-center gap-1.5">
								<PanelsTopLeft className="h-3.5 w-3.5" aria-hidden="true" />
								Sessions
							</span>
						),
					},
				]}
				onValueChange={(value) => setKind(value)}
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
			<DialogContent size="lg">
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
										{SUPPORTED_FILES}
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
									{reading ? 'Reading…' : 'Choose file…'}
								</Button>
								<input
									ref={fileRef}
									type="file"
									className="hidden"
									tabIndex={-1}
									aria-hidden="true"
									accept=".json,.html,.htm,.csv,.tsv,.txt,.md,.markdown,application/json,text/html,text/csv,text/plain,text/markdown"
									onChange={(event) => void readFile(event.target.files?.[0])}
								/>
							</section>
							{kind === 'bookmarks' && (
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
				) : (
					parsed &&
					preview &&
					source && (
						<>
							<DialogBody>
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
								<div className="min-w-0">
									<p className="mb-1.5 text-xs font-medium text-muted-foreground">
										Preview
										{preview.links > preview.sample.length
											? ` (first ${preview.sample.length} of ${preview.links.toLocaleString()})`
											: ''}
									</p>
									<ScrollArea
										type="auto"
										className="h-40 rounded-md border border-border"
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
														{value: 'column', label: 'One column'},
													]}
													onValueChange={setTarget}
												/>
												{target === 'column' && (
													<Select
														value={columnId || UNFILED_COLUMN_ID}
														onValueChange={setColumnId}
													>
														<SelectTrigger
															className="h-8 w-48 text-xs"
															aria-label="Column for every imported bookmark"
														>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{columns.map((column) => (
																<SelectItem key={column.id} value={column.id}>
																	{column.name}
																</SelectItem>
															))}
															<SelectItem value={UNFILED_COLUMN_ID}>
																Unfiled
															</SelectItem>
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
									{busy ? 'Importing…' : importLabel}
								</Button>
							</DialogFooter>
						</>
					)
				)}
			</DialogContent>
		</Dialog>
	);
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
