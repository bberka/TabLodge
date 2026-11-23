import {requireOptionalNativeModule} from 'expo';

type QuickTilesModule = {
	clipboardText: () => Promise<string | null>;
};

const native = requireOptionalNativeModule<QuickTilesModule>('QuickTiles');

export async function readClipboard(): Promise<string> {
	return (await native?.clipboardText()) ?? '';
}
