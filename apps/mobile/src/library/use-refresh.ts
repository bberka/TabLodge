import {useState} from 'react';
import {syncPrivate} from '../private/private-library';
import {refreshStatus, syncClient} from './library-store';
import {useView} from './view';

/**
Pull to refresh for a list: syncs the library on screen (the private one while it is open) and says when it is done.
*/
export function useRefresh() {
	const view = useView();
	const [refreshing, setRefreshing] = useState(false);
	const refresh = async () => {
		setRefreshing(true);
		try {
			await (view === 'private' ? syncPrivate() : syncClient.syncNow());
		} catch {
			// The status card in Settings shows why.
		} finally {
			await refreshStatus();
			setRefreshing(false);
		}
	};

	return {refreshing, refresh};
}
