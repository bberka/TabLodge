import {
	useEffect,
	useState,
	type ComponentPropsWithoutRef,
	type ComponentType,
	type ReactNode,
} from 'react';
import {Bookmark, CircleAlert, CircleCheck, X} from 'lucide-react';
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
	TabLodgeMessages,
	TabLodgeMessageType,
	TabLodgeState,
} from './types';
import {PROJECT} from './project';

const STORAGE_KEY = 'tablodge.state';

// Message types whose payload has no required fields can be sent without a second argument.
type OptionalFields<K extends TabLodgeMessageType> =
	{} extends TabLodgeMessages[K]
		? [fields?: TabLodgeMessages[K]]
		: [fields: TabLodgeMessages[K]];

/**
Sends a typed message to the TabLodge service worker and resolves with its response.
*/
export const send = <K extends TabLodgeMessageType>(
	type: K,
	...[fields]: OptionalFields<K>
): Promise<ActionResult<K>> => chrome.runtime.sendMessage({type, ...fields});

/**
Soft restore note for saved split views the browser would not recreate (the tabs still opened).
*/
export const splitNote = (count: number) =>
	`${count} split ${count === 1 ? 'view' : 'views'} opened as separate tabs`;

/**
Icon components accepted by the layout helpers (lucide icons).
*/
export type IconComponent = ComponentType<{
	className?: string;
	'aria-hidden'?: boolean | 'true' | 'false';
}>;

const RETRY_DELAYS_MS = [150, 300, 600, 1000, 1500];
const wait = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
// Rejections are usually Errors, but any object with a message counts.
const errorMessage = (reason: unknown): unknown =>
	(reason as {message?: unknown} | null | undefined)?.message;
const isTransportError = (reason: unknown) =>
	/receiving end does not exist|could not establish connection|message port closed|extension context invalidated/i.test(
		String(errorMessage(reason) || reason || ''),
	);

// The service worker may still be waking up when a page opens. Transport failures are retried
// quietly so only a definitive failure replaces the loading state with an error.
export function useTabLodgeState() {
	const [state, setState] = useState<TabLodgeState | null>(null);
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(true);
	const load = async (): Promise<TabLodgeState | null> => {
		try {
			let result: ActionResult<'GET_STATE'> | ActionFailure | undefined;
			for (let attempt = 0; ; attempt += 1) {
				try {
					result = await send('GET_STATE');
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
					(result as ActionFailure | undefined)?.error ||
						`${PROJECT.name} could not load saved data.`,
				);
			}

			setState({
				...result,
				groups: Array.isArray(result.groups) ? result.groups : [],
				folders: Array.isArray(result.folders)
					? result.folders
					: [{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true}],
				bookmarkColumns: Array.isArray(result.bookmarkColumns)
					? result.bookmarkColumns
					: [
							{
								id: 'bookmark-default',
								name: 'Bookmarks',
								createdAt: 0,
								isDefault: true,
							},
						],
				bookmarks: Array.isArray(result.bookmarks) ? result.bookmarks : [],
			});
			setError('');
			return result;
		} catch (reason) {
			setError(
				isTransportError(reason)
					? `${PROJECT.name}’s background service is not responding. Reload the page or the extension and try again.`
					: String(
							errorMessage(reason) ||
								`${PROJECT.name} could not load saved data.`,
						),
			);
			return null;
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
		const onChanged = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: chrome.storage.AreaName,
		) => {
			if (area === 'local' && Object.hasOwn(changes, STORAGE_KEY)) {
				void load();
			}
		};

		chrome.storage.onChanged.addListener(onChanged);
		return () => chrome.storage.onChanged.removeListener(onChanged);
	}, []);
	return {state, error, loading, reload: load};
}

export function LoadingLine({className = ''}: {className?: string}) {
	return (
		<p
			className={`py-6 text-sm text-muted-foreground ${className}`}
			role="status"
			aria-live="polite"
		>
			Loading {PROJECT.name}…
		</p>
	);
}

