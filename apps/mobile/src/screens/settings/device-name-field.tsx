import {useState} from 'react';
import {Text} from 'react-native';
import {
	MAX_DEVICE_NAME,
	cleanDeviceName,
} from '../../../../extension/src/shared/device';
import {defaultDeviceName} from '../../platform/device';
import {setPreferences, usePreferences} from '../../settings/preferences';
import {useColors} from '../../ui/theme';
import {Field} from '../../ui/widgets';
import {useRowVisible} from './settings-card';
import {ROWS} from './settings-index';

/**
The name this phone puts on the sessions it saves, so a session list shared between devices says where each one
came from. An empty field goes back to the phone's make and model.
*/
export function DeviceNameField() {
	const colors = useColors();
	const {deviceName} = usePreferences();
	const fallback = defaultDeviceName();
	const [draft, setDraft] = useState(deviceName);
	const visible = useRowVisible(ROWS.deviceName);
	if (!visible) {
		return null;
	}

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
				label={ROWS.deviceName.label}
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
				{ROWS.deviceName.hint} (“{fallback}”).
			</Text>
		</>
	);
}
