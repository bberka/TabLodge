import {useEffect, useState, type ReactNode} from 'react';
import {ArrowRight, Lock} from 'lucide-react';
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
import {useTheme} from '../shared/theme';
import {messageOf, send, type ShowStatus} from './common';
import {AccentPalette} from './accent-palette';
import type {PrivateConfig, PrivateStorageMode} from './types';
import {PROJECT} from './project';
import {
	modeLockedReason,
	PrivateLockSettings,
	usePrivateLockInfo,
} from './private-lock-ui';
import {
	PRIVATE_ACCENT_DEFAULT,
	PRIVATE_ACCENT_SAME,
	PRIVATE_CONFIG_KEY,
	PRIVATE_RELOAD_FOCUS_KEY,
	privateConfigNeedsReload,
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
	'accent',
	'color',
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
			'Private and regular windows share sessions, bookmarks, and settings. Changes show up in both.',
	},
	{
		value: 'saved',
		title: 'Use a separate saved library',
		description:
			'Starts empty and stays on this device after the browser restarts. It can be locked with a PIN or password.',
	},
	{
		value: 'temporary',
		title: 'Use a separate temporary library',
		description:
			'Starts empty and stays while the browser runs, then clears when the browser restarts.',
	},
];

const modeStatus: Record<PrivateStorageMode, string> = {
	shared: 'Private windows will use the same library as regular windows.',
	saved: 'Private windows will use a separate saved library.',
	temporary: 'Private windows will use a separate temporary library.',
};

function PrivateStorageForm({
	config,
	onSaved,
	disabled = false,
	showContinue = false,
	lockedReason = null,
}: {
	config: PrivateConfig;
	onSaved: (config: PrivateConfig) => void;
	disabled?: boolean;
	showContinue?: boolean;
	/**
	Set while a lock protects the saved library: the mode cannot change, and this says why.
	*/
	lockedReason?: string | null;
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
			{lockedReason && (
				<p
					id="private-mode-locked"
					className="flex gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm"
				>
					<Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
					{lockedReason}
				</p>
			)}
			<RadioCardGroup
				label="Choose a library for private windows"
				value={mode}
				disabled={busy || disabled || lockedReason !== null}
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
			<p className="text-xs leading-5 text-muted-foreground">
				Switching does not copy, merge, or delete a library, and switching back
				reopens it. Snapshots and automatic backups never run in private
				windows. Files you export stay on disk, even with a temporary library.
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
	const lock = usePrivateLockInfo();
	const {systemColor} = useTheme();
	const [savingAccent, setSavingAccent] = useState(false);
	const saveAccent = async (accent: string) => {
		if (!config || savingAccent) {
			return;
		}

		setSavingAccent(true);
		setError('');
		try {
			const result = await send('SET_PRIVATE_ACCENT', {accent});
			if (!result.ok) {
				throw new Error(result.error);
			}

			setConfig(result);
			showStatus(
				accent === PRIVATE_ACCENT_SAME
					? 'Private windows use the regular accent.'
					: 'Private window accent saved.',
			);
		} catch (reason) {
			setError(messageOf(reason) || 'Could not save the private accent.');
		} finally {
			setSavingAccent(false);
		}
	};

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
			{error && <p role="alert">{error}</p>}
			{incognitoAllowed === undefined && (
				<p role="status" className="sr-only">
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
				<div className="divide-y divide-border">
					<div className="space-y-4 pb-5">
						<div className="space-y-1">
							<h3 className="text-sm font-medium">Library</h3>
							<p className="text-xs leading-5 text-muted-foreground">
								Where private windows keep their sessions and bookmarks. This
								applies to every private window.
							</p>
						</div>
						<PrivateStorageForm
							key={`${config.mode}:${config.configured}`}
							config={config}
							showContinue={false}
							lockedReason={modeLockedReason(lock.info)}
							onSaved={(next) => {
								setConfig(next);
								showStatus(modeStatus[next.mode]);
							}}
						/>
					</div>
					<PrivateLockSettings showStatus={showStatus} lock={lock} />
					<div className="flex items-start justify-between gap-4 py-5">
						<div className="min-w-0 space-y-1">
							<label
								htmlFor="private-new-tab-redirect"
								className="block text-sm font-medium"
							>
								Redirect private new tabs to the dashboard
							</label>
							<p
								id="private-new-tab-redirect-description"
								className="text-xs leading-5 text-muted-foreground"
							>
								Chromium does not let extensions replace the private new tab
								page, so the browser’s page opens first and then switches to the
								dashboard. Turn this off to keep the browser’s page.
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
					<div className="space-y-3 pt-5">
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0 space-y-1">
								<label
									htmlFor="private-accent-switch"
									className="block text-sm font-medium"
								>
									Use a different accent in private windows
								</label>
								<p
									id="private-accent-description"
									className="text-xs leading-5 text-muted-foreground"
								>
									Tints buttons, focus rings, and selections so private windows
									are easy to tell apart. Light and dark follow your regular
									choice.
								</p>
							</div>
							<Switch
								id="private-accent-switch"
								checked={config.accent !== PRIVATE_ACCENT_SAME}
								disabled={savingAccent}
								aria-describedby="private-accent-description"
								onCheckedChange={(enabled) =>
									void saveAccent(
										enabled ? PRIVATE_ACCENT_DEFAULT : PRIVATE_ACCENT_SAME,
									)
								}
							/>
						</div>
						{config.accent !== PRIVATE_ACCENT_SAME && (
							<AccentPalette
								accent={config.accent}
								systemColor={systemColor}
								onChange={(next) => void saveAccent(next)}
							/>
						)}
					</div>
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
			if (privateConfigNeedsReload(previous, next)) {
				reloadPrivatePage();
			}
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
		return children;
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
