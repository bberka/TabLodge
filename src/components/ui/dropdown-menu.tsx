import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import {Circle} from 'lucide-react';
import {ScrollArea} from './scroll-area';
import {cn} from '@/lib/utils';

// Menus size to their items but never past the space Radix reports as available; the
// ScrollArea flex-shrinks inside that limit (or a caller's own max-h) and scrolls the rest.
const menuScrollClass = 'flex min-h-0 flex-col';

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

// `container`/`portalContainer` choose the portal host (for example a ShadowRoot); defaults to document.body.
type PortalTarget = {
	container?: Element | DocumentFragment | null;
	portalContainer?: Element | DocumentFragment | null;
};

const DropdownMenuContent = React.forwardRef<
	React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> &
		PortalTarget
>(
	(
		{
			className,
			children,
			sideOffset = 6,
			collisionPadding = 8,
			container,
			portalContainer,
			...props
		},
		ref,
	) => (
		<DropdownMenuPrimitive.Portal container={portalContainer ?? container}>
			<DropdownMenuPrimitive.Content
				ref={ref}
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				className={cn(
					'tn-menu-content z-[100] flex max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[8rem] max-w-[var(--radix-dropdown-menu-content-available-width)] flex-col overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground',
					'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
					className,
				)}
				{...props}
			>
				<ScrollArea className={menuScrollClass} viewportClassName="min-h-0">
					{children}
				</ScrollArea>
			</DropdownMenuPrimitive.Content>
		</DropdownMenuPrimitive.Portal>
	),
);
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
	React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
		inset?: boolean;
	}
>(({className, inset, ...props}, ref) => (
	<DropdownMenuPrimitive.Item
		ref={ref}
		className={cn(
			'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
			inset && 'pl-8',
			className,
		)}
		{...props}
	/>
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuRadioItem = React.forwardRef<
	React.ComponentRef<typeof DropdownMenuPrimitive.RadioItem>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({className, children, ...props}, ref) => (
	<DropdownMenuPrimitive.RadioItem
		ref={ref}
		className={cn(
			'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
			className,
		)}
		{...props}
	>
		<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
			<DropdownMenuPrimitive.ItemIndicator>
				<Circle className="h-2 w-2 fill-current" />
			</DropdownMenuPrimitive.ItemIndicator>
		</span>
		{children}
	</DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
	React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
		inset?: boolean;
	}
>(({className, inset, ...props}, ref) => (
	<DropdownMenuPrimitive.Label
		ref={ref}
		className={cn(
			'px-2 py-1.5 text-sm font-semibold',
			inset && 'pl-8',
			className,
		)}
		{...props}
	/>
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
	React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({className, ...props}, ref) => (
	<DropdownMenuPrimitive.Separator
		ref={ref}
		className={cn('-mx-1 my-1 h-px bg-muted', className)}
		{...props}
	/>
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuRadioGroup,
};
