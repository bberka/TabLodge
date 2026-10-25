import {useEffect, useState} from 'react';
import {History, LifeBuoy, RotateCcw} from 'lucide-react';
import {Button} from '../shared/ui';
import {send, type ShowStatus} from './common';
import {
	messageOf,
	plural,
	reportSnapshotRestore,
	useSnapshots,
	whenText,
} from './recovery-core';

/**
"Restore your last browsing session? N windows · M tabs" shown on the dashboard after an unclean exit.
*/
export function RecoveryBanner({
	showStatus,
	onReview,
}: {
	showStatus: ShowStatus;
	onReview: () => void;
}) {
	const {data, reload} = useSnapshots(true);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		const onChanged = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: chrome.storage.AreaName,
		) => {
			if (area === 'local' && 'tablodge.snapshots.meta' in changes) {
				void reload();
			}
		};

		chrome.storage.onChanged.addListener(onChanged);
		return () => chrome.storage.onChanged.removeListener(onChanged);
	}, [reload]);
	const recovery = data?.recovery;
	if (!recovery) {
		return null;
	}

	async function restore() {
		if (busy || !recovery) {
			return;
		}

		setBusy(true);
		try {
			const result = await send('RESTORE_SNAPSHOT', {
				id: recovery.snapshotId,
			});
			if (result?.ok) {
				reportSnapshotRestore(result, showStatus);
			} else {
				showStatus(result?.error || 'Could not restore that session.', true);
			}
		} catch (reason) {
			showStatus(messageOf(reason) || 'Could not restore that session.', true);
		}

		setBusy(false);
		await reload();
	}

	async function dismiss() {
		await send('DISMISS_RECOVERY');
		await reload();
	}

	return (
		<section
			aria-label="Session recovery"
			className="mb-6 flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/[.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
		>
			<div className="flex min-w-0 items-start gap-3">
				<span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
					<LifeBuoy className="h-4 w-4" aria-hidden="true" />
				</span>
				<div className="min-w-0">
					<p className="text-sm font-semibold">
						Restore your last browsing session?
					</p>
					<p className="text-xs leading-5 text-muted-foreground">
						{plural(recovery.windows, 'window')} ·{' '}
						{plural(recovery.tabs, 'tab')} · {whenText(recovery.at)}. The
						browser seems to have closed unexpectedly.
					</p>
				</div>
			</div>
			<div className="flex shrink-0 flex-wrap gap-2">
				<Button size="sm" disabled={busy} onClick={() => void restore()}>
					<RotateCcw className="h-4 w-4" />
					{busy ? 'Restoring' : 'Restore'}
				</Button>
				<Button size="sm" variant="outline" onClick={onReview}>
					<History className="h-4 w-4" />
					Review
				</Button>
				<Button size="sm" variant="ghost" onClick={() => void dismiss()}>
					Dismiss
				</Button>
			</div>
		</section>
	);
}
