/*
The default name of a session this phone makes from saved links, by the same Session name settings as the extension.
*/
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

/**
The name for a new session holding `urls`, the first with its page `title`. An `ask` style falls back to its fallback
style, since the name field on the save sheet is where the phone asks and an empty one asks for the default.
*/
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
