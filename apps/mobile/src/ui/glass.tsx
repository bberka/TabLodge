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

export function useGlass(): boolean {
	const {look, glassEffect} = usePreferences();
	return resolveLook(look) === 'ios' && glassEffect;
}

const BLURS = Platform.OS === 'android' && Platform.Version >= 31;

const BLUR_REDUCTION = 1.6;

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
			{}
			<View style={[styles.target, {backgroundColor: colors.background}]}>
				{children}
			</View>
		</BlurTargetView>
	);
}

export function GlassBackdrop({kind, tint}: {kind: GlassKind; tint?: string}) {
	const glass = useGlass();
	const colors = useColors();
	const dark = useColorScheme() === 'dark';
	const blurTarget = useSyncExternalStore(subscribe, readTarget);
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

const HIGHLIGHT = [0.4, 0.32, 0.25, 0.19, 0.14, 0.1, 0.07, 0.045, 0.025, 0.01];

const styles = StyleSheet.create({
	target: {flex: 1},
	rim: {borderWidth: 1, borderRadius: 999},
	highlight: {position: 'absolute', left: 0, right: 0, height: 2},
});
