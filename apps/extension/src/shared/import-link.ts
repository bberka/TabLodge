/*
Import › From a link, for both apps: fetches a page the user named, once, with no credentials, and parses it like an
imported file. A TabLodge shared page comes back as its columns or sessions (import-formats.ts reads its data block).
*/
import {
	ImportFormatError,
	MAX_IMPORT_BYTES,
	parseImportFile,
	type ParsedImport,
} from './import-formats';
import {webUrl} from './web-url';

const TIMEOUT_MS = 20_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
Reads the page at `address` for import. Throws ImportFormatError with a message to show when the address is not a
web address, the page cannot be fetched, or it holds no links.
*/
export async function importFromLink(
	send: Fetch,
	address: string,
): Promise<ParsedImport> {
	const url = webUrl(address);
	if (!url) {
		throw new ImportFormatError(
			'Enter a web address that starts with https:// or http://.',
		);
	}

	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, TIMEOUT_MS);
	try {
		let response: Response;
		try {
			response = await send(url, {
				credentials: 'omit',
				cache: 'no-store',
				signal: controller.signal,
			});
		} catch {
			throw new ImportFormatError(
				'Could not read that link. Check that the address is right and that you are online.',
			);
		}

		if (response.status === 404) {
			throw new ImportFormatError(
				'Nothing is at that link. A shared page that was deleted shows this too.',
			);
		}

		if (!response.ok) {
			throw new ImportFormatError(
				`That link answered with an error (${response.status}). Try again later.`,
			);
		}

		if (Number(response.headers.get('content-length')) > MAX_IMPORT_BYTES) {
			throw new ImportFormatError(TOO_LARGE);
		}

		return parseImportFile(await readCapped(response));
	} finally {
		// Held until the body is read, so a server that sends headers and then stalls still times out.
		clearTimeout(timer);
	}
}

const TOO_LARGE = 'That page is larger than 45 MB.';

/**
The body as text, stopped at MAX_IMPORT_BYTES even when the server sent no Content-Length. React Native's fetch has
no body stream, so there the whole text is read and then measured.
*/
async function readCapped(response: Response): Promise<string> {
	try {
		const reader = response.body?.getReader();
		if (!reader) {
			const text = await response.text();
			if (text.length > MAX_IMPORT_BYTES) {
				throw new ImportFormatError(TOO_LARGE);
			}

			return text;
		}

		const decoder = new TextDecoder();
		let text = '';
		let bytes = 0;
		for (;;) {
			const {done, value} = await reader.read();
			if (done) {
				return text + decoder.decode();
			}

			bytes += value.byteLength;
			if (bytes > MAX_IMPORT_BYTES) {
				void reader.cancel();
				throw new ImportFormatError(TOO_LARGE);
			}

			text += decoder.decode(value, {stream: true});
		}
	} catch (error) {
		throw error instanceof ImportFormatError
			? error
			: new ImportFormatError(
					'Could not read that link. The page stopped loading before it finished.',
				);
	}
}
