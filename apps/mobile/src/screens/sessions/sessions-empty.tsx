import {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {refreshStatus, syncClient} from '../../library/library-store';
import {PrivateSwitch} from '../../private/private-switch';
import {FloatingActions} from '../../ui/floating-actions';
import {Button, Empty, Header} from '../../ui/widgets';

/**
The Sessions screen with nothing in it: why it is empty for this library, and the button that fixes it when there is one
(Sync now once connected, Connect to your server before).
*/
export function SessionsEmpty({
	connected,
	isPrivate,
	space,
	onConnect,
	onAdd,
}: {
	connected: boolean;
	isPrivate: boolean;
	space: number;
	onConnect: () => void;
	onAdd: () => void;
}) {
	const [syncing, setSyncing] = useState(false);
	return (
		<View style={styles.screen}>
			<Header title="Sessions" right={<PrivateSwitch />} />
			<Empty
				icon="albums-outline"
				title="No sessions yet"
				action={
					isPrivate ? undefined : connected ? (
						<Button
							label="Sync now"
							icon="sync-outline"
							loading={syncing}
							onPress={() => {
								setSyncing(true);
								void syncClient
									.syncNow()
									.catch(() => undefined)
									.then(refreshStatus)
									.finally(() => {
										setSyncing(false);
									});
							}}
						/>
					) : (
						<Button
							label="Connect to your server"
							icon="sync-outline"
							onPress={onConnect}
						/>
					)
				}
			>
				{isPrivate
					? 'Nothing is saved in the private library yet. Choose Private when you save a link.'
					: connected
						? 'This phone is connected to your server, but the library has no sessions yet. Sessions saved in the TabLodge extension appear here after they sync. To save one from here, share several links from your browser to TabLodge.'
						: 'Sessions saved in the TabLodge extension appear here once this phone is synced with your server. To save one from here, share several links from your browser to TabLodge.'}
			</Empty>
			<FloatingActions bottom={space} buttonLabel="Add links" onAdd={onAdd} />
		</View>
	);
}

const styles = StyleSheet.create({
	screen: {flex: 1},
});
