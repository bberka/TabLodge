import type {ReactNode} from 'react';
import type {LucideIcon} from 'lucide-react';
import {
	DEFAULT_COLUMN_ICON,
	DEFAULT_FOLDER_ICON,
	getIcon,
} from './icon-registry';

/**
An icon before a name, for select items and menu rows. Inside a `SelectItem` it also shows in the closed trigger.
*/
export function IconLabel({
	icon: Icon,
	children,
}: {
	icon: LucideIcon;
	children: ReactNode;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			<Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
			<span className="min-w-0 truncate">{children}</span>
		</span>
	);
}

export function ColumnLabel({column}: {column: {name: string; icon?: string}}) {
	return (
		<IconLabel icon={getIcon(column.icon, DEFAULT_COLUMN_ICON).component}>
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
