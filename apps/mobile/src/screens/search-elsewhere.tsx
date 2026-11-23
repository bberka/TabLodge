import {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {FinderItem} from '../../../extension/src/shared/global-search';
import type {Store} from '../../../extension/src/shared/types';
import {hostOf} from '../library/store-shape';
import {requestJump} from '../library/jump';
import {linkToOpen} from '../library/links';
import {
	jumpFor,
	type Place,
	PLACE_NAME,
	searchElsewhere,
	settingsForSearch,
} from '../library/search-elsewhere';
import {elsewhereIntro} from '../library/search-count';
import {useLinkSettings} from '../library/use-link-settings';
import {openLink} from '../platform/open-links';
import {useSettledText} from '../ui/search-count';
import {BookmarkIcon, spokenKind} from '../ui/bookmark-icon';
import {SiteIcon} from '../ui/site-icon';
import {TARGET, useColors} from '../ui/theme';
import {Button, Icon} from '../ui/widgets';
import {SECTIONS} from './settings/settings-index';

const {development, ...SHOWN_SECTIONS} = SECTIONS;
const SETTINGS_RESULTS = settingsForSearch(__DEV__ ? SECTIONS : SHOWN_SECTIONS);

export function SearchElsewhere({
	store,
	query,
	here,
	localCount,
	onJump,
}: {
	store: Store;
	query: string;
	here: Place;
	localCount: number;
	onJump: () => void;
}) {
	const colors = useColors();
	const links = useLinkSettings();
	const [asked, setAsked] = useState(false);
	const isSearching = query.trim() !== '';
	useEffect(() => {
		if (!isSearching) {
			setAsked(false);
		}
	}, [isSearching]);
	const visible = isSearching && (localCount === 0 || asked);
	const sections = useMemo(
		() =>
			visible ? searchElsewhere(store, query, here, SETTINGS_RESULTS) : [],
		[visible, store, query, here],
	);
	const found = sections.reduce(
		(sum, section) => sum + section.items.length,
		0,
	);
	const introNow = elsewhereIntro(PLACE_NAME[here], localCount, found);
	const intro = useSettledText(visible, introNow);
	if (!isSearching) {
		return null;
	}

	if (!visible) {
		return (
			<View style={styles.ask}>
				<Button
					kind="plain"
					label={`Also search ${here === 'sessions' ? 'Bookmarks' : 'Sessions and saved tabs'}`}
					icon="search"
					onPress={() => {
						setAsked(true);
					}}
				/>
			</View>
		);
	}

	const open = (item: FinderItem) => {
		const jump = jumpFor(item);
		if (jump) {
			onJump();
			requestJump(jump);
		} else if (item.url) {
			openLink(linkToOpen(item.url, links));
		}
	};

	return (
		<View style={styles.box}>
			<Text
				accessibilityRole="header"
				accessibilityLiveRegion="polite"
				style={[styles.intro, {color: colors.muted}]}
			>
				{intro ?? introNow}
			</Text>
			{sections.map((section) => (
				<View key={section.kind}>
					<Text style={[styles.label, {color: colors.muted}]}>
						{section.label}
					</Text>
					{section.items.map((item) => (
						<Pressable
							key={item.id}
							accessibilityRole={item.url ? 'link' : 'button'}
							accessibilityLabel={`${item.kind === 'bookmark' && item.url ? spokenKind(item.url) : ''}${item.title}${item.detail ? `, ${item.detail}` : ''}`}
							accessibilityHint={
								item.url
									? 'Opens the link'
									: item.kind === 'session'
										? 'Shows the session'
										: item.kind === 'setting'
											? 'Opens Settings'
											: 'Shows the column'
							}
							style={({pressed}) => [
								styles.row,
								pressed && {backgroundColor: colors.pressed},
							]}
							onPress={() => {
								open(item);
							}}
						>
							{item.kind === 'bookmark' && item.url ? (
								<BookmarkIcon url={item.url} size={28} />
							) : item.url ? (
								<SiteIcon host={hostOf(item.url)} size={28} />
							) : (
								<Icon
									name={
										item.kind === 'session'
											? 'albums-outline'
											: item.kind === 'setting'
												? 'settings-outline'
												: 'list-outline'
									}
									size={22}
									color={colors.accent}
								/>
							)}
							<View style={styles.texts}>
								<Text numberOfLines={1} style={{color: colors.text}}>
									{item.title}
								</Text>
								{item.detail !== undefined && (
									<Text
										numberOfLines={1}
										style={{color: colors.muted, fontSize: 13}}
									>
										{item.detail}
									</Text>
								)}
							</View>
						</Pressable>
					))}
				</View>
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	ask: {paddingHorizontal: 16, paddingTop: 8},
	box: {paddingHorizontal: 16, paddingTop: 8, gap: 4},
	intro: {fontSize: 15, paddingVertical: 8},
	label: {
		fontSize: 13,
		fontWeight: '700',
		paddingTop: 8,
		paddingBottom: 2,
	},
	row: {
		minHeight: TARGET,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 6,
		paddingHorizontal: 8,
		borderRadius: 12,
	},
	texts: {flex: 1},
});
