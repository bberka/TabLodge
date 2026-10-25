import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import {cn} from '@/lib/utils';

// Radix wraps viewport children in a `display: table` div, which lets long text push the
// content wider than the viewport and breaks `truncate`. Vertical-only areas keep it a block.
type ScrollAreaProps = React.ComponentPropsWithoutRef<
	typeof ScrollAreaPrimitive.Root
> & {
	viewportClassName?: string;
	viewportRef?: React.Ref<HTMLDivElement>;
	/**
	Adds a horizontal scrollbar and lets content extend wider than the viewport.
	*/
	horizontal?: boolean;
};

const ScrollArea = React.forwardRef<
	React.ComponentRef<typeof ScrollAreaPrimitive.Root>,
	ScrollAreaProps
>(
	(
		{
			className,
			viewportClassName,
			viewportRef,
			children,
			type = 'hover',
			horizontal = false,
			...props
		},
		ref,
	) => (
		<ScrollAreaPrimitive.Root
			ref={ref}
			type={type}
			className={cn('relative overflow-hidden', className)}
			{...props}
		>
			<ScrollAreaPrimitive.Viewport
				ref={viewportRef}
				className={cn(
					'h-full w-full rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
					!horizontal && '[&>div]:!block',
					viewportClassName,
				)}
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			<ScrollBar />
			{horizontal && <ScrollBar orientation="horizontal" />}
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	),
);
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
	React.ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
	React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({className, orientation = 'vertical', ...props}, ref) => (
	<ScrollAreaPrimitive.ScrollAreaScrollbar
		ref={ref}
		orientation={orientation}
		className={cn(
			'z-10 flex touch-none select-none p-px transition-colors',
			orientation === 'vertical' && 'h-full w-2 border-l border-l-transparent',
			orientation === 'horizontal' &&
				'h-2 flex-col border-t border-t-transparent',
			className,
		)}
		{...props}
	>
		<ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-muted-foreground/35 transition-colors hover:bg-muted-foreground/60" />
	</ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export {ScrollArea, ScrollBar};
