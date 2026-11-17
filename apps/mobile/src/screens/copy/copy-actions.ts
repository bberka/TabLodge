import type {SheetAction} from '../../ui/action-sheet';
import type {Colors} from '../../ui/theme';
import {notify} from '../../ui/dialog';
import {showSnack} from '../../ui/snackbar';
import {keepCopy} from '../../library/page-copies';
import {openReader} from './reader';

/**
Keep a copy, and Open copy once one exists, for a link's menu. The private library gets neither: copies are never
kept for it.
*/
export function copyActions(
	url: string,
	{
		colors,
		hasCopy,
		isPrivate,
	}: {colors: Colors; hasCopy: boolean; isPrivate: boolean},
): SheetAction[] {
	if (isPrivate) {
		return [];
	}

	const keep: SheetAction = {
		icon: 'download-outline',
		label: hasCopy ? 'Keep a new copy' : 'Keep a copy',
		hint: hasCopy ? 'Replaces the copy on this phone' : undefined,
		color: colors.info,
		onPress() {
			showSnack('Keeping a copy…');
			void keepCopy(url).then((outcome) => {
				if (outcome.ok) {
					showSnack('Copy kept', {
						label: 'Open',
						run() {
							openReader(url);
						},
					});
				} else {
					notify('Could not keep a copy', outcome.error);
				}
			});
		},
	};
	return hasCopy
		? [
				{
					icon: 'document-text-outline',
					label: 'Open copy',
					color: colors.info,
					onPress() {
						openReader(url);
					},
				},
				keep,
			]
		: [keep];
}

/**
A link menu with the copy actions added just above its first destructive action.
*/
export function withCopyActions(
	actions: SheetAction[],
	extra: SheetAction[],
): SheetAction[] {
	const at = actions.findIndex((action) => action.destructive);
	return at === -1
		? [...actions, ...extra]
		: [...actions.slice(0, at), ...extra, ...actions.slice(at)];
}
