import type {Store} from '../../../extension/src/shared/types';
import type {OpenWith} from '../settings/preference-schema';
import {bookmarksIn, columnViews} from './board-edits';
import {hostOf} from './store-shape';

/**
The format the Bookmarks widget reads. The Kotlin side refuses any other version and shows its "not loaded" message.
*/
export const WIDGET_SNAPSHOT_VERSION = 1;
export const WIDGET_LINKS_PER_COLUMN = 50;
export const WIDGET_COLUMNS_MAX = 50;

export type WidgetLink = {title: string; url: string; host: string};

export type WidgetColumn = {
	id: string;
	name: string;
	/**
	Every web link in the column, also those past the cap.
	*/
	count: number;
	links: WidgetLink[];
};

export type WidgetSnapshot = {
	v: typeof WIDGET_SNAPSHOT_VERSION;
	/**
	How a row opens its link: the regular library's **Settings › Open links** choice.
	*/
	open: {how: OpenWith; app: string};
	columns: WidgetColumn[];
};

const isWebLink = (url: string) => /^https?:\/\//i.test(url);

/**
What the home screen widget may show of a library: its bookmark columns in the user's order (the Unfiled bucket last),
each with its first web links in the column's own order, capped so the file stays small. Pass only the regular
library; the widget has no way to tell libraries apart. A library with no bookmarks gives no snapshot, so erasing the
bookmarks deletes the widget's copy too.
*/
export function buildWidgetSnapshot(
	regular: Store,
	open: {how: OpenWith; app: string},
): WidgetSnapshot | undefined {
	if (regular.bookmarks.length === 0) {
		return undefined;
	}

	const columns = columnViews(regular)
		.slice(0, WIDGET_COLUMNS_MAX)
		.map((column) => {
			const links = bookmarksIn(regular, column.id).filter((bookmark) =>
				isWebLink(bookmark.url),
			);
			return {
				id: column.id,
				name: column.name,
				count: links.length,
				links: links.slice(0, WIDGET_LINKS_PER_COLUMN).map((bookmark) => {
					const host = hostOf(bookmark.url);
					return {
						title: bookmark.title.trim() || host,
						url: bookmark.url,
						host,
					};
				}),
			};
		});
	return {v: WIDGET_SNAPSHOT_VERSION, open, columns};
}
