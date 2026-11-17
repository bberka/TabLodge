import {useEffect, useState} from 'react';
import {CircleAlert} from 'lucide-react';
import {Label, SelectItem, Switch} from '../shared/ui';
import type {SiteSourceStatus} from '../shared/types';
import {ColumnSelect} from './column-select';
import {send, type ShowStatus} from './common';
import {PROJECT} from './project';
import {
	SITE_SOURCES,
	SITE_SOURCES_KEY,
	type SiteSource,
	type SiteSourceId,
} from './site-sources';

export const SOURCES_TITLE = 'Sources';
export const SOURCES_DESCRIPTION = `Save a link to ${PROJECT.name} when you save it on one of these sites. Each site asks for access to that site only.`;
export const SOURCES_WORDS = [
	'sources',
	'YouTube',
	'Watch later',
	'Reddit',
	'saved posts',
	'X',
	'Twitter',
	'bookmarks',
	'Instagram',
	'reels',
	'site access',
	'permission',
	'Save to',
	'column',
];
// The Save to entry for the site's own column; Radix Select needs a non-empty value.
const SITE_COLUMN = 'site-column';

const HELP: Record<SiteSourceId, string> = {
	youtube: `When you add a video to Watch later on youtube.com, ${PROJECT.name} bookmarks it too.`,
	reddit: `When you save a post or comment on reddit.com, ${PROJECT.name} bookmarks it too.`,
	x: `When you bookmark a post on x.com or twitter.com, ${PROJECT.name} bookmarks it too.`,
	instagram: `When you save a post or reel on instagram.com, ${PROJECT.name} bookmarks it too.`,
};

function noticeText(source: SiteSource, notice: SiteSourceStatus['notice']) {
	if (notice === 'revoked') {
		return `Switched off because the browser removed ${PROJECT.name}'s access to ${source.hosts[0]}.`;
	}

	return notice === 'unreadable'
		? `${PROJECT.name} can't read this page anymore, so your last save there was not added. The site may have changed.`
		: undefined;
}

export function SiteSourcesSettings({
	columns,
	showStatus,
}: {
	columns: ReadonlyArray<{id: string; name: string; icon?: string}>;
	showStatus: ShowStatus;
}) {
	const [sources, setSources] = useState<SiteSourceStatus[]>();
	const [busy, setBusy] = useState<SiteSourceId>();
	const privateWindow = Boolean(chrome.extension?.inIncognitoContext);

	useEffect(() => {
		let alive = true;
		const read = () => {
			void send('GET_SITE_SOURCES')
				.then((result) => {
					if (alive && result.ok) {
						setSources(result.sources);
					}
				})
				.catch(() => undefined);
		};

		// The worker writes a notice when the browser revokes access or a page cannot be read.
		const onChanged = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: string,
		) => {
			if (area === 'local' && Object.hasOwn(changes, SITE_SOURCES_KEY)) {
				read();
			}
		};

		read();
		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			alive = false;
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, []);

	if (privateWindow) {
		return (
			<p className="text-sm text-muted-foreground">
				Switch sources on or off in a regular window. A save in a private window
				is added only when private windows use the regular library.
			</p>
		);
	}

	async function toggle(source: SiteSource, enabled: boolean) {
		setBusy(source.id);
		try {
			// The permission request comes first, straight from the click: Firefox refuses it after another await.
			if (enabled) {
				let granted = false;
				try {
					granted = await chrome.permissions.request({origins: source.origins});
				} catch {
					// A request the browser rejects counts as not granted.
				}

				if (!granted) {
					showStatus(
						`The browser did not grant access to ${source.hosts[0]}, so ${source.label} stays off.`,
						true,
					);
					return;
				}
			}

			const result = await send('SET_SITE_SOURCE', {
				source: source.id,
				enabled,
			});
			if (!enabled) {
				await chrome.permissions
					.remove({origins: source.origins})
					.catch(() => undefined);
			}

			if (!result.ok) {
				showStatus(result.error, true);
				return;
			}

			setSources(result.sources);
			showStatus(
				enabled
					? `${source.label} is on.`
					: `${source.label} is off, and ${PROJECT.name} no longer has access to ${source.hosts[0]}.`,
			);
		} finally {
			setBusy(undefined);
		}
	}

	async function chooseColumn(source: SiteSource, value: string) {
		const columnId = value === SITE_COLUMN ? null : value;
		const result = await send('SET_SITE_SOURCE_COLUMN', {
			source: source.id,
			columnId,
		});
		if (!result.ok) {
			showStatus(result.error, true);
			return;
		}

		setSources(result.sources);
		const name =
			columns.find((column) => column.id === columnId)?.name ??
			`the ${source.column} column`;
		showStatus(`${source.label} now saves to ${name}.`);
	}

	return (
		<div className="divide-y divide-border/70">
			{SITE_SOURCES.map((source) => {
				const status = sources?.find((entry) => entry.id === source.id);
				const notice = noticeText(source, status?.notice);
				const labelId = `site-source-${source.id}`;
				const columnFieldId = `site-source-column-${source.id}`;
				// With no choice, or a chosen column that was deleted, saves go to the site's own column: the one with its
				// name, or a new one.
				const siteColumn = columns.find(
					(column) =>
						column.name.toLocaleLowerCase() ===
						source.column.toLocaleLowerCase(),
				);
				const chosen = columns.some((column) => column.id === status?.columnId)
					? status?.columnId
					: (siteColumn?.id ?? SITE_COLUMN);
				return (
					<div
						key={source.id}
						data-site-source={source.id}
						className="py-4 first:pt-0 last:pb-0"
					>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0">
								<p id={labelId} className="text-sm font-medium">
									{source.label}
								</p>
								<p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
									{HELP[source.id]}
								</p>
								{notice && (
									<p
										role="status"
										className="mt-2 flex max-w-xl items-start gap-1.5 text-xs leading-5 text-destructive"
									>
										<CircleAlert
											className="mt-0.5 h-3.5 w-3.5 shrink-0"
											aria-hidden="true"
										/>
										{notice}
									</p>
								)}
							</div>
							<div className="shrink-0">
								<Switch
									checked={status?.enabled === true}
									aria-labelledby={labelId}
									disabled={!sources || busy !== undefined}
									onCheckedChange={(value) => void toggle(source, value)}
								/>
							</div>
						</div>
						{status?.enabled && (
							<div className="mt-3 ml-2 flex flex-col gap-2 border-l-2 border-border pl-4 sm:flex-row sm:items-center sm:justify-between">
								<div className="min-w-0">
									<Label
										htmlFor={columnFieldId}
										className="text-sm font-medium"
									>
										Save to
									</Label>
									<p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
										The {source.column} column is made on the first save. If a
										column you choose is deleted, saves go there again.
									</p>
								</div>
								<ColumnSelect
									id={columnFieldId}
									columns={columns}
									value={chosen}
									className="w-full sm:w-64"
									onValueChange={(value) => void chooseColumn(source, value)}
								>
									{!siteColumn && (
										<SelectItem value={SITE_COLUMN}>
											{source.column} (new)
										</SelectItem>
									)}
								</ColumnSelect>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
