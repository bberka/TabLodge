import * as React from 'react';
import {Search} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from '../components/ui/tooltip';
import {cn} from '@/lib/utils';

export {Button} from '../components/ui/button';
export {Input} from '../components/ui/input';
export {Textarea} from '../components/ui/textarea';
export {Switch} from '../components/ui/switch';
export {Checkbox} from '../components/ui/checkbox';
export {
	Select,
	SelectValue,
	SelectTrigger,
	SelectContent,
	SelectItem,
} from '../components/ui/select';
export {
	Dialog,
	DialogBody,
	DialogCloseButton,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	useRetainedValue,
} from '../components/ui/dialog';
export {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '../components/ui/alert-dialog';
export {
	RadioCard,
	RadioCardGroup,
	SegmentedControl,
} from '../components/ui/radio-cards';
export {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuRadioGroup,
} from '../components/ui/dropdown-menu';
export {
	ContextMenu,
	ContextMenuTrigger,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
} from '../components/ui/context-menu';
export {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from '../components/ui/card';
export {
	ActionDropdownMenu,
	ActionContextMenu,
	type MenuAction,
} from '../components/ui/action-menu';
export {Badge} from '../components/ui/badge';
export {TooltipProvider} from '../components/ui/tooltip';
export {Label} from '../components/ui/label';
export {ScrollArea} from '../components/ui/scroll-area';

/**
Where Radix portals render (for example a shadow-root container); defaults to document.body.
*/
type PortalTargetProps = {
	container?: Element | DocumentFragment | null;
	portalContainer?: Element | DocumentFragment | null;
};

function portalTarget(
	container?: Element | DocumentFragment | null,
	portalContainer?: Element | DocumentFragment | null,
) {
	return portalContainer ?? container;
}

type IconTooltipProps = React.ComponentPropsWithoutRef<typeof Tooltip> &
	PortalTargetProps & {
		label: React.ReactNode;
		side?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side'];
	};

export function IconTooltip({
	label,
	children,
	side = 'top',
	container,
	portalContainer,
	...props
}: IconTooltipProps) {
	return (
		<Tooltip {...props}>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent
				side={side}
				container={portalTarget(container, portalContainer)}
			>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

// Search that stays a single icon until it is needed; it remains open while it holds a query.
type ExpandingSearchProps = {
	value: string;
	onChange: (value: string) => void;
	label: string;
	placeholder?: string;
	className?: string;
};

export function ExpandingSearch({
	value,
	onChange,
	label,
	placeholder = label,
	className,
}: ExpandingSearchProps) {
	const [open, setOpen] = React.useState(Boolean(value));
	const inputRef = React.useRef<HTMLInputElement>(null);
	React.useEffect(() => {
		if (open) {
			inputRef.current?.focus();
		}
	}, [open]);
	if (!open && !value) {
		return (
			<IconTooltip label={label}>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8"
					aria-label={label}
					onClick={() => setOpen(true)}
				>
					<Search />
				</Button>
			</IconTooltip>
		);
	}

	return (
		<label className={cn('relative block', className)}>
			<span className="sr-only">{label}</span>
			<Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				ref={inputRef}
				type="search"
				value={value}
				placeholder={placeholder}
				className="h-8 w-[min(60vw,240px)] pl-8 text-xs"
				onChange={(event) => onChange(event.target.value)}
				onBlur={() => {
					if (!value) {
						setOpen(false);
					}
				}}
				onKeyDown={(event) => {
					if (event.key !== 'Escape') {
						return;
					}

					onChange('');
					setOpen(false);
				}}
			/>
		</label>
	);
}
