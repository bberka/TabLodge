import type {FinderItem} from './global-search';

export type ItemActionId =
	| 'restore'
	| 'restore-new-window'
	| 'reveal'
	| 'open'
	| 'open-new-tab'
	| 'open-new-window'
	| 'copy-link'
	| 'switch'
	| 'close-tab';

export type ItemAction = {id: ItemActionId; label: string};

/**
The second level of the palette: what can be done with a result besides its default action. Results with one
obvious action return nothing. `standalone` is the palette window, which has no dashboard to reveal a session on.
*/
export function itemActions(
	item: FinderItem,
	standalone: boolean,
): ItemAction[] {
	switch (item.kind) {
		case 'session': {
			return [
				{id: 'restore', label: 'Restore here'},
				{id: 'restore-new-window', label: 'Restore in a new window'},
				...(standalone
					? []
					: [{id: 'reveal' as const, label: 'Reveal on the dashboard'}]),
			];
		}

		case 'bookmark':
		case 'saved-tab': {
			return [
				{id: 'open', label: 'Open'},
				{id: 'open-new-tab', label: 'Open in a new tab'},
				{id: 'open-new-window', label: 'Open in a new window'},
				{id: 'copy-link', label: 'Copy link'},
			];
		}

		case 'tab': {
			return [
				{id: 'switch', label: 'Switch to tab'},
				{id: 'close-tab', label: 'Close tab'},
			];
		}

		default: {
			return [];
		}
	}
}

export function filterItemActions(
	actions: readonly ItemAction[],
	filter: string,
): ItemAction[] {
	const needle = filter.trim().toLowerCase();
	return needle
		? actions.filter((action) => action.label.toLowerCase().includes(needle))
		: [...actions];
}
