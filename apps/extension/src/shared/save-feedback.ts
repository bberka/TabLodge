export type SaveOutcome =
	| {
			kind: 'saved';
			count: number;
			skipped: number;
			noun: string;
			into?: string;
			closed?: boolean;
	  }
	| {kind: 'duplicate'; skipped: number; noun: string}
	| {kind: 'failed'; error: string};

export type SaveKind = SaveOutcome['kind'];

export const UNDO_LABEL = 'Undo';
export const REOPEN_FAILED = 'Could not reopen the tabs.';

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export const duplicatesNote = (skipped: number) =>
	skipped > 0 ? ` ${count(skipped, 'duplicate')} not saved.` : '';

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

export const reopenedMessage = (reopened: number) =>
	`Reopened ${count(reopened, 'tab')}.`;

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

export const SAVE_BADGES: Record<SaveKind, {text: string; color: string}> = {
	saved: {text: '✓', color: '#15803d'},
	duplicate: {text: '=', color: '#b45309'},
	failed: {text: '!', color: '#b91c1c'},
};
