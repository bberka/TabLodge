import {useMemo} from 'react';
import {type LinkSettings, linkSettings} from './links';
import {useLibrary, useRegularLibrary} from './library-store';

export function useLinkSettings(own = false): LinkSettings {
	const shown = useLibrary();
	const regular = useRegularLibrary();
	const {settings} = own ? regular : shown;
	return useMemo(() => linkSettings(settings), [settings]);
}
