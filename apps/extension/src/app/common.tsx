import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type ComponentPropsWithoutRef,
	type ComponentType,
	type CSSProperties,
	type ReactNode,
} from 'react';
import {Bookmark, CircleAlert, CircleCheck, Info, X} from 'lucide-react';
import {applyStateChanges} from '../shared/state-changes';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '../shared/ui';
import type {
	ActionFailure,
	ActionResult,
	SaveResult,
	TabLodgeState,
} from '../shared/types';
import {
	REOPEN_FAILED,
	reopenedMessage,
	saveMessage,
	saveOutcomeOf,
	UNDO_LABEL,
} from '../shared/save-feedback';
import {webUrl} from '../shared/web-url';
import {hostIsExcluded} from '../shared/excluded-sites';
import {
	toastEdges,
	toastMs,
	toastPlace,
	type ToastDuration,
	type ToastPosition,
} from '../shared/toast-prefs';
import {PrivateWindowMark} from './private-window-appearance';
import {
	PRIVATE_CONFIG_KEY,
	PRIVATE_STORAGE_PREFIX,
	privateConfigNeedsReload,
	reloadPrivatePage,
} from './private-config';
import {onUndoOffer, send} from './message-client';
import {PROJECT} from './project';
import {plural} from './plural';
import {cn} from '@/lib/utils';

const STORAGE_KEY = 'tablodge.state';

export const messageOf = (reason: unknown) =>
	(reason as {message?: string} | null | undefined)?.message;

export function useCloseOnEscape(
	close: () => void = () => {
		window.close();
	},
) {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !event.defaultPrevented) {
				close();
			}
		};

		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [close]);
}

export function useTabSelection(includePinned: boolean) {
	const [selection, setSelection] = useState({selected: false, count: 0});
	useEffect(() => {
		if (!chrome.tabs?.query) {
			return;
		}

		let alive = true;
		const slot = (tab: chrome.tabs.Tab) => {
			const split = (tab as {splitViewId?: number}).splitViewId ?? -1;
			return split >= 0 ? `split:${split}` : `tab:${tab.id}`;
		};

		const read = async () => {
			try {
				const tabs = await chrome.tabs.query({
					currentWindow: true,
					highlighted: true,
				});
				const selected = new Set(tabs.map((tab) => slot(tab))).size > 1;
				const count = new Set(
					tabs
						.filter(
							(tab) =>
								/^https?:\/\//i.test(tab.url || '') &&
								(includePinned || !tab.pinned),
						)
						.map((tab) => slot(tab)),
				).size;
				if (alive) {
					setSelection({selected, count});
				}
			} catch {}
		};

		void read();
		const onChange = () => void read();
		chrome.tabs.onHighlighted.addListener(onChange);
		chrome.tabs.onRemoved.addListener(onChange);
		chrome.tabs.onAttached?.addListener(onChange);
		chrome.tabs.onDetached?.addListener(onChange);
		return () => {
			alive = false;
			chrome.tabs.onHighlighted.removeListener(onChange);
			chrome.tabs.onRemoved.removeListener(onChange);
			chrome.tabs.onAttached?.removeListener(onChange);
			chrome.tabs.onDetached?.removeListener(onChange);
		};
	}, [includePinned]);
	return selection;
}

export function useHasSavableTabs(
	includePinned: boolean,
	excludedOrigins: readonly string[],
) {
	const [found, setFound] = useState(false);
	const excludedKey = excludedOrigins.join('\n');
	useEffect(() => {
		if (!chrome.tabs?.query) {
			return;
		}

		let alive = true;
		const excluded = excludedKey ? excludedKey.split('\n') : [];
		const read = async () => {
			try {
				const tabs = await chrome.tabs.query({currentWindow: true});
				const savable = tabs.some((tab) => {
					const url = webUrl(tab.url);
					return (
						url !== null &&
						(includePinned || !tab.pinned) &&
						!hostIsExcluded(new URL(url).hostname, excluded)
					);
				});
				if (alive) {
					setFound(savable);
				}
			} catch {}
		};

		void read();
		const onChange = () => void read();
		const events = [
			chrome.tabs.onCreated,
			chrome.tabs.onUpdated,
			chrome.tabs.onRemoved,
			chrome.tabs.onAttached,
			chrome.tabs.onDetached,
		];
		for (const event of events) {
			event?.addListener(onChange);
		}

		return () => {
			alive = false;
			for (const event of events) {
				event?.removeListener(onChange);
			}
		};
	}, [includePinned, excludedKey]);
	return found;
}

