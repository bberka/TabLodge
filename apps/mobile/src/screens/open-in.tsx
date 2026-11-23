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
	several: boolean;
	from: string;
	onOpen?: () => void;
};

let request: (Request & {view: View}) | undefined;
const listeners = new Set<() => void>();

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
