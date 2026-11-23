export const LIVE_PATH = '/v1/live';
export const LIVE_PING = 'ping';
export const LIVE_PONG = 'pong';
export const LIVE_UNAUTHORIZED = 4401;
export const LIVE_AUTH_TIMEOUT_MS = 10_000;
export const LIVE_MAX_SOCKETS = 64;

export const cursorMessage = (cursor: number) =>
	JSON.stringify({type: 'cursor', cursor});
export const readyMessage = (cursor: number) =>
	JSON.stringify({type: 'ready', cursor});

/* eslint-disable no-bitwise -- a constant time comparison is bit arithmetic */
export function sameToken(given: string, expected: string): boolean {
	let difference = given.length ^ expected.length;
	for (let index = 0; index < expected.length; index += 1) {
		difference |=
			(given.codePointAt(index % Math.max(given.length, 1)) ?? 0) ^
			expected.codePointAt(index)!;
	}

	return difference === 0;
}
/* eslint-enable no-bitwise */

export function isAuthMessage(message: unknown, token: string): boolean {
	if (typeof message !== 'string' || message.length > 1024) {
		return false;
	}

	try {
		const parsed = JSON.parse(message) as unknown;
		return (
			typeof parsed === 'object' &&
			parsed !== null &&
			(parsed as {type?: unknown}).type === 'auth' &&
			typeof (parsed as {token?: unknown}).token === 'string' &&
			sameToken((parsed as {token: string}).token, token)
		);
	} catch {
		return false;
	}
}
