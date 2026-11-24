export const SHARE_MODE_CHOICES = [
	{
		value: 'snapshot',
		title: 'Snapshot',
		description: 'A frozen copy of what you share now.',
	},
	{
		value: 'live',
		title: 'Live link',
		description: 'The page updates after your edits sync.',
	},
] as const;

export const SAVE_TARGET_CHOICES = [
	{
		value: 'bookmark',
		title: 'Bookmark column',
		description: 'Links go into one of your bookmark columns.',
	},
	{
		value: 'session',
		title: 'Session',
		description: 'Links are added to a saved session.',
	},
] as const;
