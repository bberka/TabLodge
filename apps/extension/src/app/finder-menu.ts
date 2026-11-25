import type {FinderItem} from '../shared/global-search';

export type ItemActionId =
	| 'restore'
	| 'restore-new-window'
	| 'reveal'
	| 'open'
	| 'open-new-tab'
	| 'open-new-window'
	| 'open-private-window'
	| 'copy-link'
	| 'open-copy'
	| 'switch'
	| 'close-tab';

export type ItemAction = {id: ItemActionId; label: string};

export type ItemActionContext = {
	standalone: boolean;
	copies?: ReadonlySet<string>;
	privateWindow?: boolean;
};

export function itemActions(
	item: FinderItem,
	{standalone, copies, privateWindow}: ItemActionContext,
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
				...(privateWindow
					? [
							{
								id: 'open-private-window' as const,
								label: 'Open in a private window',
							},
						]
					: []),
				{id: 'copy-link', label: 'Copy link'},
				...(item.url && copies?.has(item.url)
					? [{id: 'open-copy' as const, label: 'Open copy'}]
					: []),
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

export function leavesActionMenu(
	event: Pick<
		KeyboardEvent,
		'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
	>,
	field: Pick<HTMLInputElement, 'value' | 'selectionStart' | 'selectionEnd'>,
): boolean {
	if (event.key === 'Escape') {
		return true;
	}

	if (event.key === 'Backspace') {
		return field.value === '';
	}

	return (
		event.key === 'ArrowLeft' &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.shiftKey &&
		field.selectionStart === 0 &&
		field.selectionEnd === 0
	);
}
