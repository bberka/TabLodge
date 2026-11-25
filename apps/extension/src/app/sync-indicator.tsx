import {useEffect, useState} from 'react';
import {CloudAlert, CloudOff, RefreshCw} from 'lucide-react';
import {SYNC_STATUS_KEY, type SyncStatus} from '../shared/sync/client';
import {isRecord} from '../shared/library-values';
import {Button, IconTooltip} from '../shared/ui';

export function useLocalValue(key: string): {value: unknown} | undefined {
	const [value, setValue] = useState<{value: unknown}>();
	useEffect(() => {
		void chrome.storage.local.get([key]).then((values) => {
			setValue({value: values[key]});
		});
		const onChanged = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: string,
		) => {
			if (area === 'local' && Object.hasOwn(changes, key)) {
				setValue({value: changes[key].newValue});
			}
		};

		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, [key]);
	return value;
}

export function useSyncStatus(): SyncStatus | undefined {
	const value = useLocalValue(SYNC_STATUS_KEY)?.value;
	return isRecord(value) && value.connected === true
		? (value as SyncStatus)
		: undefined;
}

export const SYNC_SETTINGS_PAGE = 'options.html#settings-sync';

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

const MIN_SYNCING_MS = 900;

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

export function SyncIndicator() {
	const status = useSyncStatus();
	const syncing = useSyncingLook(status?.phase === 'syncing');
	if (!status) {
		return null;
	}

	const {
		label: state,
		Icon,
		spin,
	} = describe(syncing ? {...status, phase: 'syncing'} : status);
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
				<a href={SYNC_SETTINGS_PAGE} aria-label={label}>
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
