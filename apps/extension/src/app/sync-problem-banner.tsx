import {CloudAlert, CloudUpload, Settings} from 'lucide-react';
import {problemBanner, readCompat} from '../shared/sync/compat';
import {Button} from '../shared/ui';
import {SYNC_SETTINGS_PAGE, useSyncStatus} from './sync-indicator';
import {cn} from '@/lib/utils';

/**
Shown on the dashboard while the connected sync server and this browser do not match: sync stopped over another
protocol, or the server lacks features. It has no Dismiss; it goes away once the server or the app is updated.
*/
export function SyncProblemBanner() {
	const status = useSyncStatus();
	const banner = status && problemBanner(readCompat(status));
	if (!banner) {
		return null;
	}

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
			<Button asChild size="sm" variant="outline" className="shrink-0">
				<a href={SYNC_SETTINGS_PAGE}>
					<Settings className="h-4 w-4" aria-hidden="true" />
					Open Sync settings
				</a>
			</Button>
		</section>
	);
}
