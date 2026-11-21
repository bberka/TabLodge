/*
How a new session is named and when an idle session is archived. The extension and the Android app share both, so the
Session name and Archive settings mean the same on each (#424).
*/
import {
	DEFAULT_SETTINGS,
	SESSION_NAME_TEMPLATE_MAX,
	cleanText,
	isArchivedFolderName,
} from './library-normalize';
import type {Folder, Session, Settings} from './types';

/**
The style that builds the name: `ask` falls back to its fallback style whenever a session is named without asking
(or the answer was left empty).
*/
export function builtNameStyle(settings: {
	sessionNameStyle: Settings['sessionNameStyle'];
	sessionNameFallback: Settings['sessionNameFallback'];
}): Settings['sessionNameFallback'] {
	return settings.sessionNameStyle === 'ask'
		? settings.sessionNameFallback
		: settings.sessionNameStyle;
}

const SESSION_NAME_STYLE_TEMPLATES: Record<string, string> = {
	title: '{title}',
	datetime: '{date} · {time}',
	'date-title': '{date} · {title}',
};

export type SessionNameParts = {
	style: Settings['sessionNameFallback'];
	template: string;
	/**
	Title and address of the first saved tab.
	*/
	title: string;
	url: string;
	count: number;
	/**
	1-based window number when saving all windows; 0 or omitted otherwise.
	*/
	windowNumber?: number;
	now: Date;
	locale: string;
};

/**
The name for a new session. `{date}` is "Sat, Oct 25" (no year: a new session is always named for today),
`{time}` the locale's short time, `{weekday}` a short weekday. Unknown `{...}` tokens stay as typed.
*/
export function formatSessionName(parts: SessionNameParts): string {
	const format = (options: Intl.DateTimeFormatOptions) => {
		try {
			return new Intl.DateTimeFormat(parts.locale, options).format(parts.now);
		} catch {
			return new Intl.DateTimeFormat('en-US', options).format(parts.now);
		}
	};

	let host = '';
	try {
		host = new URL(parts.url).hostname.replace(/^www\./i, '');
	} catch {
		/*
		A page without a usable address has no domain.
		*/
	}

	const values: Record<string, () => string> = {
		date: () => format({weekday: 'short', month: 'short', day: 'numeric'}),
		time: () => format({timeStyle: 'short'}),
		weekday: () => format({weekday: 'short'}),
		title: () => cleanText(parts.title, host, 500),
		domain: () => host,
		count: () => String(parts.count),
		window: () => (parts.windowNumber ? String(parts.windowNumber) : ''),
	};
	const template =
		parts.style === 'custom'
			? cleanText(
					parts.template,
					DEFAULT_SETTINGS.sessionNameTemplate,
					SESSION_NAME_TEMPLATE_MAX,
				)
			: (SESSION_NAME_STYLE_TEMPLATES[parts.style] ??
				SESSION_NAME_STYLE_TEMPLATES['date-title']);
	return cleanText(
		template
			.replaceAll(/\{(\w+)\}/g, (token, key: string) =>
				Object.hasOwn(values, key) ? values[key]() : token,
			)
			// Narrow no-break spaces from the time format, and gaps left by an empty placeholder
			.replaceAll(/\s+/g, ' '),
		'Saved session',
		120,
	);
}

/**
The sessions that were not opened, saved, or edited in the last `days` days and are not in the Archived folder yet.
Nothing for `days` of 0, which is "never".
*/
export function staleSessions(
	sessions: readonly Session[],
	folders: ReadonlyArray<Pick<Folder, 'id' | 'name'>>,
	days: number,
	now: number,
): Session[] {
	if (days === 0) {
		return [];
	}

	const cutoff = now - days * 86_400_000;
	const archivedId = folders.find((folder) =>
		isArchivedFolderName(folder.name),
	)?.id;
	return sessions.filter(
		(session) =>
			session.folderId !== archivedId &&
			Math.max(
				session.lastOpenedAt ?? 0,
				session.updatedAt,
				session.createdAt,
			) < cutoff,
	);
}