export function saveWindowLabel(selection: {selected: boolean; count: number}) {
	return selection.selected
		? `Save ${selection.count} selected ${selection.count === 1 ? 'tab' : 'tabs'}`
		: 'Save this window';
}

export function switchSummary(
	result: {
		saved: number;
		count: number;
		failed?: number;
		savedGroupId?: string | null;
	},
	name: string,
) {
	const parts = [
		result.saved > 0
			? `Saved ${plural(result.saved, 'tab')}`
			: result.savedGroupId
				? 'Already saved'
				: 'Nothing to save',
		`opened ${plural(result.count, 'tab')} from “${name}”`,
	];
	if (result.failed) {
		parts.push(`${result.failed} failed`);
	}

	return `${parts.join(', ')}.`;
}

export type IconComponent = ComponentType<{
	className?: string;
	'aria-hidden'?: boolean | 'true' | 'false';
}>;

const STORAGE_RELOAD_DELAY_MS = 60;

const jsonCache = new WeakMap<object, string>();
const jsonOf = (value: object) => {
	let json = jsonCache.get(value);
	if (json === undefined) {
		json = JSON.stringify(value);
		jsonCache.set(value, json);
	}

	return json;
};

function shareUnchanged<T extends {id: string}>(
	previous: readonly T[] | undefined,
	next: T[],
): T[] {
	if (!previous || previous.length === 0) {
		return next;
	}

	const old = new Map(previous.map((item) => [item.id, item]));
	let same = previous.length === next.length;
	const merged = next.map((item, index) => {
		const before = old.get(item.id);
		const keep = before && jsonOf(before) === JSON.stringify(item);
		if (keep) {
			jsonCache.set(item, jsonOf(before));
			if (previous[index] !== before) {
				same = false;
			}

			return before;
		}

		same = false;
		return item;
	});
	return same ? (previous as T[]) : merged;
}

function shareValue<T extends object>(previous: T | undefined, next: T): T {
	return previous && jsonOf(previous) === JSON.stringify(next)
		? previous
		: next;
}

function withSharedReferences(
	old: TabLodgeState | null,
	next: TabLodgeState,
): TabLodgeState {
	const groups = Array.isArray(next.groups) ? next.groups : [];
	const folders = Array.isArray(next.folders)
		? next.folders
		: [{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true}];
	const bookmarkColumns = Array.isArray(next.bookmarkColumns)
		? next.bookmarkColumns
		: [
				{
					id: 'bookmark-default',
					name: 'Bookmarks',
					createdAt: 0,
					isDefault: true,
				},
			];
	const bookmarks = Array.isArray(next.bookmarks) ? next.bookmarks : [];
	return {
		...next,
		groups: shareUnchanged(old?.groups, groups),
		folders: shareUnchanged(old?.folders, folders),
		bookmarkColumns: shareUnchanged(old?.bookmarkColumns, bookmarkColumns),
		bookmarks: shareUnchanged(old?.bookmarks, bookmarks),
		settings:
			next.settings && old?.settings
				? shareValue(old.settings, next.settings)
				: next.settings,
	};
}

function withSharedRoot(
	old: TabLodgeState,
	next: TabLodgeState,
): TabLodgeState {
	return {
		...next,
		folders: shareUnchanged(old.folders, next.folders),
		bookmarkColumns: shareUnchanged(old.bookmarkColumns, next.bookmarkColumns),
		settings: shareValue(old.settings, next.settings),
	};
}

