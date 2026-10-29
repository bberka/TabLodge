import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {
	Check,
	ChevronDown,
	Monitor,
	Pipette,
	RotateCcw,
	Search,
} from 'lucide-react';
import {
	ACCENTS,
	SYSTEM_ACCENT,
	DEFAULT_ACCENT,
	DEFAULT_ACCENT_HEX,
	accentColor,
	foregroundOn,
	isCustomAccent,
	rgbToHex,
	type Rgb,
} from '../shared/accents';
import {Button, Popover, PopoverContent, PopoverTrigger} from '../shared/ui';
import {cn} from '@/lib/utils';

const css = ([r, g, b]: Rgb) => `rgb(${r} ${g} ${b})`;
const RAINBOW =
	'conic-gradient(#ef4444, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)';
const TYPED_HEX = /^#?([\da-f]{6})$/i;
const COLUMNS = 7;
// The native picker fires on every drag step; the page follows once the drag pauses this long.
const PICKER_DEBOUNCE_MS = 300;
const CUSTOM = 'custom';
const ARROW_STEPS = new Map([
	['ArrowRight', 1],
	['ArrowLeft', -1],
	['ArrowDown', COLUMNS],
	['ArrowUp', -COLUMNS],
]);

type Choice = {
	id: string;
	label: string;
	detail: string;
	background: string;
	icon?: 'monitor' | 'pipette';
	// What gets stored when it differs from the id (a typed hex color).
	value?: string;
};

const DEFAULT_CHOICE: Choice = {
	id: DEFAULT_ACCENT,
	label: 'TabLodge default',
	detail: 'The default theme color',
	background: DEFAULT_ACCENT_HEX,
};
// The system accent is only a real choice where the platform has one; elsewhere it uses the default.
const systemChoice = (color: Rgb | undefined): Choice => ({
	id: SYSTEM_ACCENT,
	label: 'System',
	detail: color
		? 'Follows your system’s accent color'
		: 'Not available here, uses the default',
	background: color ? css(color) : 'rgb(var(--muted-foreground) / 0.35)',
	icon: 'monitor',
});
const CUSTOM_CHOICE: Choice = {
	id: CUSTOM,
	label: 'Custom color…',
	detail: 'Pick any color, or type #rrggbb',
	background: RAINBOW,
	icon: 'pipette',
};
const buildChoices = (systemColor: Rgb | undefined): Choice[] => [
	DEFAULT_CHOICE,
	systemChoice(systemColor),
	...ACCENTS.map(({id, label, hex}) => ({
		id,
		label,
		detail: hex,
		background: hex,
	})),
	CUSTOM_CHOICE,
];

function Circle({
	choice,
	selected,
	color,
	small,
}: {
	choice: Pick<Choice, 'background' | 'icon'>;
	selected?: boolean;
	color?: Rgb;
	small?: boolean;
}) {
	const Icon = selected
		? Check
		: {monitor: Monitor, pipette: Pipette}[choice.icon ?? 'monitor'];
	return (
		<span
			aria-hidden="true"
			className={cn(
				'grid shrink-0 place-items-center rounded-full border border-border',
				small ? 'h-5 w-5' : 'h-8 w-8',
			)}
			style={{
				background: choice.background,
				color: color ? css(foregroundOn(color)) : '#fff',
			}}
		>
			{(selected || choice.icon) && (
				<Icon className={small ? 'h-3 w-3' : 'h-4 w-4'} />
			)}
		</span>
	);
}

