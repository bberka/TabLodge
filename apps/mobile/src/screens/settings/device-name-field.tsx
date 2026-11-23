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
