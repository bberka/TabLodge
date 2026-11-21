import {
	ImportFormatError,
	MAX_IMPORT_BYTES,
} from '../../../extension/src/shared/import-formats';
import {
	IMPORT_TOO_LARGE,
	utf8Bytes,
} from '../../../extension/src/shared/import-link';

export type ReadRequest = {
	open(method: string, url: string): void;
	send(): void;
	abort(): void;
	readonly status: number;
	readonly responseText: string;
	withCredentials: boolean;
	addEventListener(
		type: 'progress',
		listener: (event: {loaded: number}) => void,
	): void;
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

			let measured = 0;
			let bytes = 0;
			request.addEventListener('progress', (event) => {
				const text = request.responseText;
				bytes += utf8Bytes(text.slice(measured));
				measured = text.length;
				if (Math.max(event.loaded, bytes) > maxBytes) {
					stop(new ImportFormatError(IMPORT_TOO_LARGE));
				}
			});

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
