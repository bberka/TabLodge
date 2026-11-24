import {SAVE_TARGET_CHOICES} from '../../../../extension/src/shared/choice-copy';
import type {IconName} from '../../ui/widgets';
import {asChoices} from '../settings/select-row';

export type SaveTarget = (typeof SAVE_TARGET_CHOICES)[number]['value'];

const ICONS: Record<SaveTarget, IconName> = {
	bookmark: 'bookmark-outline',
	session: 'albums-outline',
};

export const SAVE_TARGET_ROWS = asChoices(SAVE_TARGET_CHOICES).map(
	(choice) => ({
		...choice,
		icon: ICONS[choice.id],
	}),
);
