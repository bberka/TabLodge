import {
	ImportFormatError,
	MAX_IMPORT_BYTES,
	parseImportFile,
	type ParsedImport,
} from './import-formats';
import {SHARED_PAGE_PASSWORD_HEADER} from './sync/shared-pages';
import {webUrl} from './web-url';

const TIMEOUT_MS = 20_000;
export const IMPORT_TOO_LARGE = 'That page is larger than 45 MB.';

export class ImportPasswordRequiredError extends ImportFormatError {
	readonly wrongPassword: boolean;

	constructor(wrongPassword: boolean) {
		super(
			wrongPassword
				? 'Incorrect password. Try again.'
				: 'This shared page is password-protected.',
		);
		this.name = 'ImportPasswordRequiredError';
		this.wrongPassword = wrongPassword;
	}
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function allowsPasswordTransport(address: string): boolean {
	try {
		const parsed = new URL(address);
		return (
			parsed.protocol === 'https:' ||
			(parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname))
		);
	} catch {
		return false;
	}
}

export async function importFromLink(
	send: Fetch,
	address: string,
	{signal, password}: {signal?: AbortSignal; password?: string} = {},
): Promise<ParsedImport> {
	const url = webUrl(address);
	if (!url) {
		throw new ImportFormatError(
			'Enter a web address that starts with https:// or http://.',
		);
	}

	if (password !== undefined && !allowsPasswordTransport(url)) {
		throw new ImportFormatError(
			'Passwords can only be sent over HTTPS (or localhost).',
		);
	}

	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, TIMEOUT_MS);
	const stopWithCaller = () => {
		controller.abort();
	};

	signal?.addEventListener('abort', stopWithCaller);
	try {
		let response: Response;
		try {
			const init: RequestInit =
				password === undefined
					? {
							credentials: 'omit',
							cache: 'no-store',
							signal: controller.signal,
						}
					: {
							method: 'POST',
							headers: {
								'Content-Type': 'application/x-www-form-urlencoded',
							},
							body: new URLSearchParams({password}).toString(),
							credentials: 'omit',
							cache: 'no-store',
							signal: controller.signal,
						};
			response = await send(url, init);
		} catch (error) {
			throw error instanceof ImportFormatError
				? error
				: new ImportFormatError(
						'Could not read that link. Check that the address is right and that you are online.',
					);
		}

		if (
			response.status === 401 &&
			response.headers.get(SHARED_PAGE_PASSWORD_HEADER) === '1'
		) {
			throw new ImportPasswordRequiredError(password !== undefined);
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
			throw new ImportFormatError(IMPORT_TOO_LARGE);
		}

		return parseImportFile(await readCapped(response));
	} finally {
		controller.abort();
		clearTimeout(timer);
		signal?.removeEventListener('abort', stopWithCaller);
	}
}

async function readCapped(response: Response): Promise<string> {
	try {
		const reader = response.body?.getReader();
		if (!reader) {
			const text = await response.text();
			if (utf8Bytes(text) > MAX_IMPORT_BYTES) {
				throw new ImportFormatError(IMPORT_TOO_LARGE);
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
				throw new ImportFormatError(IMPORT_TOO_LARGE);
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

export function utf8Bytes(text: string): number {
	let bytes = 0;
	for (const char of text) {
		const code = char.codePointAt(0)!;
		bytes += code < 0x80 ? 1 : code < 0x8_00 ? 2 : code < 0x1_00_00 ? 3 : 4;
	}

	return bytes;
}
