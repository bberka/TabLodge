import {usePreferences} from '../settings/preferences';
import {showSnack} from '../ui/snackbar';
import {useColors} from '../ui/theme';
import {Button, IconButton} from '../ui/widgets';
import {setView, useView} from '../library/view';
import {openPrivateSheet} from './private-sheets';
import {lockPrivate, usePrivateState} from './private-library';

export async function lockNow(): Promise<void> {
	await lockPrivate();
	showSnack('Private library locked');
}

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
		} else if (state.needsPassword) {
			openPrivateSheet('protect');
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
			{priv && state.hasLock && (
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