// Every showStatus call gets a fresh id so a repeated message shows again after it was dismissed.
export type Status = {
	message: string;
	error: boolean;
	/**
	Show a success message as a visible toast. Errors are always visible.
	*/
	toast?: boolean;
	/**
	Set by showStatus; errors without an id (passed in directly) never time out.
	*/
	id?: string;
};
export type StatusOptions = {
	/**
	Show a success message as a visible toast instead of only announcing it to screen readers.
	*/
	toast?: boolean;
};
/**
 `showStatus(message)` announces a routine success to screen readers only,
 `showStatus(message, false, { toast: true })` also shows it as a toast, and
 `showStatus(message, true)` shows an error toast. `showStatus(null)` clears the status.
 */
export type ShowStatus = (
	message?: string | null,
	error?: unknown,
	options?: StatusOptions,
) => void;

export function useStatus(): [Status | null, ShowStatus] {
	const [status, setStatus] = useState<Status | null>(null);
	const showStatus: ShowStatus = (message, error = false, options = {}) =>
		setStatus(
			message
				? {
						message,
						error: Boolean(error),
						toast: Boolean(options.toast),
						id: `${Date.now()}-${Math.random()}`,
					}
				: null,
		);
	return [status, showStatus];
}

const TOAST_TIMEOUT_MS = {success: 4000, error: 10_000};

// Routine success messages are only announced to screen readers. Errors and success messages
// marked `toast` appear as a small dismissible toast at the bottom center. Toasts from showStatus
// fade after 4s (success) or 10s (error); errors passed in directly (such as a failed initial
// load) stay until dismissed.
export function StatusLine({status}: {status: Status | null | undefined}) {
	const [dismissed, setDismissed] = useState<string | null>(null);
	const visible =
		status?.message && (status.error || status.toast) ? status : null;
	const key = visible ? `${visible.id ?? 'fixed'}:${visible.message}` : null;
	useEffect(() => {
		if (!visible?.id) {
			return undefined;
		}

		const timer = setTimeout(
			() => setDismissed(key),
			visible.error ? TOAST_TIMEOUT_MS.error : TOAST_TIMEOUT_MS.success,
		);
		return () => clearTimeout(timer);
	}, [key, visible?.id, visible?.error]);
	const Icon = visible?.error ? CircleAlert : CircleCheck;
	return (
		<>
			<p className="sr-only" role="status" aria-live="polite">
				{status && !status.error ? status.message || '' : ''}
			</p>
			{visible && dismissed !== key && (
				<div
					key={key}
					role={visible.error ? 'alert' : undefined}
					className={`fixed bottom-5 left-1/2 z-[100] flex w-max max-w-[min(92vw,28rem)] -translate-x-1/2 animate-[pop-in_160ms_ease-out] items-start gap-2.5 rounded-lg border bg-popover py-2.5 pl-3 pr-2 text-sm text-popover-foreground shadow-lg ${visible.error ? 'border-destructive/40' : 'border-border'}`}
				>
					<Icon
						className={`mt-0.5 h-4 w-4 shrink-0 ${visible.error ? 'text-destructive' : 'text-primary'}`}
						aria-hidden="true"
					/>
					<span className="min-w-0 flex-1 break-words leading-5">
						{visible.message}
					</span>
					<button
						type="button"
						aria-label="Dismiss message"
						className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						onClick={() => setDismissed(key)}
					>
						<X className="h-3.5 w-3.5" aria-hidden="true" />
					</button>
				</div>
			)}
		</>
	);
}

// The filled TabLodge logo mark; matches extension/icons/tablodge.svg. Use it wherever TabLodge itself
// is shown (headers, empty states). The outline lucide Layers2 stays for actions such as saving a window.
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
}: {
	compact?: boolean;
	link?: string;
	label?: string;
}) {
	return (
		<a
			href={link}
			className="inline-flex items-center gap-2.5 rounded-lg text-sm font-extrabold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			aria-label={label}
		>
			<span className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
				<TabLodgeMark className="h-[22px] w-[22px]" />
			</span>
			{!compact && <span>{PROJECT.name}</span>}
		</a>
	);
}

