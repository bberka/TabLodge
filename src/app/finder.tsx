// The global finder: the command palette (Ctrl/Cmd+K) with one search box, one ranking (global-search.ts) and one
// way of opening results.
import {
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
	AppWindow,
	Bookmark,
	ChevronRight,
	Columns3,
	CornerDownLeft,
	Folder,
	Globe,
	Layers,
	Link2,
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
import {scrollBehavior} from '../shared/motion';
import {send, useCloseOnEscape, type IconComponent} from './common';
import {
	buildFinderIndex,
	flattenSections,
	searchFinder,
	type FinderCommand,
	type FinderItem,
	type FinderKind,
	type OpenTabInfo,
} from './global-search';
import {faviconUrl} from './favicon';
import {
	filterItemActions,
	itemActions,
	type ItemAction,
	type ItemActionId,
} from './finder-menu';
import {writeClipboard} from './interaction-actions';
import {Highlight} from './highlight';
import {isPinnedLodgeTab, openLink} from './link-target';
import type {TabLodgeState} from './types';
import {cn} from '@/lib/utils';

/**
A command the finder lists; `run` is called when it is chosen.
*/
export type FinderAction = FinderCommand & {
	icon: IconComponent;
	run: () => void | Promise<void>;
};

/**
Window event used to ask the sessions area (a separate component) to reveal a session or folder.
*/
export const FINDER_EVENT = 'tablodge:finder';
export type FinderEventDetail =
	| {type: 'reveal-session'; id: string}
	| {type: 'restore-session'; id: string; newWindow: boolean}
	| {type: 'select-folder'; id: string}
	| {type: 'new-folder'}
	| {type: 'backup-sessions'}
	| {type: 'import-sessions'};

export function emitFinderEvent(detail: FinderEventDetail) {
	globalThis.dispatchEvent(new CustomEvent(FINDER_EVENT, {detail}));
}

const isMac = /mac|iphone|ipad/i.test(globalThis.navigator?.platform ?? '');
const SHORTCUT_NAME = isMac ? '⌘K' : 'Ctrl+K';

const KIND_ICONS: Partial<Record<FinderKind, IconComponent>> = {
	url: Globe,
	tab: AppWindow,
	bookmark: Bookmark,
	'saved-tab': Link2,
	session: Layers,
	column: Columns3,
	folder: Folder,
	command: Zap,
	web: Search,
};

function ResultIcon({
	item,
	commandIcon,
}: {
	item: FinderItem;
	commandIcon?: IconComponent;
}) {
	const [failed, setFailed] = useState(false);
	if (item.url && !failed && item.kind !== 'url' && faviconUrl(item.url)) {
		return (
			<img
				src={faviconUrl(item.url)}
				alt=""
				loading="lazy"
				decoding="async"
				className="h-5 w-5 shrink-0 object-contain"
				onError={() => setFailed(true)}
			/>
		);
	}

	const Icon =
		(item.kind === 'command' && commandIcon) || KIND_ICONS[item.kind] || Globe;
	return (
		<Icon
			className="h-4 w-4 shrink-0 text-muted-foreground"
			aria-hidden="true"
		/>
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
	active: boolean;
	/**
	Set when the finder runs in its own palette window (opened by the browser shortcut) instead of over the dashboard.
	Links, searches and session restores then go to `windowId`, the window that was in front when the shortcut was
	pressed, and the palette window closes after the action succeeded.
	*/
	standalone?: {windowId?: number};
};

function useFinder({state, actions, onDone, active, standalone}: FinderProps) {
	const [query, setQuery] = useState('');
	const [index, setIndex] = useState(0);
	const [error, setError] = useState('');
	// A new query starts again from the first result.
	const changeQuery = (value: string) => {
		setQuery(value);
		setIndex(0);
		setError('');
		setMessage('');
	};

	// The actions menu: the result it was opened for, the highlighted action and the filter typed into it.
	const [menu, setMenu] = useState<{item: FinderItem} | undefined>();
	const [menuIndex, setMenuIndex] = useState(0);
	const [menuFilter, setMenuFilter] = useState('');
	// Heard by a screen reader but not shown: where the keyboard just went.
	const [announcement, setAnnouncement] = useState('');
	// Shown, and heard: the outcome of an action that leaves the palette open.
	const [message, setMessage] = useState('');
	const [closedTabs, setClosedTabs] = useState<readonly number[]>([]);
	const openTabs = useOpenTabs(active);
	const tabs = useMemo(
		() => openTabs.filter((tab) => !closedTabs.includes(tab.id)),
		[openTabs, closedTabs],
	);
	const menuActions = useMemo(
		() =>
			menu
				? filterItemActions(
						itemActions(menu.item, Boolean(standalone)),
						menuFilter,
					)
				: [],
		[menu, menuFilter, standalone],
	);
	const menuSelected =
		menuActions.length > 0 ? Math.min(menuIndex, menuActions.length - 1) : -1;
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
			}),
		[
			state.groups,
			state.folders,
			state.bookmarks,
			state.bookmarkColumns,
			tabs,
			actions,
		],
	);
	// The input stays responsive while a big library is searched: results follow the query when React has time.
	const resultQuery = useDeferredValue(query);
	const sections = useMemo(
		() => searchFinder(resultQuery, catalog),
		[resultQuery, catalog],
	);
	const flat = useMemo(() => flattenSections(sections), [sections]);
	const selected = flat.length > 0 ? Math.min(index, flat.length - 1) : -1;

	/**
	`newTab` (Ctrl/Cmd) opens in a new tab, or a session in a new window. `secondary` (Shift) reveals a session on the
	dashboard instead of restoring it.
	*/
	async function run(item: FinderItem, newTab: boolean, secondary = false) {
		const requested = newTab ? 'new' : undefined;
		// Over the dashboard the palette closes first; in its own window it closes once the action worked.
		const closeFirst = () => {
			if (!standalone) {
				onDone?.();
			}
		};

		const closeLast = () => {
			if (standalone) {
				onDone?.();
			}
		};

		const where = standalone ? {windowId: standalone.windowId} : undefined;
		setError('');
		try {
			switch (item.kind) {
				case 'command': {
					closeFirst();
					await actions.find((action) => action.id === item.ref)?.run();
					closeLast();
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
					closeFirst();
					await openLink(item.url!, 'bookmark', settings, requested, where);
					closeLast();
					return;
				}

				case 'saved-tab': {
					closeFirst();
					await openLink(item.url!, 'session', settings, requested, where);
					closeLast();
					return;
				}

				case 'url': {
					closeFirst();
					await openLink(
						item.url!,
						'bookmark',
						settings,
						requested ?? 'current',
						where,
					);
					closeLast();
					return;
				}

				case 'session': {
					if (standalone) {
						const result = await send('RESTORE_GROUP', {
							groupId: item.ref!,
							restoreTarget: newTab ? 'always-new-window' : undefined,
						});
						if (!result?.ok) {
							setError(result?.error || 'Could not restore this session.');
							return;
						}

						await focusWindow(standalone.windowId, newTab);
						onDone?.();
						return;
					}

					onDone?.();
					emitFinderEvent(
						secondary
							? {type: 'reveal-session', id: item.ref!}
							: {type: 'restore-session', id: item.ref!, newWindow: newTab},
					);
					return;
				}

				case 'folder': {
					closeFirst();
					emitFinderEvent({type: 'select-folder', id: item.ref!});
					return;
				}

				case 'column': {
					closeFirst();
					revealColumn(item.ref!);
					return;
				}

				case 'web': {
					closeFirst();
					if (standalone) {
						await searchInWindow(item.ref!, standalone.windowId, newTab);
						closeLast();
						return;
					}

					const pinned = settings.keepLodgePinned && (await isPinnedLodgeTab());
					await chrome.search.query({
						text: item.ref!,
						disposition: newTab || pinned ? 'NEW_TAB' : 'CURRENT_TAB',
					});
				}
			}
		} catch (error_) {
			// Over the dashboard the page may already be navigating away. In the palette window the user is still looking.
			if (standalone) {
				setError(
					error_ instanceof Error && error_.message
						? error_.message
						: 'Could not do that.',
				);
			}
		}
	}

	function openMenu(item: FinderItem | undefined) {
		if (!item) {
			return;
		}

		const available = itemActions(item, Boolean(standalone));
		if (available.length === 0) {
			return;
		}

		setMenu({item});
		setMenuIndex(0);
		setMenuFilter('');
		setError('');
		setMessage('');
		setAnnouncement(`Actions for ${item.title}, ${available.length} actions`);
	}

	/**
	Leaves the actions menu for the results. Returns false when no menu was open.
	*/
	function closeMenu() {
		if (!menu) {
			return false;
		}

		setMenu(undefined);
		setAnnouncement('Back to results');
		return true;
	}

	async function runAction(item: FinderItem, action: ItemActionId) {
		setError('');
		try {
			switch (action) {
				case 'restore':
				case 'open':
				case 'switch': {
					await run(item, false);
					return;
				}

				case 'restore-new-window':
				case 'open-new-tab': {
					await run(item, true);
					return;
				}

				case 'reveal': {
					await run(item, false, true);
					return;
				}

				case 'open-new-window': {
					await chrome.windows.create({url: item.url});
					onDone?.();
					return;
				}

				case 'copy-link': {
					await writeClipboard({text: item.url ?? '', html: ''});
					setMenu(undefined);
					setMessage('Link copied.');
					return;
				}

				case 'close-tab': {
					await chrome.tabs.remove(Number(item.ref));
					setClosedTabs((closed) => [...closed, Number(item.ref)]);
					setMenu(undefined);
					setMessage('Tab closed.');
				}
			}
		} catch (error_) {
			setError(
				error_ instanceof Error && error_.message
					? error_.message
					: 'Could not do that.',
			);
		}
	}

	function onMenuKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
		if (!menu) {
			return;
		}

		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (menuActions.length > 0) {
				const step = event.key === 'ArrowDown' ? 1 : -1;
				setMenuIndex(
					(menuSelected + step + menuActions.length) % menuActions.length,
				);
			}
		} else if (event.key === 'Enter' && menuSelected >= 0) {
			event.preventDefault();
			void runAction(menu.item, menuActions[menuSelected].id);
		} else if (
			event.key === 'Escape' ||
			(event.key === 'Backspace' && menuFilter === '')
		) {
			// Escape goes up one level before it closes the palette; the window and dialog handlers skip a handled key.
			event.preventDefault();
			closeMenu();
		}
	}

	function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
		if (event.nativeEvent.isComposing) {
			return;
		}

		if (menu) {
			onMenuKeyDown(event);
			return;
		}

		const input = event.currentTarget;
		const atEnd =
			input.selectionStart === input.value.length &&
			input.selectionEnd === input.value.length;
		if (
			event.key === 'ArrowRight' &&
			atEnd &&
			!event.shiftKey &&
			selected >= 0 &&
			itemActions(flat[selected], Boolean(standalone)).length > 0
		) {
			event.preventDefault();
			openMenu(flat[selected]);
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (flat.length > 0) {
				const step = event.key === 'ArrowDown' ? 1 : -1;
				setIndex((selected + step + flat.length) % flat.length);
			}
		} else if (event.key === 'Enter' && selected >= 0) {
			event.preventDefault();
			void run(flat[selected], event.ctrlKey || event.metaKey, event.shiftKey);
		}
	}

	const commandIcons = useMemo(
		() => new Map(actions.map((action) => [action.id, action.icon])),
		[actions],
	);
	return {
		commandIcons,
		query,
		resultQuery,
		error,
		changeQuery,
		menu,
		menuActions,
		menuSelected,
		setMenuIndex,
		menuFilter,
		changeMenuFilter(value: string) {
			setMenuFilter(value);
			setMenuIndex(0);
		},
		openMenu,
		closeMenu,
		runAction,
		announcement,
		message,
		sections,
		flat,
		selected,
		setIndex,
		run,
		onKeyDown,
	};
}

