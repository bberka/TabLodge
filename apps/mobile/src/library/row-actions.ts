import type {RowAction, SessionAction} from '../settings/preferences';
import type {Colors} from '../ui/theme';
import type {IconName} from '../ui/ui';

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
	archived = false,
): {label: string; icon: IconName; color: string} {
	switch (action) {
		case 'open': {
			return {label: 'Open all', icon: 'albums-outline', color: colors.accent};
		}

		case 'rename': {
			return {
				label: 'Edit details',
				icon: 'create-outline',
				color: colors.warn,
			};
		}

		case 'move': {
			return {label: 'Move', icon: 'folder-open-outline', color: colors.ok};
		}

		case 'archive': {
			// A session in the Archived folder is taken out of it instead.
			return archived
				? {
						label: 'Unarchive',
						icon: 'arrow-undo-outline',
						color: colors.teal,
					}
				: {label: 'Archive', icon: 'archive-outline', color: colors.teal};
		}

		case 'share': {
			return {label: 'Share', icon: 'share-outline', color: colors.info};
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
