import {useEffect, useId, useState} from 'react';
import {Copy, ExternalLink, Trash2} from 'lucide-react';
import type {SharedPage} from '../shared/sync/shared-pages-client';
import type {SharedPagesServer} from '../shared/types';
import {Button, ConfirmationDialog, IconTooltip} from '../shared/ui';
import {messageOf, send, type ShowStatus} from './common';
import {writeClipboard} from './interaction-actions';

const privateWindow = () => Boolean(chrome.extension?.inIncognitoContext);

/**
Whether the connected sync server takes shared pages, asked each time `open` turns true. Always `none` in a private
window, whose libraries are never shared.
*/
export function useSharedPagesServer(open: boolean) {
	const [server, setServer] = useState<SharedPagesServer>('none');
	useEffect(() => {
		if (!open || privateWindow()) {
			return;
		}

		let live = true;
		void send('GET_SHARED_PAGES').then((result) => {
			if (live) {
				setServer(result.ok ? result.server : 'none');
			}
		});
		return () => {
			live = false;
		};
	}, [open]);
	return server;
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

/**
Settings › Sync › Shared pages: every page on the server, with its link, and Delete, which takes the link down.
*/
export function SharedPagesSettings({showStatus}: {showStatus: ShowStatus}) {
	const headingId = useId();
	const [server, setServer] = useState<SharedPagesServer>();
	const [pages, setPages] = useState<SharedPage[]>([]);
	const [deleting, setDeleting] = useState<SharedPage>();
	const [busy, setBusy] = useState(false);

	const load = async () => {
		const result = await send('GET_SHARED_PAGES', {list: true});
		if (result.ok) {
			setServer(result.server);
			setPages(result.pages);
		} else {
			setServer('offline');
		}
	};

	useEffect(() => {
		if (!privateWindow()) {
			void load();
		}
	}, []);

	if (server === undefined || server === 'none') {
		return null;
	}

	const remove = async (page: SharedPage) => {
		setBusy(true);
		const result = await send('DELETE_SHARED_PAGE', {id: page.id});
		setBusy(false);
		setDeleting(undefined);
		if (result.ok) {
			showStatus(`Deleted ${page.title}. Its link no longer opens.`, false, {
				toast: true,
			});
			await load();
		} else {
			showStatus(messageOf(result.error) || 'Could not delete the page.', true);
		}
	};

	return (
		<section aria-labelledby={headingId} className="space-y-2">
			<h3 id={headingId} className="text-sm font-semibold">
				Shared pages
			</h3>
			{server === 'old' ? (
				<p className="text-sm text-muted-foreground">
					Update your sync server to share pages by link.
				</p>
			) : server === 'offline' ? (
				<p className="text-sm text-muted-foreground">
					Cannot reach the server to list shared pages.
				</p>
			) : pages.length === 0 ? (
				<p className="text-sm text-muted-foreground">No pages shared yet.</p>
			) : (
				<ul className="divide-y divide-border rounded-lg border border-border">
					{pages.map((page) => (
						<li
							key={page.id}
							className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="min-w-0">
								<a
									className="block truncate text-sm font-medium text-primary underline-offset-2 hover:underline"
									href={page.url}
									target="_blank"
									rel="noopener noreferrer"
								>
									{page.title || 'Untitled page'}
								</a>
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
		</section>
	);
}