const RETRY_DELAYS_MS = [150, 300, 600, 1000, 1500];
const wait = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
const isTransportError = (reason: unknown) =>
	/receiving end does not exist|could not establish connection|message port closed|extension context invalidated/i.test(
		String(messageOf(reason) || reason || ''),
	);

export function useTabLodgeState(
	initialRequest?: Promise<ActionResult<'GET_STATE'> | undefined>,
) {
	const [state, setState] = useState<TabLodgeState | null>(null);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(true);
	const initialRequestRef = useRef(initialRequest);
	const latestRequestRef = useRef(0);
	const mountedRef = useRef(true);
	const heldRef = useRef<TabLodgeState | null>(null);
	const hold = useCallback((next: TabLodgeState) => {
		heldRef.current = next;
		setState(next);
	}, []);
	const load = useCallback(async (): Promise<TabLodgeState | null> => {
		latestRequestRef.current += 1;
		const request = latestRequestRef.current;
		try {
			let result: ActionResult<'GET_STATE'> | ActionFailure | undefined;
			for (let attempt = 0; ; attempt += 1) {
				try {
					const firstRequest = initialRequestRef.current;
					initialRequestRef.current = undefined;
					result = firstRequest ? await firstRequest : await send('GET_STATE');
				} catch (reason) {
					if (!isTransportError(reason) || attempt >= RETRY_DELAYS_MS.length) {
						throw reason;
					}

					await wait(RETRY_DELAYS_MS[attempt]);
					continue;
				}

				if (result || attempt >= RETRY_DELAYS_MS.length) {
					break;
				}

				await wait(RETRY_DELAYS_MS[attempt]);
			}

			if (!result?.ok) {
				throw new Error(
					result?.error || `${PROJECT.name} could not load saved data.`,
				);
			}

			if (request !== latestRequestRef.current || !mountedRef.current) {
				return result;
			}

			hold(withSharedReferences(heldRef.current, result));
			setError('');
			return result;
		} catch (reason) {
			if (request !== latestRequestRef.current || !mountedRef.current) {
				return null;
			}

			setError(
				isTransportError(reason)
					? `${PROJECT.name}’s background service is not responding. Reload the page or the extension and try again.`
					: String(
							messageOf(reason) || `${PROJECT.name} could not load saved data.`,
						),
			);
			return null;
		} finally {
			if (request === latestRequestRef.current && mountedRef.current) {
				setLoading(false);
			}
		}
	}, [hold]);

	const applyChanges = useCallback(async (): Promise<TabLodgeState | null> => {
		const since = heldRef.current?.revision;
		if (!since) {
			return load();
		}

		const answer = await send('GET_STATE_CHANGES', {since});
		const held = heldRef.current;
		const next =
			held && answer.ok && answer.changes
				? applyStateChanges(held, answer.changes)
				: undefined;
		if (!next) {
			return load();
		}

		if (mountedRef.current) {
			if (next !== held) {
				hold(withSharedRoot(held!, next));
			}

			setError('');
		}

		return heldRef.current;
	}, [hold, load]);

	const queueRef = useRef<Promise<unknown>>(Promise.resolve());
	const refresh = useCallback(async () => {
		const run = queueRef.current.then(applyChanges, applyChanges);
		queueRef.current = run;
		return run;
	}, [applyChanges]);

	useEffect(() => {
		mountedRef.current = true;
		void load();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onChanged = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: chrome.storage.AreaName,
		) => {
			if (
				chrome.extension.inIncognitoContext &&
				area === 'local' &&
				Object.hasOwn(changes, PRIVATE_CONFIG_KEY)
			) {
				const {oldValue, newValue} = changes[PRIVATE_CONFIG_KEY];
				if (privateConfigNeedsReload(oldValue, newValue)) {
					reloadPrivatePage();
				}

				return;
			}

			if (!(
				['local', 'session'].includes(area) &&
				(Object.hasOwn(changes, STORAGE_KEY) ||
					(chrome.extension.inIncognitoContext &&
						Object.hasOwn(changes, `${PRIVATE_STORAGE_PREFIX}${STORAGE_KEY}`)))
			)) {
				return;
			}

			clearTimeout(timer);
			timer = setTimeout(() => void refresh(), STORAGE_RELOAD_DELAY_MS);
		};

		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			mountedRef.current = false;
			clearTimeout(timer);
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, [load, refresh]);
	return {state, error, loading, reload: refresh};
}

