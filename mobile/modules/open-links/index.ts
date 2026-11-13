import {requireOptionalNativeModule} from 'expo';

type OpenLinksModule = {openAll: (urls: string[]) => boolean};

const native = requireOptionalNativeModule<OpenLinksModule>('OpenLinks');

/**
Opens every link in the default browser in one go. Returns false when this build has no native support, or the
system refused, so the caller can fall back to opening them one at a time.
*/
export function openLinksTogether(urls: string[]): boolean {
	return native?.openAll(urls) ?? false;
}
