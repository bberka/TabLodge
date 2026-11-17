/*
The calls a device makes for shared pages (see shared-pages.ts), used by the extension's worker and the Android app.
*/
import {isRecord} from '../library-values';
import {callServer, type SyncConfig, SyncError, type SyncHost} from './client';
import {
	MAX_SHARED_PAGE_TITLE,
	SHARED_PAGE_ID,
	SHARED_PAGE_PREFIX,
	SHARED_PAGES_FEATURE,
} from './shared-pages';

export type SharedPage = {
	id: string;
	title: string;
	/**
	UTF-8 bytes of the page.
	*/
	size: number;
	createdAt: number;
	/**
	The public link: the server address the device connected with, plus /p/<id>.
	*/
	url: string;
};

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
		url: `${server}${SHARED_PAGE_PREFIX}${value.id}`,
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

/**
Whether the server takes shared pages. False for a server too old to have them, and when it cannot be reached.
*/
export async function serverSharesPages(
	send: SyncHost['fetch'],
	target: SyncConfig,
): Promise<boolean> {
	try {
		const body = await ask(send, target, '/v1/status');
		return (
			isRecord(body) &&
			Array.isArray(body.features) &&
			body.features.includes(SHARED_PAGES_FEATURE)
		);
	} catch {
		return false;
	}
}

/**
Uploads a page made by `shareHtmlPage` and returns its new link. Each upload is a new link; the old one stays until
it is deleted.
*/
export async function uploadSharedPage(
	send: SyncHost['fetch'],
	target: SyncConfig,
	title: string,
	html: string,
): Promise<SharedPage> {
	const body = await ask(send, target, '/v1/pages', {
		method: 'POST',
		body: JSON.stringify({
			title: title.slice(0, MAX_SHARED_PAGE_TITLE),
			html,
		}),
	});
	const page = parsePage(body, target.url);
	if (!page) {
		throw new SyncError('server', 'The sync server sent a broken answer.');
	}

	return page;
}

/**
Every page on the server, newest first.
*/
export async function listSharedPages(
	send: SyncHost['fetch'],
	target: SyncConfig,
): Promise<SharedPage[]> {
	const body = await ask(send, target, '/v1/pages');
	const pages = isRecord(body) && Array.isArray(body.pages) ? body.pages : [];
	return pages.flatMap((entry) => parsePage(entry, target.url) ?? []);
}

/**
Deletes a page, so its link answers 404. A page that is already gone counts as deleted.
*/
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
