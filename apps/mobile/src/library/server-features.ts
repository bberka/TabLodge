import {useEffect, useState} from 'react';
import {SYNC_CONFIG_KEY} from '../../../extension/src/shared/sync/client';
import {readJson} from '../platform/storage';
import {useSyncStatus} from './library-store';

// What each server address said it can do, asked once, so a screen of settings does not ask again for every row.
const known = new Map<string, Promise<readonly string[] | undefined>>();

async function ask(url: string): Promise<readonly string[] | undefined> {
	const saved = await readJson(SYNC_CONFIG_KEY);
	const token = (saved as {token?: unknown} | undefined)?.token;
	if (typeof token !== 'string') {
		return undefined;
	}

	try {
		const response = await fetch(`${url}/v1/status`, {
			headers: [['Authorization', `Bearer ${token}`]],
		});
		if (!response.ok) {
			return undefined;
		}

		const body = (await response.json()) as {features?: unknown};
		// A server old enough to have no list at all supports none of the optional parts.
		return Array.isArray(body.features)
			? body.features.filter(
					(feature): feature is string => typeof feature === 'string',
				)
			: [];
	} catch {
		return undefined;
	}
}

/**
The optional parts the connected server has (`private`, `key`, `preview`), or undefined while it is not known: not
connected, not asked yet, or the server could not be reached. Site icons and previews need `preview`.
*/
export function useServerFeatures(): readonly string[] | undefined {
	const {connected, url} = useSyncStatus();
	const [features, setFeatures] = useState<readonly string[]>();
	useEffect(() => {
		if (!connected || !url) {
			setFeatures(undefined);
			return;
		}

		let live = true;
		let found = known.get(url);
		if (!found) {
			found = ask(url);
			known.set(url, found);
		}

		void found.then((result) => {
			if (result === undefined) {
				// Not answered: ask again next time.
				known.delete(url);
			}

			if (live) {
				setFeatures(result);
			}
		});
		return () => {
			live = false;
		};
	}, [connected, url]);
	return features;
}
