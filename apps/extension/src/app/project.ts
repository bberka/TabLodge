import {license, repository} from '../../../../package.json';

const manifest = chrome.runtime.getManifest();
const repoUrl = repository.url
	.replace(/^git\+/, '')
	.replace(/\.git$/, '')
	.replace(/\/$/, '');

export const PROJECT = {
	name: manifest.short_name ?? manifest.name,
	version: manifest.version,
	repoUrl,
	websiteUrl: 'https://tablodge.bbay.dev',
	issuesUrl: `${repoUrl}/issues`,
	changelogUrl: `${repoUrl}/releases`,
	license,
	licenseUrl: `${repoUrl}/blob/master/LICENSE`,
} as const;
