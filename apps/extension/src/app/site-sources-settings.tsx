import {useEffect, useState} from 'react';
import {CircleAlert} from 'lucide-react';
import {Switch} from '../shared/ui';
import type {SiteSourceStatus} from '../shared/types';
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
	'site access',
	'permission',
];

const HELP: Record<SiteSourceId, string> = {
	youtube: `When you add a video to Watch later on youtube.com, ${PROJECT.name} bookmarks it in a YouTube column.`,
	reddit: `When you save a post or comment on reddit.com, ${PROJECT.name} bookmarks it in a Reddit column.`,
};

function noticeText(source: SiteSource, notice: SiteSourceStatus['notice']) {
	if (notice === 'revoked') {
		return `Switched off because the browser removed ${PROJECT.name}'s access to ${source.hosts[0]}.`;
	}

	return notice === 'unreadable'
		? `${PROJECT.name} can't read this page anymore, so your last save there was not added. The site may have changed.`
		: undefined;
}

export function SiteSourcesSettings({showStatus}: {showStatus: ShowStatus}) {
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
					? `${source.label} is on. Saves there now go to the ${source.column} column.`
					: `${source.label} is off, and ${PROJECT.name} no longer has access to ${source.hosts[0]}.`,
			);
		} finally {
			setBusy(undefined);
		}
	}

	return (
		<div className="divide-y divide-border/70">
			{SITE_SOURCES.map((source) => {
				const status = sources?.find((entry) => entry.id === source.id);
				const notice = noticeText(source, status?.notice);
				const labelId = `site-source-${source.id}`;
				return (
					<div
						key={source.id}
						data-site-source={source.id}
						className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
					>
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
				);
			})}
		</div>
	);
}
