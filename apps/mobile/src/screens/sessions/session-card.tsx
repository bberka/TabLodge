import {memo} from 'react';
import {useColorScheme, Pressable, StyleSheet, Text, View} from 'react-native';
import type {Session} from '../../../../extension/src/shared/types';
import {columnTint} from '../../ui/column-icons';
import {hostOf} from '../../library/store-shape';
import {linkActionLook, sessionActionLook} from '../../library/row-actions';
import {SwipeRow} from '../../ui/swipe-row';
import {
	type LinkAction,
	type SessionAction,
	usePreferences,
} from '../../settings/preferences';
import {linkToOpen, rowText} from '../../library/links';
import {openLink} from '../../platform/open-links';
import {soften, TARGET, useColors} from '../../ui/theme';
import {useLinkSettings} from '../../library/use-link-settings';
import {Button, Card, Icon} from '../../ui/widgets';
import {SiteIcon} from '../../ui/site-icon';
import {NoteText} from '../../ui/note-text';
import {
	firstPassage,
	spokenNote,
} from '../../../../extension/src/shared/note-links';

const PREVIEW_TABS = 4;

// The actions a screen reader offers on a session card, besides the ones a swipe can also run.
const SESSION_MENU: ReadonlyArray<readonly [string, string]> = [
	['expand', 'Show or hide tabs'],
	['open', 'Open all tabs'],
	['rename', 'Edit details'],
	['share', 'Share'],
	['archive', 'Archive'],
	['delete', 'Delete'],
	['more', 'More actions'],
];

const shortDate = (time: number) =>
	new Date(time).toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
	});

/**
A row of small site badges that overlap, as a glance at what a session holds.
*/
function TabPreview({session}: {session: Session}) {
	const colors = useColors();
	const shown = session.tabs.slice(0, PREVIEW_TABS);
	const more = session.tabs.length - shown.length;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={styles.preview}
		>
			{shown.map((tab, index) => (
				<View
					key={tab.id}
					style={[
						styles.badge,
						{
							borderColor: colors.surface,
							marginLeft: index === 0 ? 0 : -6,
						},
					]}
				>
					<SiteIcon host={hostOf(tab.url)} size={22} />
				</View>
			))}
			{more > 0 && (
				<Text style={[styles.more, {color: colors.muted}]}>+{more}</Text>
			)}
		</View>
	);
}

