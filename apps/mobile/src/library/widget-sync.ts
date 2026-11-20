import {writeWidgetSnapshot} from '../../modules/bookmarks-widget';
import {getPreferences, subscribePreferences} from '../settings/preferences';
import {getLibrary, subscribeLibrary} from './library-store';
import {buildWidgetSnapshot} from './widget-snapshot';

let last: string | null | undefined;

/**
Hands the Bookmarks widget a copy of the regular library as it is now, unless it is the copy this process wrote last.
Call after the saved library is read: before that the store is empty, and an empty library deletes the widget's copy.
*/
export function publishWidgetSnapshot(): void {
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
}

/**
Keeps the Bookmarks widget's copy of the regular library current. It is written at once on every change, since a save
from the share sheet or a tile closes the app moment later, and only when what the widget shows has changed, so a
session edit does not redraw the widgets.
*/
export function startWidgetSnapshot(): () => void {
	publishWidgetSnapshot();
	const stopLibrary = subscribeLibrary(publishWidgetSnapshot);
	const stopPreferences = subscribePreferences(publishWidgetSnapshot);
	return () => {
		stopLibrary();
		stopPreferences();
	};
}
