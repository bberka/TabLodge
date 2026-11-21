import {useVirtualizer} from '@tanstack/react-virtual';
import {type ReactNode, useEffect, useRef, useState} from 'react';

export const VIRTUAL_OVERSCAN = 6;

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
	children,
}: {
	count: number;
	scrollElement: HTMLElement | null;
	estimate: number;
	gap: number;
	active?: boolean;
	itemKey: (index: number) => string;
	children: (index: number) => ReactNode;
}) {
	const virtualizer = useVirtualizer({
		count,
		getScrollElement: () => scrollElement,
		estimateSize: () => estimate,
		overscan: VIRTUAL_OVERSCAN,
		gap,
		getItemKey: itemKey,
		initialRect: {width: 0, height: 800},
	});
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
					>
						{children(item.index)}
					</div>
				))}
		</div>
	);
}
