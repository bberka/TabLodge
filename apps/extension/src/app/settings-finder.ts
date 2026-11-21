import {sectionId, settingsSections} from './settings-sections';
import {
	SETTING_WORDS,
	settingsFieldGroups,
	type FieldEnvironment,
} from './settings-fields';

export const fieldEntryId = (name: string) => `settings-field-${name}`;

export const finderSettings = (
	environment: FieldEnvironment,
): ReturnType<typeof settingsSections> => [
	...settingsSections(environment.appName, environment.firefox),
	...settingsFieldGroups(environment).flatMap((group) =>
		group.fields.map((field) => ({
			id: fieldEntryId(field.name),
			target: sectionId(group.title),
			title: field.label,
			detail: group.title,
			keywords: [
				'settings',
				...(SETTING_WORDS[field.name] ?? []),
				...('options' in field ? field.options.map(([, label]) => label) : []),
			],
		})),
	),
];
