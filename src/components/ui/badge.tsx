import type * as React from 'react';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/utils';

const badgeVariants = cva(
	'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
	{
		variants: {
			variant: {
				default: 'border-border bg-muted text-muted-foreground',
				secondary: 'border-border bg-muted text-muted-foreground',
				accent: 'border-primary/20 bg-primary/10 text-primary',
				destructive: 'border-destructive/20 bg-destructive/10 text-destructive',
				outline: 'border-border text-foreground',
			},
		},
		defaultVariants: {
			variant: 'secondary',
		},
	},
);

type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
	VariantProps<typeof badgeVariants>;

function Badge({className, variant, ...props}: BadgeProps) {
	return (
		<span className={cn(badgeVariants({variant}), className)} {...props} />
	);
}

export {Badge};
