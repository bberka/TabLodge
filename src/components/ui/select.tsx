import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import {Check, ChevronDown} from 'lucide-react';
import {ScrollBar} from './scroll-area';
import {cn} from '@/lib/utils';

const Select = SelectPrimitive.Root;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
	React.ComponentRef<typeof SelectPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({className, children, ...props}, ref) => (
	<SelectPrimitive.Trigger
		ref={ref}
		className={cn(
			'tn-select-trigger flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background data-[placeholder]:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
			className,
		)}
		{...props}
	>
		{children}
		<SelectPrimitive.Icon asChild>
			<ChevronDown className="h-4 w-4 opacity-50" />
		</SelectPrimitive.Icon>
	</SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

// The Select viewport doubles as the ScrollArea viewport (the composition Radix documents), so
// long lists get the thin themed scrollbar and stay within the space left in the window.
// `container`/`portalContainer` choose the portal host (for example a ShadowRoot); defaults to document.body.
type SelectContentProps = React.ComponentPropsWithoutRef<
	typeof SelectPrimitive.Content
> & {
	container?: Element | DocumentFragment | null;
	portalContainer?: Element | DocumentFragment | null;
};

const SelectContent = React.forwardRef<
	React.ComponentRef<typeof SelectPrimitive.Content>,
	SelectContentProps
>(
	(
		{
			className,
			children,
			position = 'popper',
			collisionPadding = 8,
			container,
			portalContainer,
			...props
		},
		ref,
	) => (
		<SelectPrimitive.Portal container={portalContainer ?? container}>
			<SelectPrimitive.Content
				ref={ref}
				className={cn(
					'tn-select-content relative z-[100] max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground',
					className,
				)}
				position={position}
				collisionPadding={collisionPadding}
				{...props}
			>
				<ScrollAreaPrimitive.Root
					type="auto"
					className="relative flex min-h-0 flex-col overflow-hidden"
				>
					<SelectPrimitive.Viewport asChild>
						<ScrollAreaPrimitive.Viewport
							className={cn(
								'min-h-0 w-full p-1 [&>div]:!block',
								position === 'popper' &&
									'min-w-[var(--radix-select-trigger-width)]',
							)}
						>
							{children}
						</ScrollAreaPrimitive.Viewport>
					</SelectPrimitive.Viewport>
					<ScrollBar />
				</ScrollAreaPrimitive.Root>
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	),
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = React.forwardRef<
	React.ComponentRef<typeof SelectPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({className, children, ...props}, ref) => (
	<SelectPrimitive.Item
		ref={ref}
		className={cn(
			'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
			className,
		)}
		{...props}
	>
		<span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
			<SelectPrimitive.ItemIndicator>
				<Check className="h-4 w-4" />
			</SelectPrimitive.ItemIndicator>
		</span>
		<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
	</SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export {Select, SelectValue, SelectTrigger, SelectContent, SelectItem};
