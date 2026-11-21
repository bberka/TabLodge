import type {BookmarkSort} from '../../../../extension/src/shared/types';
import {BOOKMARK_SORT_CHOICES} from '../../library/bookmark-sort';
import {BottomSheet} from '../../ui/bottom-sheet';
import {ChoiceList} from '../settings/select-row';

export function SortSheet({
	visible,
	value,
	onPick,
	onClose,
}: {
	visible: boolean;
	value: BookmarkSort;
	onPick: (sort: BookmarkSort) => void;
	onClose: () => void;
}) {
	return (
		<BottomSheet
			scroll={false}
			visible={visible}
			label="Sort bookmarks"
			onClose={onClose}
		>
			<ChoiceList
				title="Sort bookmarks"
				choices={BOOKMARK_SORT_CHOICES}
				value={value}
				onPick={(sort) => {
					onClose();
					onPick(sort);
				}}
			/>
		</BottomSheet>
	);
}
