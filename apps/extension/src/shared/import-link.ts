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
	} finally {
		clearTimeout(timer);
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
		throw new ImportFormatError('That page is larger than 45 MB.');
	}

	return parseImportFile(await response.text());
}
