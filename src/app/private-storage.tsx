import {useEffect, useState, type ReactNode} from 'react';
import {ArrowRight} from 'lucide-react';
import {
	Button,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	RadioCard,
	RadioCardGroup,
	Switch,
} from '../shared/ui';
import {messageOf, send, type ShowStatus} from './common';
import type {PrivateConfig, PrivateStorageMode} from './types';
import {PROJECT} from './project';
import {
	PRIVATE_CONFIG_KEY,
	PRIVATE_RELOAD_FOCUS_KEY,
	reloadPrivatePage,
} from './private-config';

export const PRIVATE_STORAGE_TITLE = 'Private windows';
export const PRIVATE_STORAGE_WORDS = [
	'incognito',
	'storage',
	'shared',
	'separate',
	'saved',
	'temporary',
	'restart',
	'private',
	'new tab',
	'redirect',
];

const choices: Array<{
	value: PrivateStorageMode;
	title: string;
	description: string;
}> = [
	{
		value: 'shared',
		title: 'Use the same library as regular windows',
		description:
			'Private and regular windows use the same sessions, bookmarks, and preferences. Changes appear in both.',
	},
	{
		value: 'saved',
		title: 'Use a separate saved library',
		description:
			'Start with an empty library for private windows. Keep it on this device after the browser restarts.',
	},
	{
		value: 'temporary',
		title: 'Use a separate temporary library',
		description:
			'Start with an empty library for private windows. It stays when those windows close, then clears when the browser restarts.',
	},
];

const modeSummary: Record<PrivateStorageMode, string> = {
	shared: 'Same library as regular windows',
	saved: 'Separate library saved on this device',
	temporary: 'Separate library clears on browser restart',
};

const modeStatus: Record<PrivateStorageMode, string> = {
	shared: 'Private windows will use the same library as regular windows.',
	saved: 'Private windows will use a separate saved library.',
	temporary: 'Private windows will use a separate temporary library.',
};

function PrivateWindowMark({className}: {className: string}) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 64 64"
			fill="none"
		>
			<path
				d="M12 24c.7-6.2 4.5-10.7 10.6-12.8l3-4.7h12.8l3 4.7C47.5 13.3 51.3 17.8 52 24H12Z"
				fill="currentColor"
			/>
			<path
				d="M5.5 27h53c.8 0 1.3.8.9 1.5-2.2 4.3-9.2 6.4-27.4 6.4S6.8 32.8 4.6 28.5c-.4-.7.1-1.5.9-1.5Z"
				fill="currentColor"
			/>
			<path
				d="M8 40h5m38 0h5M28.5 40h7M13 39.5h15l-1.4 7a6.4 6.4 0 0 1-12.5 0l-1.1-7Zm23 0h15l-1.1 7a6.4 6.4 0 0 1-12.5 0l-1.4-7Z"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="3"
			/>
		</svg>
	);
}

function PrivateStorageForm({
	config,
	onSaved,
	disabled = false,
	showContinue = false,
}: {
	config: PrivateConfig;
	onSaved: (config: PrivateConfig) => void;
	disabled?: boolean;
	showContinue?: boolean;
}) {
	const [mode, setMode] = useState(config.mode);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const saveMode = async (nextMode: PrivateStorageMode) => {
		if (busy || disabled) {
			return;
		}

		setBusy(true);
		setError('');
		try {
			const result = await send('SET_PRIVATE_CONFIG', {mode: nextMode});
			if (!result.ok) {
				throw new Error(result.error);
			}

			onSaved(result);
		} catch (reason) {
			if (!showContinue) {
				setMode(config.mode);
			}

			setError(messageOf(reason) || 'Could not save private storage settings.');
		} finally {
			setBusy(false);
		}
	};

	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				void saveMode(mode);
			}}
		>
			<RadioCardGroup
				label="Choose a library for private windows"
				value={mode}
				disabled={busy || disabled}
				onValueChange={(value) => {
					const choice = choices.find((choice) => choice.value === value);
					if (!choice || choice.value === mode) {
						return;
					}

					setMode(choice.value);
					if (!showContinue) {
						void saveMode(choice.value);
					}
				}}
			>
				{choices.map((choice) => (
					<RadioCard key={choice.value} {...choice} />
				))}
			</RadioCardGroup>
			<p className="text-sm text-muted-foreground">
				Switching modes does not copy, merge, or delete a library. Switching
				back reopens its existing data. Appearance is shared. Automatic
				snapshots and backups do not run in private windows. Exports and manual
				backup downloads remain on disk, even in temporary mode.
			</p>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			{showContinue && (
				<DialogFooter>
					<Button type="submit" disabled={busy || disabled}>
						<ArrowRight aria-hidden="true" />
						{busy ? 'Saving…' : 'Continue'}
					</Button>
				</DialogFooter>
			)}
		</form>
	);
}

