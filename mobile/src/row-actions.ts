import type {RowAction, SessionAction} from './preferences';
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

/**
How each session action looks in the swipe reveal, the settings, and the session menu.
*/
export function sessionActionLook(
	action: SessionAction,
	colors: Colors,
): {label: string; icon: IconName; color: string} {
	switch (action) {
		case 'open': {
			return {label: 'Open all', icon: 'albums-outline', color: colors.accent};
		}

		case 'color': {
			return {
				label: 'Change color',
				icon: 'color-palette-outline',
				color: colors.accent,
			};
		}

		case 'rename': {
			return {label: 'Rename', icon: 'create-outline', color: colors.warn};
		}

		case 'move': {
			return {label: 'Move', icon: 'folder-open-outline', color: colors.ok};
		}

		case 'archive': {
			return {label: 'Archive', icon: 'archive-outline', color: colors.muted};
		}

		case 'share': {
			return {label: 'Share links', icon: 'share-outline', color: colors.ok};
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
