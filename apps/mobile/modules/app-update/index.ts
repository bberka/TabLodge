import {requireOptionalNativeModule} from 'expo';

type AppUpdateModule = {
	canInstall: () => boolean;
	openInstallSettings: () => void;
	install: (path: string) => boolean;
};

const native = requireOptionalNativeModule<AppUpdateModule>('AppUpdate');

/**
Whether this build can start Android's installer itself. A build without native support (Expo Go) cannot.
*/
export const canInstallHere = native !== null;

/**
Whether Android lets the app start an install now. False until the person allows it in Settings on Android 8 and newer.
*/
export function installAllowed(): boolean {
	return native?.canInstall() ?? false;
}

/**
Opens the Settings page where the person allows installs from TabLodge.
*/
export function openInstallSettings(): void {
	native?.openInstallSettings();
}

/**
Opens Android's installer on the APK at `path`. Returns false when nothing could start it.
*/
export function installApk(path: string): boolean {
	return native?.install(path) ?? false;
}
