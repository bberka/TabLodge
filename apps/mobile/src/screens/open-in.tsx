import {useMemo, useSyncExternalStore} from 'react';
import {installedBrowsers} from '../../modules/open-links';
import {openChoices} from '../platform/open-choices';
import {copyLink} from '../platform/copy-link';
import {openAll, openLink} from '../platform/open-links';
import {ActionSheet, type SheetAction} from '../ui/action-sheet';
import type {Colors} from '../ui/theme';

type Request = {
	urls: string[];
	/**
	What the links are, for the question asked before opening many.
	*/
	from: string;
	/**
	Runs once the links were sent off, such as marking a session opened.
	*/
	onOpen?: () => void;
};

let request: Request | undefined;
const listeners = new Set<() => void>();

/**
Opens the **Open in** drawer for some links. `OpenInHost`, mounted once near the root, draws it.
*/
export function openIn(next: Request | undefined): void {
	request = next;
	for (const listener of listeners) {
		listener();
	}
}

export function OpenInHost() {
	const current = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => request,
	);
	// Read when the drawer opens, so a browser installed meanwhile shows up.
	const browsers = useMemo(
		() => (current ? installedBrowsers() : []),
		[current],
	);
	const several = (current?.urls.length ?? 0) > 1;
	const actions: SheetAction[] = current
		? openChoices(browsers, {several}).map((choice) => ({
				key: choice.key,
				label: choice.label,
				image: choice.image,
				icon:
					choice.opener.how === 'inapp'
						? 'albums-outline'
						: choice.opener.how === 'chooser'
							? 'apps-outline'
							: 'globe-outline',
				onPress() {
					if (several) {
						openAll(current.urls, current.from, choice.opener);
					} else {
						openLink(current.urls[0], choice.opener);
					}

					current.onOpen?.();
				},
			}))
		: [];
	return (
		<ActionSheet
			visible={current !== undefined}
			title={several ? 'Open all in' : 'Open in'}
			actions={actions}
			onClose={() => {
				openIn(undefined);
			}}
		/>
	);
}

/**
Open in… and Copy link, for a link's menu, after its Open.
*/
export function linkOpenActions(url: string, colors: Colors): SheetAction[] {
	return [
		{
			icon: 'navigate-outline',
			label: 'Open in…',
			hint: 'Another browser or app, this once',
			onPress() {
				openIn({urls: [url], from: url});
			},
		},
		{
			icon: 'copy-outline',
			label: 'Copy link',
			color: colors.info,
			onPress() {
				void copyLink(url);
			},
		},
	];
}