export function LoadingLine({className = ''}: {className?: string}) {
	return (
		<p
			className={cn('sr-only py-6 text-sm text-muted-foreground', className)}
			role="status"
			aria-live="polite"
		>
			Loading {PROJECT.name}…
		</p>
	);
}

export type Status = {
	message: string;
	error: boolean;
	toast?: boolean;
	id?: string;
	notice?: boolean;
	action?: StatusAction;
};
export type StatusAction = {
	label: string;
	onClick: () => void | Promise<void>;
	onClose?: () => void;
};
export type StatusOptions = {
	toast?: boolean;
	notice?: boolean;
	action?: StatusAction;
};
export type ShowStatus = (
	message?: string | null,
	error?: unknown,
	options?: StatusOptions,
) => void;

export function forceAddAction(
	tabIds: number[],
	showStatus: ShowStatus,
	afterAdd: () => unknown,
): StatusAction {
	return {
		label: 'Force add',
		async onClick() {
			const result = await send('SAVE_TABS', {
				scope: 'all-windows',
				tabIds,
				includePinned: true,
				allowDuplicates: true,
			});
			if (!result?.ok) {
				showStatus(result?.error || 'Could not add those tabs.', true);
				return;
			}

			showStatus(`Added ${plural(result.count, 'tab')}.`, false, {
				toast: true,
			});
			await afterAdd();
		},
	};
}

export function reportSessionSave(
	result: Pick<
		SaveResult,
		'count' | 'groups' | 'skipped' | 'rejectedTabIds' | 'groupId'
	>,
	options: {
		closeOnSave: boolean;
		showStatus: ShowStatus;
		reload: () => unknown;
	},
) {
	const {showStatus, reload} = options;
	const {groupId} = result;
	const forceable = result.rejectedTabIds.length > 0;
	const closed =
		options.closeOnSave &&
		!forceable &&
		groupId !== null &&
		result.groups === 1 &&
		result.count > 0;
	const outcome = saveOutcomeOf(
		{ok: true, count: result.count, skipped: result.skipped},
		'tab',
		{closed},
	);
	const message = saveMessage(outcome);
	if (forceable) {
		showStatus(message, false, {
			notice: outcome.kind === 'duplicate',
			action: forceAddAction(result.rejectedTabIds, showStatus, reload),
		});
		return;
	}

	if (closed && groupId) {
		showStatus(message, false, {
			action: {
				label: UNDO_LABEL,
				async onClick() {
					const reopened = await send('RESTORE_GROUP', {
						groupId,
						restoreTarget: 'current-window',
						restoreMode: 'keep',
						activate: false,
					});
					showStatus(
						reopened?.ok
							? reopenedMessage(reopened.count)
							: reopened?.error || REOPEN_FAILED,
						!reopened?.ok,
						{toast: true},
					);
				},
			},
		});
		return;
	}

	showStatus(message, outcome.kind === 'failed', {
		toast: true,
		notice: outcome.kind === 'duplicate',
	});
}

export function showSaveFailure(
	showStatus: ShowStatus,
	result: {error?: string; duplicate?: true} | undefined,
	fallback: string,
) {
	showStatus(
		result?.error || fallback,
		!result?.duplicate,
		result?.duplicate ? {toast: true, notice: true} : undefined,
	);
}

