/*
The live channel at /v1/live: a WebSocket that tells devices a push changed the library, so they pull within a
moment instead of polling. It carries no records. Browsers cannot set headers on a WebSocket, so the token comes
in the first message:

	device -> {"type":"auth","token":"..."}
	server -> {"type":"ready","cursor":12}       or closes with LIVE_UNAUTHORIZED
	server -> {"type":"cursor","cursor":13}      after every push that applied a change
	device -> "ping"   server -> "pong"           keepalive, answered without waking a hibernated Durable Object
*/

export const LIVE_PATH = '/v1/live';
export const LIVE_PING = 'ping';
export const LIVE_PONG = 'pong';
export const LIVE_UNAUTHORIZED = 4401;
/**
A socket that has not sent a valid token by then is closed, so idle strangers cannot hold connections open.
*/
export const LIVE_AUTH_TIMEOUT_MS = 10_000;
/**
More open sockets than one person's devices ever need; past it new ones are refused.
*/
export const LIVE_MAX_SOCKETS = 64;

export const cursorMessage = (cursor: number) =>
	JSON.stringify({type: 'cursor', cursor});
export const readyMessage = (cursor: number) =>
	JSON.stringify({type: 'ready', cursor});

/**
Compares in time that does not depend on where the strings first differ.
*/
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

/**
True when a message is a valid auth message with the right token.
*/
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
