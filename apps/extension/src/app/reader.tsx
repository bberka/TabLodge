import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import {ExternalLink, FileText, Trash2} from 'lucide-react';
import {Button, TooltipProvider} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider} from '../shared/theme';
import {COPY_DELETED, type CopyBlock, type PageCopy} from '../shared/page-copy';
import {webUrl} from '../shared/web-url';
import {PrivateWindowAppearance} from './private-window-appearance';
import {offerUndo} from './recovery-core';
import {
	Brand,
	EmptyState,
	LoadingLine,
	PageShell,
	StatusLine,
	send,
	useStatus,
} from './common';

const keptDate = (time: number) =>
	new Intl.DateTimeFormat(undefined, {
		dateStyle: 'long',
		timeStyle: 'short',
	}).format(time);

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
						className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm leading-[1.7143]"
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

const url = webUrl(new URLSearchParams(location.search).get('url')) ?? '';
const pageTitle = document.title;

function Reader() {
	const [copy, setCopy] = useState<PageCopy | null | undefined>();
	const [loadError, setLoadError] = useState('');
	const [status, showStatus] = useStatus();
	const deletingRef = useRef(false);

	const load = useCallback(async (isLive: () => boolean = () => true) => {
		const result = url
			? await send('GET_PAGE_COPY', {url})
			: {ok: true as const, copy: null};
		if (!isLive()) {
			return;
		}

		setLoadError(result.ok ? '' : result.error);
		setCopy(result.ok ? result.copy : null);
	}, []);

	useEffect(() => {
		document.title = copy ? `${copy.title} · ${pageTitle}` : pageTitle;
	}, [copy]);

	useEffect(() => {
		let live = true;
		void load(() => live);
		return () => {
			live = false;
		};
	}, [load]);

	async function remove() {
		if (deletingRef.current) {
			return;
		}

		deletingRef.current = true;
		const result = await send('DELETE_PAGE_COPY', {url});
		deletingRef.current = false;
		if (!result.ok) {
			showStatus(result.error, true);
			return;
		}

		setCopy(null);
		offerUndo(COPY_DELETED, result.undoId, showStatus, async () => load());
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
						<Button variant="outline" size="sm" onClick={() => void remove()}>
							<Trash2 aria-hidden="true" />
							Delete copy
						</Button>
					)}
				</div>
			</header>
			{copy === undefined ? (
				<LoadingLine />
			) : copy ? (
				<article className="text-base leading-[1.75]">
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
					{loadError || 'This device has no copy of this page.'}
				</EmptyState>
			)}
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