function SessionCardView({
	session,
	folderName,
	archived,
	tint: folderTint,
	expanded,
	selecting,
	checked,
	onPick,
	onToggle,
	onAct,
	onTabMenu,
	onTabAct,
	onMenu,
}: {
	session: Session;
	folderName: string;
	/**
	The session is in the Archived folder, so its Archive action takes it out instead.
	*/
	archived: boolean;
	tint: string;
	expanded: boolean;
	/**
	Selecting several sessions: a tap picks this one, and the card shows a check instead of its tile.
	*/
	selecting: boolean;
	checked: boolean;
	onPick: (id: string) => void;
	onToggle: (id: string) => void;
	/**
	Runs a session action; missing where the library is read only, which allows only opening and sharing.
	*/
	onAct: (action: SessionAction, session: Session) => void;
	/**
	Opens the menu of one link in the session: edit, add to bookmarks, delete.
	*/
	onTabMenu?: (session: Session, tabId: string) => void;
	/**
	Runs what swiping a link does; missing where the library is read only.
	*/
	onTabAct?: (action: LinkAction, session: Session, tabId: string) => void;
	onMenu: (session: Session) => void;
}) {
	const colors = useColors();
	const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
	const tint = columnTint(session.color, scheme) ?? folderTint;
	const links = useLinkSettings();
	const prefs = usePreferences();
	const isCompact = prefs.compactSessions;
	const main = prefs.sessionMain;
	const mainLook = sessionActionLook(main, colors, archived);
	const swipe = (action: SessionAction) =>
		action === 'none'
			? undefined
			: {
					...sessionActionLook(action, colors, archived),
					onTrigger() {
						onAct(action, session);
					},
				};
	const swipeLink = (action: LinkAction, tabId: string) =>
		action === 'none' || !onTabAct
			? undefined
			: {
					...linkActionLook(action, colors),
					onTrigger() {
						onTabAct(action, session, tabId);
					},
				};
	const chevron = (
		<Icon
			name={expanded ? 'chevron-up' : 'chevron-down'}
			color={colors.muted}
		/>
	);
	const count = `${session.tabs.length} ${session.tabs.length === 1 ? 'tab' : 'tabs'}`;
	return (
		<SwipeRow
			radius={16}
			disabled={selecting}
			left={swipe(prefs.sessionSwipeRight)}
			right={swipe(prefs.sessionSwipeLeft)}
		>
			{(handlers) => (
				<Card flush>
					<View style={styles.head} {...handlers}>
						<Pressable
							accessibilityRole={selecting ? 'checkbox' : 'button'}
							accessibilityState={selecting ? {checked} : {expanded}}
							accessibilityLabel={`${session.name}, ${count}, ${folderName}${session.deviceName ? `, saved on ${session.deviceName}` : ''}`}
							style={({pressed}) => [
								styles.headMain,
								(checked || pressed) && {
									backgroundColor: checked ? colors.accentSoft : colors.pressed,
								},
							]}
							accessibilityActions={SESSION_MENU.map(([name, label]) => ({
								name,
								label: name === 'archive' && archived ? 'Unarchive' : label,
							}))}
							onAccessibilityAction={(event) => {
								const name = event.nativeEvent.actionName;
								if (name === 'expand') {
									onToggle(session.id);
								} else if (name === 'more') {
									onMenu(session);
								} else {
									onAct(name as SessionAction, session);
								}
							}}
							onLongPress={() => {
								if (selecting) {
									onPick(session.id);
								} else {
									onMenu(session);
								}
							}}
							onPress={() => {
								if (selecting) {
									onPick(session.id);
								} else if (prefs.sessionTap === 'open') {
									onAct('open', session);
								} else {
									onToggle(session.id);
								}
							}}
						>
							{selecting ? (
								<View style={styles.tile}>
									<Icon
										name={checked ? 'checkmark-circle' : 'ellipse-outline'}
										size={28}
										color={checked ? colors.accent : colors.muted}
									/>
								</View>
							) : (
								<View style={[styles.tile, {backgroundColor: soften(tint)}]}>
									<Icon name="albums" size={22} color={tint} />
								</View>
							)}
							<View style={styles.texts}>
								<Text
									numberOfLines={2}
									style={[styles.name, {color: colors.text}]}
								>
									{session.name}
								</Text>
								<Text numberOfLines={1} style={{color: colors.muted}}>
									{count} · {folderName} · {shortDate(session.updatedAt)}
								</Text>
								{session.description !== '' && !prefs.compactSessions && (
									<Text numberOfLines={2} style={{color: colors.muted}}>
										{session.description}
									</Text>
								)}
								{session.deviceName &&
									prefs.showSavedOn &&
									!prefs.compactSessions && (
										<Text numberOfLines={1} style={{color: colors.muted}}>
											Saved on {session.deviceName}
										</Text>
									)}
								{links.showSessionFaviconPreviews && !prefs.compactSessions && (
									<TabPreview session={session} />
								)}
							</View>
							{!selecting && prefs.sessionTap !== 'open' && chevron}
						</Pressable>
						{!selecting && prefs.sessionTap === 'open' && (
							<Pressable
								accessibilityRole="button"
								accessibilityState={{expanded}}
								accessibilityLabel={
									expanded
										? `Hide tabs in ${session.name}`
										: `Show tabs in ${session.name}`
								}
								style={({pressed}) => [
									styles.round,
									styles.roundEnd,
									pressed && {backgroundColor: colors.pressed},
								]}
								onPress={() => {
									onToggle(session.id);
								}}
							>
								{chevron}
							</Pressable>
						)}
					</View>
					{expanded && !selecting && (
						<View style={[styles.tabs, {borderColor: colors.border}]}>
							{session.tabs.map((tab) => {
								const text = rowText(
									{title: tab.title || tab.url, url: tab.url},
									links,
								);
								const passage = firstPassage(tab.notes);
								return (
									<SwipeRow
										key={tab.id}
										background={colors.surface}
										left={swipeLink(prefs.linkSwipeRight, tab.id)}
										right={swipeLink(prefs.linkSwipeLeft, tab.id)}
									>
										<Pressable
											accessibilityRole="link"
											accessibilityLabel={`${text.main}${text.sub ? `, ${text.sub}` : ''}${tab.notes.trim() ? `, note: ${spokenNote(tab.notes.trim())}` : ''}`}
											accessibilityHint="Opens the link"
											style={({pressed}) => [
												styles.tab,
												isCompact && styles.tabCompact,
												{
													backgroundColor: pressed
														? colors.pressed
														: 'transparent',
												},
											]}
											accessibilityActions={[
												...(onTabMenu
													? [{name: 'menu', label: 'Link menu'}]
													: []),
												...(passage
													? [{name: 'passage', label: passage.name}]
													: []),
											]}
											onAccessibilityAction={(event) => {
												if (event.nativeEvent.actionName === 'passage') {
													if (passage) {
														openLink(linkToOpen(passage.url, links));
													}

													return;
												}

												onTabMenu?.(session, tab.id);
											}}
											onLongPress={
												onTabMenu
													? () => {
															onTabMenu(session, tab.id);
														}
													: undefined
											}
											onPress={() => {
												openLink(linkToOpen(tab.url, links));
											}}
										>
											<SiteIcon
												host={hostOf(tab.url)}
												size={isCompact ? 24 : 32}
											/>
											<View style={styles.texts}>
												<Text
													numberOfLines={isCompact ? 1 : 2}
													style={{color: colors.text}}
												>
													{text.main}
												</Text>
												{text.sub !== undefined && !isCompact && (
													<Text
														numberOfLines={1}
														style={{color: colors.muted, fontSize: 13}}
													>
														{text.sub}
													</Text>
												)}
												{tab.notes.trim() !== '' && (
													<NoteText
														notes={tab.notes.trim()}
														numberOfLines={isCompact ? 1 : 2}
														style={{color: colors.muted, fontSize: 13}}
														onOpen={(url) => {
															openLink(linkToOpen(url, links));
														}}
													/>
												)}
											</View>
											{tab.pinned && (
												<Icon name="pin" size={15} color={colors.muted} />
											)}
											<Icon
												name="open-outline"
												size={18}
												color={colors.muted}
											/>
										</Pressable>
									</SwipeRow>
								);
							})}
							<View style={styles.footer}>
								<View style={styles.footerButton}>
									<Button
										kind="plain"
										label={
											main === 'open'
												? `Open all ${session.tabs.length}`
												: mainLook.label
										}
										icon={mainLook.icon}
										onPress={() => {
											onAct(main, session);
										}}
									/>
								</View>
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={`More actions for ${session.name}`}
									style={({pressed}) => [
										styles.round,
										pressed && {backgroundColor: colors.pressed},
									]}
									onPress={() => {
										onMenu(session);
									}}
								>
									<Icon name="ellipsis-horizontal" color={colors.muted} />
								</Pressable>
							</View>
						</View>
					)}
				</Card>
			)}
		</SwipeRow>
	);
}

