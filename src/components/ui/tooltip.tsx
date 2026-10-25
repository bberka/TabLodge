import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import {cn} from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

// `container`/`portalContainer` choose the portal host (for example a ShadowRoot); defaults to document.body.
type TooltipContentProps = React.ComponentPropsWithoutRef<
	typeof TooltipPrimitive.Content
> & {
	container?: Element | DocumentFragment | null;
	portalContainer?: Element | DocumentFragment | null;
};

const TooltipContent = React.forwardRef<
	React.ComponentRef<typeof TooltipPrimitive.Content>,
	TooltipContentProps
>(({className, sideOffset = 5, container, portalContainer, ...props}, ref) => (
	<TooltipPrimitive.Portal container={portalContainer ?? container}>
		<TooltipPrimitive.Content
			ref={ref}
			sideOffset={sideOffset}
			className={cn(
				'z-[120] overflow-hidden rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background',
				className,
			)}
			{...props}
		/>
	</TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export {Tooltip, TooltipTrigger, TooltipContent, TooltipProvider};
