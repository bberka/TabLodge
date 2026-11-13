import {useState} from 'react';
import {Text} from 'react-native';
import {MAX_DEVICE_NAME, cleanDeviceName} from '../../../src/shared/device';
import {defaultDeviceName} from '../device';
import {setPreferences, usePreferences} from '../preferences';
import {useColors} from '../theme';
import {Field} from '../ui';

/**
The name this phone puts on the sessions it saves, so a session list shared between devices says where each one
came from. An empty field goes back to the phone's make and model.
*/
export function DeviceNameField() {
	const colors = useColors();
	const {deviceName} = usePreferences();
	const fallback = defaultDeviceName();
	const [draft, setDraft] = useState(deviceName);
	const commit = () => {
		const name = cleanDeviceName(draft);
		setDraft(name);
		if (name !== deviceName) {
			setPreferences({deviceName: name});
		}
	};

	return (
		<>
			<Field
				label="Device name"
				icon="phone-portrait-outline"
				value={draft}
				placeholder={fallback}
				maxLength={MAX_DEVICE_NAME}
				returnKeyType="done"
				onChangeText={setDraft}
				onBlur={commit}
				onSubmitEditing={commit}
			/>
			<Text style={{color: colors.muted}}>
				Sessions saved here say they came from this phone, for example “Berkay’s
				Pixel”. Empty uses “{fallback}”. Saved sessions keep the name they had.
			</Text>
		</>
	);
}
