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
