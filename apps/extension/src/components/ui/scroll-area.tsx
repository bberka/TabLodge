import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import {cn} from '@/lib/utils';

type ScrollAreaProps = React.ComponentPropsWithoutRef<
	typeof ScrollAreaPrimitive.Root
> & {
	viewportClassName?: string;
	viewportRef?: React.Ref<HTMLDivElement>;
	horizontal?: boolean;
};

const reserveScrollbar = '[&:has(~[data-orientation=vertical])]:pr-3';

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
					'h-full w-full rounded-[inherit] outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
					'scrollbar-none [&::-webkit-scrollbar]:hidden',
					!horizontal && '[&>div]:block!',
					type !== 'hover' && reserveScrollbar,
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
			'z-10 flex touch-none select-none p-0.5 transition-colors',
			orientation === 'vertical' && 'h-full w-2.5',
			orientation === 'horizontal' && 'h-2.5 flex-col',
			className,
		)}
		{...props}
	>
		<ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-muted-foreground/35 transition-colors hover:bg-muted-foreground/60" />
	</ScrollAreaPrimitive.ScrollAreaScrollbar>
));
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export {ScrollArea, ScrollBar, reserveScrollbar};
