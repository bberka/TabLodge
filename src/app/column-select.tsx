import type {ReactNode} from 'react';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../shared/ui';
import {ColumnLabel} from './icon-label';

/**
A select of bookmark columns, each with its icon. `children` adds items after the columns, such as "New column".
*/
export function ColumnSelect({
	columns,
	value,
	onValueChange,
	disabled,
	id,
	className,
	'aria-label': ariaLabel,
	children,
}: {
	columns: ReadonlyArray<{id: string; name: string; icon?: string}>;
	value?: string;
	onValueChange: (value: string) => void;
	disabled?: boolean;
	id?: string;
	className?: string;
	'aria-label'?: string;
	children?: ReactNode;
}) {
	return (
		<Select value={value} disabled={disabled} onValueChange={onValueChange}>
			<SelectTrigger id={id} className={className} aria-label={ariaLabel}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{columns.map((column) => (
					<SelectItem key={column.id} value={column.id}>
						<ColumnLabel column={column} />
					</SelectItem>
				))}
				{children}
			</SelectContent>
		</Select>
	);
}
