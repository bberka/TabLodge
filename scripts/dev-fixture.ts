type DevTab = {
	id: string;
	title: string;
	url: string;
	notes: string;
	pinned: boolean;
	nativeGroup: null;
	savedAt: number;
	originalIndex: number;
};
type DevSession = {
	id: string;
	name: string;
	folderId: string;
	description: string;
	createdAt: number;
	updatedAt: number;
	sourceWindowName: string;
	sourceWindowId: null;
	tabs: DevTab[];
};
type DevFolder = {
	id: string;
	name: string;
	icon?: string;
	createdAt: number;
	isDefault: boolean;
};
type DevBookmarkColumn = DevFolder;
type DevBookmark = {
	id: string;
	title: string;
	url: string;
	columnId: string;
	createdAt: number;
	updatedAt: number;
};
export type DevStore = {
	schemaVersion: number;
	groups: DevSession[];
	folders: DevFolder[];
	bookmarkColumns: DevBookmarkColumn[];
	bookmarks: DevBookmark[];
	settings: Record<string, unknown>;
	updatedAt: number;
	[key: string]: unknown;
};

const createdAt = Date.UTC(2026, 9, 25, 12);

const sessionTabs = [
	[
		['TabLodge architecture', 'https://github.com/bberka/TabLodge'],
		['Chrome extension docs', 'https://developer.chrome.com/docs/extensions/'],
		[
			'MDN Web Extensions',
			'https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions',
		],
		['Vite documentation', 'https://vite.dev/guide/'],
	],
	[
		['Quarterly planning', 'https://linear.app/'],
		['Product roadmap', 'https://www.notion.so/'],
		['Design review notes', 'https://www.figma.com/'],
	],
	[
		['Lisbon trip itinerary', 'https://www.visitlisboa.com/'],
		['Train times and tickets', 'https://www.cp.pt/'],
		['A place to stay in Alfama', 'https://www.airbnb.com/'],
		['Restaurants to try', 'https://www.timeout.com/lisbon'],
	],
	[
		[
			'CSS container queries',
			'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries',
		],
		['Accessible component patterns', 'https://www.w3.org/WAI/ARIA/apg/'],
	],
	[
		['Weekend reading list', 'https://www.theguardian.com/'],
		['Long form article saved for later', 'https://www.theatlantic.com/'],
	],
] satisfies ReadonlyArray<ReadonlyArray<readonly [string, string]>>;

const bookmarkEntries = [
	['Daily', 'Gmail', 'https://mail.google.com/'],
	['Daily', 'Calendar', 'https://calendar.google.com/'],
	['Daily', 'Weather forecast', 'https://weather.com/'],
	['Daily', 'Local news and events', 'https://www.theguardian.com/'],
	[
		'Daily',
		'A longer bookmark title to check how text wraps in a narrow column',
		'https://www.bbc.com/',
	],
	['Dev', 'GitHub', 'https://github.com/'],
	['Dev', 'MDN Web Docs', 'https://developer.mozilla.org/'],
	['Dev', 'TypeScript handbook', 'https://www.typescriptlang.org/docs/'],
	[
		'Dev',
		'Chrome extensions documentation',
		'https://developer.chrome.com/docs/extensions/',
	],
	['Dev', 'Web accessibility initiative', 'https://www.w3.org/WAI/'],
	['Dev', 'Vite', 'https://vite.dev/'],
	['Reading', 'A List Apart', 'https://alistapart.com/'],
	['Reading', 'The Atlantic', 'https://www.theatlantic.com/'],
	['Reading', 'Smashing Magazine', 'https://www.smashingmagazine.com/'],
	['Reading', 'The Verge', 'https://www.theverge.com/'],
	[
		'Reading',
		'An unusually long saved article title that spans more than one line',
		'https://www.nationalgeographic.com/',
	],
] as const;

