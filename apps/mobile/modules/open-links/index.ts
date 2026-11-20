import {requireOptionalNativeModule} from 'expo';

type OpenLinksModule = {
	// Native modules are event emitters; this one sends `screenOff`.
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

/**
Opens every link in one go: in the default browser, in an in-app tab, in the browser with this package name, or
through Android's chooser, which asks which app takes each link.
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
export function installedBrowsers(): Array<{
	id: string;
	name: string;
	/**
	The app's icon as a `data:` address, or undefined when it could not be read.
	*/
	icon?: string;
}> {
	return (native?.browsers() ?? []).map(([id, name, icon]) => ({
		id,
		name,
		icon: icon ? `data:image/png;base64,${icon}` : undefined,
	}));
}

/**
The phone's accent color as a light and a dark `#rrggbb`, or undefined on a build without native support and on
Android before 12.
*/
export function systemAccent(): {light: string; dark: string} | undefined {
	const found = native?.systemAccent();
	return found ? {light: found[0], dark: found[1]} : undefined;
}

/**
Calls `callback` when the screen turns off, which is when the phone locks. Returns a function that stops listening;
on a build without native support it never calls back, and `false` says so.
*/
export function onScreenOff(callback: () => void): (() => void) | false {
	if (!native) {
		return false;
	}

	const subscription = native.addListener('screenOff', callback);
	return () => {
		subscription.remove();
	};
}

/**
How much of the screen's bottom the on-screen keyboard covers right now, in dp, read from the window itself, or
undefined on a build without native support. The keyboard's show and hide events can be missed; this cannot.
*/
export function nativeKeyboardHeight(): number | undefined {
	return native?.keyboardHeight();
}
