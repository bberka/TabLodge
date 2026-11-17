import {useEffect, useEffectEvent, useState} from 'react';
import {CloudAlert, CloudOff, RefreshCw} from 'lucide-react';
import {SYNC_STATUS_KEY, type SyncStatus} from '../shared/sync/client';
import {
	problemKey,
	problemNotice,
	readCompat,
	SYNC_NOTICED_KEY,
} from '../shared/sync/compat';
import {isRecord} from '../shared/library-values';
import {Button, IconTooltip} from '../shared/ui';
import type {ShowStatus} from './common';

/**
The sync status the worker last wrote, kept current as it changes. Undefined while sync is off.
*/
function useSyncStatus(): SyncStatus | undefined {
	const [status, setStatus] = useState<SyncStatus>();
	useEffect(() => {
		const read = (value: unknown) => {
			setStatus(
				isRecord(value) && value.connected === true
					? (value as SyncStatus)
					: undefined,
			);
		};

		void chrome.storage.local.get([SYNC_STATUS_KEY]).then((values) => {
			read(values[SYNC_STATUS_KEY]);
		});
		const onChanged = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: string,
		) => {
			if (area === 'local' && Object.hasOwn(changes, SYNC_STATUS_KEY)) {
				read(changes[SYNC_STATUS_KEY].newValue);
			}
		};

		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, []);
	return status;
}

const SETTINGS_PAGE = 'options.html#settings-sync';

/**
Shows a toast the first time the connected server stops sync or lacks a feature, and again only after that problem
went away and came back. Settings › Sync keeps the details.
*/
function useProblemNotice(
	status: SyncStatus | undefined,
	showStatus: ShowStatus,
) {
	const compat = status && readCompat(status);
	const key = compat && problemKey(compat);
	const check = useEffectEvent(async () => {
		if (!compat || key === undefined) {
			await chrome.storage.local.remove(SYNC_NOTICED_KEY);
			return;
		}

		const stored = await chrome.storage.local.get(SYNC_NOTICED_KEY);
		if (stored[SYNC_NOTICED_KEY] === key) {
			return;
		}

		await chrome.storage.local.set({[SYNC_NOTICED_KEY]: key});
		showStatus(problemNotice(compat), compat.incompatible !== undefined, {
			action: {
				label: 'Open Sync settings',
				onClick() {
					location.assign(SETTINGS_PAGE);
				},
			},
		});
	});
	const known = status !== undefined;
	useEffect(() => {
		if (known) {
			void check();
		}
	}, [known, key]);
}

/**
What the button says besides the state, so a screen reader and the tooltip both name where it goes.
*/
const SYNC_ACTION = 'Open Sync settings';

function describe(status: SyncStatus) {
	switch (status.phase) {
		case 'syncing': {
			return {label: 'Sync: syncing', Icon: RefreshCw, spin: true};
		}

		case 'offline': {
			return {label: 'Sync: the server cannot be reached', Icon: CloudOff};
		}

		case 'error': {
			return {
				label: `Sync: ${status.error ?? 'needs attention'}`,
				Icon: CloudAlert,
			};
		}

		default: {
			return {
				label:
					status.pending > 0
						? `Sync: ${status.pending} ${status.pending === 1 ? 'change waits' : 'changes wait'} to be sent`
						: 'Sync: up to date',
				Icon: RefreshCw,
			};
		}
	}
}

// A sync that finishes faster than this would flash by unseen, so the button keeps showing it this long.
const MIN_SYNCING_MS = 900;

/**
Whether to show the syncing look: while a sync runs, and for a moment after a quick one ends.
*/
function useSyncingLook(syncing: boolean): boolean {
	const [shown, setShown] = useState(syncing);
	useEffect(() => {
		if (syncing) {
			setShown(true);
			return;
		}

		const timer = setTimeout(() => {
			setShown(false);
		}, MIN_SYNCING_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [syncing]);
	return syncing || shown;
}

/**
A header button that shows how sync is doing and opens its settings. Hidden while sync is off. While syncing it spins and
turns the accent color with a soft glow behind it.
*/
export function SyncIndicator({showStatus}: {showStatus: ShowStatus}) {
	const status = useSyncStatus();
	const syncing = useSyncingLook(status?.phase === 'syncing');
	useProblemNotice(status, showStatus);
	if (!status) {
		return null;
	}

	const {
		label: state,
		Icon,
		spin,
	} = describe(syncing ? {...status, phase: 'syncing'} : status);
	// An error message brings its own full stop.
	const label = `${state.replace(/\.$/, '')}. ${SYNC_ACTION}`;
	const tone =
		status.phase === 'error' && !syncing
			? 'text-destructive'
			: syncing
				? 'bg-primary/15 text-primary'
				: status.phase === 'offline'
					? 'text-muted-foreground'
					: '';
	return (
		<IconTooltip label={label}>
			<Button
				asChild
				variant="ghost"
				size="icon"
				className={`h-8 w-8 transition-colors duration-300 ${tone}`}
			>
				<a href={SETTINGS_PAGE} aria-label={label}>
					<Icon
						aria-hidden="true"
						className={
							spin
								? 'motion-safe:animate-spin motion-reduce:animate-pulse'
								: undefined
						}
					/>
				</a>
			</Button>
		</IconTooltip>
	);
}
