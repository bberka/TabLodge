'use client';

import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import {cn} from '@/lib/utils';

// `readOnly` keeps the switch focusable and announced (aria-readonly) but blocks toggling;
// it shares the faded look of `disabled`.
const Switch = React.forwardRef<
	React.ComponentRef<typeof SwitchPrimitives.Root>,
	React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & {
		readOnly?: boolean;
	}
>(({className, readOnly = false, onClick, onCheckedChange, ...props}, ref) => (
	<SwitchPrimitives.Root
		className={cn(
			'tn-switch peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-[background-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-[readonly=true]:cursor-not-allowed aria-[readonly=true]:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
			className,
		)}
		{...props}
		ref={ref}
		aria-readonly={readOnly || undefined}
		onClick={(event) => {
			onClick?.(event);
			if (readOnly) {
				event.preventDefault();
			}
		}}
		onCheckedChange={readOnly ? undefined : onCheckedChange}
	>
		<SwitchPrimitives.Thumb
			className={cn(
				'pointer-events-none block h-4 w-4 rounded-full border border-border bg-background ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
			)}
		/>
	</SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export {Switch};