// The accent picker: a popup like the command palette, with a search box over a grid of colored
// circles. The default and the system accent come first, then the presets and a custom color.
export function AccentPalette({
	accent,
	systemColor,
	onChange,
}: {
	accent: string;
	systemColor: Rgb | undefined;
	onChange: (accent: string) => void;
}) {
	const listId = useId();
	const pickerRef = useRef<HTMLInputElement>(null);
	const pickerTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	// What the picker shows while a drag is waiting to be applied.
	const [draft, setDraft] = useState<string>();
	useEffect(() => setDraft(undefined), [accent]);
	useEffect(
		() => () => {
			clearTimeout(pickerTimerRef.current);
		},
		[],
	);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [index, setIndex] = useState(0);
	const custom = isCustomAccent(accent);
	const current = accentColor(accent) ?? systemColor;
	const allChoices = useMemo(() => buildChoices(systemColor), [systemColor]);
	const selectedChoice: Choice =
		allChoices.find(({id}) => id === accent) ??
		({
			id: accent,
			label: `Custom ${accent}`,
			detail: accent,
			background: accent,
		} satisfies Choice);

	const choices = useMemo(() => {
		const text = query.trim().toLowerCase();
		const typed = TYPED_HEX.exec(text);
		if (typed) {
			const hex = `#${typed[1]}`;
			return [
				{
					id: `typed-${hex}`,
					label: `Use ${hex}`,
					detail: 'Press Enter to use this color',
					background: hex,
					value: hex,
				},
			];
		}

		return text
			? allChoices.filter(({label, detail}) =>
					`${label} ${detail}`.toLowerCase().includes(text),
				)
			: allChoices;
	}, [query, allChoices]);
	const active = Math.min(index, choices.length - 1);
	const focused = choices[active];

	function choose(choice: Choice | undefined) {
		if (!choice) {
			return;
		}

		setOpen(false);
		if (choice.id === CUSTOM) {
			// The native picker opens beneath its input, which is laid over the trigger.
			requestAnimationFrame(() => pickerRef.current?.showPicker());
			return;
		}

		onChange(choice.value ?? choice.id);
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.nativeEvent.isComposing) {
			return;
		}

		const step = ARROW_STEPS.get(event.key);
		if (step !== undefined && choices.length > 0) {
			event.preventDefault();
			const next = active + step;
			setIndex(Math.min(Math.max(next, 0), choices.length - 1));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			choose(focused);
		}
	}

	return (
		<div className="relative inline-block">
			<Popover
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					setQuery('');
					setIndex(
						Math.max(
							0,
							allChoices.findIndex(({id}) => id === accent),
						),
					);
				}}
			>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label={`Accent color: ${selectedChoice.label}`}
						className="tn-select-trigger flex h-9 w-56 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Circle small choice={selectedChoice} color={current} />
						<span className="min-w-0 flex-1 truncate text-left">
							{selectedChoice.label}
						</span>
						<ChevronDown className="h-4 w-4 opacity-50" aria-hidden="true" />
					</button>
				</PopoverTrigger>
				<PopoverContent className="w-80 p-0">
					<div className="flex items-center gap-2 border-b border-border px-3">
						<Search
							className="h-4 w-4 shrink-0 opacity-50"
							aria-hidden="true"
						/>
						<input
							role="combobox"
							aria-expanded="true"
							aria-controls={listId}
							aria-activedescendant={
								focused ? `${listId}-${active}` : undefined
							}
							aria-label="Search colors"
							placeholder="Search colors or type #rrggbb"
							className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
							value={query}
							onChange={(event) => {
								setQuery(event.target.value);
								setIndex(0);
							}}
							onKeyDown={onKeyDown}
						/>
					</div>
					<div
						id={listId}
						role="listbox"
						aria-label="Accent colors"
						className="grid gap-2 p-3"
						style={{gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`}}
					>
						{choices.length === 0 && (
							<p className="col-span-full py-4 text-center text-sm text-muted-foreground">
								No matching color.
							</p>
						)}
						{choices.map((choice, position) => {
							const selected =
								choice.id === accent ||
								choice.value === accent ||
								(choice.id === CUSTOM && custom);
							const color =
								choice.id === CUSTOM
									? custom
										? accentColor(accent)
										: undefined
									: accentColor(choice.value ?? choice.id);
							return (
								<div
									key={choice.id}
									id={`${listId}-${position}`}
									role="option"
									aria-selected={selected}
									aria-label={choice.label}
									title={choice.label}
									className={cn(
										'grid cursor-pointer place-items-center rounded-full p-0.5',
										position === active && 'ring-2 ring-ring',
									)}
									onMouseMove={() => position !== active && setIndex(position)}
									onMouseDown={(event) => {
										event.preventDefault();
									}}
									onClick={() => {
										choose(choice);
									}}
								>
									<Circle
										choice={
											choice.id === CUSTOM && custom
												? {background: accent}
												: choice
										}
										selected={selected}
										color={color}
									/>
								</div>
							);
						})}
					</div>
					<div className="flex items-center gap-2 border-t border-border px-3 py-2">
						<div className="min-w-0 flex-1" aria-live="polite">
							<div className="truncate text-[13px] font-medium">
								{focused?.label ?? ''}
							</div>
							<div className="truncate text-[11px] text-muted-foreground">
								{focused?.detail ?? ''}
							</div>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={accent === DEFAULT_ACCENT}
							onClick={() => {
								choose(DEFAULT_CHOICE);
							}}
						>
							<RotateCcw className="h-3.5 w-3.5" />
							Reset
						</Button>
					</div>
				</PopoverContent>
			</Popover>
			<input
				ref={pickerRef}
				type="color"
				aria-label="Custom accent color"
				tabIndex={-1}
				className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
				value={draft ?? (custom ? accent : rgbToHex(current ?? [98, 84, 215]))}
				onChange={(event) => {
					const {value} = event.target;
					setDraft(value);
					clearTimeout(pickerTimerRef.current);
					pickerTimerRef.current = setTimeout(() => {
						onChange(value);
					}, PICKER_DEBOUNCE_MS);
				}}
			/>
		</div>
	);
}
