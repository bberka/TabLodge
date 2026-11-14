import {useEffect, useState} from 'react';
import {CloudAlert, CloudOff, RefreshCw} from 'lucide-react';
import {SYNC_STATUS_KEY, type SyncStatus} from '../shared/sync/client';
import {isRecord} from '../shared/library-values';
import {Button, IconTooltip} from '../shared/ui';

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

/**
A header button that shows how sync is doing and opens its settings. Hidden while sync is off.
*/
export function SyncIndicator() {
	const status = useSyncStatus();
	if (!status) {
		return null;
	}

	const {label, Icon, spin} = describe(status);
	return (
		<IconTooltip label={label}>
			<Button
				asChild
				variant="ghost"
				size="icon"
				className={
					status.phase === 'error' ? 'h-8 w-8 text-destructive' : 'h-8 w-8'
				}
			>
				<a href="options.html#settings-sync" aria-label={label}>
					<Icon
						aria-hidden="true"
						className={spin ? 'motion-safe:animate-spin' : undefined}
					/>
				</a>
			</Button>
		</IconTooltip>
	);
}