/**
Brings the window the palette was opened over back to the front. A restore into a new window already focuses that one.
*/
async function focusWindow(windowId: number | undefined, newWindow: boolean) {
	if (windowId === undefined || newWindow) {
		return;
	}

	try {
		await chrome.windows.update(windowId, {focused: true});
	} catch {
		// The window may have closed meanwhile; the restore itself worked.
	}
}

/**
Searches the web with the default search engine in the active tab of `windowId`, or in a new tab.
*/
async function searchInWindow(
	text: string,
	windowId: number | undefined,
	newTab: boolean,
) {
	const [active] =
		windowId === undefined
			? []
			: await chrome.tabs.query({active: true, windowId});
	const tab =
		newTab || active?.id === undefined
			? await chrome.tabs.create({windowId, url: 'about:blank'})
			: active;
	await chrome.search.query({text, tabId: tab.id});
	await focusWindow(windowId, false);
}

/**
Scrolls the bookmark column into view and rings it briefly.
*/
function revealColumn(id: string) {
	const selector = `section[data-column-id="${CSS.escape(id)}"]`;
	const reveal = () => {
		const column = document.querySelector<HTMLElement>(selector);
		if (!column) {
			return false;
		}

		column.scrollIntoView({block: 'center', behavior: scrollBehavior()});
		column.classList.add('ring-2', 'ring-primary');
		setTimeout(() => column.classList.remove('ring-2', 'ring-primary'), 1600);
		return true;
	};

	if (reveal()) {
		return;
	}

	// The Focus view renders one column at a time, so open it from the rail first.
	const railItem = document.querySelector<HTMLElement>(
		`[data-focus-column="${CSS.escape(id)}"]`,
	);
	if (!railItem) {
		return;
	}

	railItem.click();
	requestAnimationFrame(() => {
		requestAnimationFrame(reveal);
	});
}

