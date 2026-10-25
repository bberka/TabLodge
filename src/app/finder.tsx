// The global finder: a command palette (Ctrl/Cmd+K) and an optional always-visible inline search that share one
// search box, one ranking (global-search.ts) and one way of opening results.
import {
	Fragment,
	useEffect,
	useMemo,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
	AppWindow,
	Columns3,
	CornerDownLeft,
	Folder,
	Globe,
	Layers,
	Search,
	Zap,
} from 'lucide-react';
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	ScrollArea,
} from '../shared/ui';
import type {IconComponent} from './common';
import {
	buildFinderIndex,
	flattenSections,
	searchFinder,
	type FinderCommand,
	type FinderItem,
	type FinderKind,
	type OpenTabInfo,
} from './global-search';
import {highlightSegments} from './fuzzy';
import {isPinnedLodgeTab, openLink} from './link-target';
import type {TabLodgeState} from './types';

/**
A command the finder lists; `run` is called when it is chosen.
*/
export type FinderAction = FinderCommand & {
	icon: IconComponent;
	run: () => void;
};

/**
Window event used to ask the sessions area (a separate component) to reveal a session or folder.
*/
export const FINDER_EVENT = 'tablodge:finder';
export type FinderEventDetail =
	| {type: 'reveal-session'; id: string}
	| {type: 'select-folder'; id: string}
	| {type: 'new-folder'}
	| {type: 'backup-sessions'}
	| {type: 'import-sessions'};

export function emitFinderEvent(detail: FinderEventDetail) {
	globalThis.dispatchEvent(new CustomEvent(FINDER_EVENT, {detail}));
}

const isMac = /mac|iphone|ipad/i.test(globalThis.navigator?.platform ?? '');
export const SHORTCUT_LABEL = isMac ? '⌘K' : 'Ctrl K';
const SHORTCUT_NAME = isMac ? '⌘K' : 'Ctrl+K';

const KIND_ICONS: Partial<Record<FinderKind, IconComponent>> = {
	url: Globe,
	tab: AppWindow,
	session: Layers,
	column: Columns3,
	folder: Folder,
	command: Zap,
	web: Search,
};

