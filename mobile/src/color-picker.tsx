import {useState} from 'react';
import {
	type AccessibilityActionEvent,
	type GestureResponderEvent,
	type LayoutChangeEvent,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import {ACCENTS, isColumnColor} from '../../src/shared/accent-colors';
import {hexToHsl, hslToHex} from '../../src/shared/color-math';
import {TARGET, useColors} from './theme';
import {Field, Icon, type IconName} from './ui';

export type LeadingChoice = {
	id: string;
	label: string;
	icon: IconName;
	/**
	The color it stands for, drawn as the swatch; without one the swatch is plain.
	*/
	hex?: string;
};

const NO_COLOR: LeadingChoice[] = [
	{id: '', label: 'No color', icon: 'ban-outline'},
];

const SWATCH = 40;
const HEX = /^#[\da-f]{6}$/i;
const BAR_HEIGHT = 36;
const THUMB = 28;
const SEGMENTS = 64;
const SATURATION = 0.7;
// The shade bar runs from a deep to a pale version of the hue.
const DARKEST = 0.25;
const LIGHTEST = 0.82;
const STEP = 0.05;

const lightnessAt = (shade: number) => DARKEST + (LIGHTEST - DARKEST) * shade;
const shadeOf = (lightness: number) =>
	Math.min(1, Math.max(0, (lightness - DARKEST) / (LIGHTEST - DARKEST)));
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
A bar of color you drag along or tap, with a thumb. A screen reader steps it with increase and decrease. The color is
sent while dragging only as the bar's position; `onDone` fires when the finger lifts, so one drag is one change.
*/
function ColorBar({
	label,
	valueText,
	colors,
	position,
	onMove,
	onDone,
}: {
	label: string;
	valueText: string;
	colors: string[];
	position: number;
	onMove: (position: number) => void;
	onDone: (position: number) => void;
}) {
	const theme = useColors();
	const [width, setWidth] = useState(0);
	const at = (event: GestureResponderEvent) =>
		width > 0 ? clamp(event.nativeEvent.locationX / width) : position;
	const step = (event: AccessibilityActionEvent) => {
		const next = clamp(
			position + (event.nativeEvent.actionName === 'increment' ? STEP : -STEP),
		);
		onMove(next);
		onDone(next);
	};

	return (
		<View
			accessible
			accessibilityRole="adjustable"
			accessibilityLabel={label}
			accessibilityValue={{text: valueText}}
			accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
			style={styles.bar}
			onAccessibilityAction={step}
			onLayout={(event: LayoutChangeEvent) => {
				setWidth(event.nativeEvent.layout.width);
			}}
			onStartShouldSetResponder={() => true}
			onMoveShouldSetResponder={() => true}
			onResponderTerminationRequest={() => false}
			onResponderGrant={(event) => {
				onMove(at(event));
			}}
			onResponderMove={(event) => {
				onMove(at(event));
			}}
			onResponderRelease={(event) => {
				onDone(at(event));
			}}
		>
			<View pointerEvents="none" style={styles.segments}>
				{colors.map((color, index) => (
					<View key={index} style={{flex: 1, backgroundColor: color}} />
				))}
			</View>
			<View
				pointerEvents="none"
				style={[
					styles.thumb,
					{
						left: position * Math.max(0, width - THUMB),
						borderColor: theme.text,
					},
				]}
			/>
		</View>
	);
}

/**
The colors a bookmark column or session can have: the extension's accent palette, or any color made with the hue and
shade bars (or typed as `#rrggbb`). Choosing the selected one again, or None, clears it. The value is a preset id or a
lower case hex, the same text the extension stores.
*/
export function ColorPicker({
	selected,
	onSelect,
	leading = NO_COLOR,
	keepSelected = false,
}: {
	selected: string;
	onSelect: (color: string) => void;
	/**
	The choices before the palette. Colors of a column or session start with "No color"; the app's accent starts with the
	phone's color and TabLodge's own.
	*/
	leading?: LeadingChoice[];
	/**
	Choosing the selected color again keeps it, instead of clearing it.
	*/
	keepSelected?: boolean;
}) {
	const colors = useColors();
	const custom = selected.startsWith('#') && isColumnColor(selected);
	const [open, setOpen] = useState(custom);
	const [initial] = useState<[number, number, number]>(() =>
		custom ? hexToHsl(selected) : [250, SATURATION, 0.5],
	);
	const [hue, setHue] = useState(initial[0]);
	const [shade, setShade] = useState(() => shadeOf(initial[2]));
	const [typed, setTyped] = useState(custom ? selected : '');
	const bad = typed !== '' && !HEX.test(typed);
	const preview = hslToHex(hue, SATURATION, lightnessAt(shade));
	const lead = leading.find((choice) => choice.id === selected);
	const name =
		lead?.label ??
		ACCENTS.find((accent) => accent.id === selected)?.label ??
		(custom ? `Custom ${selected}` : 'This color is not available');
	const commit = (nextHue: number, nextShade: number) => {
		const hex = hslToHex(nextHue, SATURATION, lightnessAt(nextShade));
		setTyped(hex);
		onSelect(hex);
	};

	return (
		<View style={styles.group}>
			<View
				accessible
				accessibilityLiveRegion="polite"
				style={styles.selection}
			>
				<View
					style={[
						styles.dot,
						{
							backgroundColor: custom
								? selected
								: (lead?.hex ??
									ACCENTS.find((accent) => accent.id === selected)?.hex ??
									colors.surface),
							borderColor: colors.border,
						},
					]}
				/>
				<Text style={{color: colors.text, fontWeight: '600'}}>{name}</Text>
			</View>
			<View accessibilityRole="radiogroup" style={styles.swatches}>
				{leading.map((choice) => {
					const on = selected === choice.id;
					return (
						<Pressable
							key={choice.id}
							accessibilityRole="radio"
							accessibilityLabel={choice.label}
							accessibilityState={{selected: on}}
							hitSlop={4}
							style={[
								styles.swatch,
								{
									borderColor: on ? colors.accent : colors.border,
									backgroundColor: choice.hex ?? colors.surface,
								},
							]}
							onPress={() => {
								setTyped('');
								onSelect(choice.id);
							}}
						>
							<Icon
								name={choice.icon}
								size={20}
								color={choice.hex ? '#ffffff' : colors.muted}
							/>
						</Pressable>
					);
				})}
				{ACCENTS.map((accent) => {
					const on = selected === accent.id;
					return (
						<Pressable
							key={accent.id}
							accessibilityRole="radio"
							accessibilityLabel={accent.label}
							accessibilityState={{selected: on}}
							hitSlop={4}
							style={[
								styles.swatch,
								{
									backgroundColor: accent.hex,
									borderColor: on ? colors.text : 'transparent',
								},
							]}
							onPress={() => {
								setTyped('');
								onSelect(on && !keepSelected ? '' : accent.id);
							}}
						>
							{on && <Icon name="checkmark" size={20} color="#ffffff" />}
						</Pressable>
					);
				})}
				<Pressable
					accessibilityRole="radio"
					accessibilityLabel="Custom color"
					accessibilityState={{selected: custom, expanded: open}}
					hitSlop={4}
					style={[
						styles.swatch,
						{
							backgroundColor: custom ? selected : colors.surface,
							borderColor: custom ? colors.text : colors.border,
						},
					]}
					onPress={() => {
						setOpen((value) => !value);
					}}
				>
					<Icon
						name="color-palette"
						size={20}
						color={custom ? '#ffffff' : colors.accent}
					/>
				</Pressable>
			</View>
			{open && (
				<View style={styles.panel}>
					<ColorBar
						label="Hue"
						valueText={`${Math.round(hue)} degrees`}
						colors={Array.from({length: SEGMENTS}, (_, index) =>
							hslToHex((index / (SEGMENTS - 1)) * 360, SATURATION, 0.5),
						)}
						position={hue / 360}
						onMove={(position) => {
							setHue(position * 360);
						}}
						onDone={(position) => {
							commit(position * 360, shade);
						}}
					/>
					<ColorBar
						label="Shade"
						valueText={`${Math.round(shade * 100)} percent`}
						colors={Array.from({length: SEGMENTS}, (_, index) =>
							hslToHex(hue, SATURATION, lightnessAt(index / (SEGMENTS - 1))),
						)}
						position={shade}
						onMove={setShade}
						onDone={(position) => {
							commit(hue, position);
						}}
					/>
					<View style={styles.hexRow}>
						<View
							style={[
								styles.dot,
								{backgroundColor: preview, borderColor: colors.border},
							]}
						/>
						<View style={{flex: 1}}>
							<Field
								label="Hex code"
								placeholder="#6254d7"
								value={typed}
								autoCapitalize="none"
								autoCorrect={false}
								maxLength={7}
								error={bad ? 'Use a color like #6254d7.' : undefined}
								onChangeText={(text) => {
									const value =
										text.startsWith('#') || text === '' ? text : `#${text}`;
									setTyped(value);
									if (!HEX.test(value)) {
										return;
									}

									const [nextHue, , lightness] = hexToHsl(value);
									setHue(nextHue);
									setShade(shadeOf(lightness));
									onSelect(value.toLowerCase());
								}}
							/>
						</View>
					</View>
				</View>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	group: {gap: 12},
	selection: {flexDirection: 'row', alignItems: 'center', gap: 10},
	dot: {width: 22, height: 22, borderRadius: 11, borderWidth: 1},
	swatches: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
	swatch: {
		width: Math.max(SWATCH, TARGET - 8),
		height: Math.max(SWATCH, TARGET - 8),
		borderRadius: 999,
		borderWidth: 2,
		alignItems: 'center',
		justifyContent: 'center',
	},
	panel: {gap: 14},
	bar: {height: BAR_HEIGHT, justifyContent: 'center'},
	segments: {
		flexDirection: 'row',
		height: BAR_HEIGHT - 8,
		borderRadius: 999,
		overflow: 'hidden',
	},
	thumb: {
		position: 'absolute',
		top: (BAR_HEIGHT - THUMB) / 2,
		width: THUMB,
		height: THUMB,
		borderRadius: THUMB / 2,
		borderWidth: 3,
		backgroundColor: '#ffffff',
	},
	hexRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 10},
});
