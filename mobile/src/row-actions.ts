import type {RowAction} from './preferences';
import type {Colors} from './theme';
import type {IconName} from './ui';

/**
How each bookmark action looks wherever it is named: the swipe reveal, the settings, and the menus.
*/
export function rowActionLook(
	action: RowAction,
	colors: Colors,
): {label: string; icon: IconName; color: string} {
	switch (action) {
		case 'open': {
			return {label: 'Open', icon: 'open-outline', color: colors.accent};
		}

		case 'edit': {
			return {label: 'Edit', icon: 'create-outline', color: colors.warn};
		}

		case 'move': {
			return {label: 'Move', icon: 'folder-open-outline', color: colors.ok};
		}

		case 'delete': {
			return {label: 'Delete', icon: 'trash-outline', color: colors.danger};
		}

		default: {
			return {
				label: 'Nothing',
				icon: 'remove-circle-outline',
				color: colors.muted,
			};
		}
	}
}
