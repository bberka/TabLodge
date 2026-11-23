import {Platform} from 'react-native';
import {
	defaultPhoneDeviceName,
	deviceStamp,
	type DeviceStamp,
} from '../../../extension/src/shared/device';
import {getPreferences} from '../settings/preferences';

export function defaultDeviceName(): string {
	const constants = Platform.constants as {Brand?: string; Model?: string};
	return defaultPhoneDeviceName(constants.Brand ?? '', constants.Model ?? '');
}

export const deviceLabel = (): string =>
	getPreferences().deviceName || defaultDeviceName();

export const phoneStamp = (): DeviceStamp =>
	deviceStamp(deviceLabel(), 'mobile');
