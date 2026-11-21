import {useEffect, useRef, useSyncExternalStore} from 'react';
import {
	Animated,
	Pressable,
	StyleSheet,
	Text,
	useColorScheme,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useLinkSettings} from '../library/use-link-settings';
import {usePreferences} from '../settings/preferences';
import {
	toastMs,
	type ToastDuration,
} from '../../../extension/src/shared/toast-prefs';
import {motion} from './motion';
import {useBarHeight} from './tab-bar';
import {useColors, useShape} from './theme';

type Snack = {
	id: number;
	message: string;
	actionLabel?: string;
	onAction?: () => void;
};

let current: Snack | undefined;
let counter = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
// Settings › Messages stay, kept here because showSnack is called from outside React; SnackbarHost updates it.
let duration: ToastDuration = 'default';
const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of listeners) {
		listener();
	}
};

export function showSnack(
	message: string,
	action?: {label: string; run: () => void},
): void {
	counter += 1;
	current = {
		id: counter,
		message,
		actionLabel: action?.label,
		onAction: action?.run,
	};
	clearTimeout(timer);
	const ms = toastMs(5000, duration);
	if (ms !== undefined) {
		timer = setTimeout(() => {
			current = undefined;
			emit();
		}, ms);
	}

	emit();
}

function dismiss() {
	clearTimeout(timer);
	current = undefined;
	emit();
}

/**
A short message with an optional action such as Undo, shown at the top of the screen (or above the tab bar) for a few
seconds, twice as long under Messages stay: Longer, and until dismissed under Until dismissed.
*/
export function SnackbarHost() {
	const colors = useColors();
	const {messagePosition} = usePreferences();
	// The regular library's setting, as Settings changes it, also while the private library is open.
	const links = useLinkSettings(true);
	useEffect(() => {
		duration = links.toastDuration;
	}, [links.toastDuration]);
	const barHeight = useBarHeight();
	const shape = useShape();
	const insets = useSafeAreaInsets();
	const snack = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => current,
	);
	const shown = useRef(new Animated.Value(0)).current;
	const lastRef = useRef<Snack | undefined>(undefined);
	if (snack) {
		lastRef.current = snack;
	}

	useEffect(() => {
		Animated.timing(shown, {
			toValue: snack ? 1 : 0,
			duration: motion(180),
			useNativeDriver: true,
		}).start();
	}, [snack, shown]);

	// The bar is dark, so its action needs a light color: the accent in dark theme (a pale tone there), its tint in light.
	const actionColor =
		useColorScheme() === 'dark' ? colors.accent : colors.accentSoft;
	const view = snack ?? lastRef.current;
	if (!view) {
		return null;
	}

	return (
		<Animated.View
			pointerEvents={snack ? 'box-none' : 'none'}
			accessibilityLiveRegion="polite"
			style={[
				styles.wrap,
				{
					...(messagePosition === 'bottom'
						? {bottom: insets.bottom + barHeight + 28}
						: {top: insets.top + 8}),
					opacity: shown,
					transform: [
						{
							translateY: shown.interpolate({
								inputRange: [0, 1],
								outputRange: [messagePosition === 'bottom' ? 24 : -24, 0],
							}),
						},
					],
				},
			]}
		>
			<Animated.View
				style={[
					styles.bar,
					{
						backgroundColor: '#322f3a',
						borderRadius: shape.ios ? 14 : 8,
					},
				]}
			>
				<Pressable
					accessibilityRole="button"
					accessibilityHint="Dismisses the message"
					style={styles.messageArea}
					onPress={dismiss}
				>
					<Text style={styles.message}>{view.message}</Text>
				</Pressable>
				{view.actionLabel && (
					<Pressable
						accessibilityRole="button"
						style={styles.action}
						onPress={() => {
							view.onAction?.();
							dismiss();
						}}
					>
						<Text style={[styles.actionLabel, {color: actionColor}]}>
							{view.actionLabel}
						</Text>
					</Pressable>
				)}
			</Animated.View>
		</Animated.View>
	);
}

const styles = StyleSheet.create({
	wrap: {position: 'absolute', left: 12, right: 12},
	bar: {
		minHeight: 48,
		flexDirection: 'row',
		alignItems: 'center',
		paddingLeft: 16,
		elevation: 6,
	},
	messageArea: {flex: 1},
	message: {color: '#ffffff', fontSize: 14, paddingVertical: 12},
	action: {
		minHeight: 48,
		minWidth: 64,
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: 16,
	},
	actionLabel: {fontWeight: '700', fontSize: 14},
});
