import {createContext, type ReactNode, use, useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useColors} from '../../ui/theme';
import {Card, Icon, type IconName, IconButton} from '../../ui/widgets';
import {confirmResetSection, useAnyChanged} from './row-reset';
import {
	headHit,
	type Row,
	rowHit,
	type Section,
	sectionVisible,
} from './settings-index';

const QueryContext = createContext('');
const WholeCardContext = createContext(true);

export const SettingsQuery = QueryContext;

export function useRowVisible(row: Row): boolean {
	const query = use(QueryContext);
	const whole = use(WholeCardContext);
	return query === '' || whole || rowHit(row, query);
}

export function SettingsCard({
	section,
	icon,
	description,
	children,
}: {
	section: Section;
	icon: IconName;
	description?: string;
	children: ReactNode;
}) {
	const colors = useColors();
	const query = use(QueryContext);
	const whole = useMemo(
		() => query === '' || headHit(section, query) || section.rows.length === 0,
		[section, query],
	);
	const changed = useAnyChanged(section.rows);
	if (!sectionVisible(section, query)) {
		return null;
	}

	return (
		<WholeCardContext value={whole}>
			<Card flush>
				<View
					style={[
						styles.header,
						{backgroundColor: colors.background, borderColor: colors.border},
					]}
				>
					<View
						style={[
							styles.tile,
							{backgroundColor: colors.surface, borderColor: colors.border},
						]}
					>
						<Icon name={icon} size={20} color={colors.accent} />
					</View>
					<View style={styles.titles}>
						<Text
							accessibilityRole="header"
							style={[styles.title, {color: colors.text}]}
						>
							{section.title}
						</Text>
						{description !== undefined && (
							<Text style={[styles.description, {color: colors.muted}]}>
								{description}
							</Text>
						)}
					</View>
					{changed && (
						<IconButton
							icon="refresh-outline"
							label={`Reset ${section.title} to default`}
							color={colors.muted}
							onPress={() => {
								confirmResetSection(section.title, section.rows);
							}}
						/>
					)}
				</View>
				<View style={styles.body}>{children}</View>
			</Card>
		</WholeCardContext>
	);
}

const styles = StyleSheet.create({
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	tile: {
		width: 40,
		height: 40,
		borderRadius: 10,
		borderWidth: StyleSheet.hairlineWidth,
		alignItems: 'center',
		justifyContent: 'center',
	},
	titles: {flex: 1},
	title: {fontSize: 16, fontWeight: '700'},
	description: {fontSize: 13, lineHeight: 18},
	body: {padding: 16, gap: 12},
});
