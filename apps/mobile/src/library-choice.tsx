import {useEffect, useState} from 'react';
import {Text, View} from 'react-native';
import {type LibraryName} from './library-store';
import {usePrivateState} from './private-library';
import {openPrivateSheet} from './private-sheets';
import {useColors} from './theme';
import {Segmented} from './ui';

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
		if (!(waiting && state.exists) || state.locked) {
			return;
		}

		setWaiting(false);
		onChange('private');
	}, [waiting, state.exists, state.locked, onChange]);
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
						name: state.locked ? 'Private (locked)' : 'Private',
						icon: state.locked ? 'lock-closed-outline' : 'glasses-outline',
					},
				]}
				selected={value}
				onSelect={(next) => {
					if (next === 'private' && state.locked) {
						setWaiting(true);
						openPrivateSheet('unlock');
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
