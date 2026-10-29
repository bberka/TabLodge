import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import {cn} from '@/lib/utils';

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverContent = React.forwardRef<
	React.ComponentRef<typeof PopoverPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(
	(
		{
			className,
			align = 'start',
			sideOffset = 6,
			collisionPadding = 8,
			...props
		},
		ref,
	) => (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				ref={ref}
				align={align}
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				className={cn(
					'tn-menu-content z-[100] w-72 max-w-[var(--radix-popover-content-available-width)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground outline-none',
					className,
				)}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	),
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export {Popover, PopoverTrigger, PopoverContent};