export function PrivateStorageSettings({showStatus}: {showStatus: ShowStatus}) {
	const [config, setConfig] = useState<PrivateConfig>();
	const [incognitoAllowed, setIncognitoAllowed] = useState<boolean>();
	const [savingRedirect, setSavingRedirect] = useState(false);
	const [error, setError] = useState('');
	const saveRedirect = async (enabled: boolean) => {
		if (!config || savingRedirect) {
			return;
		}

		setSavingRedirect(true);
		setError('');
		try {
			const result = await send('SET_PRIVATE_NEW_TAB_REDIRECT', {enabled});
			if (!result.ok) {
				throw new Error(result.error);
			}

			setConfig(result);
			showStatus(
				enabled
					? 'New private tabs will open the TabLodge dashboard.'
					: 'New private tabs will use the browser’s page.',
			);
		} catch (reason) {
			setError(
				messageOf(reason) || 'Could not save the private new tab setting.',
			);
		} finally {
			setSavingRedirect(false);
		}
	};

	useEffect(() => {
		const checkAccess = () => {
			void chrome.extension
				.isAllowedIncognitoAccess()
				.then(setIncognitoAllowed)
				.catch(() => setIncognitoAllowed(false));
		};

		const checkOnVisible = () => {
			if (document.visibilityState === 'visible') {
				checkAccess();
			}
		};

		checkAccess();
		window.addEventListener('focus', checkAccess);
		document.addEventListener('visibilitychange', checkOnVisible);
		return () => {
			window.removeEventListener('focus', checkAccess);
			document.removeEventListener('visibilitychange', checkOnVisible);
		};
	}, []);
	useEffect(() => {
		const load = () =>
			send('GET_PRIVATE_CONFIG')
				.then((result) => {
					if (!result.ok) {
						throw new Error(result.error);
					}

					setConfig(result);
				})
				.catch((reason: unknown) =>
					setError(
						messageOf(reason) || 'Could not read private storage settings.',
					),
				);
		void load();
		const changed = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: chrome.storage.AreaName,
		) => {
			if (area === 'local' && Object.hasOwn(changes, PRIVATE_CONFIG_KEY)) {
				void load();
			}
		};

		chrome.storage.onChanged.addListener(changed);
		return () => chrome.storage.onChanged.removeListener(changed);
	}, []);
	return (
		<>
			{incognitoAllowed !== false && (
				<p className="mb-4 text-sm text-muted-foreground">
					Chromium does not let extensions replace the private new tab page.
					Turn on the option below to redirect new private tabs to the dashboard
					after they open.
				</p>
			)}
			{error && <p role="alert">{error}</p>}
			{incognitoAllowed === undefined && (
				<p role="status" className="sr-only mb-4 text-sm text-muted-foreground">
					Checking private window access…
				</p>
			)}
			{incognitoAllowed === false && (
				<p role="status" className="text-sm text-muted-foreground">
					Enable Allow in Incognito in your browser’s extension settings to
					configure private storage.
				</p>
			)}
			{config && incognitoAllowed === true && (
				<div className="space-y-5">
					<div className="flex items-start justify-between gap-4 border-b border-border pb-5">
						<div className="space-y-1">
							<label
								htmlFor="private-new-tab-redirect"
								className="block font-medium"
							>
								Redirect private new tabs to the dashboard
							</label>
							<p
								id="private-new-tab-redirect-description"
								className="text-sm text-muted-foreground"
							>
								The browser opens its private new tab first, then TabLodge
								redirects it to the dashboard. Turn this off to keep the
								browser’s page.
							</p>
						</div>
						<Switch
							id="private-new-tab-redirect"
							checked={config.redirectNewTabs}
							disabled={savingRedirect}
							aria-describedby="private-new-tab-redirect-description"
							onCheckedChange={(enabled) => void saveRedirect(enabled)}
						/>
					</div>
					<PrivateStorageForm
						key={`${config.mode}:${config.configured}`}
						config={config}
						showContinue={false}
						onSaved={(next) => {
							setConfig(next);
							showStatus(modeStatus[next.mode]);
						}}
					/>
				</div>
			)}
		</>
	);
}

