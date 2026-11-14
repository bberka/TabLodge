// Turns the source manifest (shell/manifest.json, written for Chromium) into the manifest of a target browser.
//
// Firefox runs the same pages and the same background script, but its manifest differs:
//   - the background script is an event page ("scripts"), since Firefox has no extension service workers
//   - the Side Panel API does not exist; the same page is registered as the sidebar instead
//   - the "favicon" and "sidePanel" permissions do not exist
//   - private windows cannot get a separate extension context ("split"), so the extension stays out of them
//   - add-on metadata lives under browser_specific_settings.gecko
import type {Target} from './vite-shared.ts';

type Json = Record<string, unknown>;

/**
The add-on id Firefox keys storage and permissions to. It is permanent once an add-on is signed.
*/
export const GECKO_ID = 'tablodge@bbay.dev';
/**
Needed for tab groups and tabs.group (139) and for the data collection permissions key (140).
*/
export const FIREFOX_MIN_VERSION = '140.0';
/**
Permissions the Firefox build must not request: Firefox rejects names it does not know.
*/
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
				// TabLodge sends nothing anywhere, so Firefox's install prompt can say so.
				data_collection_permissions: {required: ['none']},
			},
		},
	};
}

export function manifestForTarget(source: Json, target: Target): Json {
	return target === 'firefox' ? firefoxManifest(source) : source;
}
