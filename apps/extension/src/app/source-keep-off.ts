import type {ActionResult} from '../shared/types';
import {
	eventElements,
	type SourceLink,
	type SourceRead,
	type SourceReader,
} from './source-reader';

export type KeptSave = {link: SourceLink; replay: () => boolean};

export function replayClick(control: HTMLElement | undefined) {
	if (!control?.isConnected) {
		return false;
	}

	control.click();
	return true;
}

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
