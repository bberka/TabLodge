import type {DevStore} from '../../src/shared/dev-fixture.ts';

/*
A synthetic library of any size for performance work (see perf-profile.ts). It lives under scripts/, so it never
reaches the shipped bundle. Deterministic: the same count always gives the same library.
*/

const hosts = [
	'github.com',
	'developer.mozilla.org',
	'news.ycombinator.com',
	'stackoverflow.com',
	'www.youtube.com',
	'en.wikipedia.org',
	'medium.com',
	'www.reddit.com',
	'dev.to',
	'vite.dev',
	'react.dev',
	'www.theguardian.com',
];
const words = [
	'guide',
	'tutorial',
	'release notes',
	'performance',
	'accessibility',
	'architecture',
	'benchmark',
	'cookbook',
	'reference',
	'deep dive',
	'weekly',
	'review',
];
const tagNames = [
	'read-later',
	'work',
	'design',
	'recipes',
	'travel',
	'tools',
	'research',
	'video',
];
const columnNames = [
	'Daily',
	'Dev',
	'Reading',
	'Design',
	'Videos',
	'Recipes',
	'Travel',
	'Tools',
	'Research',
	'Shopping',
	'Later',
	'Misc',
];
const base = Date.UTC(2026, 9, 1);

function random(seed: number) {
	let state = seed;
	return () => {
		state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
		return state / 4_294_967_296;
	};
}

export function createLargeLibrary(
	store: DevStore,
	bookmarkCount: number,
	sessionCount = Math.max(10, Math.round(bookmarkCount / 15)),
): DevStore {
	const next = random(bookmarkCount);
	const pick = <T>(list: readonly T[]) =>
		list[Math.floor(next() * list.length)];
	const columns = columnNames.map((name, index) => ({
		id: `perf-column-${index}`,
		name,
		icon: 'star',
		createdAt: base,
		isDefault: false,
	}));
	const bookmarks = Array.from({length: bookmarkCount}, (_, index) => {
		const host = pick(hosts);
		const title = `${pick(words)} ${index + 1}: ${pick(words)} for ${host}`;
		const tags = next() < 0.35 ? [pick(tagNames), pick(tagNames)] : undefined;
		return {
			id: `perf-bookmark-${index}`,
			title,
			url: `https://${host}/p/${index + 1}`,
			columnId: columns[Math.floor(next() ** 1.5 * columns.length)].id,
			...(next() < 0.3 && {
				notes: `Remember to compare this with the older ${pick(words)}. Needs a second read.`,
			}),
			...(tags && {tags: [...new Set(tags)]}),
			createdAt: base + index * 60_000,
			updatedAt: base + index * 60_000,
		};
	});
	const groups = Array.from({length: sessionCount}, (_, index) => ({
		id: `perf-session-${index}`,
		name: `Session ${index + 1}: ${pick(words)}`,
		folderId: 'unfiled',
		description: next() < 0.3 ? 'Notes about this session.' : '',
		createdAt: base - index * 3_600_000,
		updatedAt: base - index * 3_600_000,
		sourceWindowName: '',
		sourceWindowId: null,
		tabs: Array.from({length: 8 + Math.floor(next() * 14)}, (__, tabIndex) => {
			const host = pick(hosts);
			return {
				id: `perf-tab-${index}-${tabIndex}`,
				title: `${pick(words)} ${tabIndex + 1} on ${host}`,
				url: `https://${host}/s/${index}/${tabIndex}`,
				notes: next() < 0.15 ? 'A note on this tab.' : '',
				pinned: false,
				nativeGroup: null,
				savedAt: base - index * 3_600_000,
				originalIndex: tabIndex,
			};
		}),
	}));
	return {
		...store,
		groups,
		bookmarkColumns: columns,
		bookmarks,
		updatedAt: base,
	};
}
