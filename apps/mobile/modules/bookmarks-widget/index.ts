import {requireOptionalNativeModule} from 'expo';

type BookmarksWidgetModule = {
	writeSnapshot: (json: string | null) => void;
};

const native =
	requireOptionalNativeModule<BookmarksWidgetModule>('BookmarksWidget');

/**
Hands the Bookmarks widget its copy of the library (`src/library/widget-snapshot.ts`), or deletes it with `null`, and
redraws every placed widget. Does nothing on a build without native support.
*/
export function writeWidgetSnapshot(json: string | null): void {
	native?.writeSnapshot(json);
}
