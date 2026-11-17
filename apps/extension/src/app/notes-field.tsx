import {useState} from 'react';
import {Label, Textarea} from '../shared/ui';
import {cn} from '@/lib/utils';

/**
The optional note of a bookmark being added or edited. It stays one row tall until it is focused or holds text, so an
add form does not grow for a field most saves leave empty. The worker cleans and caps what is saved.
*/
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
