import {useEffect, useMemo, useSyncExternalStore} from 'react';
import {installedBrowsers} from '../../modules/open-links';
import {isPrivateView, useView, type View} from '../library/view';
import {openChoices} from '../platform/open-choices';
import {copyLink} from '../platform/copy-link';
import {openAll, openLink} from '../platform/open-links';
import {ActionSheet, type SheetAction} from '../ui/action-sheet';
import type {Colors} from '../ui/theme';

type Request = {
	urls: string[];
	/**
	Open all: no chooser, and the question asked before opening many, even for a column or session of one link.
	*/
	several: boolean;
	/**
	What the links are, for the question asked before opening many.
	*/
	from: string;
	/**
	Runs once the links were sent off, after the question when there is one, such as marking a session opened.
	*/
	onOpen?: () => void;
};

/**
The request and the library it came from: locking the private library returns to the regular one, which drops a
request made in the private one, so its links cannot be opened after the lock.
*/
let request: (Request & {view: View}) | undefined;
const listeners = new Set<() => void>();

/**
Opens the **Open in** drawer for some links. `OpenInHost`, mounted once near the root, draws it.
*/
export function openIn(next: Request | undefined): void {
	request = next && {...next, view: isPrivateView() ? 'private' : 'regular'};
	for (const listener of listeners) {
		listener();
	}
}

export function OpenInHost() {
	const pending = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => request,
	);
	const view = useView();
	const current = pending?.view === view ? pending : undefined;
	useEffect(() => {
		if (pending && !current) {
			openIn(undefined);
		}
	}, [pending, current]);
	const several = current?.several ?? false;
	// Read when the drawer opens, so a browser installed meanwhile shows up.
	const browsers = useMemo(
		() => (current && several ? installedBrowsers() : []),
		[current, several],
	);
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
						openAll(current.urls, current.from, choice.opener, current.onOpen);
					} else {
						openLink(current.urls[0], choice.opener);
					}
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
				openIn({urls: [url], several: false, from: url});
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
