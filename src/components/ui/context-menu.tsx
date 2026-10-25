'use client';

import * as React from 'react';
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu';
import {ScrollArea} from './scroll-area';
import {cn} from '@/lib/utils';

const menuScrollClass = 'flex min-h-0 flex-col';

const ContextMenu = ContextMenuPrimitive.Root;

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

// `container`/`portalContainer` choose the portal host (for example a ShadowRoot); defaults to document.body.
type PortalTarget = {
	container?: Element | DocumentFragment | null;
	portalContainer?: Element | DocumentFragment | null;
};

const ContextMenuContent = React.forwardRef<
	React.ComponentRef<typeof ContextMenuPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content> &
		PortalTarget
>(
	(
		{
			className,
			children,
			collisionPadding = 8,
			container,
			portalContainer,
			...props
		},
		ref,
	) => (
		<ContextMenuPrimitive.Portal container={portalContainer ?? container}>
			<ContextMenuPrimitive.Content
				ref={ref}
				collisionPadding={collisionPadding}
				className={cn(
					'tn-menu-content z-[100] flex max-h-[var(--radix-context-menu-content-available-height)] min-w-[8rem] max-w-[var(--radix-context-menu-content-available-width)] flex-col overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
					className,
				)}
				{...props}
			>
				<ScrollArea className={menuScrollClass} viewportClassName="min-h-0">
					{children}
				</ScrollArea>
			</ContextMenuPrimitive.Content>
		</ContextMenuPrimitive.Portal>
	),
);
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;

const ContextMenuItem = React.forwardRef<
	React.ComponentRef<typeof ContextMenuPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
		inset?: boolean;
	}
>(({className, inset, ...props}, ref) => (
	<ContextMenuPrimitive.Item
		ref={ref}
		className={cn(
			'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
			inset && 'pl-8',
			className,
		)}
		{...props}
	/>
));
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;

const ContextMenuSeparator = React.forwardRef<
	React.ComponentRef<typeof ContextMenuPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({className, ...props}, ref) => (
	<ContextMenuPrimitive.Separator
		ref={ref}
		className={cn('-mx-1 my-1 h-px bg-border', className)}
		{...props}
	/>
));
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

export {
	ContextMenu,
	ContextMenuTrigger,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
};
