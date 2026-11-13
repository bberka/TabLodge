import {useEffect, useState} from 'react';
import {Image, StyleSheet, View} from 'react-native';
import {SYNC_CONFIG_KEY} from '../../src/shared/sync/client';
import {useSyncStatus} from './library-store';
import {usePreferences} from './preferences';
import {readJson} from './storage';
import {Avatar} from './ui';

type Source = {uri: string; headers?: Record<string, string>};

// The server address and token are read once per address, not once per row.
let tokenCache: {url: string; token: Promise<string | undefined>} | undefined;

function serverToken(url: string): Promise<string | undefined> {
	if (tokenCache?.url !== url) {
		tokenCache = {url, token: readToken()};
	}

	return tokenCache.token;
}

async function readToken(): Promise<string | undefined> {
	const saved = await readJson(SYNC_CONFIG_KEY);
	const token = (saved as {token?: unknown} | undefined)?.token;
	return typeof token === 'string' ? token : undefined;
}

/**
Where to get a site's icon: the sync server when one is connected, otherwise the site's own favicon. Undefined while
the token is still being read, and when icons are off.
*/
function useIconSource(host: string): Source | undefined {
	const {siteIcons} = usePreferences();
	const {connected, url} = useSyncStatus();
	const [token, setToken] = useState<string>();
	useEffect(() => {
		let live = true;
		if (siteIcons && connected && url) {
			void serverToken(url).then((found) => {
				if (live) {
					setToken(found);
				}
			});
		}

		return () => {
			live = false;
		};
	}, [siteIcons, connected, url]);
	if (!siteIcons || !/^[\da-z][\d\-.a-z]*\.[\d\-a-z]{2,}$/i.test(host)) {
		return undefined;
	}

	if (connected && url) {
		return token
			? {
					uri: `${url}/v1/icon?host=${encodeURIComponent(host)}`,
					headers: {Authorization: `Bearer ${token}`},
				}
			: undefined;
	}

	return {uri: `https://${host}/favicon.ico`};
}

/**
A site's icon over its letter tile. The tile stays until the icon has loaded, and for good when it never does.
*/
export function SiteIcon({host, size = 40}: {host: string; size?: number}) {
	const source = useIconSource(host);
	const [loaded, setLoaded] = useState(false);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		setLoaded(false);
		setFailed(false);
	}, [host, source?.uri]);
	return (
		<View style={{width: size, height: size}}>
			<Avatar host={host} size={size} />
			{source && !failed && (
				<Image
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					source={source}
					resizeMode="contain"
					style={[
						styles.icon,
						{
							width: size,
							height: size,
							borderRadius: size / 2,
							opacity: loaded ? 1 : 0,
						},
					]}
					onLoad={() => {
						setLoaded(true);
					}}
					onError={() => {
						setFailed(true);
					}}
				/>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	icon: {position: 'absolute', backgroundColor: '#ffffff', padding: 6},
});
