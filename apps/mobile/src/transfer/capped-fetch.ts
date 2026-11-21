import {
	ImportFormatError,
	MAX_IMPORT_BYTES,
} from '../../../extension/src/shared/import-formats';
import {IMPORT_TOO_LARGE} from '../../../extension/src/shared/import-link';

export type ReadRequest = {
	open(method: string, url: string): void;
	send(): void;
	abort(): void;
	readonly status: number;
	readonly responseText: string;
	withCredentials: boolean;
	onprogress: XMLHttpRequest['onprogress'];
	addEventListener(
		type: 'load' | 'error' | 'timeout',
		listener: () => void,
	): void;
};

export function cappedFetch(
	makeRequest: () => ReadRequest = () => new XMLHttpRequest(),
	maxBytes = MAX_IMPORT_BYTES,
) {
	return async (url: string, init: RequestInit = {}): Promise<Response> =>
		new Promise((resolve, reject) => {
			const request = makeRequest();
			const stop = (error: Error) => {
				request.abort();
				reject(error);
			};

			const failed = () => {
				reject(new TypeError('Network request failed'));
			};

			init.signal?.addEventListener('abort', () => {
				stop(new TypeError('The read was cancelled.'));
			});
			request.open('GET', url);
			request.withCredentials = false;
			// eslint-disable-next-line unicorn/prefer-add-event-listener -- React Native's XMLHttpRequest sends progress events only when onprogress is set before send()
			request.onprogress = (event) => {
				if (event.loaded > maxBytes) {
					stop(new ImportFormatError(IMPORT_TOO_LARGE));
				}
			};

			request.addEventListener('load', () => {
				if (request.status < 200) {
					failed();
					return;
				}

				resolve(new Response(request.responseText, {status: request.status}));
			});
			request.addEventListener('error', failed);
			request.addEventListener('timeout', failed);
			request.send();
		});
}
