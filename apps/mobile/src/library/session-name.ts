import {
	builtNameStyle,
	formatSessionName,
} from '../../../extension/src/shared/session-rules';
import {cleanPageTitle, type LinkSettings} from './links';

const phoneLocale = (): string => {
	try {
		return new Intl.DateTimeFormat().resolvedOptions().locale;
	} catch {
		return 'en-US';
	}
};

export function defaultSessionName(
	settings: LinkSettings,
	links: ReadonlyArray<{url: string; title?: string}>,
	now = new Date(),
): string {
	const first = links[0];
	return formatSessionName({
		style: builtNameStyle(settings),
		template: settings.sessionNameTemplate,
		title: cleanPageTitle(first?.title ?? '', settings.cleanTitles),
		url: first?.url ?? '',
		count: Math.max(new Set(links.map((link) => link.url)).size, 1),
		now,
		locale: phoneLocale(),
	});
}
