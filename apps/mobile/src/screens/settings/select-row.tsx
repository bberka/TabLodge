import {type ReactNode, useState} from 'react';
import {
	Image,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import {BottomSheet} from '../../ui/bottom-sheet';
import {TARGET, useColors} from '../../ui/theme';
import {Icon, type IconName} from '../../ui/widgets';
import {useRowReset} from './row-reset';
import {useRowVisible} from './settings-card';
import type {Row} from './settings-index';

export type Choice<T extends string> = {
	id: T;
	name: string;
	hint?: string;
	icon?: IconName;
	image?: string;
	color?: string;
};

export function SelectRow<T extends string>({
	row,
	choices,
	value,
	onChange,
}: {
	row: Row;
	choices: Array<Choice<T>>;
	value: T;
	onChange: (value: T) => void;
}) {
	const [open, setOpen] = useState(false);
	const current = choices.find((choice) => choice.id === value);
	return (
		<>
			<ValueRow
				row={row}
				value={current?.name ?? ''}
				icon={current?.icon}
				image={current?.image}
				tint={current?.color}
				choices={choices}
				onPress={() => {
					setOpen(true);
				}}
			/>
			<BottomSheet
				scroll={false}
				visible={open}
				label={row.label}
				onClose={() => {
					setOpen(false);
				}}
			>
				<ChoiceList
					title={row.label}
					choices={choices}
					value={value}
					onPick={(id) => {
						setOpen(false);
						onChange(id);
					}}
				/>
			</BottomSheet>
		</>
	);
}

export function ValueRow({
	row,
	value,
	swatch,
	icon,
	image,
	tint,
	choices,
	onPress,
}: {
	row: Row;
	value: string;
	icon?: IconName;
	image?: string;
	tint?: string;
	swatch?: string;
	choices?: ReadonlyArray<{id: string; name: string}>;
	onPress: () => void;
}) {
	const colors = useColors();
	const visible = useRowVisible(row);
	const reset = useRowReset(row, choices);
	if (!visible) {
		return null;
	}

	return (
		<>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${row.label}, ${value}`}
				accessibilityHint={row.hint}
				style={({pressed}) => [
					styles.row,
					pressed && {backgroundColor: colors.pressed},
				]}
				accessibilityActions={reset.accessibilityActions}
				onPress={onPress}
				onAccessibilityAction={reset.onAccessibilityAction}
				onLongPress={reset.onLongPress}
			>
				<RowLabel label={row.label} changed={reset.changed} />
				{swatch && (
					<View
						style={[
							styles.dot,
							{backgroundColor: swatch, borderColor: colors.border},
						]}
					/>
				)}
				{image ? (
					<Image source={{uri: image}} style={styles.smallImage} />
				) : (
					icon && <Icon name={icon} size={18} color={tint ?? colors.muted} />
				)}
				<Text
					numberOfLines={1}
					style={[styles.value, {color: tint ?? colors.muted}]}
				>
					{value}
				</Text>
				<Icon name="chevron-forward" size={18} color={colors.muted} />
			</Pressable>
			{reset.sheet}
		</>
	);
}

export function RowLabel({
	label,
	changed,
	hint,
}: {
	label: string;
	changed: boolean;
	hint?: string;
}) {
	const colors = useColors();
	return (
		<View style={styles.labelBox}>
			{changed && (
				<View
					importantForAccessibility="no-hide-descendants"
					style={[styles.changed, {backgroundColor: colors.accent}]}
				/>
			)}
			<Text style={[styles.label, {color: colors.text}]}>{label}</Text>
			{hint && <Text style={{color: colors.muted}}>{hint}</Text>}
		</View>
	);
}

export function asChoices<T extends string>(
	list: ReadonlyArray<{value: T; title: string; description: string}>,
): Array<Choice<T>> {
	return list.map(({value, title, description}) => ({
		id: value,
		name: title,
		hint: description,
	}));
}

function ChoiceRows<T extends string>({
	choices,
	value,
	onPick,
}: {
	choices: Array<Choice<T>>;
	value: T;
	onPick: (id: T) => void;
}) {
	const colors = useColors();
	return choices.map((choice) => {
		const on = choice.id === value;
		return (
			<Pressable
				key={choice.id}
				accessibilityRole="radio"
				accessibilityState={{checked: on}}
				accessibilityLabel={choice.name}
				accessibilityHint={choice.hint}
				style={({pressed}) => [
					styles.choice,
					pressed && {backgroundColor: colors.pressed},
				]}
				onPress={() => {
					onPick(choice.id);
				}}
			>
				{choice.image ? (
					<Image source={{uri: choice.image}} style={styles.image} />
				) : (
					choice.icon && (
						<Icon
							name={choice.icon}
							size={22}
							color={choice.color ?? colors.muted}
						/>
					)
				)}
				<View style={styles.choiceText}>
					<Text
						style={{
							color: choice.color ?? colors.text,
							fontSize: 16,
							fontWeight: on ? '700' : '400',
						}}
					>
						{choice.name}
					</Text>
					{choice.hint && (
						<Text style={{color: colors.muted}}>{choice.hint}</Text>
					)}
				</View>
				{on && <Icon name="checkmark" size={22} color={colors.accent} />}
			</Pressable>
		);
	});
}

export function ChoiceGroup<T extends string>({
	title,
	choices,
	value,
	onPick,
}: {
	title: string;
	choices: Array<Choice<T>>;
	value: T;
	onPick: (id: T) => void;
}) {
	const colors = useColors();
	return (
		<View>
			<Text style={{color: colors.muted}}>{title}</Text>
			<View accessibilityRole="radiogroup" accessibilityLabel={title}>
				<ChoiceRows choices={choices} value={value} onPick={onPick} />
			</View>
		</View>
	);
}

export function ChoiceList<T extends string>({
	title,
	choices,
	value,
	onPick,
	footer,
}: {
	title: string;
	choices: Array<Choice<T>>;
	value: T;
	onPick: (id: T) => void;
	footer?: ReactNode;
}) {
	const colors = useColors();
	return (
		<View style={styles.fill}>
			<Text
				accessibilityRole="header"
				style={[styles.title, {color: colors.text}]}
			>
				{title}
			</Text>
			<ScrollView
				style={styles.list}
				accessibilityRole="radiogroup"
				keyboardShouldPersistTaps="handled"
			>
				<ChoiceRows choices={choices} value={value} onPick={onPick} />
			</ScrollView>
			{footer}
		</View>
	);
}

const styles = StyleSheet.create({
	row: {
		borderRadius: 12,
		minHeight: TARGET,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		marginVertical: -4,
		paddingHorizontal: 12,
		marginHorizontal: -12,
	},
	labelBox: {flex: 1},
	label: {fontSize: 16},
	changed: {
		position: 'absolute',
		left: -14,
		top: 8,
		width: 8,
		height: 8,
		borderRadius: 4,
	},
	value: {maxWidth: '50%', fontSize: 15},
	dot: {width: 16, height: 16, borderRadius: 8, borderWidth: 1},
	smallImage: {width: 20, height: 20, borderRadius: 5},
	image: {width: 32, height: 32, borderRadius: 8},
	title: {
		fontSize: 20,
		fontWeight: '700',
		paddingHorizontal: 20,
		paddingBottom: 6,
	},
	list: {flexGrow: 0, flexShrink: 1},
	choice: {
		borderRadius: 12,
		minHeight: TARGET + 8,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 16,
		paddingHorizontal: 20,
		paddingVertical: 8,
	},
	choiceText: {flex: 1},
	fill: {flexShrink: 1},
});