const faviconUrl = (url: string) =>
	chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`);

function ResultIcon({item}: {item: FinderItem}) {
	const [failed, setFailed] = useState(false);
	if (item.url && !failed && item.kind !== 'url') {
		return (
			<img
				src={faviconUrl(item.url)}
				alt=""
				className="h-5 w-5 shrink-0 object-contain"
				onError={() => setFailed(true)}
			/>
		);
	}

	const Icon = KIND_ICONS[item.kind] ?? Globe;
	return (
		<Icon
			className="h-4 w-4 shrink-0 text-muted-foreground"
			aria-hidden="true"
		/>
	);
}

function Highlight({text, query}: {text: string; query: string}) {
	return (
		<>
			{highlightSegments(text, query).map((segment, index) =>
				segment.match ? (
					<mark
						key={index}
						className="rounded-sm bg-primary/20 px-0 text-inherit"
					>
						{segment.text}
					</mark>
				) : (
					<Fragment key={index}>{segment.text}</Fragment>
				),
			)}
		</>
	);
}

/**
Open tabs of every window, except this extension's own pages. Re-read whenever `active` turns on.
*/
function useOpenTabs(active: boolean): OpenTabInfo[] {
	const [tabs, setTabs] = useState<OpenTabInfo[]>([]);
	useEffect(() => {
		if (!active) {
			return;
		}

		let cancelled = false;
		const own = chrome.runtime.getURL('');
		void Promise.resolve(chrome.tabs.query({}))
			.then((found) => {
				if (cancelled) {
					return;
				}

				setTabs(
					found.flatMap((tab) =>
						tab.id !== undefined && tab.url && !tab.url.startsWith(own)
							? [
									{
										id: tab.id,
										windowId: tab.windowId,
										title: tab.title ?? '',
										url: tab.url,
									},
								]
							: [],
					),
				);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [active]);
	return tabs;
}

type FinderProps = {
	state: TabLodgeState;
	actions: readonly FinderAction[];
	/**
	Called after a result ran (the palette closes itself).
	*/
	onDone?: () => void;
	variant: 'palette' | 'inline';
	active: boolean;
};

function useFinder({
	state,
	actions,
	onDone,
	active,
}: Omit<FinderProps, 'variant'>) {
	const [query, setQuery] = useState('');
	const [index, setIndex] = useState(0);
	const tabs = useOpenTabs(active);
	const {settings} = state;
	const catalog = useMemo(
		() =>
			buildFinderIndex({
				groups: state.groups,
				folders: state.folders,
				bookmarks: state.bookmarks,
				columns: state.bookmarkColumns,
				tabs,
				commands: actions,
				bookmarksEnabled: settings.bookmarksEnabled,
				sessionsEnabled: settings.sessionsEnabled,
			}),
		[state, tabs, actions, settings.bookmarksEnabled, settings.sessionsEnabled],
	);
	const sections = useMemo(
		() => searchFinder(query, catalog),
		[query, catalog],
	);
	const flat = useMemo(() => flattenSections(sections), [sections]);
	useEffect(() => setIndex(0), [query]);
	const selected = flat.length > 0 ? Math.min(index, flat.length - 1) : -1;

	async function run(item: FinderItem, newTab: boolean) {
		const requested = newTab ? 'new' : undefined;
		try {
			switch (item.kind) {
				case 'command': {
					onDone?.();
					actions.find((action) => action.id === item.ref)?.run();
					return;
				}

				case 'tab': {
					await chrome.tabs.update(Number(item.ref), {active: true});
					if (item.windowId !== undefined) {
						await chrome.windows.update(item.windowId, {focused: true});
					}

					onDone?.();
					return;
				}

				case 'bookmark': {
					onDone?.();
					await openLink(item.url!, 'bookmark', settings, requested);
					return;
				}

				case 'saved-tab': {
					onDone?.();
					await openLink(item.url!, 'session', settings, requested);
					return;
				}

				case 'url': {
					onDone?.();
					await openLink(
						item.url!,
						'bookmark',
						settings,
						requested ?? 'current',
					);
					return;
				}

				case 'session': {
					onDone?.();
					emitFinderEvent({type: 'reveal-session', id: item.ref!});
					return;
				}

				case 'folder': {
					onDone?.();
					emitFinderEvent({type: 'select-folder', id: item.ref!});
					return;
				}

				case 'column': {
					onDone?.();
					revealColumn(item.ref!);
					return;
				}

				case 'web': {
					onDone?.();
					const pinned = settings.keepLodgePinned && (await isPinnedLodgeTab());
					await chrome.search.query({
						text: item.ref!,
						disposition: newTab || pinned ? 'NEW_TAB' : 'CURRENT_TAB',
					});
				}
			}
		} catch {
			// The page may already be navigating away; a failed open has nowhere useful to report.
		}
	}

	function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
		if (event.nativeEvent.isComposing) {
			return;
		}

		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (flat.length > 0) {
				const step = event.key === 'ArrowDown' ? 1 : -1;
				setIndex((selected + step + flat.length) % flat.length);
			}
		} else if (event.key === 'Enter' && selected >= 0) {
			event.preventDefault();
			void run(flat[selected], event.ctrlKey || event.metaKey);
		}
	}

	return {query, setQuery, sections, flat, selected, setIndex, run, onKeyDown};
}

/**
Scrolls the bookmark column into view and rings it briefly.
*/
function revealColumn(id: string) {
	const column = document.querySelector<HTMLElement>(
		`section[data-column-id="${CSS.escape(id)}"]`,
	);
	if (!column) {
		return;
	}

	column.scrollIntoView({block: 'center', behavior: 'smooth'});
	column.classList.add('ring-2', 'ring-primary');
	setTimeout(() => column.classList.remove('ring-2', 'ring-primary'), 1600);
}

function ResultList({
	finder,
	listId,
	viewportClassName,
}: {
	finder: ReturnType<typeof useFinder>;
	listId: string;
	viewportClassName: string;
}) {
	const {query, sections, selected, setIndex, run} = finder;
	let position = -1;
	return (
		<ScrollArea viewportClassName={viewportClassName}>
			<div
				id={listId}
				role="listbox"
				aria-label="Results"
				className="px-2 pb-2"
			>
				{sections.map((section) => (
					<div key={section.kind} role="group" aria-label={section.label}>
						<div className="px-2 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
							{section.label}
						</div>
						{section.items.map((item) => {
							position++;
							const at = position;
							const active = at === selected;
							return (
								<div
									key={item.id}
									id={`${listId}-${at}`}
									role="option"
									aria-selected={active}
									data-active={active || undefined}
									className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 ${active ? 'bg-accent text-accent-foreground' : ''}`}
									onMouseMove={() => !active && setIndex(at)}
									onMouseDown={(event) => event.preventDefault()}
									onClick={(event) =>
										void run(item, event.ctrlKey || event.metaKey)
									}
								>
									<ResultIcon item={item} />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[13px] font-medium">
											{item.kind === 'web' || item.kind === 'url' ? (
												item.title
											) : (
												<Highlight text={item.title} query={query} />
											)}
										</span>
										{item.detail && (
											<span className="block truncate text-[11px] text-muted-foreground">
												{item.kind === 'web' || item.kind === 'url' ? (
													item.detail
												) : (
													<Highlight text={item.detail} query={query} />
												)}
											</span>
										)}
									</span>
									{active && (
										<CornerDownLeft
											className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
											aria-hidden="true"
										/>
									)}
								</div>
							);
						})}
					</div>
				))}
			</div>
		</ScrollArea>
	);
}

