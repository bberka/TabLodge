import type {
	ActionResult,
	TabLodgeMessages,
	TabLodgeMessageType,
} from '../shared/types';
import {undoableEdit} from '../shared/undo-policy';
import {PROJECT} from './project';

type UndoOffer = (done: string, undoId: string) => void;
type UndoRetract = (undoId: string) => void;
let offerEditUndo: UndoOffer | undefined;
let retractEditUndo: UndoRetract | undefined;

export function onUndoOffer(offer: UndoOffer, retract: UndoRetract) {
	offerEditUndo = offer;
	retractEditUndo = retract;
	return () => {
		if (offerEditUndo !== offer) {
			return;
		}

		offerEditUndo = undefined;
		retractEditUndo = undefined;
	};
}

export function claimUndo(undoId: string | undefined) {
	if (undoId) {
		retractEditUndo?.(undoId);
	}
}

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
		const result: ActionResult<K> = answer ?? {
			ok: false,
			error: `${PROJECT.name} did not answer. Try again.`,
		};
		const edit = undoableEdit(type);
		if (edit && result.ok && 'undoId' in result && result.undoId) {
			offerEditUndo?.(edit.done, result.undoId);
		}

		return result;
	} catch {
		return {
			ok: false,
			error: `${PROJECT.name} was updated. Reload this page.`,
		};
	}
};
