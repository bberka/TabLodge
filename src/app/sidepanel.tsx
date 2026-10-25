import {useMemo, useRef, useState, type SyntheticEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {
	Bookmark,
	Copy,
	ExternalLink,
	Pencil,
	Search,
	Settings2,
	Trash2,
	MoreVertical,
} from 'lucide-react';
import {
	Button,
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
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
	Label,
	ScrollArea,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	TooltipProvider,
	IconTooltip,
} from '../shared/ui';
import '../../styles/extension-app.css';
import {ThemeProvider} from '../shared/theme';
import {
	Brand,
	EmptyState,
	LoadError,
	StatusLine,
	send,
	useStatus,
	useTabLodgeState,
} from './common';
import type {Bookmark as SavedBookmark} from './types';
import {PROJECT} from './project';

/**
Stable fallback so memoized values do not see a new array on every render.
*/
const NO_BOOKMARKS: SavedBookmark[] = [];

function SidePanel() {
	const {state, error, reload} = useTabLodgeState();
	const [status, showStatus] = useStatus();
	const [query, setQuery] = useState('');
	const [edit, setEdit] = useState<SavedBookmark | null>(null);
	const [confirmation, setConfirmation] = useState<{
		bookmark: SavedBookmark;
		busy: boolean;
	} | null>(null);
	const focusReturnRef = useRef<HTMLElement | null>(null);
	const bookmarks = state?.bookmarks || NO_BOOKMARKS;
	const columns = state?.bookmarkColumns || [];
	const enabled = state?.settings?.bookmarksEnabled !== false;
	const filtered = useMemo(() => {
		const search = query.trim().toLocaleLowerCase();
		return bookmarks.filter(
			(bookmark) =>
				!search ||
				[bookmark.title, bookmark.url, hostname(bookmark.url)].some((value) =>
					String(value || '')
						.toLocaleLowerCase()
						.includes(search),
				),
		);
	}, [bookmarks, query]);
	const grouped = columns.map((column) => ({
		...column,
		bookmarks: filtered.filter((bookmark) => bookmark.columnId === column.id),
	}));
	const unfiled = filtered.filter(
		(bookmark) =>
			bookmark.columnId === 'bookmark-unfiled' ||
			columns.every((column) => column.id !== bookmark.columnId),
	);

	async function openBookmark(bookmark: SavedBookmark) {
		const url = safeWebUrl(bookmark.url);
		if (!url) {
			showStatus('This bookmark does not contain a valid web address.', true);
			return;
		}

		await chrome.tabs.create({url});
	}

	async function copyBookmark(bookmark: SavedBookmark) {
		try {
			await navigator.clipboard.writeText(bookmark.url);
			showStatus('Bookmark URL copied.');
		} catch {
			showStatus('Could not copy the URL.', true);
		}
	}

	async function saveEdit(event: SyntheticEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!edit) {
			return;
		}

		const result = await send('UPDATE_BOOKMARK', {
			bookmarkId: edit.id,
			fields: edit,
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not update this bookmark.', true);
			return;
		}

		setEdit(null);
		showStatus('Bookmark updated.');
		await reload();
	}

	function askDelete(bookmark: SavedBookmark) {
		focusReturnRef.current = document.activeElement as HTMLElement | null;
		setConfirmation({bookmark, busy: false});
	}

	async function confirmDelete() {
		if (!confirmation || confirmation.busy) {
			return;
		}

		setConfirmation((current) => current && {...current, busy: true});
		const result = await send('DELETE_BOOKMARK', {
			bookmarkId: confirmation.bookmark.id,
		});
		if (!result?.ok) {
			showStatus(result?.error || 'Could not delete this bookmark.', true);
			setConfirmation((current) =>
				current ? {...current, busy: false} : current,
			);
			return;
		}

		setConfirmation(null);
		showStatus('Bookmark deleted.');
		await reload();
	}

	function row(bookmark: SavedBookmark) {
		return (
			<article
				key={bookmark.id}
				className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
			>
				<a
					href={bookmark.url}
					target="_blank"
					rel="noopener noreferrer"
					className="flex min-w-0 flex-1 items-center gap-2"
					title={bookmark.title}
				>
					<span className="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-xs font-semibold text-muted-foreground">
						{hostname(bookmark.url).slice(0, 1).toUpperCase()}
						<img
							src={favicon(bookmark.url)}
							alt=""
							className="absolute inset-0 h-full w-full bg-background object-contain"
							onError={(event) => event.currentTarget.remove()}
						/>
					</span>
					<span className="min-w-0">
						<strong className="block truncate text-xs font-medium">
							{bookmark.title || hostname(bookmark.url)}
						</strong>
						<small className="block truncate text-xs text-muted-foreground">
							{hostname(bookmark.url)}
						</small>
					</span>
				</a>
				<DropdownMenu>
					<IconTooltip label={`Actions for ${bookmark.title}`}>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="h-7 w-7 shrink-0 opacity-70 group-hover:opacity-100"
								aria-label={`Actions for ${bookmark.title}`}
							>
								<MoreVertical className="h-4 w-4" />
							</Button>
						</DropdownMenuTrigger>
					</IconTooltip>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onSelect={() => void openBookmark(bookmark)}>
							<ExternalLink className="h-4 w-4" />
							Open in tab
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => void copyBookmark(bookmark)}>
							<Copy className="h-4 w-4" />
							Copy URL
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={() => setEdit({...bookmark})}>
							<Pencil className="h-4 w-4" />
							Edit
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onSelect={() => askDelete(bookmark)}
						>
							<Trash2 className="h-4 w-4" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</article>
		);
	}

	// Nothing renders until the saved state arrives, so the panel opens on its themed background without a flash.
	if (!state) {
		return error ? (
			<main data-brand="tablodge" className="min-h-screen p-3">
				<LoadError message={error} />
			</main>
		) : null;
	}

	return (
		<main
			data-brand="tablodge"
			className="flex h-screen flex-col overflow-hidden text-foreground"
		>
			<div className="shrink-0 px-3 pt-4">
				<header className="mb-4 flex items-center justify-between gap-2">
					<Brand compact />
					<Button asChild variant="ghost" size="sm">
						<a href="options.html">
							<Settings2 className="h-4 w-4" />
							Settings
						</a>
					</Button>
				</header>
				<div className="relative mb-4">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						type="search"
						aria-label="Search bookmarks"
						placeholder="Search bookmarks"
						value={query}
						className="pl-9"
						onChange={(event) => setQuery(event.target.value)}
					/>
				</div>
			</div>
			<ScrollArea className="min-h-0 flex-1" viewportClassName="px-3 pb-4">
				{!enabled && (
					<div className="mb-3 rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
						Bookmarks are disabled. Your saved links remain stored.
					</div>
				)}
				{enabled && filtered.length === 0 ? (
					<EmptyState
						icon={Bookmark}
						title={query ? 'No bookmarks match' : 'No bookmarks yet'}
					>
						{query ? (
							'Try another title or address.'
						) : (
							<a
								className="font-semibold text-primary hover:underline"
								href="newtab.html#bookmark-library"
							>
								Add bookmarks in {PROJECT.name}
							</a>
						)}
					</EmptyState>
				) : (
					<div className="space-y-4">
						{grouped
							.filter((column) => column.bookmarks.length)
							.map((column) => (
								<section key={column.id} aria-label={column.name}>
									<h2 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
										{column.name}
									</h2>
									<div>{column.bookmarks.map((bookmark) => row(bookmark))}</div>
								</section>
							))}
						{unfiled.length > 0 && (
							<section aria-label="Unfiled bookmarks">
								<h2 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									Unfiled
								</h2>
								<div>{unfiled.map((bookmark) => row(bookmark))}</div>
							</section>
						)}
					</div>
				)}
			</ScrollArea>
			{status?.message && <StatusLine status={status} />}
			<Dialog
				open={Boolean(edit)}
				onOpenChange={(open) => !open && setEdit(null)}
			>
				<DialogContent>
					<form onSubmit={saveEdit}>
						<DialogHeader>
							<DialogTitle>Edit bookmark</DialogTitle>
							<DialogDescription>
								Update the saved title, address, or column.
							</DialogDescription>
						</DialogHeader>
						<DialogBody>
							<div className="space-y-1.5">
								<Label htmlFor="sidepanel-title">Title</Label>
								<Input
									required
									id="sidepanel-title"
									maxLength={500}
									value={edit?.title || ''}
									onChange={(event) =>
										setEdit(
											(current) =>
												current && {...current, title: event.target.value},
										)
									}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="sidepanel-url">Address</Label>
								<Input
									required
									id="sidepanel-url"
									type="url"
									value={edit?.url || ''}
									onChange={(event) =>
										setEdit(
											(current) =>
												current && {...current, url: event.target.value},
										)
									}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="sidepanel-column">Column</Label>
								<Select
									value={edit?.columnId || 'bookmark-unfiled'}
									onValueChange={(value) =>
										setEdit(
											(current) => current && {...current, columnId: value},
										)
									}
								>
									<SelectTrigger id="sidepanel-column">
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
								variant="outline"
								type="button"
								onClick={() => setEdit(null)}
							>
								Cancel
							</Button>
							<Button type="submit">Save changes</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<ConfirmationDialog
				open={Boolean(confirmation)}
				title={`Delete “${confirmation?.bookmark.title}”?`}
				description={`This permanently removes the bookmark from ${PROJECT.name}.`}
				confirmLabel="Delete bookmark"
				busy={Boolean(confirmation?.busy)}
				restoreFocusTo={focusReturnRef.current}
				onOpenChange={(open) => !open && setConfirmation(null)}
				onConfirm={confirmDelete}
			/>
		</main>
	);
}

function safeWebUrl(value: string) {
	try {
		const url = new URL(value);
		return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

function hostname(value: string) {
	try {
		return new URL(value).hostname.replace(/^www\./i, '');
	} catch {
		return value || 'Saved bookmark';
	}
}

function favicon(value: string) {
	return chrome.runtime.getURL(
		`_favicon/?pageUrl=${encodeURIComponent(value)}&size=32`,
	);
}

createRoot(document.querySelector('#root')!).render(
	<ThemeProvider>
		<TooltipProvider>
			<SidePanel />
		</TooltipProvider>
	</ThemeProvider>,
);
