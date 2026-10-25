import * as React from 'react';
import {Search} from 'lucide-react';
import {Button, type ButtonProps} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {Label} from '../components/ui/label';
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '../components/ui/alert-dialog';
import type {DialogSize} from '../components/ui/dialog';
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

// An AlertDialog for every confirmation. Content stays populated while closing because the content
// retains its last open children, so callers may clear their data as soon as it closes.
type ConfirmationDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: React.ReactNode;
	description: React.ReactNode;
	/**
	Extra body content between the description and the buttons (choices, a list, a note).
	*/
	children?: React.ReactNode;
	confirmLabel?: React.ReactNode;
	cancelLabel?: React.ReactNode;
	confirmVariant?: ButtonProps['variant'];
	/**
	Disables the confirm button, for example until a body choice is valid.
	*/
	confirmDisabled?: boolean;
	/**
	The confirm button enables only after this exact text (such as "ERASE") is typed.
	*/
	requireText?: string;
	onConfirm: () => void;
	/**
	Element to focus after the dialog closes; falls back to `[data-focus-fallback]`.
	*/
	restoreFocusTo?: HTMLElement | null;
	busy?: boolean;
	size?: DialogSize;
} & PortalTargetProps;

export function ConfirmationDialog({
	open,
	onOpenChange,
	title,
	description,
	children,
	confirmLabel = 'Delete',
	cancelLabel = 'Cancel',
	confirmVariant = 'destructive',
	confirmDisabled = false,
	requireText,
	onConfirm,
	restoreFocusTo,
	busy = false,
	size = 'sm',
	container,
	portalContainer,
}: ConfirmationDialogProps) {
	const wasOpenRef = React.useRef(false);
	const [typed, setTyped] = React.useState('');
	const inputId = React.useId();
	// Destructive confirmations open on the safe choice (Cancel); others on the confirm action.
	// A typed confirmation opens on its text field, and a body element marked data-autofocus wins over both.
	const destructive = confirmVariant === 'destructive';
	React.useEffect(() => {
		if (open) {
			wasOpenRef.current = true;
			setTyped('');
		} else if (wasOpenRef.current) {
			wasOpenRef.current = false;
			requestAnimationFrame(() => {
				const target = restoreFocusTo?.isConnected
					? restoreFocusTo
					: document.querySelector<HTMLElement>('[data-focus-fallback]');
				target?.focus?.({preventScroll: true});
			});
		}
	}, [open, restoreFocusTo]);
	const textMatches = !requireText || typed.trim() === requireText;
	const blocked = busy || confirmDisabled || !textMatches;
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!busy || next) {
					onOpenChange(next);
				}
			}}
		>
			<AlertDialogContent
				size={size}
				container={container}
				portalContainer={portalContainer}
			>
				<form
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						if (!blocked) {
							onConfirm();
						}
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>{title}</AlertDialogTitle>
						<AlertDialogDescription>{description}</AlertDialogDescription>
					</AlertDialogHeader>
					{Boolean(children || requireText) && (
						<div className="grid min-w-0 gap-4 text-sm [overflow-wrap:anywhere]">
							{children}
							{requireText && (
								<div className="space-y-1.5">
									<Label htmlFor={inputId}>
										Type{' '}
										<strong className="font-mono font-semibold">
											{requireText}
										</strong>{' '}
										to confirm
									</Label>
									<Input
										id={inputId}
										data-autofocus=""
										value={typed}
										autoComplete="off"
										autoCapitalize="characters"
										spellCheck={false}
										disabled={busy}
										className="font-mono"
										onChange={(event) => setTyped(event.target.value)}
									/>
								</div>
							)}
						</div>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel
							type="button"
							disabled={busy}
							data-autofocus={(destructive && !requireText) || undefined}
						>
							{cancelLabel}
						</AlertDialogCancel>
						<Button
							type="submit"
							variant={confirmVariant}
							disabled={blocked}
							data-autofocus={(!destructive && !requireText) || undefined}
						>
							{busy ? 'Working' : confirmLabel}
						</Button>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}

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
