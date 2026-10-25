import pkg from '../../package.json';

export const SITE = {
	name: 'TabLodge',
	url: 'https://tablodge.bbay.dev',
	repo: 'https://github.com/bberka/TabLodge',
	releases: 'https://github.com/bberka/TabLodge/releases/latest',
	issues: 'https://github.com/bberka/TabLodge/issues',
	license: 'https://github.com/bberka/TabLodge/blob/master/LICENSE',
	version: pkg.version,
	author: 'Berkay',
	ogImage: '/og.png',
	defaultDescription:
		'TabLodge is a free, open-source tab session manager and new-tab bookmark board for Chrome, Brave and Edge. Save and restore tabs. No account, no tracking, everything stays in your browser.',
} as const;

export const abs = (path: string) => new URL(path, SITE.url).href;
