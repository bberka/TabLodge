import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
	excludedHostError,
	normalizeExcludedHost,
} from '../../../extension/src/shared/excluded-sites';
import {setSyncedSetting, useRegularLibrary} from '../library-store';
import {showSnack} from '../snackbar';
import {useColors} from '../theme';
import {Button, Field, IconButton} from '../ui';
import {SettingsCard} from './settings-card';
import {SECTIONS} from './settings-index';

/**
The websites that are not saved from this phone. The list is the extension's own setting, so a site added here is
excluded in the browser too, and the other way round. An entry covers the site and all its subdomains.
*/
export function ExcludedCard() {
	const colors = useColors();
	const entries = useRegularLibrary().settings.excludedOrigins ?? [];
	const [text, setText] = useState('');
	const host = normalizeExcludedHost(text);
	const problem = text.trim() === '' ? '' : excludedHostError(text);
	const known = host !== null && entries.includes(host);
	const add = () => {
		if (host === null || known) {
			return;
		}

		void setSyncedSetting('excludedOrigins', [...entries, host]);
		setText('');
	};

	return (
		<SettingsCard
			section={SECTIONS.excluded}
			icon="ban-outline"
			description="Links to these websites and their subdomains are not saved."
		>
			<Field
				label="Website"
				icon="globe-outline"
				value={text}
				placeholder="example.com"
				autoCapitalize="none"
				autoCorrect={false}
				keyboardType="url"
				returnKeyType="done"
				error={
					problem === ''
						? known
							? 'This website is already excluded.'
							: undefined
						: problem
				}
				onChangeText={setText}
				onSubmitEditing={add}
			/>
			<Button
				label="Exclude this website"
				icon="add"
				kind="plain"
				disabled={host === null || known}
				onPress={add}
			/>
			{entries.length === 0 ? (
				<Text style={{color: colors.muted}}>No websites are excluded.</Text>
			) : (
				entries.map((entry) => (
					<View key={entry} style={styles.row}>
						<Text numberOfLines={1} style={[styles.host, {color: colors.text}]}>
							{entry}
						</Text>
						<IconButton
							icon="close"
							label={`Stop excluding ${entry}`}
							onPress={() => {
								void setSyncedSetting(
									'excludedOrigins',
									entries.filter((other) => other !== entry),
								);
								showSnack(`${entry} is no longer excluded`, {
									label: 'Undo',
									run() {
										void setSyncedSetting('excludedOrigins', entries);
									},
								});
							}}
						/>
					</View>
				))
			)}
		</SettingsCard>
	);
}

const styles = StyleSheet.create({
	row: {flexDirection: 'row', alignItems: 'center', gap: 8},
	host: {flex: 1, fontSize: 16},
});
