import type {
	LinkAction,
	RowAction,
	SessionAction,
} from '../settings/preferences';
import type {Colors} from '../ui/theme';
import type {IconName} from '../ui/widgets';

export function rowActionLook(
	action: RowAction,
	colors: Colors,
): {label: string; icon: IconName; color: string} {
	switch (action) {
		case 'open': {
			return {label: 'Open', icon: 'open-outline', color: colors.accent};
		}

		case 'edit': {
			return {label: 'Edit', icon: 'create-outline', color: colors.teal};
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
				color: colors.teal,
			};
		}

		case 'move': {
			return {label: 'Move', icon: 'folder-open-outline', color: colors.ok};
		}

		case 'archive': {
			return archived
				? {
						label: 'Unarchive',
						icon: 'arrow-undo-outline',
						color: colors.warn,
					}
				: {label: 'Archive', icon: 'archive-outline', color: colors.warn};
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

export function linkActionLook(
	action: LinkAction,
	colors: Colors,
): {label: string; icon: IconName; color: string} {
	switch (action) {
		case 'open': {
			return {label: 'Open', icon: 'open-outline', color: colors.accent};
		}

		case 'edit': {
			return {label: 'Edit', icon: 'create-outline', color: colors.teal};
		}

		case 'bookmark': {
			return {
				label: 'Add to bookmarks',
				icon: 'bookmark-outline',
				color: colors.ok,
			};
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
