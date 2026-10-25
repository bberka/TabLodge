import * as React from 'react';
import {cn} from '@/lib/utils';

// Radio choices built on native radio inputs, so arrow keys, form semantics, and screen readers
// work without extra code. RadioCard is a selectable card (icon, name, one-line explanation);
// SegmentedControl is a compact row of mutually exclusive options.

type RadioGroupContextValue = {
	name: string;
	value: string;
	onValueChange: (value: string) => void;
	disabled?: boolean;
};
const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(
	null,
);

type RadioCardGroupProps = {
	value: string;
	onValueChange: (value: string) => void;
	/**
	Accessible name of the group (or pass aria-labelledby).
	*/
	label?: string;
	name?: string;
	disabled?: boolean;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'>;

function RadioCardGroup({
	value,
	onValueChange,
	label,
	name,
	disabled,
	className,
	children,
	...props
}: RadioCardGroupProps) {
	const generated = React.useId();
	const context = React.useMemo(
		() => ({name: name ?? generated, value, onValueChange, disabled}),
		[name, generated, value, onValueChange, disabled],
	);
	return (
		<RadioGroupContext.Provider value={context}>
			<div
				role="radiogroup"
				aria-label={label}
				className={cn('grid gap-2', className)}
				{...props}
			>
				{children}
			</div>
		</RadioGroupContext.Provider>
	);
}

type RadioCardProps = {
	value: string;
	title: React.ReactNode;
	description?: React.ReactNode;
	icon?: React.ComponentType<{
		className?: string;
		'aria-hidden'?: boolean | 'true' | 'false';
	}>;
	/**
	Shown after the title, for example a "Recommended" badge.
	*/
	badge?: React.ReactNode;
	disabled?: boolean;
	className?: string;
};

function RadioCard({
	value,
	title,
	description,
	icon: Icon,
	badge,
	disabled,
	className,
}: RadioCardProps) {
	const group = React.useContext(RadioGroupContext);
	if (!group) {
		throw new Error('RadioCard must be used inside RadioCardGroup');
	}

	const checked = group.value === value;
	const isDisabled = disabled || group.disabled;
	return (
		<label
			className={cn(
				'group/radio relative flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border bg-card px-3.5 py-3 text-left transition-colors',
				'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
				checked
					? 'border-primary bg-primary/[.06]'
					: 'border-border hover:border-primary/40 hover:bg-muted/50',
				isDisabled && 'cursor-not-allowed opacity-50',
				className,
			)}
		>
			<input
				type="radio"
				className="peer sr-only"
				name={group.name}
				value={value}
				checked={checked}
				disabled={isDisabled}
				onChange={() => group.onValueChange(value)}
			/>
			{Icon && (
				<span
					className={cn(
						'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border',
						checked
							? 'border-primary/30 bg-primary/10 text-primary'
							: 'border-border bg-muted/60 text-muted-foreground',
					)}
				>
					<Icon className="h-4 w-4" aria-hidden="true" />
				</span>
			)}
			<span className="min-w-0 flex-1">
				<span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium leading-5">
					{title}
					{badge}
				</span>
				{Boolean(description) && (
					<span className="mt-0.5 block text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
						{description}
					</span>
				)}
			</span>
			<span
				aria-hidden="true"
				className={cn(
					'mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
					checked ? 'border-primary' : 'border-input',
				)}
			>
				{checked && <span className="h-2 w-2 rounded-full bg-primary" />}
			</span>
		</label>
	);
}

type SegmentedControlProps<T extends string> = {
	value: T;
	onValueChange: (value: T) => void;
	options: ReadonlyArray<{
		value: T;
		label: React.ReactNode;
		disabled?: boolean;
	}>;
	label?: string;
	'aria-labelledby'?: string;
	name?: string;
	className?: string;
	/**
	Stretch to the container width with equal-width segments.
	*/
	fullWidth?: boolean;
};

function SegmentedControl<T extends string>({
	value,
	onValueChange,
	options,
	label,
	name,
	className,
	fullWidth,
	...props
}: SegmentedControlProps<T>) {
	const generated = React.useId();
	return (
		<div
			role="radiogroup"
			aria-label={label}
			aria-labelledby={props['aria-labelledby']}
			className={cn(
				fullWidth ? 'flex w-full' : 'inline-flex max-w-full flex-wrap',
				'min-h-9 items-stretch rounded-md border border-border bg-muted/60 p-0.5',
				className,
			)}
		>
			{options.map((option) => {
				const checked = option.value === value;
				return (
					<label
						key={option.value}
						className={cn(
							fullWidth && 'flex-1',
							'relative flex cursor-pointer items-center justify-center rounded-[5px] px-3 text-center text-xs font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
							checked
								? 'bg-card text-foreground shadow-sm'
								: 'text-muted-foreground hover:text-foreground',
							option.disabled && 'cursor-not-allowed opacity-50',
						)}
					>
						<input
							type="radio"
							className="sr-only"
							name={name ?? generated}
							value={option.value}
							checked={checked}
							disabled={option.disabled}
							onChange={() => onValueChange(option.value)}
						/>
						{option.label}
					</label>
				);
			})}
		</div>
	);
}

export {RadioCard, RadioCardGroup, SegmentedControl};
