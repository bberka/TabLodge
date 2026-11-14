import {Platform} from 'react-native';
import {
	defaultPhoneDeviceName,
	deviceStamp,
	type DeviceStamp,
} from '../../extension/src/shared/device';
import {getPreferences} from './preferences';

/**
The phone's make and model, for when its owner has not named it.
*/
export function defaultDeviceName(): string {
	const constants = Platform.constants as {Brand?: string; Model?: string};
	return defaultPhoneDeviceName(constants.Brand ?? '', constants.Model ?? '');
}

/**
What this phone is called: the name set in Settings, else its make and model.
*/
export const deviceLabel = (): string =>
	getPreferences().deviceName || defaultDeviceName();

/**
The fields that say a session was saved on this phone.
*/
export const phoneStamp = (): DeviceStamp =>
	deviceStamp(deviceLabel(), 'mobile');
