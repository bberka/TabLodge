import {writeWidgetSnapshot} from '../../modules/bookmarks-widget';
import {getPreferences, subscribePreferences} from '../settings/preferences';
import {getLibrary, subscribeLibrary} from './library-store';
import {buildWidgetSnapshot} from './widget-snapshot';

let last: string | null | undefined;

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

export function startWidgetSnapshot(): () => void {
	publishWidgetSnapshot();
	const stopLibrary = subscribeLibrary(publishWidgetSnapshot);
	const stopPreferences = subscribePreferences(publishWidgetSnapshot);
	return () => {
		stopLibrary();
		stopPreferences();
	};
}
