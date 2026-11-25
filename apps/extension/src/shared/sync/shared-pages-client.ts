import {isRecord} from '../library-values';
import {callServer, type SyncConfig, SyncError, type SyncHost} from './client';
import {
	isSharedPageMode,
	MAX_SHARED_PAGE_SOURCE,
	MAX_SHARED_PAGE_TITLE,
	SHARED_PAGE_ID,
	SHARED_PAGE_IMPORT_FEATURE,
	SHARED_PAGE_LIVE_PASSWORD_FEATURE,
	SHARED_PAGE_PREFIX,
	SHARED_PAGES_FEATURE,
	type SharedPageMode,
} from './shared-pages';

export type SharedPage = {
	id: string;
	title: string;
	size: number;
	createdAt: number;
	updatedAt: number;
	url: string;
	source: string;
	mode: SharedPageMode;
	hasPassword: boolean;
};

export const sharedPageSource = (kind: 'column' | 'session', id: string) =>
	`${kind}:${id}`.slice(0, MAX_SHARED_PAGE_SOURCE);

export const sharedPageUrl = (server: string, id: string) =>
	`${server}${SHARED_PAGE_PREFIX}${id}`;

const ERRORS = new Map([
	[
		'page_too_large',
		'This page is too large for the server. Share fewer links in one page.',
	],
	[
		'pages_full',
		'The server holds as many shared pages as it allows. Delete one in Settings › Sync › Shared pages.',
	],
	['not_found', 'The server no longer has this page.'],
	['page_exists', 'The server already has a page with this link. Share again.'],
	['bad_password', 'Choose a password between 4 and 128 characters.'],
	['not_live', 'This shared page is a snapshot and cannot be updated.'],
]);

function parsePage(value: unknown, server: string): SharedPage | undefined {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		!SHARED_PAGE_ID.test(value.id) ||
		typeof value.title !== 'string' ||
		typeof value.size !== 'number' ||
		typeof value.createdAt !== 'number'
	) {
		return undefined;
	}

	return {
		id: value.id,
		title: value.title,
		size: value.size,
		createdAt: value.createdAt,
		updatedAt:
			typeof value.updatedAt === 'number' ? value.updatedAt : value.createdAt,
		url: sharedPageUrl(server, value.id),
		source: typeof value.source === 'string' ? value.source : '',
		mode: isSharedPageMode(value.mode) ? value.mode : 'snapshot',
		hasPassword: value.hasPassword === true,
	};
}

async function ask(
	send: SyncHost['fetch'],
	target: SyncConfig,
	path: string,
	init?: RequestInit,
) {
	const {status, body} = await callServer(send, target, path, init);
	if (status < 200 || status >= 300) {
		const code =
			isRecord(body) && typeof body.error === 'string' ? body.error : '';
		throw new SyncError(
			'server',
			ERRORS.get(code) ?? `The sync server answered with an error (${status}).`,
		);
	}

	return body;
}

export async function sharedPagesSupport(
	send: SyncHost['fetch'],
	target: SyncConfig,
): Promise<{
	server: 'ready' | 'old' | 'offline';
	keepsIds: boolean;
	supportsLivePassword: boolean;
}> {
	try {
		const body = await ask(send, target, '/v1/status');
		const features =
			isRecord(body) && Array.isArray(body.features) ? body.features : [];
		return features.includes(SHARED_PAGES_FEATURE)
			? {
					server: 'ready',
					keepsIds: features.includes(SHARED_PAGE_IMPORT_FEATURE),
					supportsLivePassword: features.includes(
						SHARED_PAGE_LIVE_PASSWORD_FEATURE,
					),
				}
			: {server: 'old', keepsIds: false, supportsLivePassword: false};
	} catch {
		return {server: 'offline', keepsIds: false, supportsLivePassword: false};
	}
}

export async function uploadSharedPage(
	send: SyncHost['fetch'],
	target: SyncConfig,
	title: string,
	html: string,
	{
		id,
		source,
		mode,
		password,
	}: {
		id?: string;
		source?: string;
		mode?: SharedPageMode;
		password?: string;
	} = {},
): Promise<SharedPage> {
	const body = await ask(send, target, '/v1/pages', {
		method: 'POST',
		body: JSON.stringify({
			title: title.slice(0, MAX_SHARED_PAGE_TITLE),
			html,
			...(id && {id}),
			...(source && {source: source.slice(0, MAX_SHARED_PAGE_SOURCE)}),
			...(mode && {mode}),
			...(password !== undefined && password !== '' && {password}),
		}),
	});
	const page = parsePage(body, target.url);
	if (!page || (id !== undefined && page.id !== id)) {
		throw new SyncError('server', 'The sync server sent a broken answer.');
	}

	return page;
}

export async function updateSharedPage(
	send: SyncHost['fetch'],
	target: SyncConfig,
	id: string,
	title: string,
	html: string,
): Promise<SharedPage> {
	const body = await ask(
		send,
		target,
		`/v1/pages/${encodeURIComponent(id)}/update`,
		{
			method: 'POST',
			body: JSON.stringify({
				title: title.slice(0, MAX_SHARED_PAGE_TITLE),
				html,
			}),
		},
	);
	const page = parsePage(body, target.url);
	if (!page || page.id !== id) {
		throw new SyncError('server', 'The sync server sent a broken answer.');
	}

	return page;
}

export async function listSharedPages(
	send: SyncHost['fetch'],
	target: SyncConfig,
): Promise<SharedPage[]> {
	const body = await ask(send, target, '/v1/pages');
	const pages = isRecord(body) && Array.isArray(body.pages) ? body.pages : [];
	return pages.flatMap((entry) => parsePage(entry, target.url) ?? []);
}

export async function deleteSharedPage(
	send: SyncHost['fetch'],
	target: SyncConfig,
	id: string,
): Promise<void> {
	const {status} = await callServer(
		send,
		target,
		`/v1/pages/${encodeURIComponent(id)}/delete`,
		{method: 'POST'},
	);
	if (status !== 404 && (status < 200 || status >= 300)) {
		throw new SyncError(
			'server',
			`The sync server answered with an error (${status}).`,
		);
	}
}
