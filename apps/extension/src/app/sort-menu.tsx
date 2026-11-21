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

export function SortMenu({
	label,
	value,
	options,
	onChange,
}: {
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
