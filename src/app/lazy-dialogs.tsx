// The big dialogs (backup, import, share, snapshots, trash) are loaded the first time they are opened, so a page
// does not download or parse them just to show its list. Once opened, a dialog stays mounted so it can animate closed.
import {
	lazy,
	Suspense,
	useMemo,
	useState,
	type ComponentProps,
	type ComponentType,
} from 'react';
import {useRetainedValue} from '../shared/ui';
import type {ShowStatus} from './common';
import type * as DataTransfer from './data-transfer';
import type * as Recovery from './recovery';

/**
Wraps a lazily imported dialog: nothing is loaded or mounted until `open` is first true.
*/
function lazyDialog<Props extends {open: boolean}>(
	load: () => Promise<ComponentType<Props>>,
) {
	const Loaded = lazy(async () => ({
		default: await load(),
	})) as ComponentType<Props>;
	return (props: Props) => {
		const [wanted, setWanted] = useState(props.open);
		if (props.open && !wanted) {
			setWanted(true);
		}

		return wanted ? (
			<Suspense fallback={null}>
				<Loaded {...props} />
			</Suspense>
		) : null;
	};
}

export const BackupDialog = lazyDialog<
	ComponentProps<typeof DataTransfer.BackupDialog>
>(async () => (await import('./data-transfer')).BackupDialog);

export const ImportDialog = lazyDialog<
	ComponentProps<typeof DataTransfer.ImportDialog>
>(async () => (await import('./data-transfer')).ImportDialog);

const ShareDialog = lazyDialog<ComponentProps<typeof DataTransfer.ShareDialog>>(
	async () => (await import('./data-transfer')).ShareDialog,
);

export const SnapshotsDialog = lazyDialog<
	ComponentProps<typeof Recovery.SnapshotsDialog>
>(async () => (await import('./recovery')).SnapshotsDialog);

export const TrashDialog = lazyDialog<
	ComponentProps<typeof Recovery.TrashDialog>
>(async () => (await import('./recovery')).TrashDialog);

const RecoveryToolsLoaded = lazy(async () => ({
	default: (await import('./recovery')).RecoveryTools,
}));

/**
The backups list in Settings, loaded when the page reaches it.
*/
export function RecoveryTools(
	props: ComponentProps<typeof Recovery.RecoveryTools>,
) {
	return (
		<Suspense
			fallback={<p className="text-sm text-muted-foreground">Loading…</p>}
		>
			<RecoveryToolsLoaded {...props} />
		</Suspense>
	);
}

/**
Lazy form of `useShareDialog`: `openShare(payload)` opens the dialog; render `shareDialog` once.
*/
export function useShareDialog(showStatus: ShowStatus) {
	const [payload, setPayload] = useState<DataTransfer.SharePayload | null>(
		null,
	);
	const [open, setOpen] = useState(false);
	const shown = useRetainedValue(payload, open && payload != null);
	return useMemo(
		() => ({
			openShare(next: DataTransfer.SharePayload) {
				setPayload(next);
				setOpen(true);
			},
			shareDialog: (
				<ShareDialog
					open={open}
					title={shown?.title}
					groups={shown?.groups}
					sources={shown?.sources}
					showStatus={showStatus}
					onOpenChange={setOpen}
				/>
			),
		}),
		[open, shown, showStatus],
	);
}
