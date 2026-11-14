import {requireOptionalNativeModule} from 'expo';

type OpenLinksModule = {
	openAll: (urls: string[]) => boolean;
	systemAccent: () => [string, string] | null;
};

const native = requireOptionalNativeModule<OpenLinksModule>('OpenLinks');

/**
Opens every link in the default browser in one go. Returns false when this build has no native support, or the
system refused, so the caller can fall back to opening them one at a time.
*/
export function openLinksTogether(urls: string[]): boolean {
	return native?.openAll(urls) ?? false;
}

/**
The phone's accent color as a light and a dark `#rrggbb`, or undefined on a build without native support and on
Android before 12.
*/
export function systemAccent(): {light: string; dark: string} | undefined {
	const found = native?.systemAccent();
	return found ? {light: found[0], dark: found[1]} : undefined;
}
