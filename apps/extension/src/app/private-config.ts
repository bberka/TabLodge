export const PRIVATE_CONFIG_KEY = 'tablodge.private.config';
export const PRIVATE_STORAGE_PREFIX = 'tablodge.private.';
export const PRIVATE_RELOAD_FOCUS_KEY = 'tablodge.private.focus';

export {PRIVATE_ACCENT_DEFAULT, PRIVATE_ACCENT_SAME} from '../shared/accents';

export function privateConfigNeedsReload(previous: unknown, next: unknown) {
	const before = previous as {mode?: unknown; configured?: unknown} | undefined;
	const after = next as {mode?: unknown; configured?: unknown} | undefined;
	return !(
		before &&
		after &&
		before.mode === after.mode &&
		before.configured === after.configured
	);
}

export const inPrivateWindow = () =>
	Boolean(globalThis.chrome?.extension?.inIncognitoContext);

export function reloadPrivatePage() {
	sessionStorage.setItem(PRIVATE_RELOAD_FOCUS_KEY, 'true');
	location.reload();
}
