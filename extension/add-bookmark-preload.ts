import {send} from '../src/app/message-client';

// Starts the add-bookmark window's data read while its page bundle loads. The page adopts this request.
if (!chrome.extension.inIncognitoContext) {
	const url = new URLSearchParams(location.search).get('url') || '';
	Object.defineProperty(globalThis, '__tablodgeBookmarkPrompt', {
		configurable: true,
		value: send('GET_BOOKMARK_PROMPT', {url}).catch(() => undefined),
	});
}
