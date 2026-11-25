import {useCallback, useEffect, useId, useRef, useState} from 'react';
import {Copy, ExternalLink, Lock, Trash2, X} from 'lucide-react';
import type {SharedPageMode} from '../shared/sync/shared-pages';
import type {SharedPage} from '../shared/sync/shared-pages-client';
import type {SharedPagesServer} from '../shared/types';
import {
	Badge,
	Button,
	ConfirmationDialog,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	IconTooltip,
	ScrollArea,
} from '../shared/ui';
import {send, type ShowStatus} from './common';
import {writeClipboard} from './interaction-actions';

const privateWindow = () => Boolean(chrome.extension?.inIncognitoContext);

export type SharedPagesState = {
	server: SharedPagesServer | undefined;
	pages: SharedPage[];
	linkBase: string | null;
	supportsLivePassword: boolean;
	defaultShareMode: SharedPageMode;
	reload: () => Promise<void>;
};

export function useSharedPages(open: boolean, list = false): SharedPagesState {
	const [server, setServer] = useState<SharedPagesServer>();
	const [pages, setPages] = useState<SharedPage[]>([]);
	const [linkBase, setLinkBase] = useState<string | null>(null);
	const [supportsLivePassword, setSupportsLivePassword] = useState(false);
	const [defaultShareMode, setDefaultShareMode] =
		useState<SharedPageMode>('snapshot');
	const latestRef = useRef(0);
	const reload = useCallback(async () => {
		if (privateWindow()) {
			setServer('none');
			return;
		}

		const request = ++latestRef.current;
		const result = await send('GET_SHARED_PAGES', {list});
		if (request !== latestRef.current) {
			return;
		}

		if (result.ok) {
			setServer(result.server);
			setPages(result.pages);
			setLinkBase(result.linkBase);
			setSupportsLivePassword(result.supportsLivePassword);
			setDefaultShareMode(result.defaultShareMode);
		} else {
			setServer('offline');
		}
	}, [list]);
	useEffect(() => {
		if (open) {
			void reload();
		}
	}, [open, reload]);
	return {
		server,
		pages,
		linkBase,
		supportsLivePassword,
		defaultShareMode,
		reload,
	};
}

export async function copyPageLink(url: string, showStatus: ShowStatus) {
	try {
		await writeClipboard({text: url, html: null});
		showStatus('Link copied.', false, {toast: true});
	} catch {
		showStatus('Could not copy the link.', true);
	}
}

const sizeLabel = (bytes: number) =>
	bytes < 1000 ? `${bytes} B` : `${Math.ceil(bytes / 1000)} kB`;