export function useStatus(): [Status | null, ShowStatus] {
	const [status, setStatus] = useState<Status | null>(null);
	const showStatus: ShowStatus = (message, error = false, options = {}) =>
		setStatus(
			message
				? {
						message,
						error: Boolean(error),
						toast: Boolean(options.toast || options.action),
						...(options.notice && {notice: true}),
						id: `${Date.now()}-${Math.random()}`,
						...(options.action && {action: options.action}),
					}
				: null,
		);
	const showStatusRef = useRef(showStatus);
	showStatusRef.current = showStatus;
	const offeredUndoRef = useRef<string | undefined>(undefined);
	useEffect(
		() =>
			onUndoOffer(
				(done, undoId) => {
					offeredUndoRef.current = undoId;
					showStatusRef.current(done, false, {
						action: {
							label: 'Undo',
							async onClick() {
								const result = await send('UNDO', {id: undoId});
								if (result?.ok) {
									showStatusRef.current(`Undone: ${result.label}.`, false, {
										toast: true,
									});
								} else {
									showStatusRef.current(
										result?.error || 'Could not undo that.',
										true,
									);
								}
							},
						},
					});
				},
				(undoId) => {
					if (offeredUndoRef.current !== undoId) {
						return;
					}

					offeredUndoRef.current = undefined;
					showStatusRef.current(null);
				},
			),
		[],
	);
	return [status, showStatus];
}

const TOAST_TIMEOUT_MS = {success: 4000, error: 10_000, action: 6000};

function useToastPrefs(toastId: string | undefined) {
	const [prefs, setPrefs] = useState<{
		position: ToastPosition;
		duration: ToastDuration;
	}>({position: 'default', duration: 'default'});
	useEffect(() => {
		void send('TOAST_PREFS').then((result) => {
			if (result.ok) {
				setPrefs({position: result.position, duration: result.duration});
			}
		});
	}, [toastId]);
	return prefs;
}

function toastStyle(position: ToastPosition): CSSProperties {
	const {top, bottom, left, right, transform} = toastEdges(
		toastPlace(position, 'bottom'),
		20,
	);
	return {top, bottom, left, right, transform};
}

export function StatusLine({status}: {status: Status | null | undefined}) {
	const prefs = useToastPrefs(status?.id);
	const [dismissed, setDismissed] = useState<string | null>(null);
	const [paused, setPaused] = useState(false);
	const visible =
		status?.message && (status.error || status.toast) ? status : null;
	const key = visible ? `${visible.id ?? 'fixed'}:${visible.message}` : null;
	const shown = Boolean(visible) && dismissed !== key;
	useEffect(() => {
		if (!visible?.id || paused) {
			return undefined;
		}

		const ms = toastMs(
			visible.error
				? TOAST_TIMEOUT_MS.error
				: visible.action
					? TOAST_TIMEOUT_MS.action
					: TOAST_TIMEOUT_MS.success,
			prefs.duration,
		);
		if (ms === undefined) {
			return undefined;
		}

		const timer = setTimeout(() => setDismissed(key), ms);
		return () => clearTimeout(timer);
	}, [
		key,
		visible?.id,
		visible?.error,
		visible?.action,
		paused,
		prefs.duration,
	]);
	useEffect(() => {
		if (!shown) {
			setPaused(false);
		}
	}, [shown]);
	const undoAction = shown ? visible?.action : undefined;
	useEffect(() => {
		const onClose = undoAction?.onClose;
		return onClose ? () => onClose() : undefined;
	}, [undoAction]);
	useEffect(() => {
		if (!undoAction) {
			return undefined;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				event.key.toLowerCase() !== 'z' ||
				!(event.ctrlKey || event.metaKey) ||
				event.shiftKey ||
				event.altKey ||
				event.defaultPrevented ||
				target?.closest('input, textarea, select, [contenteditable="true"]') ||
				document.querySelector('[role="dialog"], [role="alertdialog"]')
			) {
				return;
			}

			event.preventDefault();
			setDismissed(key);
			void undoAction.onClick();
		};

		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [undoAction, key]);
	const Icon = visible?.error
		? CircleAlert
		: visible?.notice
			? Info
			: CircleCheck;
	return (
		<>
			<p className="sr-only" role="status" aria-live="polite">
				{status && !status.error ? status.message || '' : ''}
			</p>
			{visible && shown && (
				<div
					key={key}
					role={visible.error ? 'alert' : undefined}
					style={toastStyle(prefs.position)}
					className={cn(
						'fixed z-100 flex w-max max-w-[min(92vw,28rem)] animate-[pop-in_160ms_ease-out] motion-reduce:animate-none items-start gap-2.5 rounded-lg border bg-popover py-2.5 pl-3 pr-2 text-sm text-popover-foreground shadow-lg',
						visible.error ? 'border-destructive/40' : 'border-border',
					)}
					onMouseEnter={() => setPaused(true)}
					onMouseLeave={() => setPaused(false)}
					onFocus={() => setPaused(true)}
					onBlur={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget)) {
							setPaused(false);
						}
					}}
				>
					<Icon
						className={cn(
							'mt-0.5 h-4 w-4 shrink-0',
							visible.error
								? 'text-destructive'
								: visible.notice
									? 'text-muted-foreground'
									: 'text-primary',
						)}
						aria-hidden="true"
					/>
					<span className="min-w-0 flex-1 wrap-break-word leading-[1.4286]">
						{visible.message}
					</span>
					{visible.action && (
						<button
							type="button"
							aria-keyshortcuts="Control+Z Meta+Z"
							className="shrink-0 rounded-sm px-1.5 text-sm font-semibold leading-[1.4286] text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => {
								setDismissed(key);
								void visible.action!.onClick();
							}}
						>
							{visible.action.label}
						</button>
					)}
					<button
						type="button"
						aria-label="Dismiss message"
						className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => setDismissed(key)}
					>
						<X className="h-3.5 w-3.5" aria-hidden="true" />
					</button>
				</div>
			)}
		</>
	);
}

