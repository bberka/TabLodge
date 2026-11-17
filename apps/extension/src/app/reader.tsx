import {useEffect, useState, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {ExternalLink, FileText, Trash2} from 'lucide-react';
import {Button, ConfirmationDialog, TooltipProvider} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider} from '../shared/theme';
import type {CopyBlock, PageCopy} from '../shared/page-copy';
import {webUrl} from '../shared/web-url';
import {PrivateWindowAppearance} from './private-window-appearance';
import {
	Brand,
	EmptyState,
	LoadingLine,
	PageShell,
	StatusLine,
	send,
	useStatus,
} from './common';

// The reader for a kept copy: reader.html?url=<address>. Blocks are text, rendered as React text nodes, so nothing
// from the page can run here.

const keptDate = (time: number) =>
	new Intl.DateTimeFormat(undefined, {
		dateStyle: 'long',
		timeStyle: 'short',
	}).format(time);

/**
Consecutive list items become one list.
*/
function renderBlocks(blocks: readonly CopyBlock[]) {
	const out: ReactNode[] = [];
	let items: string[] = [];
	const endList = (key: number) => {
		if (items.length === 0) {
			return;
		}

		out.push(
			<ul key={`list-${key}`} className="list-disc space-y-1.5 ps-6">
				{items.map((text, index) => (
					// A kept copy never changes, so its position is a stable key.
					<li key={`${key}-${index}`}>{text}</li>
				))}
			</ul>,
		);
		items = [];
	};

	for (const [index, block] of blocks.entries()) {
		if (block.type === 'item') {
			items.push(block.text);
			continue;
		}

		endList(index);
		switch (block.type) {
			case 'heading': {
				out.push(
					<h2 key={index} className="pt-3 text-xl font-semibold leading-snug">
						{block.text}
					</h2>,
				);
				break;
			}

			case 'quote': {
				out.push(
					<blockquote
						key={index}
						className="whitespace-pre-line border-s-2 border-primary/60 ps-4 text-muted-foreground"
					>
						{block.text}
					</blockquote>,
				);
				break;
			}

			case 'code': {
				out.push(
					<pre
						key={index}
						className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm leading-6"
					>
						<code>{block.text}</code>
					</pre>,
				);
				break;
			}

			default: {
				out.push(
					<p key={index} className="whitespace-pre-line">
						{block.text}
					</p>,
				);
			}
		}
	}

	endList(blocks.length);
	return out;
}

function Reader() {
	const url = webUrl(new URLSearchParams(location.search).get('url')) ?? '';
	const [copy, setCopy] = useState<PageCopy | null | undefined>();
	const [confirming, setConfirming] = useState(false);
	const [status, showStatus] = useStatus();

	useEffect(() => {
		let live = true;
		void (async () => {
			const result = url
				? await send('GET_PAGE_COPY', {url})
				: {ok: true as const, copy: null};
			if (!live) {
				return;
			}

			if (!result.ok) {
				showStatus(result.error, true);
			}

			setCopy(result.ok ? result.copy : null);
			if (result.ok && result.copy) {
				document.title = `${result.copy.title} · ${document.title}`;
			}
		})();

		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- the address comes from the page's own URL
	}, []);

	async function remove() {
		const result = await send('DELETE_PAGE_COPY', {url});
		setConfirming(false);
		if (!result.ok) {
			showStatus(result.error, true);
			return;
		}

		setCopy(null);
		showStatus('Copy deleted. The link stays saved.', false, {toast: true});
	}

	const original = url && (
		<Button asChild variant="outline" size="sm">
			<a href={url} target="_blank" rel="noopener noreferrer">
				<ExternalLink aria-hidden="true" />
				Open original
			</a>
		</Button>
	);

	return (
		<PageShell className="max-w-3xl">
			<header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
				<Brand />
				<div className="flex flex-wrap gap-2">
					{original}
					{copy && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => setConfirming(true)}
						>
							<Trash2 aria-hidden="true" />
							Delete copy
						</Button>
					)}
				</div>
			</header>
			{copy === undefined ? (
				<LoadingLine />
			) : copy ? (
				<article className="text-base leading-7">
					<h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
						{copy.title}
					</h1>
					<dl className="mt-3 grid gap-x-3 gap-y-1 text-sm text-muted-foreground sm:grid-cols-[auto_minmax(0,1fr)]">
						{copy.byline && (
							<>
								<dt>By</dt>
								<dd>{copy.byline}</dd>
							</>
						)}
						<dt>Kept</dt>
						<dd>
							<time dateTime={new Date(copy.savedAt).toISOString()}>
								{keptDate(copy.savedAt)}
							</time>
						</dd>
						<dt>Original</dt>
						<dd className="min-w-0 break-all">
							<a
								href={copy.url}
								target="_blank"
								rel="noopener noreferrer"
								className="underline underline-offset-2 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
							>
								{copy.url}
							</a>
						</dd>
					</dl>
					<div className="mt-8 space-y-4 border-t border-border pt-6">
						{renderBlocks(copy.blocks)}
					</div>
				</article>
			) : (
				<EmptyState icon={FileText} title="No copy here" action={original}>
					This device has no copy of this page.
				</EmptyState>
			)}
			<ConfirmationDialog
				open={confirming}
				title="Delete this copy?"
				description="The link stays saved. Only the copy on this device is deleted."
				confirmLabel="Delete copy"
				onOpenChange={setConfirming}
				onConfirm={() => void remove()}
			/>
			<StatusLine status={status} />
		</PageShell>
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<PrivateWindowAppearance>
			<TooltipProvider>
				<Reader />
			</TooltipProvider>
		</PrivateWindowAppearance>
	</ThemeProvider>,
);
