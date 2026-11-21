import {type RefObject, useCallback, useState} from 'react';
import {
	type FlatList,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	useWindowDimensions,
} from 'react-native';
import {upButtonShows} from './scroll-top-rule';

/**
The state of an Up button for one list: pass `onScroll` to the list, show the button when `visible`, and `up` scrolls
the list back to its first row.
*/
export function useScrollTop(
	listRef: RefObject<Pick<FlatList, 'scrollToOffset'> | null>,
) {
	const {height} = useWindowDimensions();
	const [visible, setVisible] = useState(false);
	const onScroll = useCallback(
		(event: NativeSyntheticEvent<NativeScrollEvent>) => {
			const {y} = event.nativeEvent.contentOffset;
			setVisible((showing) => upButtonShows(y, height, showing));
		},
		[height],
	);
	const up = useCallback(() => {
		listRef.current?.scrollToOffset({offset: 0, animated: true});
	}, [listRef]);
	return {visible, onScroll, up};
}