const MARK_PATH =
	'M12 42 64 14l52 28-52 28ZM12 86l14.9-8L64 98l37.1-20 14.9 8-52 28Z';
export function TabLodgeMark({
	className = 'h-6 w-6',
}: {
	className?: string;
	'aria-hidden'?: boolean | 'true' | 'false';
}) {
	return (
		<svg
			viewBox="0 0 128 128"
			className={className}
			aria-hidden="true"
			focusable="false"
		>
			<path
				d={MARK_PATH}
				fill="currentColor"
				stroke="currentColor"
				strokeWidth="8"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function Brand({
	compact = false,
	link = 'newtab.html',
	label = PROJECT.name,
	newTab = false,
	privateBadge = false,
}: {
	compact?: boolean;
	link?: string;
	label?: string;
	newTab?: boolean;
	privateBadge?: boolean;
}) {
	const showPrivate = privateBadge && chrome.extension.inIncognitoContext;
	return (
		<a
			href={link}
			target={newTab ? '_blank' : undefined}
			rel={newTab ? 'noopener noreferrer' : undefined}
			className="inline-flex min-w-0 items-center gap-2.5 rounded-lg text-sm font-extrabold tracking-tight focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
			aria-label={label}
		>
			{showPrivate ? (
				<span
					role="img"
					aria-label="Private window"
					title="Private window"
					className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"
				>
					<PrivateWindowMark className="h-7 w-7" />
				</span>
			) : (
				<span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
					<TabLodgeMark className="h-[22px] w-[22px]" />
				</span>
			)}
			{!compact && <span className="truncate">{PROJECT.name}</span>}
		</a>
	);
}

const MAIN_CONTENT_ID = 'main-content';

export type AppPage = 'dashboard' | 'settings' | 'help';
const APP_PAGES: ReadonlyArray<{id: AppPage; label: string; href: string}> = [
	{id: 'dashboard', label: 'Dashboard', href: 'newtab.html'},
	{id: 'settings', label: 'Settings', href: 'options.html'},
	{id: 'help', label: 'Help', href: 'help.html'},
];

export function AppHeader({
	active,
	children,
}: {
	active: AppPage;
	children?: ReactNode;
}) {
	return (
		<>
			<a
				href={`#${MAIN_CONTENT_ID}`}
				className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				onClick={(event) => {
					event.preventDefault();
					const target = document.querySelector<HTMLElement>(
						`#${MAIN_CONTENT_ID}`,
					);
					target?.focus();
					target?.scrollIntoView({block: 'start'});
				}}
			>
				Skip to main content
			</a>
			<header className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-3 border-b border-border pb-2 sm:mb-8 sm:flex sm:flex-wrap sm:justify-between sm:gap-x-4 sm:pb-4">
				<h1 className="sr-only">
					{PROJECT.name} {APP_PAGES.find((page) => page.id === active)?.label}
				</h1>
				<div className="contents sm:flex sm:min-w-0 sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
					<Brand />
					<span
						className="hidden h-5 w-px shrink-0 bg-border sm:block"
						aria-hidden="true"
					/>
					<nav
						aria-label={`${PROJECT.name} pages`}
						className="col-span-2 row-start-2 flex flex-wrap items-center gap-1"
					>
						{APP_PAGES.map((page) => {
							const current = page.id === active;
							return (
								<a
									key={page.id}
									href={page.href}
									aria-current={current ? 'page' : undefined}
									className={cn(
										'relative inline-flex h-9 items-center rounded-md px-2.5 text-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
										current
											? 'font-medium text-foreground after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
											: 'text-muted-foreground hover:text-foreground',
									)}
								>
									{page.label}
								</a>
							);
						})}
					</nav>
				</div>
				{Boolean(children) && (
					<div className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center justify-end gap-2">
						{children}
					</div>
				)}
			</header>
			<div id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-hidden" />
		</>
	);
}

export function LoadError({
	message,
	className = '',
}: {
	message: string;
	className?: string;
}) {
	return (
		<div
			role="alert"
			className={cn(
				'flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-card p-4 text-sm',
				className,
			)}
		>
			<CircleAlert
				className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
				aria-hidden="true"
			/>
			<div className="min-w-0">
				<p className="font-medium">{message}</p>
				<button
					type="button"
					className="mt-2 rounded-sm text-xs font-semibold text-primary hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() => location.reload()}
				>
					Reload page
				</button>
			</div>
		</div>
	);
}

export function PageShell({
	children,
	className = '',
	...props
}: ComponentPropsWithoutRef<'main'>) {
	return (
		<main
			className={cn(
				'mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-9',
				className,
			)}
			{...props}
		>
			{children}
		</main>
	);
}

export function EmptyState({
	icon: Icon = Bookmark,
	title,
	children,
	action,
}: {
	icon?: IconComponent;
	title: ReactNode;
	children?: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center">
			<span className="mb-4 grid h-10 w-10 place-items-center rounded-md bg-primary/10 text-primary">
				<Icon className="h-5 w-5" />
			</span>
			<h2 className="text-base font-semibold">{title}</h2>
			<p className="mt-2 max-w-sm text-sm leading-[1.7143] text-muted-foreground">
				{children}
			</p>
			{Boolean(action) && <div className="mt-5">{action}</div>}
		</div>
	);
}

export function SectionCard({
	id,
	title,
	description,
	icon: Icon,
	reset,
	action,
	children,
	className = '',
}: {
	title: ReactNode;
	description?: ReactNode;
	icon?: IconComponent;
	reset?: ReactNode;
	action?: ReactNode;
	children?: ReactNode;
	className?: string;
	id?: string;
}) {
	return (
		<Card id={id} className={cn('overflow-hidden', className)}>
			<CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0 border-b border-border bg-muted/60 px-4 py-3">
				{Icon && (
					<span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-card text-primary">
						<Icon className="h-4 w-4" aria-hidden="true" />
					</span>
				)}
				<div className="min-w-0 flex-1 sm:min-w-[12rem]">
					<CardTitle className="text-[0.9375rem] leading-[1.6]">
						{title}
					</CardTitle>
					{Boolean(description) && (
						<CardDescription className="text-xs leading-[1.6667]">
							{description}
						</CardDescription>
					)}
				</div>
				{Boolean(reset) && <div className="shrink-0">{reset}</div>}
				{Boolean(action) && (
					<div className="max-sm:basis-full max-sm:[&>*]:w-full sm:shrink-0">
						{action}
					</div>
				)}
			</CardHeader>
			<CardContent className="pt-4">{children}</CardContent>
		</Card>
	);
}

export {send} from './message-client';

export {plural} from './plural';
