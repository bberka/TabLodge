import {useSyncExternalStore} from 'react';
import {INBOX_PUBLIC_KEY} from '../shared/private-inbox';
import type {SendTarget} from '../shared/send-to-private';
import type {SendToPrivateState} from '../shared/types';
import type {ShowStatus} from './common';
import {send} from './message-client';
import {plural} from './plural';
import {inPrivateWindow, PRIVATE_CONFIG_KEY} from './private-config';

export {SEND_TO_PRIVATE_LABEL} from '../shared/send-to-private';

let sendState: SendToPrivateState = 'hidden';
const stateListeners = new Set<() => void>();
let watching = false;

async function loadSendState() {
	const result = await send('SEND_TO_PRIVATE_STATE');
	if (!result?.ok) {
		return;
	}

	sendState = result.state;
	for (const listener of stateListeners) {
		listener();
	}
}

function watchSendState(listener: () => void) {
	stateListeners.add(listener);
	if (!watching && !inPrivateWindow() && globalThis.chrome?.storage) {
		watching = true;
		void loadSendState();
		chrome.storage.onChanged.addListener((changes, area) => {
			if (
				area === 'local' &&
				(Object.hasOwn(changes, INBOX_PUBLIC_KEY) ||
					Object.hasOwn(changes, PRIVATE_CONFIG_KEY))
			) {
				void loadSendState();
			}
		});
	}

	return () => {
		stateListeners.delete(listener);
	};
}

export function useSendToPrivate(): SendToPrivateState {
	return useSyncExternalStore(watchSendState, () => sendState);
}

export async function sendLinksToPrivate(
	targets: SendTarget[],
	showStatus: ShowStatus,
	reload: () => unknown,
): Promise<boolean> {
	const result = await send('SEND_TO_PRIVATE', {targets});
	if (!result?.ok) {
		showStatus(
			result?.error || 'Could not send that to private storage.',
			true,
		);
		return false;
	}

	await reload();
	const message = `${plural(result.count, 'link')} sent to private storage.`;
	const {undoId} = result;
	if (!undoId) {
		showStatus(message, false, {toast: true});
		return true;
	}

	let undone = false;
	showStatus(message, false, {
		action: {
			label: 'Undo',
			async onClick() {
				undone = true;
				const undo = await send('UNDO', {id: undoId});
				if (undo?.ok) {
					showStatus('Brought back from private storage.', false, {
						toast: true,
					});
					await reload();
				} else {
					showStatus(
						undo?.error ||
							'Could not bring that back. It is already in private storage.',
						true,
					);
				}
			},
			onClose() {
				if (!undone) {
					void send('DROP_UNDO', {id: undoId});
				}
			},
		},
	});
	return true;
}
