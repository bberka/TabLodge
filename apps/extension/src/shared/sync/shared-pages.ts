export const SHARED_PAGES_FEATURE = 'shared-pages';
export const SHARED_PAGE_IMPORT_FEATURE = 'shared-page-import';
export const SHARED_PAGE_LIVE_PASSWORD_FEATURE = 'shared-page-live-password';
export const SHARED_PAGE_PASSWORD_HEADER = 'X-TabLodge-Password-Required';
export const SHARED_PAGE_PREFIX = '/p/';
export const MAX_SHARED_PAGE_TITLE = 200;
export const MAX_SHARED_PAGE_SOURCE = 100;
export type SharedPageMode = 'snapshot' | 'live';
export const SHARED_PAGE_MODES: readonly SharedPageMode[] = [
	'snapshot',
	'live',
];
export const isSharedPageMode = (value: unknown): value is SharedPageMode =>
	value === 'snapshot' || value === 'live';
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
