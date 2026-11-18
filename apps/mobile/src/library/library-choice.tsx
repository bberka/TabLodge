import {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {usePrivateState} from '../private/private-library';
import {openPrivateSheet} from '../private/private-sheets';
import {useColors} from '../ui/theme';
import {Segmented} from '../ui/widgets';
import {type LibraryName} from './library-store';

/**
Which library a link is saved to, when the phone has a private one: the regular library or the private one. Choosing a
locked private library asks for its PIN or password first, and switches once it is open.
*/
export function LibraryChoice({
	value,
	onChange,
}: {
	value: LibraryName;
	onChange: (library: LibraryName) => void;
}) {
	const colors = useColors();
	const state = usePrivateState();
	const [waiting, setWaiting] = useState(false);
	useEffect(() => {
		if (!(waiting && state.exists) || state.locked || state.needsPin) {
			return;
		}

		setWaiting(false);
		onChange('private');
	}, [waiting, state.exists, state.locked, state.needsPin, onChange]);
	if (!state.exists) {
		return null;
	}

	return (
		<View style={{gap: 6}}>
			<Segmented
				label="Library"
				items={[
					{id: 'regular', name: 'Regular', icon: 'bookmark-outline'},
					{
						id: 'private',
						name:
							state.locked || state.needsPin ? 'Private (locked)' : 'Private',
						icon:
							state.locked || state.needsPin
								? 'lock-closed-outline'
								: 'glasses-outline',
					},
				]}
				selected={value}
				onSelect={(next) => {
					if (next === 'private' && (state.locked || state.needsPin)) {
						setWaiting(true);
						openPrivateSheet(state.needsPin ? 'protect' : 'unlock');
					} else {
						setWaiting(false);
						onChange(next);
					}
				}}
			/>
			{value === 'private' && (
				<Text style={{color: colors.muted}}>
					Saved only to your private library.
				</Text>
			)}
		</View>
	);
}
