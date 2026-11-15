import {BlurTargetView, BlurView} from 'expo-blur';
import {
	type ReactNode,
	useCallback,
	useEffect,
	useState,
	useSyncExternalStore,
} from 'react';
import {Platform, StyleSheet, useColorScheme, View} from 'react-native';
import {resolveLook, usePreferences} from '../settings/preferences';
import {BLUR_INTENSITY, type GlassKind, glassFill} from './glass-colors';
import {useColors} from './theme';

/**
The iOS look's glass: a blur of what scrolls behind a bar or button, under a translucent tint, a thin bright rim, and a
soft highlight along the top edge. It is an approximation. iOS 26's glass is a system material that bends the light
behind it; this only blurs and tints, because Android has no such material.
*/

/**
Whether to draw glass: the iOS look, with the effect on.
*/
export function useGlass(): boolean {
	const {look, glassEffect} = usePreferences();
	return resolveLook(look) === 'ios' && glassEffect;
}

// Android 12 is where the blur is cheap (a render effect on the GPU). Before it the library falls back to a slow software
// blur, so older phones get the same glass, tinted but not blurred.
const BLURS = Platform.OS === 'android' && Platform.Version >= 31;

// Android's blur radius is intensity divided by this, in dp; 25 is as far as the library goes.
const BLUR_REDUCTION = 1.6;

/**
The one view the glass blurs. Blur views are drawn from a view that holds the content, so each screen's list lives in
one, and the bar and buttons (which sit beside it) read it from here.
*/
type Target = {current: unknown; id: number};
let target: Target | undefined;
let targets = 0;
const listeners = new Set<() => void>();

function setTarget(node: unknown): void {
	if (node) {
		target = {current: node, id: ++targets};
	} else if (target) {
		target = undefined;
	} else {
		return;
	}

	for (const listener of listeners) {
		listener();
	}
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

const readTarget = () => target;

/**
Holds a screen's content so glass beside it can blur what scrolls under it. Only the iOS look has one: the Material look
draws its content directly, exactly as before.
*/
export function GlassTarget({children}: {children: ReactNode}) {
	const {look} = usePreferences();
	const colors = useColors();
	const ref = useCallback((node: unknown) => {
		setTarget(node);
	}, []);
	if (resolveLook(look) !== 'ios') {
		return <>{children}</>;
	}

	return (
		<BlurTargetView ref={ref} style={styles.target}>
			{/* The page's color, painted inside, so an empty stretch of the page blurs as the page and not as the window's black. */}
			<View style={[styles.target, {backgroundColor: colors.background}]}>
				{children}
			</View>
		</BlurTargetView>
	);
}

/**
Fills the shape it sits in (a rounded bar, a round button) with glass. The parent supplies the radius and clips with
`overflow: 'hidden'`. Draws nothing when glass is off, so the parent keeps its own solid fill.
*/
export function GlassBackdrop({
	kind,
	tint,
}: {
	kind: GlassKind;
	/**
	Fills with this color instead of the surface color (the accent button).
	*/
	tint?: string;
}) {
	const glass = useGlass();
	const colors = useColors();
	const dark = useColorScheme() === 'dark';
	const blurTarget = useSyncExternalStore(subscribe, readTarget);
	// A blur view looks its target up when it mounts, and throws if that view is already gone. Switching tabs mounts the
	// next screen's buttons while the last screen's target is still the one stored, so the blur waits for the commit,
	// by which time the stored target is the new, live one.
	const [settled, setSettled] = useState(false);
	useEffect(() => {
		setSettled(true);
	}, []);
	if (!glass) {
		return null;
	}

	const blurred = BLURS && settled && blurTarget !== undefined;
	return (
		<View pointerEvents="none" style={StyleSheet.absoluteFill}>
			{blurred && (
				<BlurView
					key={blurTarget.id}
					blurTarget={blurTarget as never}
					blurMethod="dimezisBlurViewSdk31Plus"
					intensity={BLUR_INTENSITY}
					blurReductionFactor={BLUR_REDUCTION}
					tint={dark ? 'dark' : 'light'}
					style={StyleSheet.absoluteFill}
				/>
			)}
			<View
				style={[
					StyleSheet.absoluteFill,
					{backgroundColor: glassFill(tint ?? colors.surface, kind, blurred)},
				]}
			/>
			<View
				style={[
					StyleSheet.absoluteFill,
					styles.rim,
					{
						borderColor: dark
							? 'rgba(255,255,255,0.2)'
							: 'rgba(255,255,255,0.85)',
					},
				]}
			/>
			{HIGHLIGHT.map((alpha, row) => (
				<View
					key={alpha}
					style={[
						styles.highlight,
						{
							top: row * 2,
							backgroundColor: `rgba(255,255,255,${dark ? alpha * 0.4 : alpha})`,
						},
					]}
				/>
			))}
		</View>
	);
}

// The soft light along the top edge: strips that fade from bright to nothing, clipped by the rounded shape they sit in.
const HIGHLIGHT = [0.4, 0.32, 0.25, 0.19, 0.14, 0.1, 0.07, 0.045, 0.025, 0.01];

const styles = StyleSheet.create({
	target: {flex: 1},
	rim: {borderWidth: 1, borderRadius: 999},
	highlight: {position: 'absolute', left: 0, right: 0, height: 2},
});
