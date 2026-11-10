export const PRIVATE_CONFIG_KEY = 'tablodge.private.config';
export const PRIVATE_STORAGE_PREFIX = 'tablodge.private.';
export const PRIVATE_RELOAD_FOCUS_KEY = 'tablodge.private.focus';

export {PRIVATE_ACCENT_DEFAULT, PRIVATE_ACCENT_SAME} from '../shared/accents';

/**
Only a change of library mode or setup needs a page reload; the redirect and accent apply live.
*/
export function privateConfigNeedsReload(
	previous: {mode?: unknown; configured?: unknown} | undefined,
	next: {mode?: unknown; configured?: unknown} | undefined,
) {
	return !(
		previous &&
		next &&
		previous.mode === next.mode &&
		previous.configured === next.configured
	);
}

/**
True in a private (incognito) window. Automatic snapshots never run there, so their entry points are hidden.
*/
export const inPrivateWindow = () =>
	Boolean(globalThis.chrome?.extension?.inIncognitoContext);

export function reloadPrivatePage() {
	sessionStorage.setItem(PRIVATE_RELOAD_FOCUS_KEY, 'true');
	location.reload();
}
