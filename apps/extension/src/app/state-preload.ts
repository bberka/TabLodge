import type {ActionResult} from '../shared/types';
import {send} from './message-client';

type StateRequest = Promise<ActionResult<'GET_STATE'> | undefined>;

declare global {
	// Global declarations can only be augmented through interfaces in TypeScript.
	// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- Required for the Window global augmentation.
	interface Window {
		__tablodgeStateRequest?: StateRequest;
	}
}

export function startStateRequest() {
	if (
		chrome.extension.inIncognitoContext ||
		// eslint-disable-next-line unicorn/prefer-global-this -- The preload promise is typed on Window.
		window.__tablodgeStateRequest
	) {
		return;
	}

	// eslint-disable-next-line unicorn/prefer-global-this -- The preload promise is typed on Window.
	Object.defineProperty(window, '__tablodgeStateRequest', {
		configurable: true,
		value: send('GET_STATE').catch(() => undefined),
	});
}

export function takeStateRequest() {
	// eslint-disable-next-line unicorn/prefer-global-this -- The preload promise is typed on Window.
	const request = window.__tablodgeStateRequest;
	// eslint-disable-next-line unicorn/prefer-global-this -- The preload promise is typed on Window.
	Object.defineProperty(window, '__tablodgeStateRequest', {
		configurable: true,
		value: undefined,
	});
	return request;
}
