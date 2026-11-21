/*
Shared pages: a Share › Web page snapshot uploaded to the sync server, which serves it to anyone with its link at
/p/<id>. The server stores the page as it came and never reads library records for it. These are the parts of the
protocol the server needs too; the calls a device makes are in shared-pages-client.ts.
*/
/**
Listed in /v1/status `features` by a server that takes shared pages.
*/
export const SHARED_PAGES_FEATURE = 'shared-pages';
export const SHARED_PAGE_IMPORT_FEATURE = 'shared-page-import';
export const SHARED_PAGE_PREFIX = '/p/';
export const MAX_SHARED_PAGE_TITLE = 200;
export const MAX_SHARED_PAGE_SOURCE = 100;
/**
22 random base64url characters (132 bits), so a link cannot be guessed.
*/
export const SHARED_PAGE_ID = /^[\w-]{22}$/;

const ID_ALPHABET =
	'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const newSharedPageId = (
	randomBytes: (count: number) => Uint8Array = (count) =>
		crypto.getRandomValues(new Uint8Array(count)),
) => Array.from(randomBytes(22), (byte) => ID_ALPHABET[byte % 64]).join('');

export function isSharedPageUrl(address: string | undefined): boolean {
	try {
		const {protocol, pathname} = new URL(address ?? '');
		return (
			(protocol === 'https:' || protocol === 'http:') &&
			/\/p\/[\w-]{22}$/.test(pathname)
		);
	} catch {
		return false;
	}
}
