import type {BookmarkBoardView} from '../shared/types';

export const FOCUS_HINT_COLUMNS = 6;

export const FOCUS_HINT_KEY = 'tablodge.focusHintDismissed';

export function suggestsFocusView(
	columnCount: number,
	view: BookmarkBoardView,
) {
	return view === 'board' && columnCount > FOCUS_HINT_COLUMNS;
}
