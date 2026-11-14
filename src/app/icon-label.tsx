import type {ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';
import {COLUMN_COLOR_TEXT, columnColorVars} from './column-color';
import {
	DEFAULT_COLUMN_ICON,
	DEFAULT_FOLDER_ICON,
	getIcon,
} from './icon-registry';
import {cn} from '@/lib/utils';

/**
An icon before a name, for select items and menu rows. Inside a `SelectItem` it also shows in the closed trigger.
*/
export function IconLabel({
	icon: Icon,
	children,
	color,
}: {
	icon: LucideIcon;
	children: ReactNode;
	/**
	A column color; the icon takes it instead of the neutral gray.
	*/
	color?: string;
}) {
	const vars = columnColorVars(color);
	return (
		<span className="flex min-w-0 items-center gap-2" style={vars}>
			<Icon
				aria-hidden
				className={cn(
					'h-4 w-4 shrink-0',
					vars ? COLUMN_COLOR_TEXT : 'text-muted-foreground',
				)}
			/>
			<span className="min-w-0 truncate">{children}</span>
		</span>
	);
}

export function ColumnLabel({
	column,
}: {
	column: {name: string; icon?: string; color?: string};
}) {
	return (
		<IconLabel
			icon={getIcon(column.icon, DEFAULT_COLUMN_ICON).component}
			color={column.color}
		>
			{column.name}
		</IconLabel>
	);
}

export function FolderLabel({folder}: {folder: {name: string; icon?: string}}) {
	return (
		<IconLabel icon={getIcon(folder.icon, DEFAULT_FOLDER_ICON).component}>
			{folder.name}
		</IconLabel>
	);
}
