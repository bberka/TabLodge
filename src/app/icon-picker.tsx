import {
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
	Button,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	ScrollArea,
} from '../shared/ui';
import {getIcon, isIconId, searchIcons} from './icon-registry';
import type {IconId} from './icon-ids';
import {cn} from '@/lib/utils';

type IconPickerDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	The stored icon id; anything unknown shows no selection.
	*/
	value?: string;
	/**
	Called with an icon id, or undefined for "Reset to default".
	*/
	onSelect: (id: string | undefined) => void;
};

/**
Searchable icon grid. Arrow keys move through the grid (ArrowDown from the search box enters it),
Enter picks the focused icon, or the first match while typing.
*/
function IconPickerDialog({
	open,
	onOpenChange,
	value,
	onSelect,
}: IconPickerDialogProps) {
	const [query, setQuery] = useState('');
	const gridRef = useRef<HTMLDivElement | null>(null);
	const icons = useMemo(() => searchIcons(query), [query]);
	const selected = isIconId(value) ? value : undefined;

	function choose(id: string | undefined) {
		onSelect(id);
		onOpenChange(false);
	}

	function buttons() {
		return [
			...(gridRef.current?.querySelectorAll<HTMLButtonElement>(
				'button[data-icon-id]',
			) ?? []),
		];
	}

	function focusFirst() {
		const all = buttons();
		(
			all.find((button) => button.dataset.selected === 'true') ?? all[0]
		)?.focus();
	}

	function onGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
		const all = buttons();
		const index = all.indexOf(document.activeElement as HTMLButtonElement);
		if (index === -1) {
			return;
		}

		// Columns in the current layout: buttons that share the first row's offset.
		const columns = all.filter(
			(button) => button.offsetTop === all[0].offsetTop,
		).length;
		const next = {
			ArrowRight: index + 1,
			ArrowLeft: index - 1,
			ArrowDown: index + columns,
			ArrowUp: index - columns,
			Home: 0,
			End: all.length - 1,
		}[event.key];
		if (next === undefined) {
			return;
		}

		event.preventDefault();
		if (next < 0) {
			gridRef.current
				?.closest('[role="dialog"]')
				?.querySelector('input')
				?.focus();
			return;
		}

		all[Math.min(next, all.length - 1)]?.focus();
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					setQuery('');
				}

				onOpenChange(next);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Choose icon</DialogTitle>
					<DialogDescription>
						Search by name or topic, then pick an icon.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<Input
						type="search"
						aria-label="Search icons"
						placeholder="Search icons"
						autoComplete="off"
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
						}}
						onKeyDown={(event) => {
							if (event.key === 'ArrowDown') {
								event.preventDefault();
								focusFirst();
							} else if (event.key === 'Enter') {
								// Never submit an enclosing form; pick the best match instead.
								event.preventDefault();
								if (icons[0]) {
									choose(icons[0].id);
								}
							}
						}}
					/>
					<ScrollArea className="h-64 rounded-md border border-border">
						{icons.length > 0 ? (
							<div
								ref={gridRef}
								role="listbox"
								aria-label="Icons"
								className="grid grid-cols-[repeat(auto-fill,2.5rem)] justify-center gap-1 p-2"
								onKeyDown={onGridKeyDown}
							>
								{icons.map((icon) => {
									const Icon = icon.component;
									const active = icon.id === selected;
									return (
										<button
											key={icon.id}
											ref={
												active
													? (node) => {
															node?.scrollIntoView({block: 'nearest'});
														}
													: undefined
											}
											type="button"
											role="option"
											aria-selected={active}
											aria-label={icon.label}
											title={icon.label}
											data-icon-id={icon.id}
											data-selected={active}
											className={cn(
												'grid h-10 w-10 place-items-center rounded-md text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
												active
													? 'bg-primary text-primary-foreground'
													: 'hover:bg-accent',
											)}
											onClick={() => {
												choose(icon.id);
											}}
										>
											<Icon className="size-5" />
										</button>
									);
								})}
							</div>
						) : (
							<p className="px-3 py-10 text-center text-sm text-muted-foreground">
								No icons match.
							</p>
						)}
					</ScrollArea>
				</DialogBody>
				<DialogFooter className="justify-between">
					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							choose(undefined);
						}}
					>
						Reset to default
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							onOpenChange(false);
						}}
					>
						Cancel
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type IconNameFieldProps = {
	id: string;
	/**
	Visible label above the row, for example "Name".
	*/
	label: string;
	/**
	Accessible name of the text input, for example "Column name".
	*/
	nameLabel: string;
	icon?: string;
	defaultIcon: IconId;
	onIconChange: (id: string | undefined) => void;
	inputProps: Omit<React.ComponentPropsWithoutRef<typeof Input>, 'id'>;
};

/**
One form row: the icon button (opens the picker) on the left, the name input filling the rest, both 36px tall.
*/
export function IconNameField({
	id,
	label,
	nameLabel,
	icon,
	defaultIcon,
	onIconChange,
	inputProps,
}: IconNameFieldProps) {
	const [open, setOpen] = useState(false);
	const current = getIcon(icon, defaultIcon);
	const Icon = current.component;
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>{label}</Label>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					variant="outline"
					className="h-9 w-9 min-h-9 shrink-0 p-0"
					aria-label={`Choose icon (current: ${current.label})`}
					title="Choose icon"
					onClick={() => {
						setOpen(true);
					}}
				>
					<Icon className="!size-5" />
				</Button>
				<Input
					{...inputProps}
					id={id}
					aria-label={nameLabel}
					className="min-w-0 flex-1"
				/>
			</div>
			<IconPickerDialog
				open={open}
				value={icon}
				onOpenChange={setOpen}
				onSelect={onIconChange}
			/>
		</div>
	);
}
