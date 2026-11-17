import {requireOptionalNativeModule} from 'expo';

type QuickTilesModule = {
	clipboardText: () => Promise<string | null>;
};

const native = requireOptionalNativeModule<QuickTilesModule>('QuickTiles');

/**
The clipboard's text, read once the app's window has focus, as Android 10 and newer require. Empty when the clipboard
is empty, Android refuses, or the build has no native support.
*/
export async function readClipboard(): Promise<string> {
	return (await native?.clipboardText()) ?? '';
}
