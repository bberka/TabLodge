import {useState} from 'react';
import {Label, Textarea} from '../shared/ui';
import {cn} from '@/lib/utils';

export function NotesField({
	id,
	value,
	onChange,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
}) {
	const [focused, setFocused] = useState(false);
	const open = focused || value !== '';
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>Notes</Label>
			<Textarea
				id={id}
				maxLength={10_000}
				rows={open ? 3 : 1}
				placeholder="Why you saved it (optional)"
				className={cn(!open && 'min-h-9 resize-none')}
				value={value}
				onFocus={() => {
					setFocused(true);
				}}
				onBlur={() => {
					setFocused(false);
				}}
				onChange={(event) => {
					onChange(event.target.value);
				}}
			/>
		</div>
	);
}
