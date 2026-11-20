// What the phone shows of bookmark tags (#344): the chips on a row, the tag filter, and the Tags field of the edit
// sheet. The rules are the extension's, in apps/extension/src/shared/bookmark-tags.ts.
import {useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {
	MAX_TAGS,
	parseTagInput,
	shownTags,
	tagCounts,
} from '../../../../extension/src/shared/bookmark-tags';
import {linkKind} from '../../../../extension/src/shared/link-kind';
import {
	parseSearchQuery,
	toggleTagFilter,
} from '../../../../extension/src/shared/search-query';
import type {Bookmark} from '../../../../extension/src/shared/types';
import {BottomSheet, SheetHeader} from '../../ui/bottom-sheet';
import {useColors} from '../../ui/theme';
import {Field, Icon, IconButton} from '../../ui/widgets';

type Tagged = Pick<Bookmark, 'url' | 'tags' | 'hiddenKinds'>;
export type TagEdit = Pick<Bookmark, 'tags' | 'hiddenKinds'>;

/**
How a row's tags are read out at the end of its accessibility label, or nothing without tags.
*/
export function spokenTags(bookmark: Tagged) {
	const tags = shownTags(bookmark);
	return tags.length > 0 ? `, tags: ${tags.join(', ')}` : '';
}

/**
A row's tags as small labels. The row's accessibility label says them (spokenTags), so these are hidden from TalkBack.
*/
export function RowTags({bookmark}: {bookmark: Tagged}) {
	const colors = useColors();
	const tags = shownTags(bookmark);
	if (tags.length === 0) {
		return null;
	}

	return (
		<View
			importantForAccessibility="no-hide-descendants"
			style={styles.rowTags}
		>
			{tags.map((tag) => (
				<Text
					key={tag}
					numberOfLines={1}
					style={[
						styles.rowTag,
						{color: colors.muted, backgroundColor: colors.pressed},
					]}
				>
					{tag}
				</Text>
			))}
		</View>
	);
}

/**
Every tag in the library with how many bookmarks show it. Tapping one adds `tag:` to the search, or takes it out
again, so the search field always says what is filtered.
*/
export function TagFilterSheet({
	visible,
	bookmarks,
	query,
	onQuery,
	onClose,
}: {
	visible: boolean;
	bookmarks: readonly Tagged[];
	query: string;
	onQuery: (query: string) => void;
	onClose: () => void;
}) {
	const colors = useColors();
	const counts = visible ? tagCounts(bookmarks) : [];
	const active = parseSearchQuery(query).tags;
	return (
		<BottomSheet visible={visible} label="Filter by tag" onClose={onClose}>
			<SheetHeader title="Filter by tag" onClose={onClose} />
			<ScrollView contentContainerStyle={styles.filterList}>
				{counts.length === 0 && (
					<Text style={{color: colors.muted}}>
						No tags yet. Tags come from the kind of link, and from the ones you
						add when you edit a link.
					</Text>
				)}
				{counts.map(({tag, count}) => {
					const on = active.includes(tag);
					return (
						<Pressable
							key={tag}
							accessibilityRole="checkbox"
							accessibilityState={{checked: on}}
							accessibilityLabel={`${tag}, ${count}`}
							style={({pressed}) => [
								styles.filterRow,
								pressed && {backgroundColor: colors.pressed},
							]}
							onPress={() => {
								onQuery(toggleTagFilter(query, tag));
							}}
						>
							<Icon
								name={on ? 'checkbox' : 'square-outline'}
								size={22}
								color={on ? colors.accent : colors.muted}
							/>
							<Text
								numberOfLines={1}
								style={[styles.filterName, {color: colors.text}]}
							>
								{tag}
							</Text>
							<Text style={{color: colors.muted}}>{count}</Text>
						</Pressable>
					);
				})}
			</ScrollView>
		</BottomSheet>
	);
}

/**
The Tags field of the edit sheet. The automatic kind shows with a remove button, which keeps it removed for this
link; a removed kind can be put back. Typed tags are added with the keyboard's enter key or a comma.
*/
export function TagsField({
	url,
	value,
	onChange,
	autoFocus = false,
}: {
	url: string;
	value: TagEdit;
	onChange: (value: TagEdit) => void;
	autoFocus?: boolean;
}) {
	const colors = useColors();
	const [draft, setDraft] = useState('');
	const own = value.tags ?? [];
	const hidden = value.hiddenKinds ?? [];
	const kind = linkKind(url);
	const automatic = kind === 'page' ? undefined : kind;
	const kindHidden = automatic !== undefined && hidden.includes(automatic);
	const full = own.length >= MAX_TAGS;

	// Removing the kind also takes away a typed tag of the same name, so the chip does not come straight back.
	const setKindHidden = (next: boolean) => {
		const others = hidden.filter((entry) => entry !== automatic);
		onChange({
			tags: next ? own.filter((tag) => tag !== automatic) : own,
			hiddenKinds: next && automatic ? [...others, automatic] : others,
		});
	};

	const commit = (text: string) => {
		const added = parseTagInput(text).filter((tag) => !own.includes(tag));
		if (added.length > 0) {
			onChange({...value, tags: [...own, ...added].slice(0, MAX_TAGS)});
		}

		setDraft('');
	};

	const token = (label: string, buttonLabel: string, onRemove: () => void) => (
		<View key={label} style={[styles.token, {backgroundColor: colors.pressed}]}>
			<Text numberOfLines={1} style={[styles.tokenText, {color: colors.text}]}>
				{label}
			</Text>
			<IconButton icon="close" label={buttonLabel} onPress={onRemove} />
		</View>
	);

	return (
		<View style={styles.field}>
			<Field
				label="Tags (optional)"
				icon="pricetag-outline"
				autoFocus={autoFocus}
				editable={!full}
				placeholder={full ? `Up to ${MAX_TAGS} tags` : 'Add a tag'}
				autoCapitalize="none"
				value={draft}
				submitBehavior="submit"
				returnKeyType="done"
				onChangeText={(text) => {
					if (text.includes(',')) {
						commit(text);
					} else {
						setDraft(text);
					}
				}}
				onSubmitEditing={() => {
					commit(draft);
				}}
				onBlur={() => {
					commit(draft);
				}}
			/>
			{(own.length > 0 || (automatic && !kindHidden)) && (
				<View style={styles.tokens}>
					{automatic &&
						!kindHidden &&
						token(automatic, `Remove automatic tag ${automatic}`, () => {
							setKindHidden(true);
						})}
					{own
						.filter((tag) => tag !== automatic || kindHidden)
						.map((tag) =>
							token(tag, `Remove tag ${tag}`, () => {
								onChange({
									...value,
									tags: own.filter((entry) => entry !== tag),
								});
							}),
						)}
				</View>
			)}
			{kindHidden && (
				<Pressable
					accessibilityRole="button"
					style={styles.restore}
					onPress={() => {
						setKindHidden(false);
					}}
				>
					<Icon name="add" size={18} color={colors.accent} />
					<Text style={{color: colors.accent}}>
						Show automatic tag {automatic}
					</Text>
				</Pressable>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	rowTags: {flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4},
	rowTag: {
		fontSize: 11,
		paddingHorizontal: 6,
		paddingVertical: 1,
		borderRadius: 8,
		overflow: 'hidden',
		maxWidth: 160,
	},
	filterList: {paddingHorizontal: 16, paddingBottom: 24},
	filterRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 12,
		minHeight: 48,
		paddingHorizontal: 4,
		borderRadius: 8,
	},
	filterName: {flex: 1, fontSize: 16},
	field: {gap: 8},
	tokens: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
	token: {
		flexDirection: 'row',
		alignItems: 'center',
		borderRadius: 20,
		paddingLeft: 12,
		maxWidth: '100%',
	},
	tokenText: {fontSize: 14, flexShrink: 1},
	restore: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		minHeight: 48,
		alignSelf: 'flex-start',
	},
});
