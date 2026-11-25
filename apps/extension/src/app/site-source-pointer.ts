import {useEffect, useRef} from 'react';
import {send, type ShowStatus} from './common';
import {turnOnSiteSources} from './site-source-access';
import {
	type SiteSource,
	siteSourceById,
	SITE_SOURCES_KEY,
} from './site-sources';

const names = (sources: readonly SiteSource[]) =>
	sources.length === 1
		? sources[0].label
		: `${sources
				.slice(0, -1)
				.map((source) => source.label)
				.join(', ')} and ${sources.at(-1)!.label}`;

export function useSourcesElsewherePointer(
	showStatus: ShowStatus,
	shown: boolean,
) {
	const showRef = useRef(showStatus);
	showRef.current = showStatus;
	useEffect(() => {
		if (!shown || chrome.extension?.inIncognitoContext) {
			return;
		}

		let alive = true;
		const check = async () => {
			const result = await send('GET_SITE_SOURCES').catch(() => undefined);
			const sources = result?.ok
				? result.sources
						.filter(
							(entry) =>
								entry.wanted &&
								!entry.enabled &&
								!entry.notice &&
								!entry.pointed,
						)
						.flatMap((entry) => siteSourceById(entry.id) ?? [])
				: [];
			if (!alive || sources.length === 0) {
				return;
			}

			await send('SITE_SOURCES_POINTED', {
				sources: sources.map((source) => source.id),
			});
			const label = names(sources);
			showRef.current(
				`${label} ${sources.length === 1 ? 'is' : 'are'} on in another browser.`,
				false,
				{
					action: {
						label: 'Turn on',
						async onClick() {
							const turned = await turnOnSiteSources(sources);
							showRef.current(
								turned.ok
									? `Turned on ${label} in this browser.`
									: turned.error,
								!turned.ok,
								{toast: true},
							);
						},
					},
				},
			);
		};

		const onChanged = (
			changes: Record<string, chrome.storage.StorageChange>,
			area: string,
		) => {
			if (area === 'local' && Object.hasOwn(changes, SITE_SOURCES_KEY)) {
				void check();
			}
		};

		void check();
		chrome.storage.onChanged.addListener(onChanged);
		return () => {
			alive = false;
			chrome.storage.onChanged.removeListener(onChanged);
		};
	}, [shown]);
}
