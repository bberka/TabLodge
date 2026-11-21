import type {
	ActionResult,
	TabLodgeMessages,
	TabLodgeMessageType,
} from '../shared/types';
import {PROJECT} from './project';

type OptionalFields<K extends TabLodgeMessageType> =
	{} extends TabLodgeMessages[K]
		? [fields?: TabLodgeMessages[K]]
		: [fields: TabLodgeMessages[K]];

export const send = async <K extends TabLodgeMessageType>(
	type: K,
	...[fields]: OptionalFields<K>
): Promise<ActionResult<K>> => {
	try {
		const answer: ActionResult<K> | undefined =
			await chrome.runtime.sendMessage({type, ...fields});
		return (
			answer ?? {ok: false, error: `${PROJECT.name} did not answer. Try again.`}
		);
	} catch {
		// The worker is gone (the extension was reloaded or updated while this page stayed open).
		return {
			ok: false,
			error: `${PROJECT.name} was updated. Reload this page.`,
		};
	}
};
