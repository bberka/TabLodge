// How the Sources content script listens to a site's page, including Save to TabLodge only (#296): when the user
// chose it for the site, a click the adapter reads as a save is stopped before the site's own handlers see it, and
// the link goes to TabLodge alone. Every doubt lets the click through, so a broken adapter costs a normal site save,
// never a lost one: a click the adapter cannot read, a choice not loaded yet, and Shift held down all reach the site.
import type {ActionResult} from '../shared/types';
import {
	eventElements,
	type SourceLink,
	type SourceRead,
	type SourceReader,
} from './source-reader';

/**
A save stopped before the site saw it. `replay` clicks the same control again, which this listener lets through
because the browser marks a script's click untrusted; it is false when the control has left the page.
*/
export type KeptSave = {link: SourceLink; replay: () => boolean};

/**
Clicks the control again for the site: the nearest element on the click's path with a click method (an icon inside
a button has none). The browser marks that click untrusted, so the listener below lets it through.
*/
export function replayClick(control: HTMLElement | undefined) {
	if (!control?.isConnected) {
		return false;
	}

	control.click();
	return true;
}

/**
Listens for trusted clicks on the window in the capture phase, so the adapter reads a control before the site
changes it and a save can be stopped before the site acts on it. `keepOff` answers whether the site keeps saves off
it right now. `onRead` gets every read: `kept` for a save stopped here, else what the site handles as usual.
*/
export function listenForSaves(
	target: Pick<Window, 'addEventListener'>,
	{
		read,
		keepOff,
		onRead,
	}: {
		read: SourceReader;
		keepOff: () => boolean;
		onRead: (found: NonNullable<SourceRead>, kept?: KeptSave) => void;
	},
) {
	target.addEventListener(
		'click',
		(event) => {
			if (!event.isTrusted) {
				return;
			}

			const found = read(event);
			if (!found) {
				return;
			}

			if (
				found.kind === 'save' &&
				!(event as MouseEvent).shiftKey &&
				keepOff()
			) {
				const control = eventElements(event).find(
					(element): element is HTMLElement =>
						typeof (element as Partial<HTMLElement>).click === 'function',
				);
				event.preventDefault();
				event.stopImmediatePropagation();
				onRead(found, {
					link: found.link,
					replay: () => replayClick(control),
				});
				return;
			}

			onRead(found);
		},
		{capture: true},
	);
}

/**
What the page shows after a stopped save went to the worker. When the save failed or the source is off here, the
click is replayed so the site saves it after all. `alsoSave` offers Also save on the site; `undoId` offers Undo.
*/
export function settleKeptSave(
	result: ActionResult<'SITE_SOURCE_SAVE'> | undefined,
	kept: KeptSave,
	{app, site}: {app: string; site: string},
): {text: string; error: boolean; alsoSave: boolean; undoId?: string} {
	if (!result?.ok || result.outcome === 'off') {
		return {
			text: kept.replay()
				? `${app} could not save this, so ${site} saved it.`
				: `${app} could not save this, and ${site} did not either. Save it again.`,
			error: true,
			alsoSave: false,
		};
	}

	const texts = {
		saved: `Saved to ${app} only, in ${result.column}. ${site} won't show it as saved.`,
		exists: `Already in ${app}, so ${site} did not save it.`,
		trashed: `In the ${app} trash bin, so not saved again. ${site} did not save it.`,
	};
	return {
		text: texts[result.outcome],
		error: false,
		alsoSave: true,
		...(result.undoId && {undoId: result.undoId}),
	};
}
