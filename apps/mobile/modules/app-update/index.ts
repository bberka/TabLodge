import {requireOptionalNativeModule} from 'expo';

type AppUpdateModule = {
	canInstall: () => boolean;
	openInstallSettings: () => void;
	install: (path: string) => boolean;
};

const native = requireOptionalNativeModule<AppUpdateModule>('AppUpdate');

export const canInstallHere = native !== null;

export function installAllowed(): boolean {
	return native?.canInstall() ?? false;
}

export function openInstallSettings(): void {
	native?.openInstallSettings();
}

export function installApk(path: string): boolean {
	return native?.install(path) ?? false;
}
