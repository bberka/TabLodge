import {writeWidgetSnapshot} from '../../modules/bookmarks-widget';
import {getPreferences, subscribePreferences} from '../settings/preferences';
import {getLibrary, subscribeLibrary} from './library-store';
import {buildWidgetSnapshot} from './widget-snapshot';

/**
Keeps the Bookmarks widget's copy of the regular library current. It is written at once on every change, since a save
from the share sheet or a tile closes the app moment later, and only when what the widget shows has changed, so a
session edit does not redraw the widgets. Call after `startLibrary`: before the saved library is read the store is
empty, and an empty library deletes the widget's copy.
*/
export function startWidgetSnapshot(): () => void {
	let last: string | null | undefined;
	const publish = () => {
		const {openWith, openApp} = getPreferences();
		const snapshot = buildWidgetSnapshot(getLibrary(), {
			how: openWith,
			app: openApp,
		});
		const text = snapshot ? JSON.stringify(snapshot) : null;
		if (text === last) {
			return;
		}

		last = text;
		writeWidgetSnapshot(text);
	};

	publish();
	const stopLibrary = subscribeLibrary(publish);
	const stopPreferences = subscribePreferences(publish);
	return () => {
		stopLibrary();
		stopPreferences();
	};
}
