import {Text} from 'react-native';
import {confirm} from '../../ui/dialog';
import {lockNow, PrivateSwitch} from '../../private/private-switch';
import {
	PRIVATE_LOCK_MINUTES,
	setPreferences,
	usePreferences,
} from '../../settings/preferences';
import {
	removePrivate,
	usePrivateState,
	usePrivateStatus,
} from '../../private/private-library';
import {openPrivateSheet} from '../../private/private-sheets';
import {useSyncStatus} from '../../library/library-store';
import {useColors} from '../../ui/theme';
import {Button} from '../../ui/ui';
import {SelectRow} from './select-row';
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
			{state.lockedWith && (
				<SelectRow
					row={ROWS.privateLockMode}
					value={prefs.privateLockMode}
					choices={[
						{
							id: 'manual',
							name: 'Never',
							hint: 'Only with Lock now',
							icon: 'hand-left-outline',
						},
						{
							id: 'leave',
							name: 'When I leave the app',
							hint: 'It locks when another app comes in front',
							icon: 'exit-outline',
						},
						{
							id: 'screen',
							name: 'When the screen locks',
							hint: 'It locks when the screen turns off',
							icon: 'phone-portrait-outline',
						},
						{
							id: 'timeout',
							name: 'After a while',
							hint: 'It locks after some time without a touch',
							icon: 'time-outline',
						},
					]}
					onChange={(privateLockMode) => {
						setPreferences({privateLockMode});
					}}
				/>
			)}
			{state.lockedWith && prefs.privateLockMode === 'timeout' && (
				<SelectRow
					row={ROWS.privateLockMinutes}
					value={String(prefs.privateLockMinutes)}
					choices={PRIVATE_LOCK_MINUTES.map((minutes) => ({
						id: String(minutes),
						name:
							minutes === 60
								? '1 hour'
								: `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`,
					}))}
					onChange={(minutes) => {
						setPreferences({privateLockMinutes: Number(minutes)});
					}}
				/>
			)}
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
