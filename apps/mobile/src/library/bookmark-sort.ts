import {BOOKMARK_SORT_OPTIONS} from '../../../extension/src/shared/bookmark-rules';
import type {BookmarkSort} from '../../../extension/src/shared/types';
import type {IconName} from '../ui/widgets';

const ICONS: Record<BookmarkSort, IconName> = {
	manual: 'reorder-three-outline',
	newest: 'arrow-down-outline',
	oldest: 'arrow-up-outline',
	title: 'text-outline',
	site: 'globe-outline',
};

export const BOOKMARK_SORT_CHOICES = BOOKMARK_SORT_OPTIONS.map(
	([id, name]) => ({id, name, icon: ICONS[id]}),
);

export const bookmarkSortName = (sort: BookmarkSort): string =>
	BOOKMARK_SORT_OPTIONS.find(([id]) => id === sort)?.[1] ?? sort;
