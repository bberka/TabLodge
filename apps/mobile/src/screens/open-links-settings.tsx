import {useMemo} from 'react';
import {installedBrowsers} from '../../modules/open-links';
import {type OpenWith, setPreferences, usePreferences} from '../preferences';
import {SelectRow} from './select-row';
import {SettingsCard} from './settings-card';
import {ROWS, SECTIONS} from './settings-index';

const HOW_CHOICES: Array<{id: OpenWith; name: string; hint: string}> = [
	{id: 'system', name: 'Default browser', hint: 'Whatever your phone uses'},
	{
		id: 'inapp',
		name: 'In-app tab',
		hint: 'Opens over TabLodge and comes back when closed',
	},
	{id: 'app', name: 'A specific browser', hint: 'Pick one of your browsers'},
];

/**
Where links open: for the regular library, and separately for the private one, which can point at another browser.
Chrome ignores a request for a private tab from another app, so private links get a browser of their own to choose.
*/
export function OpenLinksCard() {
	const prefs = usePreferences();
	const browsers = useMemo(() => installedBrowsers(), []);
	const browserChoices = browsers.map(({id, name, icon}) => ({
		id,
		name,
		image: icon,
	}));
	// A browser is picked as soon as the choice is made, so the row never reads blank.
	const first = browsers[0]?.id;
	const privateChoices: Array<{
		id: OpenWith | 'same';
		name: string;
		hint?: string;
	}> = [{id: 'same', name: 'Same as other links'}, ...HOW_CHOICES];
	return (
		<SettingsCard
			section={SECTIONS.openLinks}
			icon="open-outline"
			description="Pick the browser for your links."
		>
			<SelectRow
				row={ROWS.openWith}
				value={prefs.openWith}
				choices={HOW_CHOICES}
				onChange={(openWith) => {
					setPreferences({
						openWith,
						...(openWith === 'app' &&
							prefs.openApp === '' &&
							first && {openApp: first}),
					});
				}}
			/>
			{prefs.openWith === 'app' && (
				<SelectRow
					row={ROWS.openApp}
					value={prefs.openApp}
					choices={browserChoices}
					onChange={(openApp) => {
						setPreferences({openApp});
					}}
				/>
			)}
			<SelectRow
				row={ROWS.privateOpenWith}
				value={prefs.privateOpenWith}
				choices={privateChoices}
				onChange={(privateOpenWith) => {
					setPreferences({
						privateOpenWith,
						...(privateOpenWith === 'app' &&
							prefs.privateOpenApp === '' &&
							first && {privateOpenApp: first}),
					});
				}}
			/>
			{prefs.privateOpenWith === 'app' && (
				<SelectRow
					row={ROWS.privateOpenApp}
					value={prefs.privateOpenApp}
					choices={browserChoices}
					onChange={(privateOpenApp) => {
						setPreferences({privateOpenApp});
					}}
				/>
			)}
		</SettingsCard>
	);
}
