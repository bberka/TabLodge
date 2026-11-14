import {
	type ComponentRef,
	type ReactNode,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	type FlatList,
	type FlatListProps,
	type LayoutChangeEvent,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	PanResponder,
	type StyleProp,
	View,
	type ViewStyle,
} from 'react-native';
import type {Selection} from '../../ui/use-selection';

// How close to the list's top or bottom edge the fingers must be for it to scroll, and how far it scrolls each move.
const EDGE = 72;
const STEP = 28;

type CellProps = {
	index: number;
	onLayout?: (event: LayoutChangeEvent) => void;
	style?: StyleProp<ViewStyle>;
	children?: ReactNode;
};

/**
Three fingers dragged down or up a list select every row they pass, from the row they started on, and keep what was
already selected. The list scrolls by itself while the fingers are near its top or bottom edge. Spread `panHandlers` and
`containerRef`/`onContainerLayout` on a view that wraps the list, pass `CellRenderer`, `onScroll` and `scrollEnabled` to
the list.
*/
export function useDragSelect<T extends {id: string}>({
	data,
	selection,
	listRef,
}: {
	data: readonly T[];
	selection: Selection;
	listRef: {current: FlatList<T> | null};
}) {
	const [dragging, setDragging] = useState(false);
	const containerRef = useRef<ComponentRef<typeof View>>(null);
	// Where each row is in the list's content, by its place in `data`.
	const layoutsRef = useRef(new Map<number, {y: number; height: number}>());
	const scrollOffsetRef = useRef(0);
	const areaRef = useRef({top: 0, height: 0});
	const anchorRef = useRef(-1);
	const baseRef = useRef<ReadonlySet<string>>(new Set());
	const latestRef = useRef({data, selection});
	latestRef.current = {data, selection};
	const previousDataRef = useRef(data);
	if (previousDataRef.current !== data) {
		previousDataRef.current = data;
		layoutsRef.current.clear();
	}

	const indexAt = (pageY: number): number => {
		const y = pageY - areaRef.current.top + scrollOffsetRef.current;
		let nearest = -1;
		let distance = Infinity;
		for (const [index, {y: top, height}] of layoutsRef.current) {
			if (y >= top && y < top + height) {
				return index;
			}

			const gap = Math.min(Math.abs(y - top), Math.abs(y - (top + height)));
			if (!(gap < distance)) {
				continue;
			}

			distance = gap;
			nearest = index;
		}

		return nearest;
	};

	const averageY = (touches: ReadonlyArray<{pageY: number}>) =>
		touches.reduce((sum, touch) => sum + touch.pageY, 0) / touches.length;

	const select = (pageY: number) => {
		const {data: rows, selection: picked} = latestRef.current;
		const index = indexAt(pageY);
		if (index < 0 || anchorRef.current < 0) {
			return;
		}

		const from = Math.min(anchorRef.current, index);
		const to = Math.max(anchorRef.current, index);
		picked.setAll([
			...baseRef.current,
			...rows.slice(from, to + 1).map((row) => row.id),
		]);
		// Near an edge the list moves under the fingers, so the drag can reach rows that are off screen.
		if (pageY < areaRef.current.top + EDGE) {
			listRef.current?.scrollToOffset({
				offset: Math.max(0, scrollOffsetRef.current - STEP),
				animated: false,
			});
		} else if (pageY > areaRef.current.top + areaRef.current.height - EDGE) {
			listRef.current?.scrollToOffset({
				offset: scrollOffsetRef.current + STEP,
				animated: false,
			});
		}
	};

	const pan = useMemo(
		() =>
			PanResponder.create({
				onStartShouldSetPanResponderCapture: (event) =>
					event.nativeEvent.touches.length >= 3,
				onMoveShouldSetPanResponderCapture: (event) =>
					event.nativeEvent.touches.length >= 3,
				onPanResponderTerminationRequest: () => false,
				onPanResponderGrant(event) {
					const pageY = averageY(event.nativeEvent.touches);
					containerRef.current?.measureInWindow((_x, top, _width, height) => {
						areaRef.current = {top, height};
						const {data: rows, selection: picked} = latestRef.current;
						const index = indexAt(pageY);
						if (index < 0) {
							return;
						}

						anchorRef.current = index;
						baseRef.current = picked.active ? new Set(picked.ids) : new Set();
						const first = rows[index];
						if (first && !picked.active) {
							picked.start(first.id);
						}

						select(pageY);
					});
					setDragging(true);
				},
				onPanResponderMove(event) {
					if (event.nativeEvent.touches.length >= 3) {
						select(averageY(event.nativeEvent.touches));
					}
				},
				onPanResponderRelease() {
					anchorRef.current = -1;
					setDragging(false);
				},
				onPanResponderTerminate() {
					anchorRef.current = -1;
					setDragging(false);
				},
			}),
		// The responder reads everything through refs, so it is made once.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- refs only
		[],
	);

	const CellRenderer = useMemo(() => {
		function Row({index, onLayout, style, children, ...rest}: CellProps) {
			return (
				<View
					{...rest}
					style={style}
					onLayout={(event) => {
						layoutsRef.current.set(index, {
							y: event.nativeEvent.layout.y,
							height: event.nativeEvent.layout.height,
						});
						onLayout?.(event);
					}}
				>
					{children}
				</View>
			);
		}

		// The list hands its cells more than this (a key, the item); only these are used, the rest pass through.
		return Row as NonNullable<FlatListProps<T>['CellRendererComponent']>;
	}, []);

	return {
		panHandlers: pan.panHandlers,
		containerRef,
		onContainerLayout(event: LayoutChangeEvent) {
			areaRef.current = {
				...areaRef.current,
				height: event.nativeEvent.layout.height,
			};
		},
		CellRenderer,
		onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
			scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
		},
		scrollEnabled: !dragging,
	};
}
