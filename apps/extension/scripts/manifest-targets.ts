import type {Target} from './vite-shared.ts';

type Json = Record<string, unknown>;

export const GECKO_ID = 'tablodge@bbay.dev';
export const FIREFOX_MIN_VERSION = '140.0';
export const CHROMIUM_ONLY_PERMISSIONS = ['favicon', 'sidePanel'] as const;

function firefoxManifest(source: Json): Json {
	const {
		incognito: _incognito,
		minimum_chrome_version: _minimumChromeVersion,
		side_panel: sidePanel,
		background,
		permissions,
		...rest
	} = source as {
		incognito?: unknown;
		minimum_chrome_version?: unknown;
		side_panel?: {default_path?: string};
		background?: {service_worker?: string};
		permissions?: string[];
	} & Json;

	const sidebar =
		sidePanel?.default_path === undefined
			? {}
			: {
					sidebar_action: {
						default_panel: sidePanel.default_path,
						default_title: (source.short_name ?? source.name) as string,
						default_icon: (source.icons as Json | undefined)?.['32'],
					},
				};

	return {
		...rest,
		incognito: 'not_allowed',
		permissions: (permissions ?? []).filter(
			(entry) =>
				!CHROMIUM_ONLY_PERMISSIONS.includes(
					entry as (typeof CHROMIUM_ONLY_PERMISSIONS)[number],
				),
		),
		background: background?.service_worker
			? {scripts: [background.service_worker]}
			: undefined,
		...sidebar,
		browser_specific_settings: {
			gecko: {
				id: GECKO_ID,
				strict_min_version: FIREFOX_MIN_VERSION,
				data_collection_permissions: {required: ['none']},
			},
		},
	};
}

export function manifestForTarget(source: Json, target: Target): Json {
	return target === 'firefox' ? firefoxManifest(source) : source;
}
