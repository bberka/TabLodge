import {
	defaultRangeExtractor,
	type Range,
	useVirtualizer,
	useWindowVirtualizer,
} from '@tanstack/react-virtual';
import {
	type ReactNode,
	type Ref,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';

export const VIRTUAL_OVERSCAN = 6;

export type VirtualRowsHandle = {
	scrollToIndex: (
		index: number,
		options?: {
			align?: 'auto' | 'start' | 'center' | 'end';
			behavior?: 'auto' | 'smooth';
		},
	) => void;
};

function withRowAndNeighbors(range: Range, row: number | null) {
	const rows = defaultRangeExtractor(range);
	if (row === null) {
		return rows;
	}

	const kept = [row - 1, row, row + 1].filter(
		(index) => index >= 0 && index < range.count,
	);
	return [...new Set([...rows, ...kept])].toSorted((a, b) => a - b);
}

export function useNearViewport(margin = 600) {
	const ref = useRef<HTMLElement>(null);
	const [near, setNear] = useState(false);
	useEffect(() => {
		const element = ref.current;
		if (!element || typeof IntersectionObserver === 'undefined') {
			setNear(true);
			return undefined;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				setNear(entries.some((entry) => entry.isIntersecting));
			},
			{rootMargin: `${margin}px 0px`},
		);
		observer.observe(element);
		return () => {
			observer.disconnect();
		};
	}, [margin]);
	return [ref, near] as const;
}

export function VirtualRows({
	count,
	scrollElement,
	estimate,
	gap,
	active = true,
	itemKey,
	handleRef,
	keepFocused = false,
	children,
}: {
	count: number;
	scrollElement: HTMLElement | null;
	estimate: number;
	gap: number;
	active?: boolean;
	itemKey: (index: number) => string;
	handleRef?: Ref<VirtualRowsHandle>;
	keepFocused?: boolean;
	children: (index: number) => ReactNode;
}) {
	const [focusedRow, setFocusedRow] = useState<number | null>(null);
	const virtualizer = useVirtualizer({
		count,
		getScrollElement: () => scrollElement,
		estimateSize: () => estimate,
		overscan: VIRTUAL_OVERSCAN,
		gap,
		getItemKey: itemKey,
		rangeExtractor: (range) => withRowAndNeighbors(range, focusedRow),
		initialRect: {width: 0, height: 800},
	});
	useImperativeHandle(
		handleRef,
		() => ({
			scrollToIndex(index, options) {
				virtualizer.scrollToIndex(index, options);
			},
		}),
		[virtualizer],
	);
	return (
		<div
			data-virtual-rows
			style={{height: virtualizer.getTotalSize(), position: 'relative'}}
		>
			{active &&
				virtualizer.getVirtualItems().map((item) => (
					<div
						key={item.key}
						ref={virtualizer.measureElement}
						data-index={item.index}
						style={{
							position: 'absolute',
							top: 0,
							left: 0,
							width: '100%',
							transform: `translateY(${item.start}px)`,
						}}
						onFocus={
							keepFocused
								? () => {
										setFocusedRow(item.index);
									}
								: undefined
						}
					>
						{children(item.index)}
					</div>
				))}
		</div>
	);
}

export function WindowVirtualRows({
	count,
	estimate,
	gap,
	itemKey,
	handleRef,
	children,
}: {
	count: number;
	estimate: number;
	gap: number;
	itemKey: (index: number) => string;
	handleRef?: Ref<VirtualRowsHandle>;
	children: (index: number) => ReactNode;
}) {
	const listRef = useRef<HTMLDivElement>(null);
	const [scrollMargin, setScrollMargin] = useState(0);

	useLayoutEffect(() => {
		const updateMargin = () => {
			const element = listRef.current;
			if (!element) {
				return;
			}

			const next = Math.round(
				element.getBoundingClientRect().top + globalThis.scrollY,
			);
			setScrollMargin((current) => (current === next ? current : next));
		};

		updateMargin();
		globalThis.addEventListener('resize', updateMargin);
		const observer =
			typeof ResizeObserver === 'undefined'
				? null
				: new ResizeObserver(updateMargin);
		observer?.observe(document.documentElement);
		return () => {
			globalThis.removeEventListener('resize', updateMargin);
			observer?.disconnect();
		};
	}, []);

	const virtualizer = useWindowVirtualizer({
		count,
		estimateSize: () => estimate,
		overscan: VIRTUAL_OVERSCAN,
		gap,
		scrollMargin,
		getItemKey: itemKey,
		initialRect: {width: 0, height: 900},
	});

	useImperativeHandle(
		handleRef,
		() => ({
			scrollToIndex(index, options) {
				virtualizer.scrollToIndex(index, options);
			},
		}),
		[virtualizer],
	);

	return (
		<div
			ref={listRef}
			data-virtual-rows
			style={{height: virtualizer.getTotalSize(), position: 'relative'}}
		>
			{virtualizer.getVirtualItems().map((item) => (
				<div
					key={item.key}
					ref={virtualizer.measureElement}
					data-index={item.index}
					style={{
						position: 'absolute',
						top: 0,
						left: 0,
						width: '100%',
						transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
					}}
				>
					{children(item.index)}
				</div>
			))}
		</div>
	);
}
