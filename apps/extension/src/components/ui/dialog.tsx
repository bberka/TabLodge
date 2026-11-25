import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {X} from 'lucide-react';
import {Button, type ButtonProps} from './button';
import {Tooltip, TooltipContent, TooltipTrigger} from './tooltip';
import {focusReturnTarget} from '@/shared/focus-rescue';
import {cn} from '@/lib/utils';

function useRetainedValue<T>(value: T, active = value != null): T {
	const retained = React.useRef(value);
	React.useLayoutEffect(() => {
		if (active) {
			retained.current = value;
		}
	});
	return active ? value : retained.current;
}

const DialogOpenContext = React.createContext<boolean | undefined>(undefined);

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

type Opener = {element: Element | null; dialog: HTMLElement | null};

function captureOpener(): Opener {
	const element = document.activeElement;
	return {element, dialog: element?.closest<HTMLElement>(OPEN_DIALOG) ?? null};
}

function returnFocus(
	event: Event,
	onCloseAutoFocus: ((event: Event) => void) | undefined,
	opener: Opener,
) {
	onCloseAutoFocus?.(event);
	if (event.defaultPrevented) {
		return;
	}

	const {element, dialog} = opener;
	const below =
		dialog?.isConnected && dialog.matches(OPEN_DIALOG) ? dialog : null;
	const target = below
		? element instanceof HTMLElement &&
			below.contains(element) &&
			!element.matches(':disabled')
			? element
			: initialFocusTarget(below)
		: focusReturnTarget();
	if (!target) {
		return;
	}

	event.preventDefault();
	target.focus();
}

const OPEN_DIALOG =
	'[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

const DIALOG_SIZES = {
	sm: 'w-[min(94vw,28rem)]',
	md: 'w-[min(94vw,32rem)]',
	lg: 'w-[min(94vw,42rem)]',
} as const;
type DialogSize = keyof typeof DIALOG_SIZES;

const dialogOverlayClass = 'tn-dialog-overlay fixed inset-0 z-90 bg-black/40';
const dialogPanelClass = (size: DialogSize) =>
	cn(
		'tn-dialog-content fixed left-1/2 top-1/2 z-91 flex max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg outline-hidden',
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
	size?: DialogSize;
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
			onCloseAutoFocus,
			size = 'md',
			hideClose = false,
			...props
		},
		ref,
	) => {
		const open = React.useContext(DialogOpenContext);
		const shownChildren = useRetainedValue(children, open !== false);
		const contentRef = React.useRef<HTMLDivElement | null>(null);
		const openerRef = React.useRef<Opener>({element: null, dialog: null});
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
					onOpenAutoFocus={(event) => {
						openerRef.current = captureOpener();
						onOpenAutoFocus?.(event);
						if (event.defaultPrevented || !contentRef.current) {
							return;
						}

						event.preventDefault();
						initialFocusTarget(contentRef.current).focus();
					}}
					onCloseAutoFocus={(event) => {
						returnFocus(event, onCloseAutoFocus, openerRef.current);
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

const DialogBody = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			'grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 text-sm wrap-anywhere',
			className,
		)}
		{...props}
	/>
);
DialogBody.displayName = 'DialogBody';

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
			'text-base font-semibold leading-snug tracking-tight wrap-anywhere',
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
			'text-sm leading-relaxed text-muted-foreground wrap-anywhere',
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
	captureOpener,
	type Opener,
	returnFocus,
	useRetainedValue,
	type DialogSize,
};