export function PrivateSetupGate({children}: {children: ReactNode}) {
	const privateContext = chrome.extension.inIncognitoContext;
	const [config, setConfig] = useState<PrivateConfig>();
	const [error, setError] = useState('');
	useEffect(() => {
		if (!privateContext) {
			return;
		}

		void send('GET_PRIVATE_CONFIG')
			.then((result) => {
				if (!result.ok) {
					throw new Error(result.error);
				}

				setConfig(result);
			})
			.catch((reason: unknown) =>
				setError(messageOf(reason) || 'Could not load private setup.'),
			);
		const changed = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: chrome.storage.AreaName,
		) => {
			if (area !== 'local' || !Object.hasOwn(changes, PRIVATE_CONFIG_KEY)) {
				return;
			}

			const {newValue, oldValue} = changes[PRIVATE_CONFIG_KEY];
			const previous = oldValue as PrivateConfig | undefined;
			const next = newValue as PrivateConfig | undefined;
			if (
				previous &&
				next &&
				previous.mode === next.mode &&
				previous.configured === next.configured
			) {
				return;
			}

			reloadPrivatePage();
		};

		chrome.storage.onChanged.addListener(changed);
		return () => chrome.storage.onChanged.removeListener(changed);
	}, [privateContext]);
	useEffect(() => {
		if (!(
			privateContext &&
			config?.configured &&
			sessionStorage.getItem(PRIVATE_RELOAD_FOCUS_KEY)
		)) {
			return;
		}

		sessionStorage.removeItem(PRIVATE_RELOAD_FOCUS_KEY);
		document.querySelector<HTMLElement>('[data-private-settings]')?.focus();
	}, [config, privateContext]);
	if (!privateContext) {
		return children;
	}

	if (config?.configured) {
		return (
			<div className="relative isolate min-h-screen">
				<div
					aria-hidden="true"
					className="pointer-events-none fixed inset-0 z-0 overflow-hidden text-muted-foreground/10"
				>
					<PrivateWindowMark className="absolute left-1/2 top-1/4 h-16 w-16 -rotate-12 sm:h-20 sm:w-20" />
					<PrivateWindowMark className="absolute right-1/6 top-1/3 h-20 w-20 rotate-12" />
					<PrivateWindowMark className="absolute left-1/3 top-1/2 h-14 w-14 rotate-6" />
					<PrivateWindowMark className="absolute right-1/4 top-2/3 h-20 w-20 -rotate-6" />
					<PrivateWindowMark className="absolute left-1/6 bottom-1/6 h-12 w-12 rotate-12" />
					<PrivateWindowMark className="absolute right-2/5 top-1/2 h-16 w-16 -rotate-12" />
					<PrivateWindowMark className="absolute left-3/5 top-1/4 h-14 w-14 rotate-6" />
					<PrivateWindowMark className="absolute right-1/5 top-5/6 h-16 w-16 rotate-12" />
				</div>
				<aside
					aria-label="Private window"
					className="relative z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-muted px-5 py-3 text-sm sm:px-8"
				>
					<div className="flex min-w-0 items-center gap-3">
						<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
							<PrivateWindowMark className="h-5 w-5" />
						</span>
						<div className="min-w-0">
							<p className="font-semibold">You’re in a private window</p>
							<p className="text-sm text-muted-foreground">
								{modeSummary[config.mode]}
							</p>
						</div>
					</div>
					<a
						data-private-settings
						href="options.html#settings-private-windows"
						className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Private window settings
					</a>
				</aside>
				<div className="relative z-10">{children}</div>
			</div>
		);
	}

	return (
		<main className="p-6">
			{error && (
				<>
					<p role="alert">{error}</p>
					<Button onClick={() => location.reload()}>Retry</Button>
				</>
			)}
			{!config && !error && (
				<p className="sr-only" role="status">
					Loading private settings…
				</p>
			)}
			<Dialog open={Boolean(config)}>
				<DialogContent
					hideClose
					onEscapeKeyDown={(event) => event.preventDefault()}
					onInteractOutside={(event) => event.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle>Configure private {PROJECT.name}</DialogTitle>
						<DialogDescription>
							Choose how private windows store your data before opening the
							dashboard. You can change this later in Settings under Private
							windows.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						{config && (
							<PrivateStorageForm
								showContinue
								config={config}
								onSaved={reloadPrivatePage}
							/>
						)}
					</DialogBody>
				</DialogContent>
			</Dialog>
		</main>
	);
}
