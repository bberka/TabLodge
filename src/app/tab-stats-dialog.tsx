// The read-only Statistics dialog in Settings: saved sessions and tabs, how many tabs are open, which of them
// were used longest ago, and a rough memory guess. It only reads data; nothing is changed or sent anywhere.
import {useEffect, useState} from 'react';
import {Check} from 'lucide-react';
import {
	Button,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '../shared/ui';
import {plural} from './common';
import {
	estimateTabMemoryMb,
	idleText,
	leastRecentlyUsedTabs,
	memoryEstimateText,
	savedStats,
} from './tab-stats';
import {displayUrl} from './url-display';
import type {Session} from './types';

const OLDEST_SHOWN = 10;

type OpenTabs = {
	total: number;
	discarded: number;
	windows: number;
	oldest: chrome.tabs.Tab[];
	now: number;
};

async function readOpenTabs(): Promise<OpenTabs> {
	const tabs = await chrome.tabs.query({});
	return {
		total: tabs.length,
		discarded: tabs.filter((tab) => tab.discarded).length,
		windows: new Set(tabs.map((tab) => tab.windowId)).size,
		oldest: leastRecentlyUsedTabs(tabs, OLDEST_SHOWN),
		now: Date.now(),
	};
}

function Stat({label, value}: {label: string; value: string}) {
	return (
		<div className="rounded-md bg-muted/60 px-3 py-2.5">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
		</div>
	);
}

export function TabStatsDialog({
	open,
	onOpenChange,
	sessions,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	sessions: readonly Session[];
}) {
	const [openTabs, setOpenTabs] = useState<OpenTabs | null>(null);
	const [error, setError] = useState(false);
	useEffect(() => {
		if (!open) {
			return;
		}

		let current = true;
		setError(false);
		readOpenTabs()
			.then((result) => current && setOpenTabs(result))
			.catch(() => current && setError(true));
		return () => {
			current = false;
		};
	}, [open]);

	const saved = savedStats(sessions);
	const memory = openTabs
		? estimateTabMemoryMb(openTabs.total, openTabs.discarded)
		: 0;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="lg">
				<DialogHeader>
					<DialogTitle>Statistics</DialogTitle>
					<DialogDescription>
						A read-only summary of your saved sessions and the tabs open in this
						browser. Nothing leaves your device.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<section aria-labelledby="stats-saved" className="min-w-0 space-y-2">
						<h3 id="stats-saved" className="text-sm font-medium">
							Saved
						</h3>
						<dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
							<Stat label="Sessions" value={String(saved.sessions)} />
							<Stat label="Saved tabs" value={String(saved.tabs)} />
							<Stat
								label="Largest session"
								value={plural(saved.largest, 'tab')}
							/>
						</dl>
					</section>
					<section aria-labelledby="stats-open" className="min-w-0 space-y-2">
						<h3 id="stats-open" className="text-sm font-medium">
							Open now
						</h3>
						{error && (
							<p role="alert" className="text-sm font-medium text-destructive">
								Could not read the open tabs.
							</p>
						)}
						{!error && !openTabs && (
							<p role="status" className="text-sm text-muted-foreground">
								Loading…
							</p>
						)}
						{openTabs && (
							<>
								<dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
									<Stat
										label="Open tabs"
										value={`${openTabs.total} in ${plural(openTabs.windows, 'window')}`}
									/>
									<Stat
										label="Unloaded tabs"
										value={String(openTabs.discarded)}
									/>
									<Stat
										label="Memory (rough guess)"
										value={memoryEstimateText(memory)}
									/>
								</dl>
								<p className="text-xs leading-5 text-muted-foreground">
									The memory figure assumes about 100 MB for each loaded tab and
									5 MB for each unloaded one. The browser does not share exact
									numbers with extensions. Open its Task Manager (Shift+Esc) for
									real figures.
								</p>
								<h4 className="pt-2 text-sm font-medium">
									Tabs unused the longest
								</h4>
								{openTabs.oldest.length === 0 ? (
									<p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
										No other open tabs to list.
									</p>
								) : (
									<ol
										className="space-y-2"
										aria-label="Open tabs, longest unused first"
									>
										{openTabs.oldest.map((tab) => (
											<li
												key={tab.id}
												className="rounded-lg border border-border px-3 py-2"
											>
												<p
													className="truncate text-sm font-medium"
													title={tab.title}
												>
													{tab.title || tab.url || 'Untitled tab'}
												</p>
												<p className="truncate text-xs text-muted-foreground">
													{tab.url ? `${displayUrl(tab.url)} · ` : ''}
													used {idleText(openTabs.now, tab.lastAccessed ?? 0)}
												</p>
											</li>
										))}
									</ol>
								)}
							</>
						)}
					</section>
				</DialogBody>
				<DialogFooter>
					<Button onClick={() => onOpenChange(false)}>
						<Check aria-hidden="true" />
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
