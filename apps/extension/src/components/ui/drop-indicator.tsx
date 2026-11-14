import {cn} from '@/lib/utils';

/**
The one insertion marker for every drag and drop: a straight 2px primary line with square ends and a small
dot at its start. The caller positions it in the gap between two items (absolute, offset by half the gap and
the line width) inside a `relative` container; it never takes up space or catches the pointer.
*/
export function DropIndicator({
	orientation = 'horizontal',
	className,
}: {
	/**
	Horizontal lines sit between rows; vertical lines sit between columns or grid cards.
	*/
	orientation?: 'horizontal' | 'vertical';
	className?: string;
}) {
	const horizontal = orientation === 'horizontal';
	return (
		<span
			aria-hidden="true"
			data-drop-indicator={orientation}
			className={cn(
				'pointer-events-none absolute z-20 bg-primary',
				horizontal ? 'h-0.5' : 'w-0.5',
				className,
			)}
		>
			<span
				className={cn(
					'absolute size-1.5 rounded-full bg-primary',
					horizontal
						? 'left-0 top-1/2 -translate-y-1/2'
						: 'left-1/2 top-0 -translate-x-1/2',
				)}
			/>
		</span>
	);
}