export type AppPage = 'dashboard' | 'settings' | 'help';
const APP_PAGES: ReadonlyArray<{id: AppPage; label: string; href: string}> = [
	{id: 'dashboard', label: 'Dashboard', href: 'newtab.html'},
	{id: 'settings', label: 'Settings', href: 'options.html'},
	{id: 'help', label: 'Help', href: 'help.html'},
];

/**
Shared header for the Dashboard, Settings and Help pages: "[logo] TabLodge | Dashboard Settings Help".
The active page is shown in the foreground color with a primary underline (aria-current="page").
Page actions go on the right. Navigation stays in the same tab.
*/
export function AppHeader({
	active,
	children,
}: {
	active: AppPage;
	children?: ReactNode;
}) {
	return (
		<header className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border pb-4">
			<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
				<Brand />
				<span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
				<nav
					aria-label={`${PROJECT.name} pages`}
					className="flex items-center gap-1"
				>
					{APP_PAGES.map((page) => {
						const current = page.id === active;
						return (
							<a
								key={page.id}
								href={page.href}
								aria-current={current ? 'page' : undefined}
								className={`relative inline-flex h-9 items-center rounded-md px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${current ? 'font-medium text-foreground after:absolute after:inset-x-2.5 after:-bottom-[17px] after:h-0.5 after:rounded-full after:bg-primary' : 'text-muted-foreground hover:text-foreground'}`}
							>
								{page.label}
							</a>
						);
					})}
				</nav>
			</div>
			{Boolean(children) && (
				<div className="flex items-center gap-2">{children}</div>
			)}
		</header>
	);
}

/**
Opens the browser's extension-shortcuts page. Plain links to chrome:// pages are blocked, so this uses tabs.create.
*/
export async function openShortcutsPage(): Promise<boolean> {
	try {
		await chrome.tabs.create({url: 'chrome://extensions/shortcuts'});
		return true;
	} catch {
		return false;
	}
}

// Shown in place of a page when its saved state definitively failed to load.
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
			className={`flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-card p-4 text-sm ${className}`}
		>
			<CircleAlert
				className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
				aria-hidden="true"
			/>
			<div className="min-w-0">
				<p className="font-medium">{message}</p>
				<button
					type="button"
					className="mt-2 rounded text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
			data-brand="tablodge"
			className={`mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-9 ${className}`}
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
			<p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
				{children}
			</p>
			{Boolean(action) && <div className="mt-5">{action}</div>}
		</div>
	);
}

// Header is a flex row (space-y reset so the text block is not pushed down) with the icon
// centered against the title/description block, on a tinted strip separated from the body.
export function SectionCard({
	title,
	description,
	icon: Icon,
	action,
	children,
	className = '',
}: {
	title: ReactNode;
	description?: ReactNode;
	icon?: IconComponent;
	action?: ReactNode;
	children?: ReactNode;
	className?: string;
}) {
	return (
		<Card className={`overflow-hidden ${className}`}>
			<CardHeader className="flex-row items-center gap-3 space-y-0 border-b border-border bg-muted/60 px-4 py-3">
				{Icon && (
					<span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-card text-primary">
						<Icon className="h-4 w-4" aria-hidden="true" />
					</span>
				)}
				<div className="min-w-0 flex-1">
					<CardTitle className="text-[15px] leading-6">{title}</CardTitle>
					{Boolean(description) && (
						<CardDescription className="text-xs leading-5">
							{description}
						</CardDescription>
					)}
				</div>
				{Boolean(action) && <div className="shrink-0">{action}</div>}
			</CardHeader>
			<CardContent className="pt-4">{children}</CardContent>
		</Card>
	);
}
