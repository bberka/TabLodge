import {useEffect, useState} from 'react';
import {usePrivateState} from '../private/private-library';
import {openPrivateSheet} from '../private/private-sheets';
import {ChoiceGroup} from '../screens/settings/select-row';
import {type LibraryName} from './library-store';

export function LibraryChoice({
	value,
	onChange,
}: {
	value: LibraryName;
	onChange: (library: LibraryName) => void;
}) {
	const state = usePrivateState();
	const [waiting, setWaiting] = useState(false);
	useEffect(() => {
		if (!(waiting && state.exists) || state.locked || state.needsPassword) {
			return;
		}

		setWaiting(false);
		onChange('private');
	}, [waiting, state.exists, state.locked, state.needsPassword, onChange]);
	if (!state.exists) {
		return null;
	}

	const locked = state.locked || state.needsPassword;
	return (
		<ChoiceGroup
			title="Library"
			choices={[
				{
					id: 'regular',
					name: 'Regular',
					hint: 'Your everyday bookmarks and sessions.',
					icon: 'bookmark-outline',
				},
				{
					id: 'private',
					name: locked ? 'Private (locked)' : 'Private',
					hint: locked
						? 'Saved only to your private library. Asks to unlock first.'
						: 'Saved only to your private library.',
					icon: locked ? 'lock-closed-outline' : 'glasses-outline',
				},
			]}
			value={value}
			onPick={(next) => {
				if (next === 'private' && locked) {
					setWaiting(true);
					openPrivateSheet(state.needsPassword ? 'protect' : 'unlock');
				} else {
					setWaiting(false);
					onChange(next);
				}
			}}
		/>
	);
}
