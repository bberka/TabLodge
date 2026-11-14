import {useEffect, useState} from 'react';
import {isRecord} from '../../../extension/src/shared/library-values';
import {SYNC_CONFIG_KEY} from '../../../extension/src/shared/sync/client';
import {readJson} from '../platform/storage';
import {readPage} from './page-title';

/**
Sent with requests the phone makes to a site itself. Some sites refuse the network library's own default.
*/
export const USER_AGENT =
	'Mozilla/5.0 (Linux; Android) TabLodge/1.0 link-preview';

export type Preview = {title?: string; description?: string};

const WAIT_MS = 6000;
const DEBOUNCE_MS = 500;
// A page larger than this is not worth downloading for a title.
const MAX_BYTES = 3_000_000;

const text = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() !== '' ? value : undefined;

/**
The sync server's address and token, when a server is connected.
*/
async function server(): Promise<{url: string; token: string} | undefined> {
	const saved = await readJson(SYNC_CONFIG_KEY);
	return isRecord(saved) &&
		typeof saved.url === 'string' &&
		typeof saved.token === 'string'
		? {url: saved.url, token: saved.token}
		: undefined;
}

/**
The title and description of a page. With a server connected, the server reads it, so the site sees the server and not
this phone. Without one, the phone reads the page itself. Nothing when the page cannot be read.
*/
export async function loadPreview(
	page: string,
	signal: AbortSignal,
): Promise<Preview | undefined> {
	const connected = await server();
	if (connected) {
		const response = await fetch(
			`${connected.url}/v1/preview?url=${encodeURIComponent(page)}`,
			{signal, headers: [['Authorization', `Bearer ${connected.token}`]]},
		);
		if (!response.ok) {
			return undefined;
		}

		const body: unknown = await response.json();
		return isRecord(body)
			? {title: text(body.title), description: text(body.description)}
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
		length > MAX_BYTES
	) {
		return undefined;
	}

	return readPage(await response.text());
}

/**
Looks a link up a moment after it stops changing. `loading` is true from the change until the answer, or until it fails.
*/
export function useLinkPreview(
	url: string | undefined,
	enabled: boolean,
): {loading: boolean; preview?: Preview; url?: string} {
	const [state, setState] = useState<{
		loading: boolean;
		preview?: Preview;
		url?: string;
	}>({loading: false});
	useEffect(() => {
		if (!enabled || !url) {
			setState({loading: false});
			return;
		}

		const controller = new AbortController();
		// An answer for an address that has since changed is dropped.
		let live = true;
		setState({loading: true, url});
		const timer = setTimeout(() => {
			const giveUp = setTimeout(() => {
				controller.abort();
			}, WAIT_MS);
			void loadPreview(url, controller.signal)
				.catch(() => undefined)
				.then((preview) => {
					if (live) {
						setState({loading: false, preview, url});
					}
				})
				.finally(() => {
					clearTimeout(giveUp);
				});
		}, DEBOUNCE_MS);
		return () => {
			live = false;
			clearTimeout(timer);
			controller.abort();
		};
	}, [url, enabled]);
	return state;
}
