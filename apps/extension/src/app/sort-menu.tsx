import {ArrowDownUp} from 'lucide-react';
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
	IconTooltip,
} from '../shared/ui';

/**
The sort button and its radio menu, shared by the session list and the bookmark columns.
*/
export function SortMenu({
	label,
	value,
	options,
	onChange,
}: {
	/**
	Names the button and titles the menu, for example "Sort sessions".
	*/
	label: string;
	value: string;
	options: ReadonlyArray<readonly [value: string, label: string]>;
	onChange: (value: string) => void;
}) {
	return (
		<DropdownMenu>
			<IconTooltip label={label}>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						aria-label={label}
					>
						<ArrowDownUp />
					</Button>
				</DropdownMenuTrigger>
			</IconTooltip>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>{label}</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={value} onValueChange={onChange}>
					{options.map(([optionValue, optionLabel]) => (
						<DropdownMenuRadioItem key={optionValue} value={optionValue}>
							{optionLabel}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
