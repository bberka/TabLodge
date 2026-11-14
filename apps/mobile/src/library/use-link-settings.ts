import {useMemo} from 'react';
import {type LinkSettings, linkSettings} from './links';
import {useLibrary, useRegularLibrary} from './library-store';

/**
The synced extension settings this app follows, with defaults filled in. They come from the library on screen,
or with `own` from the regular one, for the screen that changes them.
*/
export function useLinkSettings(own = false): LinkSettings {
	const shown = useLibrary();
	const regular = useRegularLibrary();
	const {settings} = own ? regular : shown;
	return useMemo(() => linkSettings(settings), [settings]);
}
