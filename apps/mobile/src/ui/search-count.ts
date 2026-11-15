import {useEffect, useState} from 'react';
import {SEARCH_COUNT_DELAY} from '../library/search-count';

/**
The text once it has stopped changing for a moment, so a count that follows typing is shown and announced after the
typing pauses, not on every key. Undefined while `active` is false, and until the first pause.
*/
export function useSettledText(active: boolean, text: string) {
	const [settled, setSettled] = useState<string>();
	useEffect(() => {
		if (!active) {
			setSettled(undefined);
			return;
		}

		const timer = setTimeout(() => {
			setSettled(text);
		}, SEARCH_COUNT_DELAY);
		return () => {
			clearTimeout(timer);
		};
	}, [active, text]);
	return active ? settled : undefined;
}
