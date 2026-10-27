import pkg from '../../package.json';

const version = process.env.SITE_VERSION || pkg.version;

export const SITE = {
	name: 'TabLodge',
	url: 'https://tablodge.bbay.dev',
	repo: 'https://github.com/bberka/TabLodge',
	releases: 'https://github.com/bberka/TabLodge/releases/latest',
	chromeWebStore:
		'https://chromewebstore.google.com/detail/tablodge-%E2%80%93-tab-session-ma/ekidoclgpdfhpdlidlkcjccgihbndoib',
	issues: 'https://github.com/bberka/TabLodge/issues',
	license: 'https://github.com/bberka/TabLodge/blob/master/LICENSE',
	version,
	author: 'Berkay',
	ogImage: '/og.png',
	defaultDescription: 'Save tabs for later and keep bookmarks close. Your library stays in your browser.',
} as const;

export const abs = (path: string) => new URL(path, SITE.url).href;
