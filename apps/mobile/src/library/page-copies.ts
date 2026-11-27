import {parseHTML} from 'linkedom';
import {useSyncExternalStore} from 'react';
import {
	copyLinkUrls,
	createCopyStore,
	type CopyStorage,
	type PageCopy,
} from '../../../extension/src/shared/page-copy';
import {extractPageCopy} from '../../../extension/src/shared/page-extract';
import {isRecord} from '../../../extension/src/shared/library-values';
import {SYNC_CONFIG_KEY} from '../../../extension/src/shared/sync/client';
import {readJson, removeKeys, writeJson} from '../platform/storage';
import {getLibrary, subscribeLibrary, whenLibraryLoaded} from './library-store';
import {USER_AGENT} from './link-preview';
import {serverFeatures} from './server-features';
import {onTrashChange, readTrash} from './trash-storage';

const WAIT_MS = 20_000;
const MAX_PAGE_BYTES = 3_000_000;
const SWEEP_DELAY_MS = 2 * 60_000;

const storage: CopyStorage = {
	async get(keys) {
		const values = await Promise.all(keys.map(async (key) => readJson(key)));
		return Object.fromEntries(
			keys.flatMap((key, index) =>
				values[index] === undefined ? [] : [[key, values[index]]],
			),
		);
	},
	async set(items) {
		await Promise.all(
			Object.entries(items).map(async ([key, value]) => writeJson(key, value)),
		);
	},
	remove: removeKeys,
};

const copies = createCopyStore(storage);

let urls: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

async function refresh() {
	urls = new Set((await copies.list()).map((entry) => entry.url));
	for (const listener of listeners) {
		listener();
	}
}

export const useCopyUrls = (): ReadonlySet<string> =>
	useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => urls,
	);

export const readCopy = async (url: string): Promise<PageCopy | undefined> =>
	copies.read(url);

export async function deleteCopy(url: string): Promise<PageCopy | undefined> {
	const copy = await copies.read(url);
	await copies.remove(url);
	await refresh();
	return copy;
}

export async function putCopyBack(copy: PageCopy): Promise<KeepOutcome> {
	const kept = await copies.keep(copy);
	await refresh();
	return kept.ok ? {ok: true} : {ok: false, error: kept.error};
}

async function server(): Promise<{url: string; token: string} | undefined> {
	const saved = await readJson(SYNC_CONFIG_KEY);
	return isRecord(saved) &&
		typeof saved.url === 'string' &&
		typeof saved.token === 'string'
		? {url: saved.url, token: saved.token}
		: undefined;
}

async function fetchHtml(
	page: string,
	signal: AbortSignal,
): Promise<string | undefined> {
	const connected = await server();
	if (
		connected &&
		(await serverFeatures(connected.url))?.includes('page-source')
	) {
		const response = await fetch(
			`${connected.url}/v1/page-source?url=${encodeURIComponent(page)}`,
			{signal, headers: [['Authorization', `Bearer ${connected.token}`]]},
		);
		const body: unknown = response.ok ? await response.json() : undefined;
		return isRecord(body) && typeof body.html === 'string'
			? body.html
			: undefined;
	}

	const response = await fetch(page, {
		signal,
		headers: [
			['Accept', 'text/html'],
			['User-Agent', USER_AGENT],
		],
	});
	const length = Number(response.headers.get('content-length') ?? 0);
	if (
		!response.ok ||
		!(response.headers.get('content-type') ?? '').includes('html') ||
		length > MAX_PAGE_BYTES
	) {
		return undefined;
	}

	const html = await response.text();
	return html.length > MAX_PAGE_BYTES ? undefined : html;
}

export type KeepOutcome = {ok: true} | {ok: false; error: string};

export async function keepCopy(url: string): Promise<KeepOutcome> {
	const controller = new AbortController();
	const giveUp = setTimeout(() => {
		controller.abort();
	}, WAIT_MS);
	let html: string | undefined;
	try {
		html = await fetchHtml(url, controller.signal);
	} catch {
		html = undefined;
	} finally {
		clearTimeout(giveUp);
	}

	if (html === undefined) {
		return {
			ok: false,
			error:
				'The page could not be read. It may be offline, need a sign-in, or not be a web page.',
		};
	}

	const {document} = parseHTML(html);
	const kept = await copies.keep(extractPageCopy(document, url));
	await refresh();
	return kept.ok ? {ok: true} : {ok: false, error: kept.error};
}

let sweepTimer: ReturnType<typeof setTimeout> | undefined;

let sweepHolds = 0;

export function holdCopySweep(): () => void {
	sweepHolds += 1;
	let released = false;
	return () => {
		if (released) {
			return;
		}

		released = true;
		sweepHolds -= 1;
		scheduleSweep();
	};
}

async function sweep() {
	if (sweepHolds > 0) {
		return;
	}

	const library = getLibrary();
	const trash = await readTrash('regular', library.settings.trashRetentionDays);
	const live = copyLinkUrls(library, trash);
	if (live.size === 0) {
		return;
	}

	await copies.sweep(live);
	await refresh();
}

const scheduleSweep = () => {
	clearTimeout(sweepTimer);
	sweepTimer = setTimeout(() => {
		void sweep().catch(() => undefined);
	}, SWEEP_DELAY_MS);
};

export async function startPageCopies(): Promise<void> {
	await refresh();
	await whenLibraryLoaded();
	subscribeLibrary(scheduleSweep);
	onTrashChange(scheduleSweep);
	await sweep().catch(() => undefined);
}

export const allCopies = async (): Promise<PageCopy[]> => copies.all();

export async function restoreCopies(values: readonly unknown[]): Promise<void> {
	await copies.restore(values);
	await refresh();
}
