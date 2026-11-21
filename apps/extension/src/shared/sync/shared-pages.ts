/*
Shared pages: a Share › Web page snapshot uploaded to the sync server, which serves it to anyone with its link at
/p/<id>. The server stores the page as it came and never reads library records for it. These are the parts of the
protocol the server needs too; the calls a device makes are in shared-pages-client.ts.
*/
/**
Listed in /v1/status `features` by a server that takes shared pages.
*/
export const SHARED_PAGES_FEATURE = 'shared-pages';
/**
Listed by a server whose pages can be imported: `POST /v1/pages` keeps the `id` and `source` a device sends, so a
page can link to its own address and be found again from the column or session it came from, and `/p/<id>` may be
read from any origin.
*/
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

/**
A new page id: 22 characters with 6 random bits each.
*/
export const newSharedPageId = () =>
	Array.from(
		crypto.getRandomValues(new Uint8Array(22)),
		(byte) => ID_ALPHABET[byte % 64],
	).join('');
