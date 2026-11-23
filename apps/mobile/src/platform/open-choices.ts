import type {OpenHow} from '../../modules/open-links';
import type {Preferences} from '../settings/preference-schema';

export type Opener = {how: OpenHow; app: string};

export function settingsOpener(
	prefs: Pick<
		Preferences,
		'openWith' | 'openApp' | 'privateOpenWith' | 'privateOpenApp'
	>,
	isPrivate: boolean,
): Opener {
	return isPrivate && prefs.privateOpenWith !== 'same'
		? {how: prefs.privateOpenWith, app: prefs.privateOpenApp}
		: {how: prefs.openWith, app: prefs.openApp};
}

export type OpenChoice = {
	key: string;
	label: string;
	image?: string;
	opener: Opener;
};

export function openChoices(
	browsers: ReadonlyArray<{id: string; name: string; icon?: string}>,
	{several}: {several: boolean},
): OpenChoice[] {
	return [
		{key: 'inapp', label: 'In-app tab', opener: {how: 'inapp', app: ''}},
		{
			key: 'system',
			label: 'Default browser',
			opener: {how: 'system', app: ''},
		},
		...(several
			? browsers.map(({id, name, icon}) => ({
					key: `app:${id}`,
					label: name,
					image: icon,
					opener: {how: 'app' as const, app: id},
				}))
			: [
					{
						key: 'chooser',
						label: 'Open with…',
						opener: {how: 'chooser' as const, app: ''},
					},
				]),
	];
}
