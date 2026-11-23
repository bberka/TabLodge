import {useState} from 'react';
import {
	FlatList,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
	useWindowDimensions,
} from 'react-native';
import type {LicenceEntry} from '../../about/licence-data';
import {reflow, searchLicences} from '../../about/licence-list';
import {licences} from '../../about/licences';
import {openLink} from '../../platform/open-links';
import {BottomSheet} from '../../ui/bottom-sheet';
import {useColors} from '../../ui/theme';
import {Empty, Field, Icon, IconButton} from '../../ui/widgets';
import {SettingsCard} from './settings-card';
import {ROWS, SECTIONS} from './settings-index';
import {ValueRow} from './select-row';

const kindLabel = (entry: LicenceEntry) =>
	entry.native ? 'Android library' : 'JavaScript package';

function LicenceRow({
	entry,
	onPress,
}: {
	entry: LicenceEntry;
	onPress: () => void;
}) {
	const colors = useColors();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${entry.name}, version ${entry.version}, ${entry.licence}`}
			accessibilityHint="Shows the licence text"
			style={({pressed}) => [
				styles.row,
				{borderColor: colors.border},
				pressed && {backgroundColor: colors.pressed},
			]}
			onPress={onPress}
		>
			<View style={styles.rowText}>
				<Text style={[styles.name, {color: colors.text}]}>{entry.name}</Text>
				<Text style={{color: colors.muted}}>
					{entry.version} · {entry.licence}
				</Text>
			</View>
			<Icon name="chevron-forward" size={18} color={colors.muted} />
		</Pressable>
	);
}

function LicenceText({entry}: {entry: LicenceEntry}) {
	const colors = useColors();
	const {url} = entry;
	return (
		<ScrollView contentContainerStyle={styles.textBody}>
			<Text style={{color: colors.muted}}>
				{kindLabel(entry)} · version {entry.version} · {entry.licence}
			</Text>
			{url && (
				<Pressable
					accessibilityRole="link"
					accessibilityLabel={`Project page, ${url}`}
					hitSlop={8}
					style={({pressed}) => pressed && {opacity: 0.6}}
					onPress={() => {
						openLink(url);
					}}
				>
					<Text style={[styles.link, {color: colors.accent}]}>{url}</Text>
				</Pressable>
			)}
			<Text selectable style={[styles.licence, {color: colors.text}]}>
				{reflow(licences.texts[entry.text] ?? '')}
			</Text>
		</ScrollView>
	);
}

function LicencesSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const colors = useColors();
	const {height} = useWindowDimensions();
	const [query, setQuery] = useState('');
	const [open, setOpen] = useState<LicenceEntry>();
	const found = searchLicences(licences.packages, query);
	const back = () => {
		setOpen(undefined);
	};

	return (
		<BottomSheet
			scroll={false}
			visible={visible}
			label={open ? `${open.name} licence` : 'Open source licences'}
			onClose={open ? back : onClose}
		>
			<View style={{height: Math.round(height * 0.85)}}>
				<View style={styles.header}>
					{open && (
						<IconButton
							icon="arrow-back"
							label="Back to the list"
							onPress={back}
						/>
					)}
					<Text
						accessibilityRole="header"
						numberOfLines={2}
						style={[styles.title, {color: colors.text}]}
					>
						{open ? open.name : 'Open source licences'}
					</Text>
					<IconButton icon="close" label="Close" onPress={onClose} />
				</View>
				{open ? (
					<LicenceText entry={open} />
				) : (
					<>
						<View style={styles.search}>
							<Field
								label={`Search ${licences.packages.length} packages`}
								icon="search"
								placeholder="Name or licence, such as Apache"
								value={query}
								autoCorrect={false}
								autoCapitalize="none"
								onChangeText={setQuery}
								onClear={() => {
									setQuery('');
								}}
							/>
						</View>
						<FlatList
							data={found}
							keyExtractor={(entry) => `${entry.name}@${entry.version}`}
							keyboardShouldPersistTaps="handled"
							contentContainerStyle={styles.list}
							ListEmptyComponent={
								<Empty icon="search" title="No package matches">
									Try part of a name, or a licence such as MIT.
								</Empty>
							}
							renderItem={({item}) => (
								<LicenceRow
									entry={item}
									onPress={() => {
										setOpen(item);
									}}
								/>
							)}
						/>
					</>
				)}
			</View>
		</BottomSheet>
	);
}

export function AboutCard() {
	const [open, setOpen] = useState(false);
	return (
		<SettingsCard section={SECTIONS.about} icon="information-circle-outline">
			<ValueRow
				row={ROWS.licences}
				value={`${licences.packages.length} packages`}
				onPress={() => {
					setOpen(true);
				}}
			/>
			<LicencesSheet
				visible={open}
				onClose={() => {
					setOpen(false);
				}}
			/>
		</SettingsCard>
	);
}

const styles = StyleSheet.create({
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		paddingLeft: 20,
		paddingRight: 8,
	},
	title: {flex: 1, fontSize: 20, fontWeight: '700'},
	search: {paddingHorizontal: 16, paddingBottom: 8},
	list: {paddingHorizontal: 16, paddingBottom: 24},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		minHeight: 56,
		paddingVertical: 10,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	rowText: {flex: 1, gap: 2},
	name: {fontSize: 15, fontWeight: '600'},
	textBody: {paddingHorizontal: 20, paddingBottom: 32, gap: 12},
	link: {fontSize: 14, fontWeight: '600'},
	licence: {fontSize: 13, lineHeight: 19},
});
