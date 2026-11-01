import type {ComponentProps} from 'react';
import {Plus} from 'lucide-react';
import {SelectItem} from '../shared/ui';
import {ColumnSelect} from './column-select';
import {send} from './common';
import {IconLabel} from './icon-label';
import {IconNameField} from './icon-picker';
import {DEFAULT_COLUMN_ICON} from './icon-registry';

export const NEW_BOOKMARK_COLUMN = '__new-column__';
export type BookmarkColumnDraft = {name: string; icon?: string};
type NewColumnFieldProps = {
	id: string;
	draft: BookmarkColumnDraft;
	onDraftChange: (draft: BookmarkColumnDraft) => void;
};

export async function resolveBookmarkColumn(
	columnId: string,
	draft: BookmarkColumnDraft,
) {
	if (columnId !== NEW_BOOKMARK_COLUMN) {
		return columnId;
	}

	if (!draft.name.trim()) {
		throw new Error('Enter a name for the new column.');
	}

	const result = await send('CREATE_BOOKMARK_COLUMN', {
		name: draft.name.trim(),
		icon: draft.icon,
	});
	if (!result?.ok) {
		throw new Error(result?.error || 'Could not create that column.');
	}

	return result.column.id;
}

export function BookmarkColumnPicker({
	draft,
	onDraftChange,
	...props
}: Omit<ComponentProps<typeof ColumnSelect>, 'children'> &
	NewColumnFieldProps) {
	return (
		<div className="space-y-3">
			<BookmarkColumnSelect {...props} />
			{props.value === NEW_BOOKMARK_COLUMN && (
				<BookmarkColumnNameField
					id={`${props.id}-new-name`}
					draft={draft}
					onDraftChange={onDraftChange}
				/>
			)}
		</div>
	);
}

export function BookmarkColumnSelect(
	props: Omit<ComponentProps<typeof ColumnSelect>, 'children'>,
) {
	return (
		<ColumnSelect {...props}>
			<SelectItem value={NEW_BOOKMARK_COLUMN}>
				<IconLabel icon={Plus}>New column</IconLabel>
			</SelectItem>
		</ColumnSelect>
	);
}

export function BookmarkColumnNameField({
	id,
	draft,
	onDraftChange,
}: NewColumnFieldProps) {
	return (
		<IconNameField
			id={id}
			label="New column name"
			nameLabel="New column name"
			icon={draft.icon}
			defaultIcon={DEFAULT_COLUMN_ICON}
			inputProps={{
				required: true,
				maxLength: 60,
				placeholder: 'Reading list',
				autoFocus: true,
				value: draft.name,
				onChange: (event) =>
					onDraftChange({...draft, name: event.target.value}),
			}}
			onIconChange={(icon) => onDraftChange({...draft, icon})}
		/>
	);
}