export function SharedPagesList({
	pages,
	showStatus,
	onDeleted,
	empty = 'No pages shared yet.',
}: {
	pages: readonly SharedPage[];
	showStatus: ShowStatus;
	onDeleted: () => void | Promise<void>;
	empty?: string;
}) {
	const [deleting, setDeleting] = useState<SharedPage>();
	const [busy, setBusy] = useState(false);

	const remove = async (page: SharedPage) => {
		setBusy(true);
		const result = await send('DELETE_SHARED_PAGE', {id: page.id});
		setBusy(false);
		setDeleting(undefined);
		if (result.ok) {
			showStatus(`Deleted ${page.title}. Its link no longer opens.`, false, {
				toast: true,
			});
			await onDeleted();
		} else {
			showStatus(result.error || 'Could not delete the page.', true);
		}
	};

	return (
		<>
			{pages.length === 0 ? (
				<p className="text-sm text-muted-foreground">{empty}</p>
			) : (
				<ul className="divide-y divide-border rounded-lg border border-border">
					{pages.map((page) => (
						<li
							key={page.id}
							className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="min-w-0">
								<div className="flex flex-wrap items-center gap-1.5">
									<a
										className="truncate text-sm font-medium text-primary underline-offset-2 hover:underline"
										href={page.url}
										target="_blank"
										rel="noopener noreferrer"
									>
										{page.title || 'Untitled page'}
									</a>
									<Badge
										variant={page.mode === 'live' ? 'default' : 'secondary'}
									>
										{page.mode === 'live' ? 'Live' : 'Snapshot'}
									</Badge>
									{page.hasPassword && (
										<Badge variant="outline" className="gap-1">
											<Lock className="h-3 w-3" aria-hidden="true" />
											Password
										</Badge>
									)}
								</div>
								<p className="text-xs text-muted-foreground wrap-anywhere">
									{new Date(page.createdAt).toLocaleString([], {
										dateStyle: 'medium',
										timeStyle: 'short',
									})}
									{' · '}
									{sizeLabel(page.size)}
									{' · '}
									<span className="font-mono">{page.url}</span>
								</p>
							</div>
							<div className="flex shrink-0 gap-1">
								<IconTooltip label="Copy link">
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label={`Copy the link to ${page.title}`}
										onClick={() => void copyPageLink(page.url, showStatus)}
									>
										<Copy aria-hidden="true" />
									</Button>
								</IconTooltip>
								<IconTooltip label="Open">
									<Button asChild variant="ghost" size="icon">
										<a
											href={page.url}
											target="_blank"
											rel="noopener noreferrer"
											aria-label={`Open ${page.title}`}
										>
											<ExternalLink aria-hidden="true" />
										</a>
									</Button>
								</IconTooltip>
								<IconTooltip label="Delete">
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label={`Delete ${page.title}`}
										onClick={() => {
											setDeleting(page);
										}}
									>
										<Trash2 aria-hidden="true" />
									</Button>
								</IconTooltip>
							</div>
						</li>
					))}
				</ul>
			)}
			<ConfirmationDialog
				open={deleting !== undefined}
				title="Delete this shared page?"
				description="The page is removed from your server and its link stops working for everyone who has it."
				busy={busy}
				onOpenChange={(open) => {
					if (!open) {
						setDeleting(undefined);
					}
				}}
				onConfirm={() => {
					if (deleting) {
						void remove(deleting);
					}
				}}
			/>
		</>
	);
}

function SharedPagesBody({
	state: {server, pages, reload},
	showStatus,
}: {
	state: SharedPagesState;
	showStatus: ShowStatus;
}) {
	return server === undefined ? (
		<p className="text-sm text-muted-foreground" role="status">
			Asking your server…
		</p>
	) : server === 'none' ? (
		<p className="text-sm text-muted-foreground">
			Connect a sync server in Settings › Sync to share pages by link.
		</p>
	) : server === 'old' ? (
		<p className="text-sm text-muted-foreground">
			Update your sync server to share pages by link.
		</p>
	) : server === 'offline' ? (
		<p className="text-sm text-muted-foreground">
			Cannot reach the server to list shared pages.
		</p>
	) : (
		<SharedPagesList pages={pages} showStatus={showStatus} onDeleted={reload} />
	);
}

export function SharedPagesSettings({showStatus}: {showStatus: ShowStatus}) {
	const headingId = useId();
	const state = useSharedPages(true, true);
	if (state.server === undefined || state.server === 'none') {
		return null;
	}

	return (
		<section aria-labelledby={headingId} className="space-y-2">
			<h3 id={headingId} className="text-sm font-semibold">
				Shared pages
			</h3>
			<SharedPagesBody state={state} showStatus={showStatus} />
		</section>
	);
}

export function SharedPagesDialog({
	open,
	onOpenChange,
	showStatus,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	showStatus: ShowStatus;
}) {
	const state = useSharedPages(open, true);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="lg">
				<DialogHeader>
					<DialogTitle>Shared pages</DialogTitle>
					<DialogDescription>
						Pages you shared by link. Anyone with a link can open its page until
						you delete it.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<ScrollArea type="auto" viewportClassName="max-h-[60dvh]">
						<SharedPagesBody state={state} showStatus={showStatus} />
					</ScrollArea>
				</DialogBody>
				<DialogFooter>
					<Button type="button" onClick={() => onOpenChange(false)}>
						<X aria-hidden="true" />
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
