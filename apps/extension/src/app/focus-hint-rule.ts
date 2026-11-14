/*
When the Board view is crowded: more columns than fit comfortably in a row, so the Focus view is the easier way
around. The banner that offers the switch lives in `focus-hint.tsx`; this holds the rule so tests run without a browser.
*/
import type {BookmarkBoardView} from '../shared/types';

// Matches the largest "Columns per row" setting: past it, a row can no longer hold every column.
export const FOCUS_HINT_COLUMNS = 6;

export const FOCUS_HINT_KEY = 'tablodge.focusHintDismissed';

export function suggestsFocusView(
	columnCount: number,
	view: BookmarkBoardView,
) {
	return view === 'board' && columnCount > FOCUS_HINT_COLUMNS;
}
