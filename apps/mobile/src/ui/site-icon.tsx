import {useEffect, useState} from 'react';
import {Image, StyleSheet, View} from 'react-native';
import {SYNC_CONFIG_KEY} from '../../../extension/src/shared/sync/client';
import {USER_AGENT} from '../library/link-preview';
import {useSyncStatus} from '../library/library-store';
import {useLinkSettings} from '../library/use-link-settings';
import {readJson} from '../platform/storage';
import {Avatar} from './widgets';

type Source = {uri: string; headers?: Record<string, string>};

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

function useIconSource(host: string, always: boolean): Source | undefined {
	const {siteIcons} = useLinkSettings(true);
	const mode = always ? 'direct' : siteIcons === 'browser' ? 'off' : 'server';
	const {connected, url} = useSyncStatus();
	const [token, setToken] = useState<string>();
	useEffect(() => {
		let live = true;
		if (mode !== 'off' && connected && url) {
			void serverToken(url).then((found) => {
				if (live) {
					setToken(found);
				}
			});
		}

		return () => {
			live = false;
		};
	}, [mode, connected, url]);
	if (mode === 'off' || !/^[\da-z][\d\-.a-z]*\.[\d\-a-z]{2,}$/i.test(host)) {
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

	if (mode !== 'direct') {
		return undefined;
	}

	return {
		uri: `https://${host}/favicon.ico`,
		headers: {'User-Agent': USER_AGENT},
	};
}

export function SiteIcon({
	host,
	size = 40,
	always = false,
}: {
	host: string;
	size?: number;
	always?: boolean;
}) {
	const source = useIconSource(host, always);
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
