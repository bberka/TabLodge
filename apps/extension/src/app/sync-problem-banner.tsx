import {CloudAlert, CloudUpload, Settings} from 'lucide-react';
import {
	dismissKey,
	problemBanner,
	readCompat,
	SYNC_DISMISSED_KEY,
} from '../shared/sync/compat';
import {Button} from '../shared/ui';
import {
	SYNC_SETTINGS_PAGE,
	useLocalValue,
	useSyncStatus,
} from './sync-indicator';
import {cn} from '@/lib/utils';

export function SyncProblemBanner() {
	const status = useSyncStatus();
	const dismissed = useLocalValue(SYNC_DISMISSED_KEY);
	const compat = status && readCompat(status);
	const banner = compat && dismissed && problemBanner(compat, dismissed.value);
	if (!banner) {
		return null;
	}

	const key = dismissKey(compat);

	const Icon = banner.stopped ? CloudAlert : CloudUpload;
	return (
		<section
			aria-label="Sync server"
			className={cn(
				'mb-6 flex flex-col gap-3 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
				banner.stopped
					? 'border-destructive/40 bg-destructive/6'
					: 'border-primary/30 bg-primary/6',
			)}
		>
			<div className="flex min-w-0 items-start gap-3">
				<span
					className={cn(
						'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md',
						banner.stopped
							? 'bg-destructive/10 text-destructive'
							: 'bg-primary/10 text-primary',
					)}
				>
					<Icon className="h-4 w-4" aria-hidden="true" />
				</span>
				<div className="min-w-0">
					<p className="text-sm font-semibold">{banner.title}</p>
					<p className="text-xs leading-5 text-muted-foreground">
						{banner.detail}
					</p>
				</div>
			</div>
			<div className="flex shrink-0 flex-wrap gap-2">
				<Button asChild size="sm" variant="outline">
					<a href={SYNC_SETTINGS_PAGE}>
						<Settings className="h-4 w-4" aria-hidden="true" />
						Open Sync settings
					</a>
				</Button>
				{key === undefined ? null : (
					<Button
						size="sm"
						variant="ghost"
						onClick={() =>
							void chrome.storage.local.set({[SYNC_DISMISSED_KEY]: key})
						}
					>
						Dismiss
					</Button>
				)}
			</div>
		</section>
	);
}
