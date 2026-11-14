import {askToLock, PrivateSwitch} from '../private-switch';
import {setPreferences, usePreferences} from '../preferences';
import {usePrivateStatus} from '../private-library';
import {Button} from '../ui';
import {SettingsCard} from './settings-card';
import {Toggle} from './behaviour-settings';
import {ROWS, SECTIONS} from './settings-index';

/**
What this phone keeps of the private windows' library, and a way to lock it.
*/
export function PrivateCard() {
	const status = usePrivateStatus();
	const prefs = usePreferences();
	return (
		<SettingsCard
			section={SECTIONS.private}
			icon="glasses-outline"
			description={
				status.connected
					? (status.error ?? 'Open, and read only here.')
					: 'Read the private windows’ library from your server.'
			}
		>
			<PrivateSwitch button />
			<Toggle
				row={ROWS.showPrivateButton}
				value={prefs.showPrivateButton}
				onChange={(showPrivateButton) => {
					setPreferences({showPrivateButton});
				}}
			/>
			{status.connected && (
				<Button
					label="Lock now"
					icon="lock-closed-outline"
					kind="plain"
					onPress={askToLock}
				/>
			)}
		</SettingsCard>
	);
}
