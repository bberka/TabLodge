import type {OpenHow} from '../../modules/open-links';
import type {Preferences} from '../settings/preference-schema';

export type Opener = {how: OpenHow; app: string};

/**
How links open when nothing was picked for them: what the settings say for the library on screen. The private library
follows its own choice, which can point at another browser.
*/
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
	/**
	Unique within the list: two browsers can share a name, never a package.
	*/
	key: string;
	label: string;
	/**
	The browser's icon as a `data:` address, for a browser that has one.
	*/
	image?: string;
	opener: Opener;
};

/**
What **Open in…** offers. Android's chooser already lists every installed browser and takes one link at a time, so one
link gets the in-app tab, the default browser, and the chooser, without the browsers listed again. Several links get
the installed browsers instead of the chooser.
*/
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
