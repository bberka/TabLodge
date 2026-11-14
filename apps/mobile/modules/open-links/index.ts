import {requireOptionalNativeModule} from 'expo';

type OpenLinksModule = {
	openAll: (urls: string[], how: string, packageName: string | null) => boolean;
	browsers: () => string[][];
	systemAccent: () => [string, string] | null;
};

const native = requireOptionalNativeModule<OpenLinksModule>('OpenLinks');

export type OpenHow = 'system' | 'inapp' | 'app';

/**
Opens every link in one go: in the default browser, in an in-app tab, or in the browser with this package name.
Returns false when this build has no native support, or the system refused, so the caller can fall back.
*/
export function openLinksTogether(
	urls: string[],
	how: OpenHow = 'system',
	packageName?: string,
): boolean {
	return native?.openAll(urls, how, packageName ?? null) ?? false;
}

/**
The browsers installed on this phone, or none on a build without native support.
*/
export function installedBrowsers(): Array<{id: string; name: string}> {
	return (native?.browsers() ?? []).map(([id, name]) => ({id, name}));
}

/**
The phone's accent color as a light and a dark `#rrggbb`, or undefined on a build without native support and on
Android before 12.
*/
export function systemAccent(): {light: string; dark: string} | undefined {
	const found = native?.systemAccent();
	return found ? {light: found[0], dark: found[1]} : undefined;
}

type ScreenOffEvents = {
	addListener: (
		name: 'screenOff',
		callback: () => void,
	) => {remove: () => void};
};

/**
Calls `callback` when the screen turns off, which is when the phone locks. Returns a function that stops listening;
on a build without native support it never calls back, and `false` says so.
*/
export function onScreenOff(callback: () => void): (() => void) | false {
	const emitter = native as unknown as ScreenOffEvents | undefined;
	if (!emitter?.addListener) {
		return false;
	}

	const subscription = emitter.addListener('screenOff', callback);
	return () => {
		subscription.remove();
	};
}