// Cards re-draw only when their own session, folder, or expanded state changes, not on every keystroke in the search.
export const SessionCard = memo(SessionCardView);

const styles = StyleSheet.create({
	footer: {flexDirection: 'row', gap: 8, padding: 8},
	footerButton: {flex: 1},
	tabCompact: {minHeight: 40, paddingVertical: 4},
	head: {flexDirection: 'row', alignItems: 'center'},
	headMain: {
		flex: 1,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingHorizontal: 16,
		paddingVertical: 14,
		minHeight: TARGET + 24,
	},
	tile: {
		width: 44,
		height: 44,
		borderRadius: 12,
		alignItems: 'center',
		justifyContent: 'center',
	},
	texts: {flex: 1, gap: 2},
	name: {fontSize: 16, fontWeight: '700'},
	preview: {flexDirection: 'row', alignItems: 'center', paddingTop: 6},
	badge: {borderWidth: 2, borderRadius: 13},
	more: {marginLeft: 6, fontSize: 13, fontWeight: '600'},
	// The round chevron at the end of the header, which shows the tabs.
	round: {
		width: TARGET,
		height: TARGET,
		borderRadius: TARGET / 2,
		alignItems: 'center',
		justifyContent: 'center',
	},
	roundEnd: {marginRight: 8},
	tabs: {borderTopWidth: StyleSheet.hairlineWidth},
	tab: {
		borderRadius: 12,
		minHeight: TARGET,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		paddingVertical: 8,
		paddingHorizontal: 16,
	},
});
