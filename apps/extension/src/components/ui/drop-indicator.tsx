import {cn} from '@/lib/utils';

export function DropIndicator({
	orientation = 'horizontal',
	className,
}: {
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
