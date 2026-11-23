import type {Bookmark, Store} from '../../../extension/src/shared/types';
import type {OpenWith} from '../settings/preference-schema';
import {
	ALL_BOOKMARKS_ID,
	allBookmarks,
	bookmarksByColumn,
	columnViews,
} from './board-edits';
import {hostOf} from './store-shape';

export const WIDGET_SNAPSHOT_VERSION = 1;
export const WIDGET_LINKS_PER_COLUMN = 50;
export const WIDGET_COLUMNS_MAX = 50;

export type WidgetLink = {title: string; url: string; host: string};

export type WidgetColumn = {
	id: string;
	name: string;
	count: number;
	links: WidgetLink[];
};

export type WidgetSnapshot = {
	v: typeof WIDGET_SNAPSHOT_VERSION;
	open: {how: OpenWith; app: string};
	columns: WidgetColumn[];
};

const isWebLink = (url: string) => /^https?:\/\//i.test(url);

export function buildWidgetSnapshot(
	regular: Store,
	open: {how: OpenWith; app: string},
): WidgetSnapshot | undefined {
	if (regular.bookmarks.length === 0) {
		return undefined;
	}

	const column = (id: string, name: string, bookmarks: Bookmark[]) => {
		const links = bookmarks.filter((bookmark) => isWebLink(bookmark.url));
		return {
			id,
			name,
			count: links.length,
			links: links.slice(0, WIDGET_LINKS_PER_COLUMN).map((bookmark) => {
				const host = hostOf(bookmark.url);
				return {title: bookmark.title.trim() || host, url: bookmark.url, host};
			}),
		};
	};

	const groups = bookmarksByColumn(regular);
	const columns = [
		column(ALL_BOOKMARKS_ID, 'All', allBookmarks(regular)),
		...columnViews(regular)
			.slice(0, WIDGET_COLUMNS_MAX)
			.map((view) => column(view.id, view.name, groups.get(view.id) ?? [])),
	];
	return {v: WIDGET_SNAPSHOT_VERSION, open, columns};
}
