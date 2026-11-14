import {Text} from 'react-native';
import {confirm} from '../dialog';
import {lockNow, PrivateSwitch} from '../private-switch';
import {setPreferences, usePreferences} from '../preferences';
import {
	removePrivate,
	usePrivateState,
	usePrivateStatus,
} from '../private-library';
import {openPrivateSheet} from '../private-sheets';
import {useSyncStatus} from '../library-store';
import {useColors} from '../theme';
import {Button} from '../ui';
import {SettingsCard} from './settings-card';
import {Toggle} from './behaviour-settings';
import {ROWS, SECTIONS} from './settings-index';

/**
The private library on this phone: setting it up, its lock, and what it does with the server.
*/
export function PrivateCard() {
	const colors = useColors();
	const state = usePrivateState();
	const status = usePrivateStatus();
	const {connected} = useSyncStatus();
	const prefs = usePreferences();
	const description = state.exists
		? state.locked
			? 'Locked. Open it with its PIN or password.'
			: state.lockedWith
				? 'Open and protected by a PIN or password.'
				: 'Open, with no PIN or password.'
		: 'A library of its own on this phone that works without a server.';
	return (
		<SettingsCard
			section={SECTIONS.private}
			icon="glasses-outline"
			description={description}
		>
			<Toggle
				row={ROWS.showPrivateButton}
				value={prefs.showPrivateButton}
				onChange={(showPrivateButton) => {
					setPreferences({showPrivateButton});
				}}
			/>
			{state.exists && !state.locked && status.needsKey && (
				<>
					<Text style={{color: colors.warn}}>
						Your server's private library has a PIN or password this phone does
						not have yet. Enter it to sync.
					</Text>
					<Button
						label="Enter the server's PIN or password"
						icon="key-outline"
						kind="plain"
						onPress={() => {
							openPrivateSheet('server');
						}}
					/>
				</>
			)}
			{state.exists && !state.locked && !state.lockedWith && (
				<Button
					label="Add a PIN or password"
					icon="lock-closed-outline"
					kind="plain"
					onPress={() => {
						openPrivateSheet('protect');
					}}
				/>
			)}
			{state.exists && !state.locked && state.lockedWith && (
				<Button
					label="Lock now"
					icon="lock-closed-outline"
					kind="plain"
					onPress={() => void lockNow()}
				/>
			)}
			{!state.exists && connected && (
				<Button
					label="Use my server's private library"
					icon="cloud-download-outline"
					kind="plain"
					onPress={() => {
						openPrivateSheet('server');
					}}
				/>
			)}
			{state.exists && (
				<Button
					label="Delete from this phone"
					icon="trash-outline"
					kind="danger"
					onPress={() => {
						confirm(
							'Delete the private library from this phone?',
							'Its bookmarks and sessions and its lock are removed from this phone. Your server keeps its copy, if it has one, and you can bring it back from there.',
							{label: 'Delete', destructive: true},
							() => void removePrivate(),
						);
					}}
				/>
			)}
			<PrivateSwitch button />
		</SettingsCard>
	);
}
