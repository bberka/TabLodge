import {requireOptionalNativeModule} from 'expo';

type BookmarksWidgetModule = {
	writeSnapshot: (json: string | null) => void;
};

const native =
	requireOptionalNativeModule<BookmarksWidgetModule>('BookmarksWidget');

export function writeWidgetSnapshot(json: string | null): void {
	native?.writeSnapshot(json);
}
