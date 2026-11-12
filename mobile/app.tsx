import {ShareIntentProvider, useShareIntentContext} from 'expo-share-intent';
import {StatusBar} from 'expo-status-bar';
import {useEffect, useState} from 'react';
import {AppState, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {startLibrary, syncClient} from './src/library-store';
import {BookmarksScreen} from './src/screens/bookmarks';
import {SaveLinkScreen} from './src/screens/save-link';
import {SessionsScreen} from './src/screens/sessions';
import {SettingsScreen} from './src/screens/settings';
import {TARGET, useColors} from './src/theme';
import {Icon, type IconName} from './src/ui';

type Tab = 'bookmarks' | 'sessions' | 'settings';
const TABS: Array<{id: Tab; label: string; icon: IconName; active: IconName}> =
	[
		{
			id: 'bookmarks',
			label: 'Bookmarks',
			icon: 'bookmark-outline',
			active: 'bookmark',
		},
		{
			id: 'sessions',
			label: 'Sessions',
			icon: 'albums-outline',
			active: 'albums',
		},
		{
			id: 'settings',
			label: 'Settings',
			icon: 'settings-outline',
			active: 'settings',
		},
	];

function Main() {
	const colors = useColors();
	const {hasShareIntent, shareIntent, resetShareIntent} =
		useShareIntentContext();
	const [tab, setTab] = useState<Tab>('bookmarks');
	const [adding, setAdding] = useState(false);

	useEffect(() => {
		void startLibrary();
		const subscription = AppState.addEventListener('change', (state) => {
			if (state === 'active') {
				void syncClient.wake().catch(() => undefined);
			}
		});
		return () => {
			subscription.remove();
		};
	}, []);

	const saving = adding || hasShareIntent;
	const close = () => {
		setAdding(false);
		resetShareIntent();
	};

	return (
		<SafeAreaView style={[styles.screen, {backgroundColor: colors.background}]}>
			<StatusBar style="auto" />
			{saving ? (
				<SaveLinkScreen
					key={shareIntent.webUrl ?? shareIntent.text ?? 'new'}
					initialText={shareIntent.webUrl ?? shareIntent.text ?? ''}
					initialTitle={shareIntent.meta?.title ?? ''}
					onDone={close}
				/>
			) : (
				<>
					<View style={styles.body}>
						{tab === 'bookmarks' && (
							<BookmarksScreen
								onAdd={() => {
									setAdding(true);
								}}
							/>
						)}
						{tab === 'sessions' && <SessionsScreen />}
						{tab === 'settings' && <SettingsScreen />}
					</View>
					<View
						accessibilityRole="tablist"
						style={[
							styles.bar,
							{borderColor: colors.border, backgroundColor: colors.surface},
						]}
					>
						{TABS.map((item) => {
							const on = item.id === tab;
							return (
								<Pressable
									key={item.id}
									accessibilityRole="tab"
									accessibilityState={{selected: on}}
									android_ripple={{color: colors.pressed}}
									style={styles.tab}
									onPress={() => {
										setTab(item.id);
									}}
								>
									<View
										style={[
											styles.pill,
											on && {backgroundColor: colors.accentSoft},
										]}
									>
										<Icon
											name={on ? item.active : item.icon}
											color={on ? colors.accent : colors.muted}
										/>
									</View>
									<Text
										style={{
											color: on ? colors.accent : colors.muted,
											fontWeight: on ? '700' : '500',
											fontSize: 12,
										}}
									>
										{item.label}
									</Text>
								</Pressable>
							);
						})}
					</View>
				</>
			)}
		</SafeAreaView>
	);
}

export default function App() {
	return (
		<ShareIntentProvider>
			<Main />
		</ShareIntentProvider>
	);
}

const styles = StyleSheet.create({
	screen: {flex: 1},
	body: {flex: 1},
	bar: {flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth},
	tab: {
		flex: 1,
		minHeight: TARGET + 16,
		alignItems: 'center',
		justifyContent: 'center',
		gap: 2,
	},
	pill: {
		width: 64,
		height: 32,
		borderRadius: 16,
		alignItems: 'center',
		justifyContent: 'center',
	},
});
