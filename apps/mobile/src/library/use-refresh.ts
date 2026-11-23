import {useState} from 'react';
import {syncPrivate} from '../private/private-library';
import {refreshStatus, syncClient} from './library-store';
import {useView} from './view';

export function useRefresh() {
	const view = useView();
	const [refreshing, setRefreshing] = useState(false);
	const refresh = async () => {
		setRefreshing(true);
		try {
			await (view === 'private' ? syncPrivate() : syncClient.syncNow());
		} catch {
		} finally {
			await refreshStatus();
			setRefreshing(false);
		}
	};

	return {refreshing, refresh};
}
