import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {
	Animated,
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {keyboardInset, settleKeyboard} from './keyboard';
import {motion} from './motion';
import {TARGET, useColors, useShape} from './theme';

export type DialogAction = {
	label: string;
	/**
	`cancel` is also what the back button and a tap outside do. `destructive` is drawn in the danger color.
	*/
	kind?: 'default' | 'cancel' | 'destructive';
	run?: () => void;
};

type Dialog = {
	id: number;
	title: string;
	message?: string;
	actions: DialogAction[];
};

let current: Dialog | undefined;
let counter = 0;
const listeners = new Set<() => void>();

const emit = () => {
	for (const listener of listeners) {
		listener();
	}
};

/**
Shows a centered dialog over the app, in place of the system alert. Every action closes it, then runs. Needs
`DialogHost` mounted once.
*/
export function showDialog(
	title: string,
	message: string | undefined,
	actions: DialogAction[],
): void {
	counter += 1;
	current = {id: counter, title, message, actions};
	emit();
}

/**
Asks a yes or no question: Cancel, and one action that runs `onConfirm`.
*/
export function confirm(
	title: string,
	message: string,
	action: {label: string; destructive?: boolean},
	onConfirm: () => void,
): void {
	showDialog(title, message, [
		{label: 'Cancel', kind: 'cancel'},
		{
			label: action.label,
			kind: action.destructive ? 'destructive' : 'default',
			run: onConfirm,
		},
	]);
}

/**
Tells the person something, with one OK.
*/
export function notify(title: string, message: string): void {
	showDialog(title, message, [{label: 'OK'}]);
}

/**
Draws the dialog `showDialog` asks for. Mount it once, near the root.
*/
export function DialogHost() {
	const asked = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => current,
	);
	// Kept after it closes so it can fade out.
	const [shown, setShown] = useState<Dialog>();
	const [open, setOpen] = useState(false);
	const progress = useRef(new Animated.Value(0)).current;
	if (asked && asked.id !== shown?.id) {
		setShown(asked);
		setOpen(true);
	}

	useEffect(() => {
		if (!open) {
			return;
		}

		settleKeyboard();
		const timer = setTimeout(settleKeyboard, 400);
		return () => {
			clearTimeout(timer);
		};
	}, [open]);

	useEffect(() => {
		Animated.timing(progress, {
			toValue: open ? 1 : 0,
			duration: motion(open ? 180 : 120),
			useNativeDriver: true,
		}).start(({finished}) => {
			if (finished && !open) {
				setShown(undefined);
			}
		});
	}, [open, progress]);

	const colors = useColors();
	const shape = useShape();
	const insets = useSafeAreaInsets();
	if (!shown) {
		return null;
	}

	const keyboard = keyboardInset();

	// While the keyboard is up the dialog centers in what is left above it, and a long message scrolls.
	const close = (action?: DialogAction) => {
		current = undefined;
		setOpen(false);
		emit();
		action?.run?.();
	};

	const cancel = shown.actions.find((action) => action.kind === 'cancel');
	const stacked =
		shown.actions.length > 2 ||
		shown.actions.reduce((sum, action) => sum + action.label.length, 0) > 28;
	return (
		<Modal
			hardwareAccelerated
			transparent
			statusBarTranslucent
			navigationBarTranslucent
			visible
			animationType="none"
			onRequestClose={() => {
				close(cancel);
			}}
		>
			<Animated.View
				style={[
					styles.root,
					{paddingTop: insets.top + 16, paddingBottom: keyboard},
				]}
			>
				<Animated.View style={[styles.scrim, {opacity: progress}]}>
					<Pressable
						accessibilityLabel="Dismiss"
						style={StyleSheet.absoluteFill}
						onPress={() => {
							close(cancel);
						}}
					/>
				</Animated.View>
				<Animated.View
					accessibilityViewIsModal
					accessibilityLabel={shown.title}
					style={[
						styles.card,
						{
							backgroundColor: colors.surface,
							borderRadius: shape.cardRadius + 8,
							opacity: progress,
							transform: [
								{
									scale: progress.interpolate({
										inputRange: [0, 1],
										outputRange: [0.92, 1],
									}),
								},
							],
						},
					]}
				>
					<Text
						accessibilityRole="header"
						style={[styles.title, {color: colors.text}]}
					>
						{shown.title}
					</Text>
					{shown.message !== undefined && (
						<ScrollView style={styles.body}>
							<Text style={[styles.message, {color: colors.muted}]}>
								{shown.message}
							</Text>
						</ScrollView>
					)}
					<View style={stacked ? styles.stack : styles.row}>
						{shown.actions.map((action) => {
							const ink =
								action.kind === 'destructive'
									? colors.danger
									: action.kind === 'cancel'
										? colors.muted
										: colors.accent;
							return (
								<Pressable
									key={action.label}
									accessibilityRole="button"
									style={({pressed}) => [
										styles.button,
										stacked && styles.stackedButton,
										{
											borderRadius: shape.buttonRadius,
											backgroundColor: pressed ? colors.pressed : 'transparent',
										},
									]}
									onPress={() => {
										close(action);
									}}
								>
									<Text style={[styles.label, {color: ink}]}>
										{action.label}
									</Text>
								</Pressable>
							);
						})}
					</View>
				</Animated.View>
			</Animated.View>
		</Modal>
	);
}

const styles = StyleSheet.create({
	root: {flex: 1, justifyContent: 'center', paddingHorizontal: 28},
	scrim: {...StyleSheet.absoluteFill, backgroundColor: '#000000aa'},
	card: {padding: 24, gap: 12, elevation: 12, maxHeight: '100%'},
	body: {flexGrow: 0},
	title: {fontSize: 20, fontWeight: '700'},
	message: {fontSize: 15, lineHeight: 21},
	row: {flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8},
	stack: {gap: 4, marginTop: 8},
	button: {
		minHeight: TARGET - 4,
		paddingHorizontal: 16,
		alignItems: 'center',
		justifyContent: 'center',
	},
	stackedButton: {alignItems: 'flex-end'},
	label: {fontSize: 15, fontWeight: '600'},
});
