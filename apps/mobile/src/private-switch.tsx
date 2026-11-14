import {lockPrivate, usePrivateState} from './private-library';
import {openPrivateSheet} from './private-sheets';
import {usePreferences} from './preferences';
import {showSnack} from './snackbar';
import {useColors} from './theme';
import {Button, IconButton} from './ui';
import {setView, useView} from './view';

/**
Locks the private library at once: its key leaves memory and the regular library comes back. The data stays on the
phone, and opening it again asks for the PIN or password.
*/
export async function lockNow(): Promise<void> {
	await lockPrivate();
	showSnack('Private library locked');
}

/**
Flips between the regular library and the private one. The private library is made the first time, and asks for its PIN
or password when it has one. As a header icon (the default) it appears when the person turned the button on in Settings,
and while the private library is open, with a lock beside it when it has a lock, so there is always a way back; with
`button` it is a labeled button that is always there, for Settings.
*/
export function PrivateSwitch({button = false}: {button?: boolean}) {
	const colors = useColors();
	const view = useView();
	const {showPrivateButton} = usePreferences();
	const state = usePrivateState();
	const priv = view === 'private';
	if (!(button || priv || showPrivateButton)) {
		return null;
	}

	const toggle = () => {
		if (priv) {
			setView('regular');
		} else if (!state.exists) {
			openPrivateSheet('setup');
		} else if (state.locked) {
			openPrivateSheet('unlock');
		} else {
			setView('private');
		}
	};

	if (button) {
		return (
			<Button
				label={
					priv
						? 'Back to your regular library'
						: state.exists
							? 'Open the private library'
							: 'Set up the private library'
				}
				icon={priv ? 'arrow-back-outline' : 'glasses-outline'}
				onPress={toggle}
			/>
		);
	}

	return (
		<>
			{priv && state.lockedWith && (
				<IconButton
					icon="lock-closed-outline"
					label="Lock now"
					onPress={() => void lockNow()}
				/>
			)}
			<IconButton
				icon={priv ? 'glasses' : 'glasses-outline'}
				label={priv ? 'Back to your regular library' : 'Show private library'}
				color={priv ? colors.accent : undefined}
				onPress={toggle}
			/>
		</>
	);
}
