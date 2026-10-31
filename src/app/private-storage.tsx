import {useEffect, useState, type ReactNode} from 'react';
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
} from '../shared/ui';
import {messageOf, send} from './common';
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
];

const choices: Array<{
	value: PrivateStorageMode;
	title: string;
	description: string;
}> = [
	{
		value: 'shared',
		title: 'Share normal storage',
		description:
			'Use the same sessions, bookmarks, and preferences in normal and private windows. Changes appear in both.',
	},
	{
		value: 'saved',
		title: 'Separate, saved storage',
		description:
			'Start with an empty private library. Keep it on this device after private windows close and the browser restarts.',
	},
	{
		value: 'temporary',
		title: 'Separate, temporary storage',
		description:
			'Start with an empty private library. Keep it when private windows close, but clear it when the browser restarts.',
	},
];

function PrivateStorageForm({
	config,
	onSaved,
}: {
	config: PrivateConfig;
	onSaved: (config: PrivateConfig) => void;
}) {
	const [mode, setMode] = useState(config.mode);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => setMode(config.mode), [config.mode]);
	return (
		<form
			className="space-y-4"
			onSubmit={async (event) => {
				event.preventDefault();
				setBusy(true);
				setError('');
				try {
					const result = await send('SET_PRIVATE_CONFIG', {mode});
					if (!result.ok) {
						throw new Error(result.error);
					}

					onSaved(result);
				} catch (reason) {
					setError(
						messageOf(reason) || 'Could not save private storage settings.',
					);
				} finally {
					setBusy(false);
				}
			}}
		>
			<RadioCardGroup
				label="Private window storage"
				value={mode}
				disabled={busy}
				onValueChange={(value) => {
					const choice = choices.find((choice) => choice.value === value);
					if (choice) {
						setMode(choice.value);
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
			<DialogFooter>
				<Button type="submit" disabled={busy}>
					{busy
						? 'Saving…'
						: config.configured
							? 'Save private settings'
							: 'Save and open dashboard'}
				</Button>
			</DialogFooter>
		</form>
	);
}

export function PrivateStorageSettings() {
	const [config, setConfig] = useState<PrivateConfig>();
	const [error, setError] = useState('');
	const [saved, setSaved] = useState(false);
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
			<p className="mb-4 text-sm text-muted-foreground">
				To open the dashboard privately, enable Allow in Incognito in your
				browser’s extension settings, then use the toolbar popup or the Open
				dashboard shortcut. The browser does not replace its private new tab
				page.
			</p>
			{error && <p role="alert">{error}</p>}
			{config && (
				<PrivateStorageForm
					config={config}
					onSaved={(next) => {
						setConfig(next);
						setSaved(true);
					}}
				/>
			)}
			{saved && (
				<p role="status" className="mt-3 text-sm">
					Private storage settings saved.
				</p>
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
			if (!(area === 'local' && Object.hasOwn(changes, PRIVATE_CONFIG_KEY))) {
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
			<>
				<aside
					aria-label="Private storage"
					className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-border bg-muted px-5 py-2 text-sm"
				>
					<span>
						{choices.find((choice) => choice.value === config.mode)?.title}
					</span>
					<a
						data-private-settings
						href="options.html#settings-private-windows"
						className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Change private storage
					</a>
				</aside>
				{children}
			</>
		);
	}

	return (
		<main className="p-6">
			<h1 className="text-xl font-semibold">Private {PROJECT.name} setup</h1>
			{error && (
				<>
					<p role="alert">{error}</p>
					<Button onClick={() => location.reload()}>Retry</Button>
				</>
			)}
			{!config && !error && <p role="status">Loading private settings…</p>}
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
							<PrivateStorageForm config={config} onSaved={reloadPrivatePage} />
						)}
					</DialogBody>
				</DialogContent>
			</Dialog>
		</main>
	);
}
