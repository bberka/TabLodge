import {
	DEFAULT_SETTINGS,
	SESSION_NAME_TEMPLATE_MAX,
	cleanText,
	isArchivedFolderName,
} from './library-normalize';
import type {Folder, Session, Settings} from './types';

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
	title: string;
	url: string;
	count: number;
	windowNumber?: number;
	now: Date;
	locale: string;
};

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
	} catch {}

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
			.replaceAll(/\s+/g, ' '),
		'Saved session',
		120,
	);
}

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
