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
	type ComponentProps,
	type DragEvent,
	type ReactNode,
} from 'react';
import {
	ArrowLeft,
	Bookmark,
	Check,
	CloudUpload,
	ExternalLink,
	CircleAlert,
	Archive,
	Download,
	Lock,
	FileJson,
	FileText,
	FileUp,
	Globe,
	Copy,
	Info,
	Link2,
	PanelsTopLeft,
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
	Input,
	Label,
	ScrollArea,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	SegmentedControl,
} from '../shared/ui';
import {downloadFile} from '../shared/download';
import type {
	DuplicateMode,
	ImportOptions,
	TabLodgeState,
	TitlePolicy,
} from '../shared/types';
import {looksEncrypted} from '../shared/crypto-envelope';
import {
	shareCounts,
	shareHtmlPage,
	shareLinks,
	shareMarkdown,
	sharePreview,
	shareRich,
	type ShareGroup,
	type ShareMethod,
} from '../shared/share-formats';
import {
	buildExport,
	dateStamp,
	exportCounts,
	type ExportData,
	type ExportFormat,
} from '../shared/export-formats';
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
} from '../shared/import-formats';
import {fileNamePrefix} from '../shared/backup-format';
import {
	FullBackupError,
	buildFullBackup,
	fullBackupFilename,
	looksLikeZip,
	protectFullBackup,
	protectedFullBackupFilename,
	readFullBackup,
	readProtectedFullBackup,
	type FullBackupContents,
} from '../shared/full-backup';
import type {SharedPage} from '../shared/sync/shared-pages-client';
import {isSharedPageUrl, newSharedPageId} from '../shared/sync/shared-pages';
import {importFromLink} from '../shared/import-link';
import {siteName} from '../shared/web-url';
import {offerUndo} from './recovery-core';
import {messageOf, send, type ShowStatus} from './common';
import {mergeSummary} from './merge-summary';
import {writeClipboard} from './interaction-actions';
import {PROJECT} from './project';
import {copyPageLink, SharedPagesList, useSharedPages} from './shared-pages';
import {
	EMPTY_PASSCODE_DRAFT,
	PasscodeEntry,
	PasscodeSetup,
	passcodeDraftProblem,
	type PasscodeDraft,
} from './passcode-fields';
import {
	BookmarkColumnSelect,
	BookmarkColumnNameField,
	NEW_BOOKMARK_COLUMN,
	resolveBookmarkColumn,
	type BookmarkColumnDraft,
} from './bookmark-column-picker';
import {cn} from '@/lib/utils';

const plural = (count: number, noun: string, many = `${noun}s`) =>
	`${count.toLocaleString()} ${count === 1 ? noun : many}`;

/**
What a full backup ZIP holds, listed on the Everything choice instead of a format list (it has only one format).
*/
const FULL_BACKUP_CONTENTS = [
	'Sessions and folders',
	'Bookmarks and columns',
	'All settings and excluded sites',
	'Theme',
	'Crash snapshots and the trash bin',
];

const IMPORT_KINDS: readonly ChoiceOption[] = [
	{
		value: 'everything',
		title: 'Everything',
		description: 'A full backup (ZIP) with settings. Add it or replace.',
		icon: Archive,
	},
	{
		value: 'bookmarks',
		title: 'Bookmarks',
		description: 'Links for the board. Folders become columns.',
		icon: Bookmark,
	},
	{
		value: 'sessions',
		title: 'Sessions',
		description: 'Groups of tabs. Each group becomes a session.',
		icon: PanelsTopLeft,
	},
];

type ShareSource = {
	id: string;
	label: string;
	description?: string;
	groups: ShareGroup[];
	/**
	The same thing as data, which also lets it be saved as a file (JSON, CSV, a bookmarks file) from the same dialog.
	*/
	data?: ExportData;
	/**
	Title of the shared page when this source holds several groups; defaults to the title of the whole share.
	*/
	pageTitle?: string;
	/**
	The one column or session this source is (`sharedPageSource`), so the dialog lists the links made from it.
	*/
	pageSource?: string;
	/**
	The full backup ZIP of everything: no links to list or preview, only the backup options.
	*/
	backup?: boolean;
};
export type SharePayload = {
	title: string;
	groups?: readonly ShareGroup[];
	sources?: ShareSource[];
	data?: ExportData;
	/**
	Adds "Everything", the full backup ZIP, to what can be shared.
	*/
	backup?: boolean;
	/**
	Opens on this source (`everything` for the backup) instead of the first one.
	*/
	initialSource?: string;
};

/**
How much of a file the preview shows.
*/
const FILE_PREVIEW_CHARS = 4000;
const FILE_PREVIEW_CUT = '\n…';

const EVERYTHING_SOURCE: ShareSource = {
	id: 'everything',
	label: 'Everything',
	description: 'A full backup of all data and settings',
	groups: [],
	backup: true,
};

type FileWay = `file-${'json' | 'csv' | 'html'}`;
type ShareWay = Exclude<ShareMethod, 'rich'> | FileWay;

type ShareChoice = {
	id: ShareWay;
	title: string;
	icon: typeof FileJson;
	description: string;
	/**
	Can also be copied to the clipboard (a page copies as rich text, the others as plain text).
	*/
	copy?: boolean;
	/**
	Saved as a file with the export formats, so it needs the data, not just the links.
	*/
	file?: boolean;
};

const SHARE_METHODS: readonly ShareChoice[] = [
	{
		id: 'html',
		title: 'HTML page',
		icon: Globe,
		description:
			'A page to download, or to share by link from your sync server.',
		copy: true,
	},
	{
		id: 'markdown',
		title: 'Markdown',
		icon: FileText,
		description: 'A titled list of links, ready for notes or chat.',
		copy: true,
	},
	{
		id: 'links',
		title: 'Plain links',
		icon: Link2,
		description: 'One web address per line.',
		copy: true,
	},
	{
		id: 'file-json',
		title: 'JSON file',
		icon: FileJson,
		description: 'Everything saved, to import again.',
		file: true,
	},
	{
		id: 'file-csv',
		title: 'CSV file',
		icon: FileText,
		description: 'A table for a spreadsheet.',
		file: true,
	},
	{
		id: 'file-html',
		title: 'Browser bookmarks (HTML)',
		icon: Globe,
		description: 'A bookmarks file other browsers import.',
		file: true,
	},
];

type ShareDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title?: string;
	groups?: readonly ShareGroup[];
	sources?: ShareSource[];
	data?: ExportData;
	backup?: boolean;
	initialSource?: string;
	showStatus: ShowStatus;
};

function sourceDescription(source: ShareSource) {
	if (source.backup) {
		return source.description;
	}

	return [source.description, plural(shareCounts(source.groups).links, 'link')]
		.filter(Boolean)
		.join(' · ');
}

/**
One option of a dropdown: a name with its one line explanation under it.
*/
function ChoiceText({
	icon: Icon,
	title,
	description,
}: {
	icon?: typeof FileJson;
	title: string;
	description?: string;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2.5 text-left">
			{Icon && (
				<Icon
					className="h-4 w-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
			)}
			<span className="min-w-0">
				<span className="block truncate text-sm font-medium">{title}</span>
				{description && (
					<span className="block truncate text-xs font-normal text-muted-foreground">
						{description}
					</span>
				)}
			</span>
		</span>
	);
}

type ChoiceOption = {
	value: string;
	title: string;
	description?: string;
	icon?: typeof FileJson;
};

/**
A labelled dropdown whose options have a name and a one line explanation, the same in the share, export and import dialogs.
*/
function ChoiceSelect({
	id,
	label,
	value,
	options,
	disabled,
	onValueChange,
}: {
	id: string;
	label: string;
	value: string;
	options: readonly ChoiceOption[];
	disabled?: boolean;
	onValueChange: (value: string) => void;
}) {
	const chosen = options.find((option) => option.value === value) ?? options[0];
	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Select
				value={chosen.value}
				disabled={disabled}
				onValueChange={onValueChange}
			>
				<SelectTrigger id={id} className="h-auto min-h-11 py-2">
					<SelectValue>
						<ChoiceText
							icon={chosen.icon}
							title={chosen.title}
							description={chosen.description}
						/>
					</SelectValue>
				</SelectTrigger>
				<SelectContent className="w-(--radix-select-trigger-width) max-w-none">
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							<ChoiceText
								icon={option.icon}
								title={option.title}
								description={option.description}
							/>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

type FullBackupOptionsProps = {
	protect: boolean;
	passcode: PasscodeDraft;
	saving: boolean;
	onProtectChange: (protect: boolean) => void;
	onPasscodeChange: (draft: PasscodeDraft) => void;
};

function FullBackupOptions({
	protect,
	passcode,
	saving,
	onProtectChange,
	onPasscodeChange,
}: FullBackupOptionsProps) {
	return (
		<>
			<div className="rounded-lg border border-border p-4">
				<p className="flex items-center gap-2 text-sm font-medium">
					<Archive
						className="h-4 w-4 text-muted-foreground"
						aria-hidden="true"
					/>
					Full backup (ZIP)
				</p>
				<p className="mt-1 text-xs text-muted-foreground">
					One file you can restore with Import. It is saved to your downloads.
				</p>
				<ul className="mt-2 grid gap-1 pl-6 text-sm text-muted-foreground sm:grid-cols-2">
					{FULL_BACKUP_CONTENTS.map((item) => (
						<li key={item} className="list-disc">
							{item}
						</li>
					))}
				</ul>
			</div>
			<div className="rounded-lg border border-border p-4">
				<div className="flex items-start gap-2">
					<Checkbox
						id="backup-protect"
						checked={protect}
						disabled={saving}
						onCheckedChange={(checked) => {
							onProtectChange(checked === true);
							onPasscodeChange(EMPTY_PASSCODE_DRAFT);
						}}
					/>
					<div className="min-w-0">
						<Label
							htmlFor="backup-protect"
							className="flex items-center gap-1.5 text-sm font-medium"
						>
							<Lock className="h-3.5 w-3.5" aria-hidden="true" />
							Protect with a password
						</Label>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							Optional. Encrypts the whole backup file on this device. Only full
							backups can be protected; other exports and automatic backups stay
							plain text.
						</p>
					</div>
				</div>
				{protect && (
					<div className="mt-4">
						<PasscodeSetup
							draft={passcode}
							disabled={saving}
							onChange={onPasscodeChange}
						/>
					</div>
				)}
			</div>
		</>
	);
}

type SharePreviewPanelProps = {
	preview: ReturnType<typeof sharePreview>;
	pageTitle: string;
	counts: ReturnType<typeof shareCounts>;
	formatLabel: string;
	/**
	The start of the file for formats that are saved as a file, shown as is.
	*/
	fileText?: string;
};

function SharePreviewPanel({
	preview,
	pageTitle,
	counts,
	formatLabel,
	fileText,
}: SharePreviewPanelProps) {
	// A file preview shows the file itself, so link and group counts of the link preview do not apply to it.
	const notShown = [
		...(fileText === undefined && preview.omittedLinks > 0
			? [plural(preview.omittedLinks, 'more link')]
			: []),
		...(fileText === undefined && preview.moreGroups > 0
			? [plural(preview.moreGroups, 'more group')]
			: []),
	];
	const fileCut = fileText?.endsWith(FILE_PREVIEW_CUT) === true;

	return (
		<section
			aria-labelledby="share-preview-heading"
			className="min-w-0 rounded-lg border border-border bg-muted/30 p-3"
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
							{notShown.join(' and ')} not in the preview
						</>
					)}
					{fileCut && (
						<>
							<span aria-hidden="true"> · </span>
							Showing the start of the file
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
						<h4 className="text-base font-semibold leading-tight wrap-anywhere">
							{pageTitle}
						</h4>
						<p className="mt-1 text-[11px] text-muted-foreground">
							Links shared from {PROJECT.name} on{' '}
							{new Date().toLocaleDateString(undefined, {dateStyle: 'medium'})}{' '}
							· {plural(counts.links, 'link')}
						</p>
						<div className="mt-3 space-y-2">
							{preview.groups.map((group, groupIndex) => {
								const repeatedTitle =
									preview.groups.length === 1 &&
									preview.moreGroups === 0 &&
									group.name === pageTitle;
								const createdAt =
									group.createdAt !== undefined && group.createdAt > 0
										? group.createdAt
										: null;
								return (
									<article
										key={`${group.name}-${groupIndex}`}
										className="overflow-hidden rounded-md border border-border bg-card"
									>
										{(!repeatedTitle || createdAt !== null) && (
											<div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
												<div className="min-w-0">
													{!repeatedTitle && (
														<h5 className="text-xs font-semibold wrap-anywhere">
															{group.name}
														</h5>
													)}
													{createdAt !== null && (
														<p className="mt-0.5 text-[10px] text-muted-foreground">
															Saved {new Date(createdAt).toLocaleDateString()}
														</p>
													)}
												</div>
												{!repeatedTitle && (
													<span className="shrink-0 text-[11px] text-muted-foreground">
														{plural(
															group.tabs.length + group.moreLinks,
															'link',
														)}
													</span>
												)}
											</div>
										)}
										{group.description && (
											<p className="whitespace-pre-wrap px-3 py-2 text-xs wrap-anywhere">
												{group.description}
											</p>
										)}
										{group.tabs.length > 0 && (
											<ul className="mx-3 my-1">
												{group.tabs.map((tab, tabIndex) => (
													<li
														key={`${tab.url}-${tabIndex}`}
														className="border-t border-border py-1.5 first:border-t-0"
													>
														<span className="block text-xs font-semibold text-primary wrap-anywhere">
															{tab.title || tab.url}
														</span>
														<span className="mt-0.5 block text-[10px] text-muted-foreground wrap-anywhere">
															{siteName(tab.url)}
															{tab.pinned ? ' · Pinned' : ''}
															{tab.nativeGroup?.title
																? ` · ${tab.nativeGroup.title}`
																: ''}
														</span>
													</li>
												))}
											</ul>
										)}
									</article>
								);
							})}
							{preview.moreGroups > 0 && (
								<p className="text-[11px] text-muted-foreground">
									and {plural(preview.moreGroups, 'more group')}
								</p>
							)}
						</div>
					</div>
				</div>
			) : fileText !== undefined ||
			  preview.format === 'markdown' ||
			  preview.format === 'links' ? (
				<pre className="mt-3 max-h-[min(24rem,50dvh)] min-w-0 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed">
					{fileText ?? preview.text}
				</pre>
			) : (
				<div className="mt-3 max-h-[min(24rem,50dvh)] space-y-3 overflow-y-auto rounded-md border border-border bg-background p-3">
					{preview.groups.map((group, groupIndex) => (
						<div key={`${group.name}-${groupIndex}`}>
							<h5 className="text-xs font-semibold wrap-anywhere">
								{group.name}
							</h5>
							<ul className="mt-2 list-disc space-y-1 pl-5">
								{group.tabs.map((tab, tabIndex) => (
									<li key={`${tab.url}-${tabIndex}`}>
										<span
											className="text-xs font-medium text-primary underline underline-offset-2 wrap-anywhere"
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

const sharedPageHtml = (
	title: string,
	groups: readonly ShareGroup[],
	kind: 'bookmarks' | 'sessions',
	url?: string,
) =>
	shareHtmlPage(title, groups, PROJECT.name, {
		kind,
		sharedAt: Date.now(),
		url,
	});

function SourcePages({
	noun,
	...list
}: {noun: string} & ComponentProps<typeof SharedPagesList>) {
	return (
		<section aria-labelledby="source-pages-heading" className="space-y-2">
			<h3 id="source-pages-heading" className="text-sm font-medium">
				Links to this {noun}
			</h3>
			<SharedPagesList {...list} />
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
	data,
	backup,
	initialSource,
	showStatus,
}: ShareDialogProps) {
	const all: ShareSource[] = useMemo(() => {
		const listed: ShareSource[] =
			sources && sources.length > 0
				? sources
				: groups || data
					? [{id: 'all', label: title, groups: [...(groups ?? [])], data}]
					: [];
		return backup || listed.length === 0
			? [...listed, EVERYTHING_SOURCE]
			: listed;
	}, [sources, groups, title, data, backup]);
	const [sourceId, setSourceId] = useState(all[0].id);
	const [method, setMethod] = useState<ShareWay>('html');
	// A backup-only dialog has nothing to upload, so it never asks the sync server about shared pages.
	const backupOnly = all.length === 1 && all[0].backup === true;
	const shared = useSharedPages(open && !backupOnly, true);
	const server = shared.server ?? 'none';
	const [uploading, setUploading] = useState(false);
	const [uploaded, setUploaded] = useState<SharedPage>();
	// Optional password protection of the full backup ZIP; the secret lives only in this state.
	const [protect, setProtect] = useState(false);
	const [passcode, setPasscode] = useState<PasscodeDraft>(EMPTY_PASSCODE_DRAFT);
	const [saving, setSaving] = useState(false);
	// Changes whenever the dialog opens or closes, so a backup that outlives its dialog can tell and stays quiet.
	const dialogRunRef = useRef(0);
	useEffect(() => {
		dialogRunRef.current++;
		if (!open) {
			// Drop the typed secret as soon as the dialog closes.
			setPasscode((current) => ({...current, value: '', confirm: ''}));
			return;
		}

		setSourceId(
			all.find((entry) => entry.id === initialSource)?.id ?? all[0].id,
		);
		setMethod('html');
		setUploaded(undefined);
		setProtect(false);
		setSaving(false);
		setPasscode(EMPTY_PASSCODE_DRAFT);
		// Reset each time the dialog opens only.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `open` on purpose
	}, [open]);
	const source = all.find((entry) => entry.id === sourceId) ?? all[0];
	const isBackup = source.backup === true;
	const counts = shareCounts(source.groups);
	const choices = SHARE_METHODS.filter(
		(entry) => !entry.file || source.data !== undefined,
	);
	const chosen = choices.find((entry) => entry.id === method) ?? choices[0];
	const isFile = chosen.file === true;
	const preview = sharePreview(
		source.groups,
		isFile ? 'links' : (chosen.id as ShareMethod),
	);
	const pageTitle =
		source.groups.length === 1
			? source.groups[0].name
			: (source.pageTitle ?? title);
	const pageKind = source.data?.kind === 'bookmarks' ? 'bookmarks' : 'sessions';
	const sourcePages = source.pageSource
		? shared.pages.filter((page) => page.source === source.pageSource)
		: [];
	const sourceNoun = pageKind === 'bookmarks' ? 'column' : 'session';
	let fileText: string | undefined;
	if (isFile && source.data) {
		const {content} = buildExport(
			source.data,
			chosen.id.slice(5) as ExportFormat,
			{appName: PROJECT.name},
		);
		fileText =
			content.length > FILE_PREVIEW_CHARS
				? `${content.slice(0, FILE_PREVIEW_CHARS)}${FILE_PREVIEW_CUT}`
				: content;
	}

	const fileHasData =
		source.data !== undefined &&
		(exportCounts(source.data).groups > 0 ||
			exportCounts(source.data).items > 0);
	const protectProblem =
		isBackup && protect ? passcodeDraftProblem(passcode) : null;

	async function downloadFull() {
		const mine = dialogRunRef.current;
		setSaving(true);
		try {
			const result = await send('GET_FULL_BACKUP', {});
			if (mine !== dialogRunRef.current) {
				return;
			}

			if (!result?.ok) {
				throw new Error(result?.error || 'Could not read your data.');
			}

			const {bytes, manifest} = buildFullBackup(result, {
				appVersion: PROJECT.version,
			});
			const protectedBytes = protect
				? await protectFullBackup(bytes, {value: passcode.value})
				: undefined;
			if (mine !== dialogRunRef.current) {
				return;
			}

			const filename = protectedBytes
				? protectedFullBackupFilename(PROJECT.name)
				: fullBackupFilename(PROJECT.name);
			downloadFile(
				new Uint8Array(protectedBytes ?? bytes),
				protectedBytes ? 'application/octet-stream' : 'application/zip',
				filename,
			);
			setPasscode(EMPTY_PASSCODE_DRAFT);
			onOpenChange(false);
			showStatus(
				`Saved ${protectedBytes ? 'an encrypted' : 'a'} full backup (${plural(manifest.counts.sessions, 'session')}, ${plural(manifest.counts.bookmarks, 'bookmark')}, and settings) to ${filename}.`,
				false,
				{toast: true},
			);
		} catch (reason) {
			if (mine === dialogRunRef.current) {
				showStatus(
					String(messageOf(reason) || 'Could not create the file.'),
					true,
				);
			}
		} finally {
			if (mine === dialogRunRef.current) {
				setSaving(false);
			}
		}
	}

	async function run(mode: 'download' | 'copy') {
		if (isBackup) {
			await downloadFull();
			return;
		}

		try {
			const stamp = `${fileNamePrefix(PROJECT.name)}-shared-${dateStamp(new Date())}`;
			if (mode === 'copy') {
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
			} else if (isFile && source.data) {
				const file = buildExport(
					source.data,
					chosen.id.slice(5) as ExportFormat,
					{
						appName: PROJECT.name,
						name:
							source.groups.length === 1 ? source.groups[0].name : undefined,
					},
				);
				downloadFile(file.content, file.mime, file.filename);
				showStatus(`Saved ${file.filename}.`, false, {toast: true});
			} else if (method === 'markdown') {
				downloadFile(
					shareMarkdown(source.groups),
					'text/markdown;charset=utf-8',
					`${stamp}.md`,
				);
				showStatus('Saved the Markdown file.', false, {toast: true});
			} else if (method === 'links') {
				downloadFile(
					shareLinks(source.groups),
					'text/plain;charset=utf-8',
					`${stamp}.txt`,
				);
				showStatus('Saved the list of links.', false, {toast: true});
			} else {
				downloadFile(
					sharedPageHtml(pageTitle, source.groups, pageKind),
					'text/html;charset=utf-8',
					`${stamp}.html`,
				);
				showStatus('Saved the shared page.', false, {toast: true});
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

	async function upload() {
		setUploading(true);
		const id = shared.linkBase ? newSharedPageId() : undefined;
		const result = await send('UPLOAD_SHARED_PAGE', {
			title: pageTitle,
			html: sharedPageHtml(
				pageTitle,
				source.groups,
				pageKind,
				id && `${shared.linkBase}${id}`,
			),
			id,
			linkBase: (id && shared.linkBase) ?? undefined,
			source: id && source.pageSource,
		});
		setUploading(false);
		if (!result.ok) {
			showStatus(messageOf(result.error) || 'Could not upload the page.', true);
			return;
		}

		setUploaded(result.page);
		await copyPageLink(result.page.url, showStatus);
		await shared.reload();
	}

	if (uploaded) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent size="md">
					<DialogHeader>
						<DialogTitle>Link ready</DialogTitle>
						<DialogDescription>
							The link is copied. Anyone with it can open the page. Sharing
							again makes a new link; delete the ones you no longer want below
							or in Shared pages.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<div className="space-y-2">
							<Label htmlFor="shared-page-link">Link</Label>
							<Input
								readOnly
								id="shared-page-link"
								className="font-mono text-xs"
								value={uploaded.url}
								onFocus={(event) => {
									event.currentTarget.select();
								}}
							/>
						</div>
						{sourcePages.some((page) => page.id !== uploaded.id) && (
							<SourcePages
								noun={sourceNoun}
								pages={sourcePages.filter((page) => page.id !== uploaded.id)}
								showStatus={showStatus}
								onDeleted={shared.reload}
							/>
						)}
					</DialogBody>
					<DialogFooter>
						<Button asChild variant="outline">
							<a href={uploaded.url} target="_blank" rel="noopener noreferrer">
								<ExternalLink aria-hidden="true" />
								Open
							</a>
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => void copyPageLink(uploaded.url, showStatus)}
						>
							<Copy aria-hidden="true" />
							Copy link
						</Button>
						<Button type="button" onClick={() => onOpenChange(false)}>
							<Check aria-hidden="true" />
							Done
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				size="lg"
				className="max-h-[calc(100dvh-1rem)] overflow-hidden"
			>
				<DialogHeader className="shrink-0">
					<DialogTitle>
						{backupOnly ? 'Back up everything' : 'Share and export'}
					</DialogTitle>
					<DialogDescription>
						{backupOnly
							? 'One ZIP file you can restore with Import. It is saved to your downloads and is not encrypted unless you protect it below.'
							: 'Choose what to share and the format. Downloads go to your downloads folder, and nothing leaves this browser unless you upload it.'}
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="-m-1 min-h-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-y-auto p-1">
					{all.length > 1 && (
						<ChoiceSelect
							id="share-what"
							label="What to share"
							value={source.id}
							disabled={uploading || saving}
							options={all.map((entry) => ({
								value: entry.id,
								title: entry.label,
								description: sourceDescription(entry),
							}))}
							onValueChange={setSourceId}
						/>
					)}
					{isBackup ? (
						<FullBackupOptions
							protect={protect}
							passcode={passcode}
							saving={saving}
							onProtectChange={setProtect}
							onPasscodeChange={setPasscode}
						/>
					) : (
						<>
							<ChoiceSelect
								id="share-how"
								label="Format"
								value={chosen.id}
								disabled={uploading}
								options={choices.map((entry) => ({
									value: entry.id,
									title: entry.title,
									description: entry.description,
									icon: entry.icon,
								}))}
								onValueChange={(value) => setMethod(value as ShareWay)}
							/>
							<SharePreviewPanel
								preview={preview}
								pageTitle={pageTitle}
								counts={counts}
								formatLabel={chosen.title}
								fileText={fileText}
							/>
							{server === 'ready' && sourcePages.length > 0 && (
								<SourcePages
									noun={sourceNoun}
									pages={sourcePages}
									showStatus={showStatus}
									onDeleted={shared.reload}
								/>
							)}
						</>
					)}
				</DialogBody>
				<DialogFooter className="shrink-0">
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
					>
						<X aria-hidden="true" />
						Cancel
					</Button>
					{!isBackup && chosen.id === 'html' && server === 'ready' && (
						<Button
							type="button"
							variant="outline"
							disabled={counts.links === 0 || uploading || saving}
							onClick={() => void upload()}
						>
							<CloudUpload aria-hidden="true" />
							{uploading ? 'Uploading…' : 'Get a link'}
						</Button>
					)}
					{!isBackup && chosen.copy && (
						<Button
							type="button"
							variant="outline"
							disabled={counts.links === 0 || uploading}
							onClick={() => void run('copy')}
						>
							<Copy aria-hidden="true" />
							Copy
						</Button>
					)}
					<Button
						type="button"
						disabled={
							isBackup
								? saving || uploading || protectProblem !== null
								: uploading || !(isFile ? fileHasData : counts.links > 0)
						}
						onClick={() => void run('download')}
					>
						<Download aria-hidden="true" />
						Download
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type ImportSource = {type: 'file' | 'link'; name: string} | {type: 'browser'};
type BookmarkTarget = 'folders' | 'column';

type ImportDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	The kind selected when the dialog opens; the user can switch to the other kind.
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
	initialLink?: string;
};

const SUPPORTED_FILES =
	'Full backups (ZIP, including protected ones), JSON backups, browser bookmark files (HTML), CSV, Markdown, plain URL lists, and exports from OneTab, Session Buddy, Tab Session Manager, Toby, Raindrop.io, Linkwarden, Karakeep, Omnivore, wallabag, Pinboard, and Mastodon (bookmarks.csv).';

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
	initialLink,
}: ImportDialogProps) {
	const [kind, setKind] = useState<ImportKind>(initialKind);
	// "Everything" only takes a full backup ZIP, which replaces or adds to all data and settings.
	const [everything, setEverything] = useState(initialScope === 'everything');
	const [source, setSource] = useState<ImportSource | null>(null);
	const [parsed, setParsed] = useState<ParsedImport | null>(null);
	const [full, setFull] = useState<FullBackupContents | null>(null);
	// A full backup is added to the library by default; Replace swaps everything, settings included.
	const [fullMode, setFullMode] = useState<'merge' | 'replace'>('merge');
	// An encrypted backup waiting for its password; nothing is read from it until it opens.
	const [locked, setLocked] = useState<{
		name: string;
		bytes: Uint8Array;
	} | null>(null);
	const [credential, setCredential] = useState('');
	const [unlocking, setUnlocking] = useState(false);
	const [error, setError] = useState('');
	const [reading, setReading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [link, setLink] = useState('');
	const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>('skip');
	const [titlePolicy, setTitlePolicy] = useState<TitlePolicy>('existing');
	const [target, setTarget] = useState<BookmarkTarget>('folders');
	const [columnId, setColumnId] = useState(NEW_BOOKMARK_COLUMN);
	const [newColumn, setNewColumn] = useState<BookmarkColumnDraft>({name: ''});
	const fileRef = useRef<HTMLInputElement>(null);
	const importButtonRef = useRef<HTMLButtonElement>(null);
	const chooseButtonRef = useRef<HTMLButtonElement>(null);
	const credentialRef = useRef<HTMLInputElement>(null);
	const readGenerationRef = useRef(0);
	const linkReadRef = useRef<AbortController | undefined>(undefined);
	const columns = state?.bookmarkColumns ?? [];
	// Addresses in the trash, which the import skips like saved links.
	const [trashed, setTrashed] = useState({
		sessions: [] as string[],
		bookmarks: [] as string[],
	});
	useEffect(() => {
		if (!open) {
			return;
		}

		let live = true;
		void send('GET_TRASH').then((result) => {
			if (live && result?.ok) {
				setTrashed(result.urls);
			}
		});
		return () => {
			live = false;
		};
	}, [open]);

	// Reset on open (never on close) so the closing animation keeps the last content.
	useEffect(() => {
		readGenerationRef.current += 1;
		if (!open) {
			cancelLinkRead();
			return;
		}

		setKind(initialKind);
		setEverything(initialScope === 'everything');
		setSource(null);
		setParsed(null);
		setFull(null);
		setLocked(null);
		setCredential('');
		setUnlocking(false);
		setError('');
		setReading(false);
		setBusy(false);
		setDragging(false);
		setDuplicateMode('skip');
		setTitlePolicy('existing');
		setTarget('folders');
		setColumnId(columns[0]?.id ?? NEW_BOOKMARK_COLUMN);
		setNewColumn({name: ''});
		setLink(initialLink ?? '');
		if (initialLink && isSharedPageUrl(initialLink)) {
			void readLink(initialLink);
		}

		// Resets the form each time the dialog opens; later changes to the state or props must not wipe it.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `open` on purpose
	}, [open]);

	const existingUrls = useMemo(
		() => [
			...(kind === 'sessions'
				? (state?.groups ?? []).flatMap((group) =>
						group.tabs.map((tab) => tab.url),
					)
				: (state?.bookmarks ?? []).map((bookmark) => bookmark.url)),
			...trashed[kind],
		],
		[kind, state, trashed],
	);
	const hasBookmarkFolders = Boolean(
		parsed?.bookmarks.some((group) => group.name && group.links.length > 0),
	);
	const bookmarkTarget = hasBookmarkFolders ? target : 'column';
	const preview = parsed
		? previewImport(parsed, kind, {
				existingUrls,
				includePinned: state?.settings.includePinnedTabs === true,
				singleColumn: bookmarkTarget === 'column',
			})
		: null;
	const step = (parsed || full) && source ? 'preview' : 'source';
	// The source step's focused button unmounts when the preview appears; move focus to the Import action.
	useEffect(() => {
		if (open && step === 'preview') {
			requestAnimationFrame(() => importButtonRef.current?.focus());
		}
	}, [open, step]);
	// The source step's button unmounts when the credential field appears; put focus in the field.
	useEffect(() => {
		if (open && locked) {
			requestAnimationFrame(() => credentialRef.current?.focus());
		}
	}, [open, locked]);
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

		const generation = ++readGenerationRef.current;
		setError('');
		if (file.size > MAX_IMPORT_BYTES) {
			setReading(false);
			setError(`“${file.name}” is larger than 45 MB.`);
			return;
		}

		setReading(true);
		try {
			const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
			if (generation !== readGenerationRef.current) {
				return;
			}

			if (looksEncrypted(header)) {
				const bytes = new Uint8Array(await file.arrayBuffer());
				if (generation !== readGenerationRef.current) {
					return;
				}

				setLocked({name: file.name, bytes});
				setCredential('');
				return;
			}

			if (looksLikeZip(header)) {
				const contents = readFullBackup(
					new Uint8Array(await file.arrayBuffer()),
				);
				if (generation !== readGenerationRef.current) {
					return;
				}

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

			const text = await file.text();
			if (generation !== readGenerationRef.current) {
				return;
			}

			const result = parseImportFile(text, file.name);
			setParsed(result);
			setSource({type: 'file', name: file.name});
		} catch (reason) {
			if (generation !== readGenerationRef.current) {
				return;
			}

			setError(
				reason instanceof ImportFormatError || reason instanceof FullBackupError
					? reason.message
					: `Could not read “${file.name}”.`,
			);
		} finally {
			if (generation === readGenerationRef.current) {
				setReading(false);
			}
		}
	}

	async function unlock() {
		if (!locked || unlocking || credential === '') {
			return;
		}

		const generation = ++readGenerationRef.current;
		setError('');
		setUnlocking(true);
		try {
			const contents = await readProtectedFullBackup(locked.bytes, credential);
			if (generation !== readGenerationRef.current) {
				return;
			}

			if (!contents) {
				setError(
					`“${locked.name}” opened, but it is not a ${PROJECT.name} full backup.`,
				);
				return;
			}

			setFull(contents);
			setSource({type: 'file', name: locked.name});
			setLocked(null);
			setCredential('');
		} catch (reason) {
			if (generation !== readGenerationRef.current) {
				return;
			}

			setError(
				reason instanceof FullBackupError
					? reason.message
					: `Could not open “${locked.name}”.`,
			);
			credentialRef.current?.focus();
		} finally {
			if (generation === readGenerationRef.current) {
				setUnlocking(false);
			}
		}
	}

	function cancelLinkRead() {
		linkReadRef.current?.abort();
		linkReadRef.current = undefined;
	}

	async function readLink(address: string) {
		cancelLinkRead();
		const controller = new AbortController();
		linkReadRef.current = controller;
		const generation = ++readGenerationRef.current;
		setError('');
		setReading(true);
		try {
			const result = await importFromLink(fetch, address, {
				signal: controller.signal,
			});
			if (generation !== readGenerationRef.current) {
				return;
			}

			setParsed(result);
			setSource({type: 'link', name: address.trim()});
			setEverything(false);
			if (result.kind) {
				setKind(result.kind);
			}
		} catch (reason) {
			if (generation === readGenerationRef.current) {
				setError(
					reason instanceof ImportFormatError
						? reason.message
						: 'Could not read that link.',
				);
			}
		} finally {
			if (generation === readGenerationRef.current) {
				setReading(false);
				linkReadRef.current = undefined;
			}
		}
	}

	async function readBrowserBookmarks() {
		const generation = ++readGenerationRef.current;
		setError('');
		if (!chrome.bookmarks?.getTree) {
			setReading(false);
			setError(
				'This browser does not give extensions access to its bookmarks.',
			);
			return;
		}

		setReading(true);
		try {
			const result = parseBookmarkTree(await chrome.bookmarks.getTree());
			if (generation !== readGenerationRef.current) {
				return;
			}

			if (result.bookmarks.length === 0) {
				setError('This browser has no bookmarks with web links.');
				return;
			}

			setParsed(result);
			setSource({type: 'browser'});
			setKind('bookmarks');
		} catch (reason) {
			if (generation !== readGenerationRef.current) {
				return;
			}

			setError(
				String(messageOf(reason) || 'Could not read this browser’s bookmarks.'),
			);
		} finally {
			if (generation === readGenerationRef.current) {
				setReading(false);
			}
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
			if (fullMode === 'merge') {
				// The same merge as importing a JSON backup: new sessions, bookmarks and columns are added, links
				// already saved are skipped, and settings, snapshots, and trash stay as they are.
				const merged = await send('IMPORT_GROUPS', {
					data: full.state,
					importOptions: {duplicateMode: 'skip', titlePolicy: 'existing'},
				});
				if (!merged?.ok) {
					throw new Error(merged?.error || 'Could not add this backup.');
				}

				await send('ADD_PAGE_COPIES', {copies: full.copies});

				onOpenChange(false);
				await onImported?.();
				offerUndo(mergeSummary(merged), merged.undoId, showStatus, async () =>
					onImported?.(),
				);
				return;
			}

			const result = await send('RESTORE_FULL_BACKUP', {
				format: full.manifest.format,
				version: full.manifest.version,
				state: full.state,
				preferences: full.preferences,
				snapshots: full.snapshots,
				trash: full.trash,
				copies: full.copies,
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
		try {
			const targetColumnId =
				kind === 'bookmarks' && bookmarkTarget === 'column'
					? await resolveBookmarkColumn(columnId, newColumn)
					: undefined;
			if (targetColumnId) {
				setColumnId(targetColumnId);
			}

			const options: ImportOptions = {
				duplicateMode,
				titlePolicy: duplicateMode === 'skip' ? titlePolicy : 'existing',
				...(targetColumnId && {targetColumnId}),
			};
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

	const title = locked
		? 'Unlock encrypted backup'
		: full
			? 'Review full backup'
			: everything
				? 'Import everything'
				: step === 'preview'
					? `Review ${kind === 'sessions' ? 'session' : 'bookmark'} import`
					: 'Import';
	const description = locked
		? `“${locked.name}” is protected. Enter the password you chose when you made it. Nothing in your library changes until you confirm the import.`
		: full
			? fullMode === 'merge'
				? 'This adds the backup’s sessions and bookmarks to yours and skips links you already have. Your settings, snapshots, and trash bin stay as they are. You can undo it right after.'
				: 'This replaces everything here: sessions, bookmarks, settings, snapshots, and trash bin. You can undo it right after.'
			: everything
				? `Bring in a ${PROJECT.name} full backup. You choose whether to add it to what you have or replace everything, and you can undo it right after.`
				: step === 'preview'
					? 'Nothing is saved until you choose Import.'
					: `Pick a file or paste a shared page link. A ${PROJECT.name} full backup is recognized on its own; any other file is read as the kind you choose below.`;
	const kindSwitch =
		// A full backup restores everything, so choosing Bookmarks or Sessions would only mislead.
		!full && source?.type !== 'browser' ? (
			<ChoiceSelect
				id="import-what"
				label="What to import"
				value={everything ? 'everything' : kind}
				options={IMPORT_KINDS}
				onValueChange={(value) => {
					if (reading) {
						readGenerationRef.current += 1;
						setReading(false);
					}

					setError('');
					setEverything(value === 'everything');
					if (value !== 'everything') {
						setKind(value as ImportKind);
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
				className={
					step === 'preview' && !full
						? 'h-[calc(100dvh-2rem)] overflow-hidden'
						: step === 'source' && !locked
							? 'max-h-[calc(100dvh-1rem)] overflow-hidden'
							: undefined
				}
			>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{locked && step === 'source' ? (
					<form
						className="contents"
						onSubmit={(event) => {
							event.preventDefault();
							void unlock();
						}}
					>
						<DialogBody>
							<PasscodeEntry
								inputRef={credentialRef}
								value={credential}
								error={error}
								onChange={(value) => {
									setCredential(value);
									setError('');
								}}
							/>
						</DialogBody>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								className="mr-auto"
								disabled={unlocking}
								onClick={() => {
									readGenerationRef.current += 1;
									setLocked(null);
									setCredential('');
									setError('');
									requestAnimationFrame(() => chooseButtonRef.current?.focus());
								}}
							>
								<ArrowLeft />
								Back
							</Button>
							<Button
								type="button"
								variant="ghost"
								disabled={unlocking}
								onClick={() => onOpenChange(false)}
							>
								<X aria-hidden="true" />
								Cancel
							</Button>
							<Button type="submit" disabled={unlocking || credential === ''}>
								<Lock aria-hidden="true" />
								{unlocking ? 'Unlocking' : 'Unlock'}
							</Button>
						</DialogFooter>
					</form>
				) : step === 'source' ? (
					<>
						<ScrollArea
							type="auto"
							className="-m-1 min-h-0 flex-1"
							viewportClassName="p-1"
						>
							<DialogBody className="grid-cols-[minmax(0,1fr)]">
								{kindSwitch && <div>{kindSwitch}</div>}
								<section
									aria-labelledby="import-file-heading"
									className={cn(
										'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-5 py-6 text-center transition-colors',
										dragging
											? 'border-primary bg-primary/6'
											: 'border-border bg-muted/30',
									)}
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
											{dragging
												? 'Drop the file to read it'
												: 'Drop a file here'}
										</h3>
										<p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
											{everything
												? `A ${PROJECT.name} full backup (.zip, or .zip.enc if it is protected), made with Settings › Data › Export, or Share and export › Everything.`
												: SUPPORTED_FILES}
										</p>
									</div>
									<Button
										ref={chooseButtonRef}
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
												? '.zip,.enc,application/zip'
												: '.zip,.enc,application/zip,.json,.html,.htm,.csv,.tsv,.txt,.md,.markdown,application/json,text/html,text/csv,text/plain,text/markdown'
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
											<Bookmark aria-hidden="true" />
											Read bookmarks
										</Button>
									</section>
								)}
								{!everything && (
									<section
										className="rounded-lg border border-border px-4 py-3"
										aria-labelledby="import-link-heading"
									>
										<h3
											id="import-link-heading"
											className="text-sm font-medium"
										>
											From a link
										</h3>
										<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
											Paste the address of a {PROJECT.name} shared page. Its
											columns or sessions come in as they were shared.
										</p>
										<form
											className="mt-2 flex flex-col gap-2 sm:flex-row"
											onSubmit={(event) => {
												event.preventDefault();
												void readLink(link);
											}}
										>
											<Label htmlFor="import-link" className="sr-only">
												Shared page link
											</Label>
											<Input
												id="import-link"
												type="url"
												inputMode="url"
												autoComplete="off"
												spellCheck={false}
												placeholder="https://your-server/p/…"
												value={link}
												className="min-w-0 flex-1"
												onChange={(event) => {
													if (linkReadRef.current) {
														cancelLinkRead();
														readGenerationRef.current += 1;
														setReading(false);
													}

													setLink(event.target.value);
												}}
											/>
											<Button
												type="submit"
												variant="secondary"
												size="sm"
												className="shrink-0 self-start sm:self-auto"
												disabled={reading || link.trim() === ''}
											>
												<Link2 aria-hidden="true" />
												{reading && link ? 'Reading' : 'Read link'}
											</Button>
										</form>
									</section>
								)}
								{error && (
									<p
										role="alert"
										className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/6 px-3 py-2 text-xs leading-5 text-foreground"
									>
										<CircleAlert
											className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
											aria-hidden="true"
										/>
										<span className="min-w-0">{error}</span>
									</p>
								)}
							</DialogBody>
						</ScrollArea>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
							>
								<X aria-hidden="true" />
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
									<p className="text-sm font-medium wrap-anywhere">
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
								<Stat label="Page copies" value={full.counts.copies} />
							</dl>
							<div className="rounded-lg bg-muted/40 p-3">
								<OptionRow
									inlineControl
									id="full-import-mode"
									label="How to bring it in"
									help={
										fullMode === 'merge'
											? 'Adds what is new and skips links you already have.'
											: 'Swaps all your data for the backup.'
									}
								>
									<SegmentedControl
										aria-labelledby="full-import-mode"
										value={fullMode}
										options={[
											{value: 'merge', label: 'Add to mine'},
											{value: 'replace', label: 'Replace everything'},
										]}
										onValueChange={setFullMode}
									/>
								</OptionRow>
							</div>
							<ul className="space-y-1 text-xs leading-5 text-muted-foreground">
								{fullMode === 'merge' ? (
									<Note>
										Your settings, snapshots, trash bin, and theme stay as they
										are.
									</Note>
								) : (
									<>
										<Note>
											Settings, excluded sites, and the theme are replaced too.
										</Note>
										<Note>
											A safety backup of your current data is taken first.
										</Note>
									</>
								)}
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
								<X aria-hidden="true" />
								Cancel
							</Button>
							<Button
								ref={importButtonRef}
								type="button"
								disabled={busy}
								data-autofocus=""
								onClick={() => void runFullImport()}
							>
								<FileUp aria-hidden="true" />
								{busy
									? 'Importing'
									: fullMode === 'merge'
										? 'Add to my library'
										: 'Replace everything'}
							</Button>
						</DialogFooter>
					</>
				) : (
					parsed &&
					preview &&
					source && (
						<>
							<DialogBody className="-m-1 flex min-h-0 flex-1 flex-col overflow-y-auto p-1 [&>*:not([data-import-preview])]:shrink-0">
								{kindSwitch && <div>{kindSwitch}</div>}
								<div className="flex min-w-0 items-start gap-3 rounded-lg border border-border px-3.5 py-3">
									<span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
										{source.type === 'browser' ? (
											<Globe className="h-4 w-4" aria-hidden="true" />
										) : source.type === 'link' ? (
											<Link2 className="h-4 w-4" aria-hidden="true" />
										) : (
											<FileText className="h-4 w-4" aria-hidden="true" />
										)}
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium wrap-anywhere">
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
												: bookmarkTarget === 'column'
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
								<div
									data-import-preview=""
									className="flex min-h-32 min-w-0 flex-1 flex-col"
								>
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
														{kind === 'bookmarks' &&
														bookmarkTarget === 'column' ? (
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
										inlineControl
										id="import-duplicates"
										label="Links already saved"
										help={
											preview.duplicates
												? `${plural(preview.duplicates, 'link')} in this import ${preview.duplicates === 1 ? 'is' : 'are'} already saved, in the trash bin, or repeated.`
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
											inlineControl
											id="import-target"
											label="Put bookmarks in"
											help={
												bookmarkTarget === 'folders'
													? 'Each folder becomes a column (merged by name); links without a folder go to the first column.'
													: undefined
											}
										>
											<div className="flex min-w-0 flex-wrap items-center gap-2">
												{hasBookmarkFolders && (
													<SegmentedControl
														aria-labelledby="import-target"
														value={target}
														options={[
															{
																value: 'folders',
																label: 'Columns from folders',
															},
															{value: 'column', label: 'One column'},
														]}
														onValueChange={setTarget}
													/>
												)}
												{bookmarkTarget === 'column' && (
													<BookmarkColumnSelect
														id="import-bookmark-column"
														columns={columns}
														value={columnId}
														className="h-8 w-48 text-xs"
														aria-label="Column for every imported bookmark"
														onValueChange={setColumnId}
													/>
												)}
											</div>
										</OptionRow>
									)}
									{kind === 'bookmarks' &&
										bookmarkTarget === 'column' &&
										columnId === NEW_BOOKMARK_COLUMN && (
											<BookmarkColumnNameField
												id="import-bookmark-column-new-name"
												draft={newColumn}
												onDraftChange={setNewColumn}
											/>
										)}
								</div>
								{nothingNew && (
									<p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
										<Info
											className="mt-0.5 h-3.5 w-3.5 shrink-0"
											aria-hidden="true"
										/>
										Everything here is already saved or in the trash bin. Choose
										“Add again” or “Use imported” titles to import anyway.
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
									<X aria-hidden="true" />
									Cancel
								</Button>
								<Button
									ref={importButtonRef}
									type="button"
									disabled={
										busy ||
										!preview.links ||
										nothingNew ||
										(kind === 'bookmarks' &&
											bookmarkTarget === 'column' &&
											columnId === NEW_BOOKMARK_COLUMN &&
											!newColumn.name.trim())
									}
									data-autofocus=""
									onClick={() => void runImport()}
								>
									<FileUp aria-hidden="true" />
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
				className={cn(
					'mt-0.5 text-lg font-semibold tabular-nums leading-6',
					tone === 'accent'
						? 'text-primary'
						: tone === 'warn' && 'text-destructive',
				)}
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
	inlineControl = false,
	children,
}: {
	id: string;
	label: string;
	help?: string;
	inlineControl?: boolean;
	children: ReactNode;
}) {
	return (
		<div
			className={
				inlineControl
					? 'flex flex-col gap-1'
					: 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'
			}
		>
			<div
				className={
					inlineControl
						? 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1'
						: 'min-w-0'
				}
			>
				<Label
					id={id}
					className={cn('text-sm font-medium', inlineControl && 'shrink-0')}
				>
					{label}
				</Label>
				{inlineControl && (
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						{children}
					</div>
				)}
				{help && (
					<p
						className={cn(
							'mt-0.5 text-xs leading-5 text-muted-foreground',
							inlineControl && 'basis-full',
						)}
					>
						{help}
					</p>
				)}
			</div>
			{!inlineControl && <div className="shrink-0">{children}</div>}
		</div>
	);
}
