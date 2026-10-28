import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import {Button, type ButtonProps} from './button';
import {Tooltip, TooltipContent, TooltipTrigger} from './tooltip';
import {cn} from '@/lib/utils';

// Returns `value` while `active`, and the last active value otherwise. Dialogs use it so their
// content stays populated during the close animation even after the caller clears its data.
function useRetainedValue<T>(value: T, active = value != null): T {
	const retained = React.useRef(value);
	React.useLayoutEffect(() => {
		if (active) {
			retained.current = value;
		}
	});
	return active ? value : retained.current;
}

/**
Shared by Dialog and AlertDialog: the controlled `open` state, read by the content to freeze its children while closing.
*/
const DialogOpenContext = React.createContext<boolean | undefined>(undefined);

// Shares the controlled `open` state with DialogContent, which freezes its children while closing.
function Dialog({
	open,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
	return (
		<DialogOpenContext.Provider value={open}>
			<DialogPrimitive.Root open={open} {...props} />
		</DialogOpenContext.Provider>
	);
}

const DialogClose = DialogPrimitive.Close;

/**
Width presets shared by every dialog and alert dialog: confirmations (sm), forms (md), and richer flows (lg).
*/
const DIALOG_SIZES = {
	sm: 'w-[min(94vw,28rem)]',
	md: 'w-[min(94vw,32rem)]',
	lg: 'w-[min(94vw,42rem)]',
} as const;
type DialogSize = keyof typeof DIALOG_SIZES;

/**
Overlay and panel styles, shared with alert-dialog.tsx. Long content scrolls inside the panel.
*/
const dialogOverlayClass = 'tn-dialog-overlay fixed inset-0 z-[90] bg-black/40';
const dialogPanelClass = (size: DialogSize) =>
	cn(
		'tn-dialog-content fixed left-1/2 top-1/2 z-[91] flex max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg outline-none',
		DIALOG_SIZES[size],
	);

const DialogOverlay = React.forwardRef<
	React.ComponentRef<typeof DialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({className, ...props}, ref) => (
	<DialogPrimitive.Overlay
		ref={ref}
		className={cn(dialogOverlayClass, className)}
		{...props}
	/>
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const FORM_FIELDS =
	'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role="combobox"]:not([disabled])';
const ACTIONS = 'button:not([disabled]):not([data-dialog-close])';

// Where focus lands when any dialog opens. The close (X) button never takes initial focus:
// focused, it shows its ring and tooltip, and Escape would close only the tooltip.
// Order: an element marked `data-autofocus` (or `autofocus`), the first form field, the primary action
// (a submit button, else the last footer action), else the dialog container itself.
function initialFocusTarget(content: HTMLElement): HTMLElement {
	const actions = [...content.querySelectorAll<HTMLElement>(ACTIONS)];
	return (
		content.querySelector<HTMLElement>(
			'[data-autofocus]:not([disabled]), [autofocus]:not([disabled])',
		) ??
		content.querySelector<HTMLElement>(FORM_FIELDS) ??
		content.querySelector<HTMLElement>(
			'button[type="submit"]:not([disabled])',
		) ??
		actions.at(-1) ??
		content
	);
}

// Time of the last Tab key press per document. Keyboard navigation inside a dialog's focus trap moves
// focus with Tab, so a focus right after one is keyboard focus; anything else (initial auto-focus,
// focus restored by script, a pointer press) is not.
const lastTabPress = new WeakMap<Document, number>();
function trackTabKey(doc: Document) {
	if (lastTabPress.has(doc)) {
		return;
	}

	lastTabPress.set(doc, -Infinity);
	doc.addEventListener(
		'keydown',
		(event) => {
			if (event.key === 'Tab') {
				lastTabPress.set(doc, event.timeStamp);
			}
		},
		{capture: true},
	);
}

const KEYBOARD_FOCUS_WINDOW_MS = 500;

// The close (X) button's tooltip opens on hover and on Tab focus only. Other focus is default-prevented,
// which makes Radix's trigger skip opening the tooltip. Escape while the tooltip is showing closes the
// dialog too, so one Escape is always enough. Dialogs never focus this button initially (see DialogContent).
const DialogCloseButton = React.forwardRef<
	HTMLButtonElement,
	Omit<ButtonProps, 'children'>
>(({className, onFocus, ...props}, ref) => {
	const buttonRef = React.useRef<HTMLButtonElement | null>(null);
	const setRefs = React.useCallback(
		(node: HTMLButtonElement | null) => {
			buttonRef.current = node;
			if (node) {
				trackTabKey(node.ownerDocument);
			}

			if (typeof ref === 'function') {
				ref(node);
			} else if (ref) {
				ref.current = node;
			}
		},
		[ref],
	);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<DialogClose asChild>
					<Button
						ref={setRefs}
						type="button"
						aria-label="Close dialog"
						variant="ghost"
						size="icon"
						data-dialog-close=""
						className={cn(
							'h-8 w-8 min-h-8 shrink-0 text-muted-foreground hover:text-foreground',
							className,
						)}
						onFocus={(event) => {
							onFocus?.(event);
							const doc = event.currentTarget.ownerDocument;
							const fromTab =
								event.timeStamp - (lastTabPress.get(doc) ?? -Infinity) <
								KEYBOARD_FOCUS_WINDOW_MS;
							if (!fromTab || !event.currentTarget.matches(':focus-visible')) {
								event.preventDefault();
							}
						}}
						{...props}
					>
						<X className="h-4 w-4" />
					</Button>
				</DialogClose>
			</TooltipTrigger>
			<TooltipContent
				side="top"
				onEscapeKeyDown={() => buttonRef.current?.click()}
			>
				Close dialog
			</TooltipContent>
		</Tooltip>
	);
});

type DialogContentProps = React.ComponentPropsWithoutRef<
	typeof DialogPrimitive.Content
> & {
	/**
	Width preset; defaults to "md".
	*/
	size?: DialogSize;
	/**
	Hides the close (X) button in the top-right corner.
	*/
	hideClose?: boolean;
};

const DialogContent = React.forwardRef<
	React.ComponentRef<typeof DialogPrimitive.Content>,
	DialogContentProps
>(
	(
		{
			className,
			children,
			onOpenAutoFocus,
			size = 'md',
			hideClose = false,
			...props
		},
		ref,
	) => {
		const open = React.useContext(DialogOpenContext);
		// Uncontrolled dialogs (open === undefined) never freeze.
		const shownChildren = useRetainedValue(children, open !== false);
		const contentRef = React.useRef<HTMLDivElement | null>(null);
		const setRefs = React.useCallback(
			(node: HTMLDivElement | null) => {
				contentRef.current = node;
				if (typeof ref === 'function') {
					ref(node);
				} else if (ref) {
					ref.current = node;
				}
			},
			[ref],
		);
		return (
			<DialogPrimitive.Portal>
				<DialogOverlay />
				<DialogPrimitive.Content
					ref={setRefs}
					tabIndex={-1}
					className={cn(dialogPanelClass(size), className)}
					// A caller's own onOpenAutoFocus that calls preventDefault keeps full control.
					onOpenAutoFocus={(event) => {
						onOpenAutoFocus?.(event);
						if (event.defaultPrevented || !contentRef.current) {
							return;
						}

						event.preventDefault();
						// The container is focusable (tabIndex -1) and has no visible focus ring.
						initialFocusTarget(contentRef.current).focus();
					}}
					{...props}
				>
					{shownChildren}
					{!hideClose && (
						<DialogCloseButton className="absolute right-3 top-3" />
					)}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		);
	},
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

// Title and description stack on the left; the right padding keeps long titles clear of the close button.
const DialogHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			'tn-dialog-header mb-5 flex min-w-0 flex-col gap-1.5 pr-8 text-left',
			className,
		)}
		{...props}
	/>
);
DialogHeader.displayName = 'DialogHeader';

/**
The dialog's main content between header and footer: stacked fields with even spacing.
*/
const DialogBody = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			'grid min-w-0 gap-4 text-sm [overflow-wrap:anywhere]',
			className,
		)}
		{...props}
	/>
);
DialogBody.displayName = 'DialogBody';

// Actions sit on the right: Cancel (outline or ghost) first, the primary action last. `start` content
// (for example a Back button) is pushed to the left edge.
const DialogFooter = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			'tn-dialog-footer mt-6 flex flex-wrap items-center justify-end gap-2',
			className,
		)}
		{...props}
	/>
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
	React.ComponentRef<typeof DialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({className, ...props}, ref) => (
	<DialogPrimitive.Title
		ref={ref}
		className={cn(
			'text-base font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]',
			className,
		)}
		{...props}
	/>
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
	React.ComponentRef<typeof DialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({className, ...props}, ref) => (
	<DialogPrimitive.Description
		ref={ref}
		className={cn(
			'text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]',
			className,
		)}
		{...props}
	/>
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogOpenContext,
	dialogOverlayClass,
	dialogPanelClass,
	initialFocusTarget,
	useRetainedValue,
	type DialogSize,
};
