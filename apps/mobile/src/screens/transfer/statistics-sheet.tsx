import {useMemo} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {BottomSheet} from '../../ui/bottom-sheet';
import {useColors} from '../../ui/theme';
import {Icon, type IconName} from '../../ui/ui';
import {libraryStats} from '../../library/library';
import {useLibrary} from '../../library/library-store';
import {useView} from '../../library/view';

function Tile({
	icon,
	value,
	label,
}: {
	icon: IconName;
	value: number;
	label: string;
}) {
	const colors = useColors();
	return (
		<View
			accessible
			accessibilityLabel={`${value.toLocaleString()} ${label}`}
			style={[
				styles.tile,
				{backgroundColor: colors.surface, borderColor: colors.border},
			]}
		>
			<View style={[styles.tileIcon, {backgroundColor: colors.accentSoft}]}>
				<Icon name={icon} size={20} color={colors.accent} />
			</View>
			<Text style={[styles.value, {color: colors.text}]}>
				{value.toLocaleString()}
			</Text>
			<Text style={{color: colors.muted}}>{label}</Text>
		</View>
	);
}

/**
What is saved, at a glance: counts in tiles, the sites that hold the most links with a bar each, and the largest
session. The phone cannot list a browser's open tabs, so this is only what is saved.
*/
export function StatisticsSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const colors = useColors();
	const store = useLibrary();
	const view = useView();
	const stats = useMemo(() => libraryStats(store), [store]);
	const top = stats.topSites[0]?.count ?? 1;
	return (
		<BottomSheet
			scroll={false}
			visible={visible}
			label="Statistics"
			onClose={onClose}
		>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.body}
				showsVerticalScrollIndicator={false}
			>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					Statistics
				</Text>
				<Text style={{color: colors.muted}}>
					{view === 'private' ? 'The private library' : 'This phone'}
					{stats.since
						? ` · saved since ${new Date(stats.since).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'})}`
						: ''}
				</Text>
				<View style={styles.grid}>
					<Tile icon="albums-outline" value={stats.sessions} label="Sessions" />
					<Tile icon="link-outline" value={stats.tabs} label="Saved tabs" />
					<Tile
						icon="bookmark-outline"
						value={stats.bookmarks}
						label="Bookmarks"
					/>
					<Tile icon="layers-outline" value={stats.columns} label="Columns" />
				</View>
				{stats.topSites.length > 0 && (
					<View style={styles.section}>
						<Text style={[styles.heading, {color: colors.text}]}>
							Most saved sites
						</Text>
						{stats.topSites.map((site) => (
							<View
								key={site.host}
								accessible
								accessibilityLabel={`${site.host}, ${site.count} links`}
								style={styles.site}
							>
								<View style={styles.siteLine}>
									<Text
										numberOfLines={1}
										style={[styles.host, {color: colors.text}]}
									>
										{site.host}
									</Text>
									<Text style={{color: colors.muted}}>{site.count}</Text>
								</View>
								<View style={[styles.track, {backgroundColor: colors.pressed}]}>
									<View
										style={[
											styles.bar,
											{
												backgroundColor: colors.accent,
												width: `${Math.max(6, (site.count / top) * 100)}%`,
											},
										]}
									/>
								</View>
							</View>
						))}
					</View>
				)}
				{stats.largestSession && stats.largestSession.tabs > 0 && (
					<View
						style={[
							styles.largest,
							{backgroundColor: colors.surface, borderColor: colors.border},
						]}
					>
						<Icon name="trophy-outline" size={22} color={colors.warn} />
						<View style={styles.largestText}>
							<Text style={{color: colors.muted}}>Largest session</Text>
							<Text
								numberOfLines={1}
								style={[styles.host, {color: colors.text}]}
							>
								{stats.largestSession.name}
							</Text>
						</View>
						<Text style={[styles.count, {color: colors.text}]}>
							{stats.largestSession.tabs}
						</Text>
					</View>
				)}
			</ScrollView>
		</BottomSheet>
	);
}

const styles = StyleSheet.create({
	scroll: {flexGrow: 0},
	body: {paddingHorizontal: 20, paddingBottom: 12, gap: 14},
	title: {fontSize: 20, fontWeight: '700'},
	grid: {flexDirection: 'row', flexWrap: 'wrap', gap: 12},
	tile: {
		width: '47.5%',
		flexGrow: 1,
		borderRadius: 16,
		borderWidth: 1,
		padding: 14,
		gap: 4,
	},
	tileIcon: {
		width: 36,
		height: 36,
		borderRadius: 18,
		alignItems: 'center',
		justifyContent: 'center',
		marginBottom: 6,
	},
	value: {fontSize: 28, fontWeight: '700'},
	section: {gap: 10},
	heading: {fontSize: 16, fontWeight: '700'},
	site: {gap: 6},
	siteLine: {flexDirection: 'row', alignItems: 'center', gap: 12},
	host: {flex: 1, fontSize: 16},
	track: {height: 6, borderRadius: 3, overflow: 'hidden'},
	bar: {height: 6, borderRadius: 3},
	largest: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		borderRadius: 16,
		borderWidth: 1,
		padding: 14,
	},
	largestText: {flex: 1},
	count: {fontSize: 20, fontWeight: '700'},
});