function useScrollActiveIntoView(listId: string, selected: number) {
	useEffect(() => {
		document
			.querySelector(`#${CSS.escape(`${listId}-${selected}`)}`)
			?.scrollIntoView({block: 'nearest'});
	}, [listId, selected]);
}

function Kbd({children}: {children: string}) {
	return (
		<kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">
			{children}
		</kbd>
	);
}

/**
The Ctrl/Cmd+K command palette.
*/
export function FinderPalette({
	open,
	onOpenChange,
	...rest
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	state: TabLodgeState;
	actions: readonly FinderAction[];
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				hideClose
				data-finder=""
				className="top-[14vh] max-h-[min(34rem,80vh)] -translate-y-0 gap-0 overflow-hidden p-0"
				size="lg"
			>
				<DialogTitle className="sr-only">Search TabLodge</DialogTitle>
				<DialogDescription className="sr-only">
					Search bookmarks, saved sessions, open tabs and commands, or search
					the web.
				</DialogDescription>
				<PaletteBody {...rest} onDone={() => onOpenChange(false)} />
			</DialogContent>
		</Dialog>
	);
}

function PaletteBody(props: {
	state: TabLodgeState;
	actions: readonly FinderAction[];
	onDone: () => void;
}) {
	const finder = useFinder({...props, active: true});
	const listId = 'finder-palette';
	useScrollActiveIntoView(listId, finder.selected);
	return (
		<div className="flex min-h-0 flex-col">
			<div className="flex items-center gap-2.5 border-b border-border px-4">
				<Search
					className="h-4 w-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<input
					data-autofocus
					role="combobox"
					aria-expanded="true"
					aria-controls={listId}
					aria-activedescendant={
						finder.selected >= 0 ? `${listId}-${finder.selected}` : undefined
					}
					aria-label="Search"
					autoComplete="off"
					spellCheck={false}
					placeholder="Search bookmarks, sessions, open tabs, commands, or the web"
					value={finder.query}
					className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
					onChange={(event) => finder.setQuery(event.target.value)}
					onKeyDown={finder.onKeyDown}
				/>
			</div>
			<ResultList
				finder={finder}
				listId={listId}
				viewportClassName="max-h-[min(26rem,calc(80vh-6.5rem))]"
			/>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
				<span className="flex items-center gap-1">
					<Kbd>↑</Kbd>
					<Kbd>↓</Kbd> Navigate
				</span>
				<span className="flex items-center gap-1">
					<Kbd>Enter</Kbd> Open
				</span>
				<span className="flex items-center gap-1">
					<Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
					<Kbd>Enter</Kbd> New tab
				</span>
				<span className="flex items-center gap-1">
					<Kbd>Esc</Kbd> Close
				</span>
			</div>
		</div>
	);
}