const folders: DevFolder[] = [
	{id: 'unfiled', name: 'Unfiled', createdAt: 0, isDefault: true},
	{
		id: 'archived-sessions',
		name: 'Archived',
		icon: 'archive',
		createdAt,
		isDefault: false,
	},
	{
		id: 'folder-work',
		name: 'Work',
		icon: 'briefcase',
		createdAt: createdAt - 86_400_000,
		isDefault: false,
	},
	{
		id: 'folder-trips',
		name: 'Trips',
		icon: 'plane',
		createdAt: createdAt - 172_800_000,
		isDefault: false,
	},
	{
		id: 'folder-learning',
		name: 'Learning',
		icon: 'book-open',
		createdAt: createdAt - 259_200_000,
		isDefault: false,
	},
];

const folderBySession = [
	'folder-learning',
	'folder-work',
	'folder-trips',
	'folder-learning',
	'unfiled',
];

const sessionNames = [
	'Home lab rebuild',
	'Quarterly planning',
	'Lisbon trip',
	'CSS container queries',
	'Weekend reading',
];

const sessions: DevSession[] = sessionNames.map((name, sessionIndex) => ({
	id: `dev-session-${sessionIndex + 1}`,
	name,
	folderId: folderBySession[sessionIndex],
	description:
		sessionIndex === 1
			? 'Notes and references for the next planning cycle.'
			: '',
	createdAt: createdAt - (sessionIndex + 1) * 86_400_000,
	updatedAt: createdAt - sessionIndex * 3_600_000,
	sourceWindowName: '',
	sourceWindowId: null,
	tabs: sessionTabs[sessionIndex].map(([title, url], tabIndex) => ({
		id: `dev-tab-${sessionIndex + 1}-${tabIndex + 1}`,
		title,
		url,
		notes: '',
		pinned: false,
		nativeGroup: null,
		savedAt: createdAt - sessionIndex * 3_600_000,
		originalIndex: tabIndex,
	})),
}));

const archivedExample: DevSession = {
	id: 'dev-archived-session',
	name: 'Archived example',
	folderId: 'archived-sessions',
	description: 'An example of a session kept in the archive.',
	createdAt: createdAt - 6 * 86_400_000,
	updatedAt: createdAt - 6 * 86_400_000,
	sourceWindowName: '',
	sourceWindowId: null,
	tabs: [
		{
			id: 'dev-archived-tab-1',
			title: 'Old project notes',
			url: 'https://archive.example/old-project',
			notes: '',
			pinned: false,
			nativeGroup: null,
			savedAt: createdAt - 6 * 86_400_000,
			originalIndex: 0,
		},
	],
};

const bookmarkColumns: DevBookmarkColumn[] = [
	{
		id: 'bookmark-daily',
		name: 'Daily',
		icon: 'star',
		createdAt,
		isDefault: false,
	},
	{
		id: 'bookmark-dev',
		name: 'Dev',
		icon: 'wrench',
		createdAt,
		isDefault: false,
	},
	{
		id: 'bookmark-reading',
		name: 'Reading',
		icon: 'book-open',
		createdAt,
		isDefault: false,
	},
];

export const devFixtureUrls = [
	...new Set([
		...sessionTabs.flatMap((tabs) => tabs.map(([, url]) => url)),
		...bookmarkEntries.map(([, , url]) => url),
		archivedExample.tabs[0].url,
	]),
];

const columnByName = new Map(
	bookmarkColumns.map((column) => [column.name, column.id]),
);
const bookmarks: DevBookmark[] = bookmarkEntries.map(
	([column, title, url], index) => ({
		id: `dev-bookmark-${index + 1}`,
		title,
		url,
		columnId: columnByName.get(column)!,
		createdAt: createdAt - index * 3_600_000,
		updatedAt: createdAt - index * 3_600_000,
	}),
);

/**
Build repeatable, synthetic data for local UI work from the worker's default store.
*/
export function createDevFixture(base: DevStore): DevStore {
	return {
		...base,
		groups: [...sessions, archivedExample],
		folders,
		bookmarkColumns,
		bookmarks,
		updatedAt: createdAt,
	};
}
