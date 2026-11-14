import {useCallback, useEffect, useState} from 'react';
import {plural, type ShowStatus} from './common';
import {findDuplicateTabs, reopenOrder, type ClosedTab} from './duplicate-tabs';

async function readTabs() {
	return chrome.tabs.query({windowType: 'normal'});
}

/**
Reopens closed duplicates in their window and position (a new tab in the same window if it is gone) and rejoins their tab group when it still exists. Returns how many came back.
*/
async function reopen(closed: readonly ClosedTab[]) {
	const windows = new Set<number>();
	try {
		for (const window of await chrome.windows.getAll({
			windowTypes: ['normal'],
		})) {
			if (window.id !== undefined) {
				windows.add(window.id);
			}
		}
	} catch {
		// Every tab then opens in the current window.
	}

	let count = 0;
	for (const entry of reopenOrder(closed)) {
		const inPlace = windows.has(entry.windowId);
		try {
			const created = await chrome.tabs.create({
				url: entry.url,
				active: false,
				...(inPlace && {windowId: entry.windowId, index: entry.index}),
			});
			count++;
			if (inPlace && entry.groupId !== undefined && created.id !== undefined) {
				await chrome.tabs
					.group({tabIds: created.id, groupId: entry.groupId})
					.catch(() => undefined);
			}
		} catch {
			// Skip a tab the browser would not reopen and carry on with the rest.
		}
	}

	return count;
}

/**
Closes the duplicate tabs (see `findDuplicateTabs`) and offers Undo, which reopens them.
*/
export async function closeDuplicateTabs(showStatus: ShowStatus) {
	try {
		const {close} = findDuplicateTabs(await readTabs());
		if (close.length === 0) {
			showStatus('No duplicate tabs to close.', false, {toast: true});
			return;
		}

		const closed: ClosedTab[] = [];
		for (const entry of close) {
			try {
				await chrome.tabs.remove(entry.id);
				closed.push(entry);
			} catch {
				// A tab that closed already is not a failure.
			}
		}

		showStatus(
			`Closed ${plural(closed.length, 'duplicate tab')} across ${plural(new Set(closed.map((entry) => entry.url)).size, 'address', 'addresses')}.`,
			false,
			{
				action: {
					label: 'Undo',
					async onClick() {
						const count = await reopen(closed);
						showStatus(
							count === closed.length
								? `Reopened ${plural(count, 'tab')}.`
								: `Reopened ${count} of ${plural(closed.length, 'tab')}.`,
							count !== closed.length,
							{toast: true},
						);
					},
				},
			},
		);
	} catch (reason) {
		showStatus(
			reason instanceof Error && reason.message
				? reason.message
				: 'Could not close the duplicate tabs.',
			true,
		);
	}
}

/**
How many tabs "Close duplicate tabs" would close right now. Updates live.
*/
export function useDuplicateTabCount() {
	const [count, setCount] = useState(0);
	const read = useCallback(async () => {
		try {
			setCount(findDuplicateTabs(await readTabs()).close.length);
		} catch {
			setCount(0);
		}
	}, []);
	useEffect(() => {
		if (!chrome.tabs?.query) {
			return;
		}

		let timer: number | undefined;
		const schedule = () => {
			globalThis.clearTimeout(timer);
			timer = globalThis.setTimeout(() => void read(), 120);
		};

		void read();
		const events = [
			chrome.tabs.onCreated,
			chrome.tabs.onRemoved,
			chrome.tabs.onUpdated,
			chrome.tabs.onActivated,
			chrome.tabs.onAttached,
			chrome.tabs.onDetached,
		];
		for (const event of events) {
			event?.addListener(schedule);
		}

		return () => {
			globalThis.clearTimeout(timer);
			for (const event of events) {
				event?.removeListener(schedule);
			}
		};
	}, [read]);
	return count;
}
