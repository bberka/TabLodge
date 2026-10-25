// Project metadata for the UI: Help › About and the Settings footer.
//
// The repository URL comes from package.json ("homepage" and "repository.url"), the single source of truth:
// the links below are derived from it, and the build copies "homepage" into the manifest's homepage_url
// (scripts/vite-shared.ts).
//
// The display name and version come from extension/manifest.json ("short_name" and "version"), which is
// also what the browser shows; HTML <title>s use %APP_NAME% and the service worker reads the same field.
import {license, repository} from '../../package.json';

const manifest = chrome.runtime.getManifest();
const repoUrl = repository.url
	.replace(/^git\+/, '')
	.replace(/\.git$/, '')
	.replace(/\/$/, '');

export const PROJECT = {
	name: manifest.short_name ?? manifest.name,
	version: manifest.version,
	repoUrl,
	issuesUrl: `${repoUrl}/issues`,
	changelogUrl: `${repoUrl}/releases`,
	license,
	licenseUrl: `${repoUrl}/blob/master/LICENSE`,
} as const;
