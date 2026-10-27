import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import {buttonVariants} from './button';
import {
	DialogOpenContext,
	dialogOverlayClass,
	dialogPanelClass,
	initialFocusTarget,
	useRetainedValue,
	type DialogSize,
} from './dialog';
import {cn} from '@/lib/utils';

// Shadcn's AlertDialog on @radix-ui/react-alert-dialog, styled like Dialog. Alert dialogs have no close (X)
// button and ignore outside clicks: the user answers with Cancel or the action (Escape still cancels).

function AlertDialog({
	open,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
	return (
		<DialogOpenContext.Provider value={open}>
			<AlertDialogPrimitive.Root open={open} {...props} />
		</DialogOpenContext.Provider>
	);
}

const AlertDialogOverlay = React.forwardRef<
	React.ComponentRef<typeof AlertDialogPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({className, ...props}, ref) => (
	<AlertDialogPrimitive.Overlay
		ref={ref}
		className={cn(dialogOverlayClass, className)}
		{...props}
	/>
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

type AlertDialogContentProps = React.ComponentPropsWithoutRef<
	typeof AlertDialogPrimitive.Content
> & {
	/**
	Width preset; defaults to "sm".
	*/
	size?: DialogSize;
};

// Initial focus follows the same rules as DialogContent (a `data-autofocus` element first), so a
// destructive confirmation can open on Cancel and a harmless one on its action.
const AlertDialogContent = React.forwardRef<
	React.ComponentRef<typeof AlertDialogPrimitive.Content>,
	AlertDialogContentProps
>(({className, children, onOpenAutoFocus, size = 'sm', ...props}, ref) => {
	const open = React.useContext(DialogOpenContext);
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
		<AlertDialogPrimitive.Portal>
			<AlertDialogOverlay />
			<AlertDialogPrimitive.Content
				ref={setRefs}
				tabIndex={-1}
				className={cn(dialogPanelClass(size), className)}
				onOpenAutoFocus={(event) => {
					onOpenAutoFocus?.(event);
					if (event.defaultPrevented || !contentRef.current) {
						return;
					}

					event.preventDefault();
					initialFocusTarget(contentRef.current).focus();
				}}
				{...props}
			>
				{shownChildren}
			</AlertDialogPrimitive.Content>
		</AlertDialogPrimitive.Portal>
	);
});
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn('mb-5 flex min-w-0 flex-col gap-1.5 text-left', className)}
		{...props}
	/>
);
AlertDialogHeader.displayName = 'AlertDialogHeader';

const AlertDialogFooter = ({
	className,
	...props
}: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			'mt-6 flex flex-wrap items-center justify-end gap-2',
			className,
		)}
		{...props}
	/>
);
AlertDialogFooter.displayName = 'AlertDialogFooter';

const AlertDialogTitle = React.forwardRef<
	React.ComponentRef<typeof AlertDialogPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({className, ...props}, ref) => (
	<AlertDialogPrimitive.Title
		ref={ref}
		className={cn(
			'text-base font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]',
			className,
		)}
		{...props}
	/>
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
	React.ComponentRef<typeof AlertDialogPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({className, ...props}, ref) => (
	<AlertDialogPrimitive.Description
		ref={ref}
		className={cn(
			'text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]',
			className,
		)}
		{...props}
	/>
));
AlertDialogDescription.displayName =
	AlertDialogPrimitive.Description.displayName;

const AlertDialogCancel = React.forwardRef<
	React.ComponentRef<typeof AlertDialogPrimitive.Cancel>,
	React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({className, ...props}, ref) => (
	<AlertDialogPrimitive.Cancel
		ref={ref}
		className={cn(buttonVariants({variant: 'outline'}), className)}
		{...props}
	/>
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
	AlertDialog,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogFooter,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogCancel,
};