function ResultList({
	finder,
	listId,
	areaClassName,
	viewportClassName,
	standalone,
}: {
	finder: ReturnType<typeof useFinder>;
	listId: string;
	areaClassName?: string;
	viewportClassName?: string;
	standalone: boolean;
}) {
	const {
		resultQuery: query,
		sections,
		selected,
		setIndex,
		run,
		commandIcons,
	} = finder;
	let position = -1;
	const count = sections.reduce(
		(total, section) => total + section.items.length,
		0,
	);
	return (
		<>
			{/* Moving through results announces each option; this says how many a new search found. */}
			<p role="status" className="sr-only">
				{query.trim() ? `${count} ${count === 1 ? 'result' : 'results'}` : ''}
			</p>
			<ScrollArea
				className={areaClassName}
				viewportClassName={viewportClassName}
			>
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
										className={cn(
											'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5',
											active && 'bg-accent text-accent-foreground',
										)}
										onMouseMove={() => !active && setIndex(at)}
										onMouseDown={(event) => event.preventDefault()}
										onContextMenu={(event) => {
											event.preventDefault();
											setIndex(at);
											finder.openMenu(item);
										}}
										onClick={(event) =>
											void run(
												item,
												event.ctrlKey || event.metaKey,
												event.shiftKey,
											)
										}
									>
										<ResultIcon
											item={item}
											commandIcon={
												item.kind === 'command'
													? commandIcons.get(item.ref!)
													: undefined
											}
										/>
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
										{active &&
											itemActions(item, Boolean(standalone)).length > 0 && (
												<ChevronRight
													className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
													aria-hidden="true"
												/>
											)}
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
		</>
	);
}

