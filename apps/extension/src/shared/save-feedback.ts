// One result shape and one wording for every save, on every surface: the toolbar badge, a page toast, and the Android
// snackbar all show what `saveMessage` says and what `SAVE_BADGES` marks. A skipped duplicate is never a success.

export type SaveOutcome =
	| {
			kind: 'saved';
			count: number;
			/**
			Duplicates left out of the same save.
			*/
			skipped: number;
			/**
			What was saved, singular: `tab`, `link`, or `bookmark`.
			*/
			noun: string;
			/**
			Where it went (a session or a column), when the surface knows.
			*/
			into?: string;
			/**
			The saved tabs were closed, so the message offers **Undo**.
			*/
			closed?: boolean;
	  }
	| {kind: 'duplicate'; skipped: number; noun: string}
	| {kind: 'failed'; error: string};

export type SaveKind = SaveOutcome['kind'];

export const UNDO_LABEL = 'Undo';
export const REOPEN_FAILED = 'Could not reopen the tabs.';

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
The note for a save that left duplicates out, such as " 2 duplicates not saved." (empty when none).
*/
export const duplicatesNote = (skipped: number) =>
	skipped > 0 ? ` ${count(skipped, 'duplicate')} not saved.` : '';

/**
What every surface says after a save.
*/
export function saveMessage(outcome: SaveOutcome): string {
	switch (outcome.kind) {
		case 'failed': {
			return outcome.error;
		}

		case 'duplicate': {
			return `Nothing saved.${duplicatesNote(outcome.skipped)}`;
		}

		case 'saved': {
			const where = outcome.into ? ` to ${outcome.into}` : '';
			const closed = outcome.closed ? ' and closed them' : '';
			return `Saved ${count(outcome.count, outcome.noun)}${where}${closed}.${duplicatesNote(outcome.skipped)}`;
		}
	}
}

/**
What every surface says after Undo reopens the tabs a save closed.
*/
export const reopenedMessage = (reopened: number) =>
	`Reopened ${count(reopened, 'tab')}.`;

/**
The outcome of a save result that reports how many items it stored and how many it skipped as duplicates. Nothing
stored with something skipped is a duplicate; nothing stored and nothing skipped is a failure with `empty` as the reason.
*/
export function saveOutcomeOf(
	result:
		{ok: true; count: number; skipped?: number} | {ok: false; error?: string},
	noun: string,
	options: {into?: string; closed?: boolean; empty?: string} = {},
): SaveOutcome {
	if (!result.ok) {
		return {kind: 'failed', error: result.error || 'Could not save.'};
	}

	const skipped = result.skipped ?? 0;
	if (result.count > 0) {
		return {
			kind: 'saved',
			count: result.count,
			skipped,
			noun,
			into: options.into,
			closed: options.closed,
		};
	}

	return skipped > 0
		? {kind: 'duplicate', skipped, noun}
		: {kind: 'failed', error: options.empty ?? 'Nothing was saved.'};
}

/**
The toolbar badge for each kind of result; a page toast says the same in words.
*/
export const SAVE_BADGES: Record<SaveKind, {text: string; color: string}> = {
	saved: {text: '✓', color: '#15803d'},
	duplicate: {text: '=', color: '#b45309'},
	failed: {text: '!', color: '#b91c1c'},
};
