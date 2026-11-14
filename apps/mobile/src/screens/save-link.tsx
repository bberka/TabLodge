import {useEffect, useState} from 'react';
import {
	ActivityIndicator,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native';
import type {Bookmark} from '../../../extension/src/shared/types';
import {stripTrackingParameters} from '../../../extension/src/shared/tracking-parameters';
import {ColumnChoice, useColumnChoice} from '../column-choice';
import {addBookmark, extractUrl, hostOf, updateBookmark} from '../library';
import {edit, newId} from '../library-store';
import {cleanPageTitle} from '../links';
import {useLinkPreview} from '../link-preview';
import {getPreferences, setPreferences, usePreferences} from '../preferences';
import {SiteIcon} from '../site-icon';
import {useLinkSettings} from '../use-link-settings';
import {useColors} from '../theme';
import {Button, Field, IconButton} from '../ui';

/**
The body of the save drawer. Opened by Add link, or by the Android share sheet with the shared text filled in.
*/
export function SaveLinkForm({
	initialText,
	initialTitle,
	editing,
	onDone,
}: {
	initialText: string;
	initialTitle: string;
	/**
	A bookmark to change instead of saving a new one. The initial text and title are then its own.
	*/
	editing?: Bookmark;
	/**
	Called when the drawer should close; `saved` is the column name when a link was saved.
	*/
	onDone: (saved?: string) => void;
}) {
	const colors = useColors();
	const settings = useLinkSettings();
	const choice = useColumnChoice(editing?.columnId);
	const [text, setText] = useState(
		() => extractUrl(initialText) ?? initialText,
	);
	const [title, setTitle] = useState(initialTitle);
	// Once the person types a title, the page's own never replaces it.
	const [titleEdited, setTitleEdited] = useState(initialTitle !== '');
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState('');

	const url = extractUrl(text);
	const {savePreview} = usePreferences();
	const {loading, preview} = useLinkPreview(url, savePreview && !editing);
	useEffect(() => {
		if (preview?.title && !titleEdited) {
			setTitle(preview.title);
		}
	}, [preview?.title, titleEdited]);

	const save = async () => {
		if (!url) {
			return;
		}

		setSaving(true);
		setProblem('');
		try {
			const {id: target, name} = await choice.resolve();
			const saved = {
				url: getPreferences().cleanOnSave ? stripTrackingParameters(url) : url,
				title: cleanPageTitle(title, settings.cleanTitles),
			};

			await edit((current) =>
				editing
					? updateBookmark(
							current,
							editing.id,
							{...saved, columnId: target},
							Date.now(),
						)
					: addBookmark(
							current,
							{...saved, columnId: target},
							newId(),
							Date.now(),
						),
			);
			setPreferences({lastColumnId: target});
			onDone(name);
		} catch {
			// A full disk or a storage fault: say so, and let the person try again instead of a button that spins.
			setProblem('Could not save. Try again.');
		} finally {
			setSaving(false);
		}
	};

	return (
		<View style={styles.screen}>
			<View style={styles.top}>
				<Text
					accessibilityRole="header"
					style={[styles.title, {color: colors.text}]}
				>
					{editing ? 'Edit link' : 'Save link'}
				</Text>
				<IconButton
					icon="close"
					label="Close"
					onPress={() => {
						onDone();
					}}
				/>
			</View>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.body}
				keyboardShouldPersistTaps="handled"
			>
				<Field
					label="Link"
					icon="link-outline"
					value={text}
					autoCapitalize="none"
					autoCorrect={false}
					keyboardType="url"
					error={
						text.length > 0 && !url
							? 'Enter a web address that starts with http:// or https://.'
							: undefined
					}
					onChangeText={setText}
					onClear={() => {
						setText('');
					}}
				/>
				{savePreview && !editing && url && (
					<View style={styles.preview}>
						<SiteIcon always host={hostOf(url)} size={40} />
						<View style={styles.previewText}>
							<Text
								numberOfLines={2}
								style={{color: colors.text, fontWeight: '600'}}
							>
								{preview?.title ?? hostOf(url)}
							</Text>
							{preview?.description && (
								<Text numberOfLines={2} style={{color: colors.muted}}>
									{preview.description}
								</Text>
							)}
						</View>
						{loading && <ActivityIndicator color={colors.muted} />}
					</View>
				)}
				<Field
					label="Title (optional)"
					value={title}
					onChangeText={(next) => {
						setTitleEdited(true);
						setTitle(next);
					}}
				/>
				<ColumnChoice choice={choice} />
				{problem !== '' && (
					<Text accessibilityLiveRegion="polite" style={{color: colors.danger}}>
						{problem}
					</Text>
				)}
				<Button
					label="Save"
					icon="checkmark"
					disabled={!url || choice.incomplete}
					loading={saving}
					onPress={() => void save()}
				/>
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	// Sized to its content: the sheet only grows as far as its own maximum height, then the body scrolls.
	screen: {flexShrink: 1},
	top: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingLeft: 20,
		paddingRight: 8,
	},
	title: {fontSize: 20, fontWeight: '700'},
	scroll: {flexGrow: 0},
	preview: {flexDirection: 'row', alignItems: 'center', gap: 12},
	previewText: {flex: 1, gap: 2},
	body: {paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, gap: 14},
	group: {gap: 8},
});