/**
The second level: what can be done with the result chosen with the right arrow. The search box stays the combobox and
filters these actions; the breadcrumb names where you are.
*/
function ActionMenu({
	finder,
	listId,
	areaClassName,
	viewportClassName,
}: {
	finder: ReturnType<typeof useFinder>;
	listId: string;
	areaClassName?: string;
	viewportClassName?: string;
}) {
	const {menu, menuActions, menuSelected, setMenuIndex, runAction} = finder;
	if (!menu) {
		return null;
	}

	return (
		<>
			<nav
				aria-label="Breadcrumb"
				className="flex shrink-0 items-center gap-1 px-4 py-2 text-xs text-muted-foreground"
			>
				<ol className="flex min-w-0 items-center gap-1">
					<li className="shrink-0">
						<button
							type="button"
							tabIndex={-1}
							className="rounded-sm underline-offset-2 hover:text-foreground hover:underline"
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => finder.closeMenu()}
						>
							Search
						</button>
					</li>
					<li aria-hidden="true" className="shrink-0">
						<ChevronRight className="h-3 w-3" />
					</li>
					<li aria-current="page" className="min-w-0 truncate text-foreground">
						{menu.item.title}
					</li>
				</ol>
			</nav>
			<ScrollArea
				className={areaClassName}
				viewportClassName={viewportClassName}
			>
				<div
					id={listId}
					role="listbox"
					aria-label={`Actions for ${menu.item.title}`}
					className="px-2 pb-2"
				>
					{menuActions.map((action: ItemAction, at: number) => {
						const active = at === menuSelected;
						return (
							<div
								key={action.id}
								id={`${listId}-${at}`}
								role="option"
								aria-selected={active}
								data-active={active || undefined}
								className={cn(
									'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2',
									active && 'bg-accent text-accent-foreground',
								)}
								onMouseMove={() => !active && setMenuIndex(at)}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => void runAction(menu.item, action.id)}
							>
								<span className="min-w-0 flex-1 truncate text-[13px] font-medium">
									{action.label}
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
					{menuActions.length === 0 && (
						<p className="px-2 py-3 text-xs text-muted-foreground">
							No matching actions.
						</p>
					)}
				</div>
			</ScrollArea>
		</>
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
		<kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">
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
	const backRef = useRef<() => boolean>(() => false);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				hideClose
				data-finder=""
				className="top-[14vh] max-h-[min(34rem,80vh)] translate-y-0 gap-0 overflow-hidden p-0"
				size="lg"
				// Escape leaves the actions menu first and closes the palette on the next press.
				onEscapeKeyDown={(event) => {
					if (backRef.current()) {
						event.preventDefault();
					}
				}}
			>
				<DialogTitle className="sr-only">Search TabLodge</DialogTitle>
				<DialogDescription className="sr-only">
					Search bookmarks, saved sessions, open tabs and commands, or search
					the web.
				</DialogDescription>
				<PaletteBody
					{...rest}
					backRef={backRef}
					onDone={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}

function PaletteBody(props: {
	state: TabLodgeState;
	actions: readonly FinderAction[];
	onDone: () => void;
	standalone?: {windowId?: number};
	/**
	Filled with a function that leaves the actions menu (true when one was open), for a Escape handler outside.
	*/
	backRef?: {current: () => boolean};
}) {
	const finder = useFinder({...props, active: true});
	const {backRef} = props;
	const {closeMenu} = finder;
	useEffect(() => {
		if (backRef) {
			backRef.current = closeMenu;
		}
	});

	const listId = finder.menu ? 'finder-actions' : 'finder-palette';
	const activeIndex = finder.menu ? finder.menuSelected : finder.selected;
	const inputRef = useRef<HTMLInputElement>(null);
	useScrollActiveIntoView(listId, activeIndex);
	// The palette window has no dialog to move focus into the input.
	useEffect(() => {
		if (props.standalone) {
			inputRef.current?.focus();
		}
	}, [props.standalone]);
	const current = finder.flat[finder.selected];
	const onSession = current?.kind === 'session';
	const hasActions =
		current !== undefined &&
		itemActions(current, Boolean(props.standalone)).length > 0;
	// The dialog caps the list height. The palette window fills its height instead: the list takes the spare room
	// (and scrolls when it overflows) so the shortcut bar stays at the bottom edge.
	let viewportClassName: string | undefined = finder.menu
		? 'max-h-[min(26rem,calc(80vh-9rem))]'
		: 'max-h-[min(26rem,calc(80vh-6.5rem))]';
	if (props.standalone) {
		viewportClassName = undefined;
	}

	const areaClassName = props.standalone ? 'min-h-0 flex-1' : undefined;

	const modifier = isMac ? '⌘' : 'Ctrl';
	return (
		<div
			className={cn(
				'flex min-h-0 flex-col',
				props.standalone && 'h-full flex-1',
			)}
		>
			<div className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 focus-within:shadow-[inset_0_-2px_0_0_rgb(var(--ring))]">
				<Search
					className="h-4 w-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<input
					ref={inputRef}
					data-autofocus
					role="combobox"
					aria-expanded="true"
					aria-controls={listId}
					aria-activedescendant={
						activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
					}
					aria-label={finder.menu ? 'Filter actions' : 'Search'}
					autoComplete="off"
					spellCheck={false}
					placeholder={
						finder.menu
							? 'Filter actions'
							: 'Search bookmarks, sessions, open tabs, commands, or the web'
					}
					value={finder.menu ? finder.menuFilter : finder.query}
					className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
					onChange={(event) =>
						finder.menu
							? finder.changeMenuFilter(event.target.value)
							: finder.changeQuery(event.target.value)
					}
					onKeyDown={finder.onKeyDown}
				/>
			</div>
			{finder.error && (
				<p role="alert" className="px-4 py-2 text-xs text-destructive">
					{finder.error}
				</p>
			)}
			<p role="status" className="sr-only">
				{finder.announcement}
			</p>
			{finder.message && (
				<p role="status" className="px-4 py-2 text-xs text-muted-foreground">
					{finder.message}
				</p>
			)}
			{finder.menu ? (
				<ActionMenu
					finder={finder}
					listId={listId}
					areaClassName={areaClassName}
					viewportClassName={viewportClassName}
				/>
			) : (
				<ResultList
					finder={finder}
					listId={listId}
					areaClassName={areaClassName}
					viewportClassName={viewportClassName}
					standalone={Boolean(props.standalone)}
				/>
			)}
			<div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
				<span className="flex items-center gap-1">
					<Kbd>↑</Kbd>
					<Kbd>↓</Kbd> Navigate
				</span>
				{finder.menu ? (
					<>
						<span className="flex items-center gap-1">
							<Kbd>Enter</Kbd> Run
						</span>
						<span className="flex items-center gap-1">
							<Kbd>Esc</Kbd>
							<Kbd>Backspace</Kbd> Back
						</span>
					</>
				) : (
					<>
						<span className="flex items-center gap-1">
							<Kbd>Enter</Kbd> {onSession ? 'Restore' : 'Open'}
						</span>
						<span className="flex items-center gap-1">
							<Kbd>{modifier}</Kbd>
							<Kbd>Enter</Kbd> {onSession ? 'New window' : 'New tab'}
						</span>
						{onSession && !props.standalone && (
							<span className="flex items-center gap-1">
								<Kbd>Shift</Kbd>
								<Kbd>Enter</Kbd> Reveal
							</span>
						)}
						{hasActions && (
							<span className="flex items-center gap-1">
								<Kbd>→</Kbd> Actions
							</span>
						)}
						<span className="flex items-center gap-1">
							<Kbd>Esc</Kbd> Close
						</span>
					</>
				)}
			</div>
		</div>
	);
}

/**
Closes the palette window when another window takes the focus, the way a menu closes when you click away. Only a
real popup window does this: the same page opened as a tab by address stays open. The short wait skips the
blur the browser sends while the window is still being focused, and a focus that came back in between.
*/
function useCloseWhenUnfocused(enabled: boolean) {
	useEffect(() => {
		if (!enabled) {
			return;
		}

		let timer: ReturnType<typeof setTimeout> | undefined;
		let popup = false;
		void Promise.resolve(chrome.windows.getCurrent())
			.then((current) => {
				popup = current.type === 'popup';
			})
			.catch(() => {});
		const onBlur = () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				if (popup && !document.hasFocus()) {
					globalThis.close();
				}
			}, 150);
		};

		const onFocus = () => clearTimeout(timer);
		globalThis.addEventListener('blur', onBlur);
		globalThis.addEventListener('focus', onFocus);
		return () => {
			clearTimeout(timer);
			globalThis.removeEventListener('blur', onBlur);
			globalThis.removeEventListener('focus', onFocus);
		};
	}, [enabled]);
}

/**
The palette as the whole page of its own small window (palette.html), opened by the "Open the search palette"
browser shortcut from any page. `windowId` is the window the shortcut was pressed in. Escape closes the window.
*/
export function FinderPaletteWindow({
	state,
	actions,
	windowId,
	overlay = false,
}: {
	state: TabLodgeState;
	actions: readonly FinderAction[];
	windowId?: number;
	/**
	The palette is a frame over a web page (see palette-overlay.ts): closing asks the page to remove the frame, and Tab
	stays inside it.
	*/
	overlay?: boolean;
}) {
	const close = useCallback(() => {
		if (overlay) {
			globalThis.parent.postMessage({type: 'tablodge-palette-close'}, '*');
		} else {
			globalThis.close();
		}
	}, [overlay]);
	useCloseOnEscape(close);
	useCloseWhenUnfocused(!overlay);
	useEffect(() => {
		if (!overlay) {
			return;
		}

		// The search box is the only stop, so Tab has nowhere to go inside the frame and must not reach the page.
		const trap = (event: KeyboardEvent) => {
			if (event.key === 'Tab') {
				event.preventDefault();
			}
		};

		document.addEventListener('keydown', trap);
		return () => document.removeEventListener('keydown', trap);
	}, [overlay]);
	const standalone = useMemo(() => ({windowId}), [windowId]);
	return (
		<main
			aria-label="Search TabLodge"
			className="flex h-screen flex-col bg-background"
		>
			<PaletteBody
				state={state}
				actions={actions}
				standalone={standalone}
				onDone={close}
			/>
		</main>
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