/**
The always-visible finder at the top of the page ("Focus search when opening a new tab"). Its input takes focus
on load and whenever the page becomes visible. Chromium may keep focus in the address bar on a new tab.
*/
export function InlineFinder({
	state,
	actions,
	inputRef,
}: {
	state: TabLodgeState;
	actions: readonly FinderAction[];
	inputRef: {current: HTMLInputElement | null};
}) {
	const [focused, setFocused] = useState(false);
	const finder = useFinder({state, actions, active: true, onDone: undefined});
	const listId = 'finder-inline';
	useScrollActiveIntoView(listId, finder.selected);

	useEffect(() => {
		const focus = () => {
			if (document.visibilityState === 'visible') {
				inputRef.current?.focus({preventScroll: true});
			}
		};

		focus();
		// Chromium may move focus to the address bar just after load, so ask again a few times.
		let timer: ReturnType<typeof setTimeout> | undefined;
		const retry = (attempt: number) => {
			timer = setTimeout(() => {
				focus();
				if (attempt < 2) {
					retry(attempt + 1);
				}
			}, [60, 300, 900][attempt]);
		};

		retry(0);
		document.addEventListener('visibilitychange', focus);
		globalThis.addEventListener('focus', focus);
		return () => {
			clearTimeout(timer);
			document.removeEventListener('visibilitychange', focus);
			globalThis.removeEventListener('focus', focus);
		};
	}, [inputRef]);

	const showResults = focused && finder.query.trim() !== '';
	return (
		<div className="relative mx-auto mb-8 w-full max-w-2xl">
			<div className="relative">
				<Search
					className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<input
					ref={inputRef}
					autoFocus
					role="combobox"
					aria-expanded={showResults}
					aria-controls={listId}
					aria-activedescendant={
						showResults && finder.selected >= 0
							? `${listId}-${finder.selected}`
							: undefined
					}
					aria-label="Search TabLodge or the web"
					autoComplete="off"
					spellCheck={false}
					placeholder="Search bookmarks, sessions, open tabs, or the web"
					value={finder.query}
					className="tn-input h-11 w-full rounded-lg border border-input bg-card pl-10 pr-20 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
					onChange={(event) => finder.setQuery(event.target.value)}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onKeyDown={(event) => {
						if (event.key === 'Escape') {
							finder.setQuery('');
							event.currentTarget.blur();
							return;
						}

						finder.onKeyDown(event);
					}}
				/>
				<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
					<Kbd>{SHORTCUT_LABEL}</Kbd>
				</span>
			</div>
			{showResults && (
				<div className="absolute inset-x-0 top-full z-40 mt-2 overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg">
					<ResultList
						finder={finder}
						listId={listId}
						viewportClassName="max-h-[min(26rem,60vh)]"
					/>
				</div>
			)}
		</div>
	);
}

/**
"Search /" button for the page header; the same size as the neighbouring "Save this window" button.
*/
export function FinderTrigger({onClick}: {onClick: () => void}) {
	return (
		<Button
			variant="outline"
			size="sm"
			aria-label={`Search (/ or ${SHORTCUT_NAME})`}
			title={`Search (/ or ${SHORTCUT_NAME})`}
			onClick={onClick}
		>
			<Search aria-hidden="true" />
			<span className="hidden sm:inline">Search</span>
			<span className="hidden sm:inline">
				<Kbd>/</Kbd>
			</span>
		</Button>
	);
}
