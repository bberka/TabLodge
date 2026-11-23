import {requireOptionalNativeModule} from 'expo';

type OpenLinksModule = {
	addListener: (
		name: 'screenOff',
		callback: () => void,
	) => {remove: () => void};
	openAll: (urls: string[], how: string, packageName: string | null) => boolean;
	browsers: () => string[][];
	systemAccent: () => [string, string] | null;
	keyboardHeight: () => number;
};

const native = requireOptionalNativeModule<OpenLinksModule>('OpenLinks');

export type OpenHow = 'system' | 'inapp' | 'app' | 'chooser';

export function openLinksTogether(
	urls: string[],
	how: OpenHow = 'system',
	packageName?: string,
): boolean {
	return native?.openAll(urls, how, packageName ?? null) ?? false;
}

export function installedBrowsers(): Array<{
	id: string;
	name: string;
	icon?: string;
}> {
	return (native?.browsers() ?? []).map(([id, name, icon]) => ({
		id,
		name,
		icon: icon ? `data:image/png;base64,${icon}` : undefined,
	}));
}

export function systemAccent(): {light: string; dark: string} | undefined {
	const found = native?.systemAccent();
	return found ? {light: found[0], dark: found[1]} : undefined;
}

export function onScreenOff(callback: () => void): (() => void) | false {
	if (!native) {
		return false;
	}

	const subscription = native.addListener('screenOff', callback);
	return () => {
		subscription.remove();
	};
}

export function nativeKeyboardHeight(): number | undefined {
	return native?.keyboardHeight();
}
