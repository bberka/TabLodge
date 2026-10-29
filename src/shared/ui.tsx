import * as React from 'react';
import {Search} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '../components/ui/alert-dialog';
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
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	useRetainedValue,
} from '../components/ui/dialog';
export {
	Popover,
	PopoverTrigger,
	PopoverContent,
} from '../components/ui/popover';
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

type IconTooltipProps = React.ComponentPropsWithoutRef<typeof Tooltip> & {
	label: React.ReactNode;
	side?: React.ComponentPropsWithoutRef<typeof TooltipContent>['side'];
};

export function IconTooltip({
	label,
	children,
	side = 'top',
	...props
}: IconTooltipProps) {
	return (
		<Tooltip {...props}>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side={side}>{label}</TooltipContent>
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

/**
A confirmation for destructive actions on the Settings page. Dashboard, new-tab and side-panel actions run at once with an Undo toast instead.
*/
export function ConfirmationDialog({
	open,
	onOpenChange,
	title,
	description,
	children,
	confirmLabel = 'Delete',
	confirmDisabled = false,
	busy = false,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: React.ReactNode;
	description?: React.ReactNode;
	/**
	Extra body content, such as choices.
	*/
	children?: React.ReactNode;
	confirmLabel?: React.ReactNode;
	confirmDisabled?: boolean;
	busy?: boolean;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent size="sm">
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					{Boolean(description) && (
						<AlertDialogDescription>{description}</AlertDialogDescription>
					)}
				</AlertDialogHeader>
				{children}
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<Button
						variant="destructive"
						disabled={busy || confirmDisabled}
						onClick={onConfirm}
					>
						{confirmLabel}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
