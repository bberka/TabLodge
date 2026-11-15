import {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {FinderItem} from '../../../extension/src/shared/global-search';
import type {Store} from '../../../extension/src/shared/types';
import {hostOf} from '../library/library';
import {requestJump} from '../library/jump';
import {linkToOpen} from '../library/links';
import {
	jumpFor,
	type Place,
	PLACE_NAME,
	searchElsewhere,
} from '../library/search-elsewhere';
import {useLinkSettings} from '../library/use-link-settings';
import {openLink} from '../platform/open-links';
import {SiteIcon} from '../ui/site-icon';
import {TARGET, useColors} from '../ui/theme';
import {Button, Icon} from '../ui/ui';

/**
Under a screen's own search results: the same query run over the other places, listed with a line that says so.
With no results of its own, the screen shows them straight away; otherwise a button asks for them.
*/
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
	/**
	Runs after a result that leads to a session or column is tapped, so the screen can drop its search.
	*/
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
		() => (visible ? searchElsewhere(store, query, here) : []),
		[visible, store, query, here],
	);
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
				style={[styles.intro, {color: colors.muted}]}
			>
				{sections.length === 0
					? `Nothing in ${PLACE_NAME[here]} matches, and nothing else does either.`
					: localCount === 0
						? `Nothing in ${PLACE_NAME[here]} matches. Found elsewhere:`
						: 'Also found elsewhere:'}
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
							accessibilityLabel={`${item.title}${item.detail ? `, ${item.detail}` : ''}`}
							accessibilityHint={
								item.url
									? 'Opens the link'
									: item.kind === 'session'
										? 'Shows the session'
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
							{item.url ? (
								<SiteIcon host={hostOf(item.url)} size={28} />
							) : (
								<Icon
									name={
										item.kind === 'session' ? 'albums-outline' : 'list-outline'
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
