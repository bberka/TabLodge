export const PRIVATE_CONFIG_KEY = 'tablodge.private.config';
export const PRIVATE_STORAGE_PREFIX = 'tablodge.private.';
export const PRIVATE_RELOAD_FOCUS_KEY = 'tablodge.private.focus';

export function reloadPrivatePage() {
	sessionStorage.setItem(PRIVATE_RELOAD_FOCUS_KEY, 'true');
	location.reload();
}
